"""POST /api/workhub-documents/extract-knowledge — HWPX 원문 가져오기."""
import json
import sys
from http.server import BaseHTTPRequestHandler
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent))
from _knowledge_import import run,basic

class handler(BaseHTTPRequestHandler):
    def log_message(self,*_args):
        pass
    def _send(self,status,body):
        raw=json.dumps(body,ensure_ascii=False,allow_nan=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type","application/json; charset=utf-8")
        self.send_header("Content-Length",str(len(raw)))
        self.send_header("Cache-Control","no-store")
        self.send_header("X-Content-Type-Options","nosniff")
        self.end_headers()
        self.wfile.write(raw)
    def do_GET(self):
        self.send_response(405);self.send_header("Allow","POST");self.end_headers()
    def do_POST(self):
        try:
            lengths=self.headers.get_all("Content-Length",[])
            if self.headers.get("Transfer-Encoding") or len(lengths)!=1 or not 0<int(lengths[0])<=basic.REQUEST_LIMIT or self.headers.get("Content-Type","").split(";",1)[0].lower().strip()!="application/json":
                raise ValueError()
            self.connection.settimeout(5)
            raw=self.rfile.read(int(lengths[0]))
            if len(raw)!=int(lengths[0]):raise ValueError()
            payload=basic.parse_json(raw,"INVALID_INPUT",400)
        except (ValueError,OSError,basic.CheckError):
            return self._send(400,{"error":{"code":"INVALID_INPUT"}})
        try:
            result=run(payload,self.headers.get("Authorization"))
        except basic.CheckError as error:
            return self._send(error.status,{"error":{"code":error.code}})
        except Exception:
            return self._send(503,{"error":{"code":"RESULT_UNKNOWN"}})
        return self._send(200,result)
