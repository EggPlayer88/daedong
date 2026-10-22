"""POST /api/workhub-ai/chat — 승인된 학교·개인 범위의 Claude 비서."""
import json
import sys
from http.server import BaseHTTPRequestHandler
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
from _assistant import CheckError, LIMITS, parse_json
from _school_policy import execute

class handler(BaseHTTPRequestHandler):
    def log_message(self, *_args):
        pass
    def _send(self, status, body):
        raw = json.dumps(body, ensure_ascii=False, allow_nan=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers(); self.wfile.write(raw)
    def do_GET(self):
        self.send_response(405); self.send_header("Allow", "POST"); self.send_header("Cache-Control", "no-store"); self.end_headers()
    def do_POST(self):
        try:
            if self.headers.get("Transfer-Encoding"):
                raise CheckError("INVALID_INPUT", 400)
            lengths = self.headers.get_all("Content-Length", [])
            if len(lengths) != 1:
                raise CheckError("INVALID_INPUT", 400)
            try:
                length = int(lengths[0])
                if length <= 0 or length > LIMITS["requestBytes"]:
                    raise ValueError()
            except ValueError:
                raise CheckError("INVALID_INPUT", 400) from None
            self.connection.settimeout(5)
            raw = self.rfile.read(length)
            if len(raw) != length or self.headers.get("Content-Type", "").split(";", 1)[0].strip().lower() != "application/json":
                raise CheckError("INVALID_INPUT", 400)
            payload = parse_json(raw, "INVALID_INPUT", 400)
            result = execute(payload, self.headers.get("Authorization"))
        except CheckError as error:
            return self._send(error.status, {"error": {"code": error.code}})
        except Exception:
            return self._send(503, {"error": {"code": "RESULT_UNKNOWN"}})
        return self._send(200, result)
