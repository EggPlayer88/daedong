"""POST /api/workhub-ai/operations — 학교 관리자용 읽기 전용 운영 조회·진단."""
import json
import sys
from http.server import BaseHTTPRequestHandler
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _school_operations import execute
from _assistant import CheckError, parse_json


class handler(BaseHTTPRequestHandler):
    def log_message(self, *_args):
        pass

    def _send(self, status, body):
        raw = json.dumps(body, ensure_ascii=False, allow_nan=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(raw)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.end_headers(); self.wfile.write(raw)

    def do_GET(self):
        self.send_response(405); self.send_header('Allow', 'POST'); self.send_header('Cache-Control', 'no-store'); self.end_headers()

    def do_POST(self):
        try:
            lengths = self.headers.get_all('Content-Length', [])
            if self.headers.get('Transfer-Encoding') or len(lengths) != 1 or not lengths[0].isdigit():
                raise CheckError('INVALID_INPUT', 400)
            length = int(lengths[0])
            if not 0 < length <= 8192 or self.headers.get('Content-Type', '').split(';', 1)[0].strip().lower() != 'application/json':
                raise CheckError('INVALID_INPUT', 400)
            self.connection.settimeout(5)
            raw = self.rfile.read(length)
            if len(raw) != length:
                raise CheckError('INVALID_INPUT', 400)
            value = execute(parse_json(raw, 'INVALID_INPUT', 400), self.headers.get('Authorization'))
        except CheckError as problem:
            return self._send(problem.status, {'error': {'code': problem.code}})
        except Exception:
            # 원문 DB 오류·키·환경 변수는 HTTP 응답이나 로그에 싣지 않는다.
            return self._send(503, {'error': {'code': 'RESULT_UNKNOWN'}})
        return self._send(200, value)
