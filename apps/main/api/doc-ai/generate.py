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
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler
from pathlib import Path

HERE = Path(__file__).resolve().parent
ASSETS = HERE / "_assets"
MANIFEST_PATH = ASSETS / "template-manifest.json"
TEMPLATE_PATH = ASSETS / "template.hwpx"
FIXED_HOURS_PATH = ASSETS / "fixed-hours-2026-2.json"
REGULATION_PATH = ASSETS / "regulation-2026.json"
CONSTANTS_PATH = ASSETS / "school-constants-2026-2.json"

# 검증된 엔진 (api/_hwpx). 이 폴더는 수정하지 않고 import 만 한다.
sys.path.insert(0, str(HERE.parent / "_hwpx"))
from hwpx_lib import (  # noqa: E402
    ln,
    _para_text,
    load_section,
    save_section,
    replace_text_anywhere,
    find_text_indices,
    scan_placeholders,
    verify_hwpx,
)
from hwpx_zip import pack, unpack  # noqa: E402

sys.path.insert(0, str(HERE))
import _v2fill  # noqa: E402
import _regulation  # noqa: E402

MAX_REQUEST_BYTES = 1_000_000


class BadRequest(Exception):
    """400 — 클라이언트가 고칠 수 있는 문제."""


class TemplateMissing(Exception):
    """409 — 해당 유형의 양식 파일이 아직 없음.

    variant/label 을 함께 실어 "어느 유형이 준비 중인지" 를 알린다.
    """

    def __init__(self, variant: str = "", label: str = ""):
        super().__init__(label or variant)
        self.variant = variant
        self.label = label


class RegulationViolation(Exception):
    """400 — 학업성적관리규정 위반 (ERROR). 위반 내용 + 근거 조문을 함께 전달한다."""

    def __init__(self, findings: list):
        super().__init__("; ".join(f["message"] for f in findings))
        self.findings = findings


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


def is_approved(authorization: str, user_id: str) -> bool:
    """승인 확인 (D20) — RLS 와 별개의 API 비용/자원 방어선.

    users_select 정책이 "본인 행" 을 예외 허용하므로 사용자 토큰으로 조회된다.
    행이 없거나 조회에 실패하면 **대기로 본다** (안전한 쪽).
    """
    url = os.environ.get("VITE_SUPABASE_URL")
    anon = os.environ.get("VITE_SUPABASE_ANON_KEY")
    if not url or not anon or not user_id:
        return False
    q = f"{url}/rest/v1/users?id=eq.{urllib.parse.quote(str(user_id))}&select=is_active"
    req = urllib.request.Request(q, headers={"apikey": anon, "Authorization": authorization})
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            rows = json.loads(resp.read().decode("utf-8"))
    except (urllib.error.HTTPError, urllib.error.URLError, ValueError):
        return False
    return bool(rows) and rows[0].get("is_active") is True


# ---------------------------------------------------------------------------
# manifest 기반 검증
# ---------------------------------------------------------------------------
def load_manifest() -> dict:
    with open(MANIFEST_PATH, encoding="utf-8") as f:
        return json.load(f)


