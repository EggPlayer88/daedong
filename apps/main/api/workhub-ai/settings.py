"""POST /api/workhub-ai/settings — 학교별 AI 키 관리. 원키를 로그에 남기지 않는다."""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
from http.server import BaseHTTPRequestHandler
import json
from _school_settings import execute, CheckError
from _assistant import parse_json


class handler(BaseHTTPRequestHandler):
    def log_message(self, *_args):
        pass

    def _send(self, status, body):
        raw = json.dumps(body, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(raw)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.end_headers(); self.wfile.write(raw)

    def do_GET(self):
        self._send(405, {'error': {'code': 'METHOD_NOT_ALLOWED'}})

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
            result = execute(parse_json(raw, 'INVALID_INPUT', 400), self.headers.get('Authorization'))
            self._send(200, result)
        except CheckError as error:
            self._send(error.status, {'error': {'code': error.code}})
        except Exception:
            self._send(503, {'error': {'code': 'RESULT_UNKNOWN'}})
