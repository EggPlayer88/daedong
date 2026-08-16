#!/usr/bin/env python3
"""POST /api/doc-ai/generate — 확정된 필드로 .hwpx 를 생성한다 (Vercel Python Function).

설계 원칙 (D19): AI 는 내용만, 서식은 이 코드가.
대화가 어떻게 흘렀든 결과물은 template.hwpx 의 양식을 그대로 따른다.

절차:
  1. Bearer 토큰을 Supabase 에 검증 위임
  2. manifest 로 필드 검증 (required / 비율 합 / repeating 개수)
  3. template.hwpx 존재 확인 → 없으면 409 TEMPLATE_MISSING
  4. unpack → 토큰 치환 (미사용 슬롯은 빈 문자열) → 잔여 토큰 0 확인
  5. pack → verify_hwpx → base64 JSON 응답

⚠ 한글 파일명을 HTTP 헤더로 보내면 인코딩 문제가 잦다. 바이너리 대신 base64 JSON 으로
   통일하고 프론트에서 Blob 으로 내려받는다.
"""
import base64
import json
import os
import re
import shutil
import sys
import tempfile
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler
from pathlib import Path

HERE = Path(__file__).resolve().parent
ASSETS = HERE / "_assets"
MANIFEST_PATH = ASSETS / "template-manifest.json"
TEMPLATE_PATH = ASSETS / "template.hwpx"

# 검증된 엔진 (api/_hwpx). 이 폴더는 수정하지 않고 import 만 한다.
sys.path.insert(0, str(HERE.parent / "_hwpx"))
from hwpx_lib import (  # noqa: E402
    load_section,
    save_section,
    replace_text_anywhere,
    find_text_indices,
    scan_placeholders,
    verify_hwpx,
)
from hwpx_zip import pack, unpack  # noqa: E402

MAX_REQUEST_BYTES = 1_000_000


class BadRequest(Exception):
    """400 — 클라이언트가 고칠 수 있는 문제."""


class TemplateMissing(Exception):
    """409 — 양식 파일이 아직 없음 (오늘은 이 상태가 정상)."""


class TemplateMismatch(Exception):
    """500 — 템플릿과 manifest 가 어긋남 (운영자가 고쳐야 함)."""


