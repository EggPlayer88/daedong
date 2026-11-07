"""나이스 자료 조회 갱신. POST는 현재 소속, GET은 서버 예약 실행 전용."""
import json
import sys
from http.server import BaseHTTPRequestHandler
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent))
from _service import execute, cron, CheckError, NeisError, parse_json


class handler(BaseHTTPRequestHandler):
    def log_message(self,*_args):
        pass

    def send_json(self,status,value):
        data=json.dumps(value,ensure_ascii=False,allow_nan=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type","application/json; charset=utf-8")
        self.send_header("Content-Length",str(len(data)))
        self.send_header("Cache-Control","no-store")
        self.send_header("X-Content-Type-Options","nosniff")
        self.end_headers()
        self.wfile.write(data)

    def run_action(self,action):
        try:
            return self.send_json(200,action())
        except CheckError as error:
            return self.send_json(error.status,{"error":{"code":error.code}})
        except NeisError as error:
            return self.send_json(400 if error.code=="INVALID_INPUT" else 503,{"error":{"code":error.code}})
        except Exception:
            return self.send_json(503,{"error":{"code":"RESULT_UNKNOWN"}})

    def do_GET(self):
        return self.run_action(lambda:cron(self.headers.get("Authorization")))

    def do_POST(self):
        def action():
            sizes=self.headers.get_all("Content-Length",[])
            if self.headers.get("Transfer-Encoding") or len(sizes)!=1 or not sizes[0].isdigit() or not 0<int(sizes[0])<=4096:
                raise CheckError("INVALID_INPUT",400)
            if self.headers.get("Content-Type","").split(";")[0].strip().lower()!="application/json":
                raise CheckError("INVALID_INPUT",400)
            self.connection.settimeout(5)
            data=self.rfile.read(int(sizes[0]))
            if len(data)!=int(sizes[0]):
                raise CheckError("INVALID_INPUT",400)
            return execute(parse_json(data,"INVALID_INPUT",400),self.headers.get("Authorization"))
        return self.run_action(action)
