"""POST /api/collections/check-hwpx — 직접 업로드한 HWPX의 최소 확인."""
import json
import sys
from http.server import BaseHTTPRequestHandler
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _hwpx_basic import CheckError, REQUEST_LIMIT, check_file, parse_json


class handler(BaseHTTPRequestHandler):
    def log_message(self, *_args):
        # 요청 주소·헤더·서버 오류를 기본 HTTP 로그에 남기지 않는다.
        pass

    def _send(self, status, body):
        raw = json.dumps(body, ensure_ascii=False, allow_nan=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(raw)

    def do_GET(self):
        self.send_response(405)
        self.send_header("Allow", "POST")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()

    def do_POST(self):
        if self.headers.get("Transfer-Encoding"):
            return self._send(400, {"error": {"code": "INVALID_INPUT"}})
        try:
            lengths = self.headers.get_all("Content-Length", [])
            if len(lengths) != 1:
                raise ValueError()
            length = int(lengths[0])
            if length <= 0:
                raise ValueError()
        except ValueError:
            return self._send(400, {"error": {"code": "INVALID_INPUT"}})
        if length > REQUEST_LIMIT:
            return self._send(413, {"error": {"code": "INVALID_INPUT"}})
        # 작은 본문도 읽지 않고 소켓을 닫으면 일부 환경에서 오류 응답 자체가 유실된다.
        # 길이 검사를 먼저 끝내고 제한된 본문만 읽은 뒤 형식을 판정한다.
        try:
            self.connection.settimeout(5)
            raw = self.rfile.read(length)
        except (OSError, TimeoutError):
            return self._send(400, {"error": {"code": "INVALID_INPUT"}})
        if len(raw) != length:
            return self._send(400, {"error": {"code": "INVALID_INPUT"}})
        if self.headers.get("Content-Type", "").split(";", 1)[0].strip().lower() != "application/json":
            return self._send(415, {"error": {"code": "INVALID_INPUT"}})
        try:
            payload = parse_json(raw, "INVALID_INPUT", 400)
            response = check_file(payload, self.headers.get("Authorization"))
        except CheckError as error:
            return self._send(error.status, {"error": {"code": error.code}})
        except Exception:
            # 응답이 사라졌으면 같은 요청 번호로 재조회한다. 내부 예외 문자열은 노출하지 않는다.
            return self._send(503, {"error": {"code": "RESULT_UNKNOWN"}})
        return self._send(200, response)