# ---------------------------------------------------------------------------
# 인증
# ---------------------------------------------------------------------------
def verify_user(authorization: str | None) -> dict | None:
    url = os.environ.get("VITE_SUPABASE_URL")
    anon = os.environ.get("VITE_SUPABASE_ANON_KEY")
    if not url or not anon:
        raise RuntimeError("서버에 VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY 가 설정되지 않았습니다.")
    if not authorization:
        return None

    req = urllib.request.Request(
        f"{url}/auth/v1/user",
        headers={"apikey": anon, "Authorization": authorization},
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError:
        return None


# ---------------------------------------------------------------------------
# manifest 기반 검증
# ---------------------------------------------------------------------------
def load_manifest() -> dict:
    with open(MANIFEST_PATH, encoding="utf-8") as f:
        return json.load(f)


def _as_number(value, label):
    if isinstance(value, bool):
        raise BadRequest(f"'{label}' 은 숫자여야 합니다.")
    if isinstance(value, (int, float)):
        return value
    try:
        s = str(value).strip().replace("%", "")
        return float(s) if "." in s else int(s)
    except (TypeError, ValueError):
        raise BadRequest(f"'{label}' 은 숫자여야 하는데 '{value}' 를 받았습니다.")


def validate_fields(manifest: dict, fields: dict) -> dict:
    """필드를 검증하고 기본값을 채운 dict 를 돌려준다. 실패 시 이유를 명시해 BadRequest."""
    if not isinstance(fields, dict):
        raise BadRequest("fields 는 객체여야 합니다.")

    clean = {}
    for spec in manifest["fields"]:
        key, label = spec["key"], spec["label"]
        value = fields.get(key)

        if value is None or (isinstance(value, str) and not value.strip()):
            if "default" in spec:
                value = spec["default"]
            elif spec.get("required"):
                raise BadRequest(f"필수 항목 '{label}' (key: {key}) 이 비어 있습니다.")
            else:
                value = ""

        if spec.get("type") == "number" and value != "":
            value = _as_number(value, label)
        clean[key] = value

    # 비율 합 검증
    ratio_keys = (manifest.get("validation") or {}).get("ratio_sum_100")
    if ratio_keys:
        total = 0
        for k in ratio_keys:
            total += _as_number(clean.get(k, 0), k)
        if round(total, 3) != 100:
            labels = " + ".join(
                next((f["label"] for f in manifest["fields"] if f["key"] == k), k)
                for k in ratio_keys
            )
            raise BadRequest(f"{labels} 의 합이 100 이어야 하는데 {total} 입니다.")

    # repeating_group 검증
    group = manifest.get("repeating_group")
    if group:
        gkey = group["key"]
        items = fields.get(gkey) or []
        if not isinstance(items, list):
            raise BadRequest(f"'{group['label']}' (key: {gkey}) 은 배열이어야 합니다.")
        if not (group["min"] <= len(items) <= group["max"]):
            raise BadRequest(
                f"'{group['label']}' 은 {group['min']}~{group['max']}개여야 하는데 "
                f"{len(items)}개를 받았습니다."
            )
        norm = []
        for i, item in enumerate(items, start=1):
            if not isinstance(item, dict):
                raise BadRequest(f"'{group['label']}' {i}번째 항목이 객체가 아닙니다.")
            row = {}
            for it in group["item_fields"]:
                v = item.get(it["key"])
                if v is None or (isinstance(v, str) and not v.strip()):
                    raise BadRequest(
                        f"'{group['label']}' {i}번째의 '{it['label']}' 이 비어 있습니다."
                    )
                row[it["key"]] = v
            norm.append(row)
        clean[gkey] = norm

    return clean


# ---------------------------------------------------------------------------
# 치환
# ---------------------------------------------------------------------------
def replace_token(sec, token: str, text: str, *, required: bool) -> int:
    """토큰을 치환한다. required=False 면 템플릿에 없어도 통과."""
    idxs = find_text_indices(sec, token)
    if not idxs:
        if required:
            raise TemplateMismatch(
                f"템플릿에 토큰 {token} 이 없습니다. template.hwpx 와 manifest 가 어긋납니다."
            )
        return 0
    total = 0
    children = list(sec)
    for i in idxs:
        total += replace_text_anywhere(children[i], token, text, required=False)
    return total


def fill_template(manifest: dict, values: dict, work: Path) -> None:
    section = work / "Contents" / "section0.xml"
    if not section.exists():
        raise TemplateMismatch("template.hwpx 안에 Contents/section0.xml 이 없습니다.")

    tree, _root, sec = load_section(section)

    # 1) 단일 필드
    for spec in manifest["fields"]:
        value = values.get(spec["key"], "")
        replace_token(sec, spec["token"], "" if value is None else str(value),
                      required=bool(spec.get("required")))

    # 2) repeating_group — 1..max 슬롯을 전부 채운다.
    #    입력된 슬롯은 값으로, 미사용 슬롯은 빈 문자열로 (fixed_rows_blank_unused)
    group = manifest.get("repeating_group")
    if group:
        items = values.get(group["key"], [])
        for n in range(1, group["max"] + 1):
            item = items[n - 1] if n <= len(items) else None
            for it in group["item_fields"]:
                token = it["token_pattern"].replace("{n}", str(n))
                text = "" if item is None else str(item.get(it["key"], ""))
                # 미사용 슬롯 토큰이 템플릿에 없을 수 있으므로 required=False
                replace_token(sec, token, text, required=False)

    # 3) 잔여 토큰 확인 — {{ 가 남아 있으면 템플릿/manifest 불일치 신호
    leftover = [
        (ph, txt) for ph, txt in scan_placeholders(sec, extra=["{{"]) if ph == "{{"
    ]
    if leftover:
        preview = " / ".join(t for _ph, t in leftover[:5])
        raise TemplateMismatch(
            f"치환되지 않은 토큰이 {len(leftover)}건 남았습니다: {preview}"
        )

    save_section(tree, section)


def build_filename(manifest: dict, values: dict) -> str:
    pattern = manifest.get("filename_pattern") or "{doc_type}.hwpx"
    try:
        name = pattern.format(**values)
    except KeyError as e:
        raise TemplateMismatch(f"filename_pattern 에 알 수 없는 key {e} 가 있습니다.")
    # 파일명에 쓸 수 없는 문자 제거 (경로 조작 방지 포함)
    name = re.sub(r'[\\/:*?"<>|\x00-\x1f]', "_", name).strip()
    return name or "평가계획서.hwpx"


def generate(payload: dict) -> tuple[str, str]:
    manifest = load_manifest()

    # manifest v2 는 키 구조가 다르고(basic_fields/monthly_plan/exam/perf_plans…)
    # token 값이 전부 TBD 다. 토큰 맵은 내일 template.hwpx v2 확정본과 함께 온다.
    # 그때까지 이 함수는 v1 로직을 그대로 두되, v2 manifest 로 호출되면
    # 아래에서 명확히 멈춘다 — 검증을 억지로 돌려 엉뚱한 오류를 내지 않는다.
    if int(manifest.get("manifest_version", 1)) >= 2:
        if not TEMPLATE_PATH.exists():
            raise TemplateMissing()
        raise TemplateMismatch(
            "manifest v2 의 토큰 맵이 아직 구현되지 않았습니다 "
            "(template.hwpx v2 확정본 수령 후 작업 예정)."
        )

    values = validate_fields(manifest, payload.get("fields"))

    if not TEMPLATE_PATH.exists():
        raise TemplateMissing()

    tmp = Path(tempfile.mkdtemp(prefix="hwpx_"))
    try:
        work = tmp / "work"
        out = tmp / "out.hwpx"
        unpack(TEMPLATE_PATH, work)
        fill_template(manifest, values, work)
        pack(work, out)

        expect = [str(values[k]) for k in ("subject", "year") if values.get(k) not in (None, "")]
        verify_hwpx(out, expect_texts=expect, forbid_texts=["{{"])

        data = out.read_bytes()
        return build_filename(manifest, values), base64.b64encode(data).decode("ascii")
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


# ---------------------------------------------------------------------------
# HTTP 핸들러
# ---------------------------------------------------------------------------
class handler(BaseHTTPRequestHandler):
    def _send(self, status: int, body: dict) -> None:
        raw = json.dumps(body, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def do_GET(self):  # noqa: N802
        self.send_response(405)
        self.send_header("Allow", "POST")
        self.end_headers()

    def do_POST(self):  # noqa: N802
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            return self._send(400, {"error": "Content-Length 가 올바르지 않습니다."})
        if length > MAX_REQUEST_BYTES:
            return self._send(413, {"error": "요청이 너무 큽니다."})

        try:
            payload = json.loads(self.rfile.read(length).decode("utf-8") or "{}")
        except (ValueError, UnicodeDecodeError):
            return self._send(400, {"error": "JSON 본문을 해석하지 못했습니다."})

        try:
            user = verify_user(self.headers.get("Authorization"))
        except RuntimeError as e:
            return self._send(500, {"error": str(e)})
        except Exception as e:  # 네트워크 등
            return self._send(502, {"error": f"인증 서버에 연결하지 못했습니다: {e}"})
        if not user:
            return self._send(401, {"error": "로그인이 필요합니다."})

        try:
            filename, b64 = generate(payload)
        except BadRequest as e:
            return self._send(400, {"error": str(e)})
        except TemplateMissing:
            return self._send(409, {
                "error": "TEMPLATE_MISSING",
                "message": "양식(template.hwpx)이 아직 등록되지 않았습니다.",
            })
        except TemplateMismatch as e:
            print(f"[doc-ai/generate] template mismatch: {e}", file=sys.stderr)
            return self._send(500, {"error": f"양식과 필드 명세가 어긋납니다: {e}"})
        except Exception as e:  # noqa: BLE001
            print(f"[doc-ai/generate] unexpected: {type(e).__name__}: {e}", file=sys.stderr)
            return self._send(500, {"error": f"문서 생성 중 오류가 발생했습니다: {e}"})

        return self._send(200, {"filename": filename, "base64": b64})
