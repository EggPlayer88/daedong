#!/usr/bin/env python3
"""POST /api/doc-ai/extract — 참고자료 hwpx 에서 본문 텍스트를 뽑는다.

용도: 교사가 지난 학기(또는 작년 동학기) 평가계획서를 올리면 그 내용을 초안의
1차 재료로 쓴다 (prompt-rules.v2.md 대화 2단계와 연동).

요청:  { "filename": "2026_1학기_과학.hwpx", "base64": "..." }
응답:  { "filename": ..., "text": "...", "chars": 1234, "truncated": false }

프론트는 받은 text 를 "[참고자료: 파일명]\\n<본문>" 형식의 user 메시지로 대화에 넣는다.

⚠ 추출 엔진(_hwpx/extract_text.py)은 검증된 확정본이다. 수정하지 않고 import 만 한다.
"""
import base64
import binascii
import json
import os
import sys
import tempfile
import urllib.error
import urllib.request
import zipfile
from http.server import BaseHTTPRequestHandler
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "_hwpx"))
from extract_text import extract, table_to_markdown  # noqa: E402

# Vercel 서버리스 함수의 요청 본문 상한(약 4.5MB)을 감안한 값.
# base64 는 원본의 약 4/3 이므로 원본 3MB 까지 허용한다.
MAX_FILE_BYTES = 3 * 1024 * 1024
MAX_REQUEST_BYTES = 5 * 1024 * 1024

# 대화에 통째로 실리므로 상한을 둔다 (chat.js 의 총 길이 상한과 맞물림)
MAX_TEXT_CHARS = 20000


class BadRequest(Exception):
    pass


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


def blocks_to_text(blocks: list[dict]) -> str:
    """문단은 그대로, 표는 마크다운으로. AI 가 읽기 좋은 형태로 합친다."""
    parts = []
    for b in blocks:
        if b["type"] == "table":
            md = table_to_markdown(b["rows"])
            if md.strip():
                parts.append(md)
        else:
            t = (b.get("text") or "").strip()
            if t:
                parts.append(t)
    return "\n\n".join(parts)


def extract_payload(payload: dict) -> dict:
    filename = (payload.get("filename") or "참고자료.hwpx").strip()
    b64 = payload.get("base64")
    if not isinstance(b64, str) or not b64:
        raise BadRequest("base64 필드가 없습니다.")

    try:
        raw = base64.b64decode(b64, validate=True)
    except (binascii.Error, ValueError):
        raise BadRequest("파일을 해석하지 못했습니다 (base64 오류).")

    if len(raw) > MAX_FILE_BYTES:
        raise BadRequest(
            f"파일이 너무 큽니다 ({len(raw) // 1024}KB / 상한 {MAX_FILE_BYTES // 1024}KB)."
        )
    if not raw.startswith(b"PK"):
        raise BadRequest("hwpx 파일이 아닙니다. 한글에서 '한/글 문서(*.hwpx)'로 저장해 주세요.")

    tmp = Path(tempfile.mkdtemp(prefix="extract_"))
    path = tmp / "ref.hwpx"
    try:
        path.write_bytes(raw)
        try:
            blocks = extract(path)
        except zipfile.BadZipFile:
            raise BadRequest("압축이 깨진 파일입니다.")
        except Exception as e:  # noqa: BLE001
            raise BadRequest(f"본문을 읽지 못했습니다: {type(e).__name__}")

        text = blocks_to_text(blocks)
        if not text.strip():
            raise BadRequest(
                "본문 텍스트를 찾지 못했습니다. hwp 파일이라면 한글에서 hwpx 로 저장해 주세요."
            )

        truncated = len(text) > MAX_TEXT_CHARS
        if truncated:
            text = text[:MAX_TEXT_CHARS] + "\n\n…(이하 생략 — 파일이 길어 앞부분만 사용합니다)"

        return {
            "filename": filename,
            "text": text,
            "chars": len(text),
            "truncated": truncated,
            "blocks": len(blocks),
        }
    finally:
        for p in sorted(tmp.rglob("*"), reverse=True):
            p.unlink(missing_ok=True)
        tmp.rmdir()


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
            result = extract_payload(payload)
        except BadRequest as e:
            return self._send(400, {"error": str(e)})
        except Exception as e:  # noqa: BLE001
            print(f"[doc-ai/extract] unexpected: {type(e).__name__}: {e}", file=sys.stderr)
            return self._send(500, {"error": f"추출 중 오류가 발생했습니다: {e}"})

        return self._send(200, result)