def load_regulation() -> dict | None:
    """학업성적관리규정 룰셋. 없으면 규정 검증을 건너뛴다."""
    try:
        with open(REGULATION_PATH, encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        return None


def load_constants() -> dict:
    """학교 상수 (횟수 세트 등). 없으면 빈 dict — 그 경우 세트 안내를 건너뛴다."""
    try:
        with open(CONSTANTS_PATH, encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        return {}


def load_fixed_hours() -> dict | None:
    """시수/누계 고정표. 없으면 None (그 경우 교사·AI 값을 그대로 쓴다)."""
    try:
        with open(FIXED_HOURS_PATH, encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        return None


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


def validate_v2(manifest: dict, plan: dict, spec: dict | None = None) -> None:
    """v2 검증.

    막는 것 — 고칠 수 있고 고쳐야 하는 것만:
      · 교과 누락
      · 배점 정합성 (각 회차 100점 / 수행 영역 합 100점 / 반영비율 합 100%)
    막지 않는 것:
      · 내용의 빈칸 — '공란은 실패가 아니다' (prompt-rules 제1원칙)
      · 양식 수용 한도 초과 — 거부하지 않고 수용분만 채운 뒤 안내한다 (apply_capacity)
    """
    if not isinstance(plan, dict):
        raise BadRequest("fields 는 객체여야 합니다.")

    for key, label in (("perf_areas", "수행평가 영역"), ("perf_plans", "수행평가 출제 계획")):
        if key in plan and plan[key] is not None and not isinstance(plan[key], list):
            raise BadRequest(f"'{label}' 은 배열이어야 합니다.")

    if not str(plan.get("subject") or "").strip():
        raise BadRequest("필수 항목 '교과(과목명)' 이 비어 있습니다.")

    # 자유학기형은 점수화하지 않는다 — 배점 검증 자체가 성립하지 않는다
    if spec is not None and not spec.get("scoring", True):
        return

    problems = _v2fill.check_scales(plan)
    if problems:
        raise BadRequest("배점이 맞지 않습니다 — " + " / ".join(problems))


def regulation_findings(plan: dict, variant: str) -> list:
    """학업성적관리규정 검증 (V01~V18). 규정 자산이 없으면 빈 목록."""
    return _regulation.check(plan, load_regulation() or {}, variant)


def generate_v2(manifest: dict, plan: dict, check_only: bool = False):
    # 교과·학년으로 양식 유형을 정한다 (템플릿 패밀리)
    variant = _v2fill.resolve_variant(plan, manifest)
    spec = _v2fill.variant_spec(manifest, variant)
    print(f"[doc-ai/generate] variant: {variant} ({spec['label']})", file=sys.stderr)

    validate_v2(manifest, plan, spec)

    # 규정 한계선 — ERROR 는 생성을 막고, WARN·FLAG 는 안내로 넘긴다
    findings = regulation_findings(plan, variant)
    by = _regulation.split(findings)
    if by["ERROR"]:
        raise RegulationViolation(by["ERROR"])

    # 횟수 세트는 규정이 아니라 학교 관행이라 막지 않고 안내만 한다
    count_notes = _v2fill.check_perf_count(plan, (load_constants().get("perf_count_rule")))
    # 3분류 중 현행 양식에 칸이 없는 것(단답형·완성형)이 있으면 숨기지 않고 알린다
    count_notes += _v2fill.check_exam_categories(plan, manifest)

    if check_only:
        # 문서를 만들지 않고 판정만 돌려준다 (확인 카드용)
        return {
            "variant": variant,
            "variant_label": spec["label"],
            "findings": findings,
            "notices": count_notes,
            "template_ready": (ASSETS / spec["template_file"]).exists(),
        }

    template = ASSETS / spec["template_file"]
    if not template.exists():
        raise TemplateMissing(variant, spec["label"])

    # 양식이 담을 수 있는 만큼만 채운다. 넘치는 분은 잘라내고 무엇이 왜 빠졌는지 알린다
    # — 안 되는 걸 되는 것처럼 만들지 않는다.
    notices = ["[확인] " + _regulation.format_line(f) for f in by["FLAG"] + by["WARN"]]
    notices += count_notes
    notices += _v2fill.apply_capacity(plan, manifest, spec.get('limits'))
    for n in notices:
        print(f"[doc-ai/generate] capacity: {n}", file=sys.stderr)

    # 시수/누계는 학사일정 기반 고정표가 진실이다. PLAN_READY 의 hours_cum 은
    # 덮어쓴다 (AI 계산 금지). 교사가 직접 지정했으면 hours_manual 로 보존.
    hours = _v2fill.apply_fixed_hours(plan, load_fixed_hours())
    print(f"[doc-ai/generate] fixed_hours: {hours['reason']} {hours['months']}", file=sys.stderr)
    if not hours["applied"] and hours["reason"] == "weekly_hours 가 고정표 범위를 벗어남":
        notices.append(
            "주당 시수가 고정표 범위를 벗어나 시수/누계가 자동 입력되지 않았습니다. "
            "표에 들어간 값을 한글에서 확인해 주세요."
        )

    values, data = _v2fill.build_token_values(plan, manifest)

    tmp = Path(tempfile.mkdtemp(prefix="hwpx_"))
    try:
        work = tmp / "work"
        out = tmp / "out.hwpx"
        unpack(template, work)

        section = work / "Contents" / "section0.xml"
        if not section.exists():
            raise TemplateMismatch("template.hwpx 안에 Contents/section0.xml 이 없습니다.")
        tree, _root, sec = load_section(section)

        _v2fill.fill_document(
            sec, values, data, manifest,
            ln=ln,
            find_text_indices=find_text_indices,
            replace_text_anywhere=replace_text_anywhere,
            para_text=_para_text,
        )

        # final_check ① 잔여 토큰 0
        leftover = _v2fill.leftover_tokens(sec, ln=ln)
        if leftover:
            raise TemplateMismatch(
                f"치환되지 않은 토큰이 남았습니다: {', '.join(leftover[:8])}"
            )

        save_section(tree, section)
        pack(work, out)

        # final_check ② verify_hwpx
        expect = [t for t in (as_str(data.get("subject")), as_str(data.get("year"))) if t]
        verify_hwpx(out, expect_texts=expect, forbid_texts=["{{"])

        return (
            build_filename(manifest, data),
            base64.b64encode(out.read_bytes()).decode("ascii"),
            notices,
        )
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def as_str(v) -> str:
    return "" if v is None else str(v).strip()


def generate(payload: dict) -> tuple[str, str, list]:
    manifest = load_manifest()

    if int(manifest.get("manifest_version", 1)) >= 2:
        return generate_v2(manifest, payload.get("fields") or {},
                           check_only=bool(payload.get("check_only")))

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
        return build_filename(manifest, values), base64.b64encode(data).decode("ascii"), []
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

        # D20 — 승인 전에는 처리하지 않는다 (RLS 와 별개의 방어선)
        if not is_approved(self.headers.get("Authorization"), user.get("id")):
            return self._send(403, {
                "error": "PENDING_APPROVAL",
                "message": "승인 대기중입니다. 관리자 승인 후 이용할 수 있습니다.",
            })

        try:
            result = generate(payload)
            if isinstance(result, dict):        # check_only
                return self._send(200, result)
            filename, b64, notices = result
        except RegulationViolation as e:
            return self._send(400, {
                "error": "REGULATION_VIOLATION",
                "message": "학업성적관리규정에 어긋나는 항목이 있습니다.",
                "findings": e.findings,
            })
        except BadRequest as e:
            return self._send(400, {"error": str(e)})
        except TemplateMissing as e:
            label = e.label or e.variant
            return self._send(409, {
                "error": "TEMPLATE_MISSING",
                "variant": e.variant,
                "label": label,
                "message": (
                    f"'{label}' 양식이 아직 준비되지 않았습니다. "
                    "내용은 확정됐으니 양식 등록 후 다시 생성해 주세요."
                    if label else "양식(template.hwpx)이 아직 등록되지 않았습니다."
                ),
            })
        except TemplateMismatch as e:
            print(f"[doc-ai/generate] template mismatch: {e}", file=sys.stderr)
            return self._send(500, {"error": f"양식과 필드 명세가 어긋납니다: {e}"})
        except Exception as e:  # noqa: BLE001
            print(f"[doc-ai/generate] unexpected: {type(e).__name__}: {e}", file=sys.stderr)
            return self._send(500, {"error": f"문서 생성 중 오류가 발생했습니다: {e}"})

        return self._send(200, {"filename": filename, "base64": b64, "notices": notices})
