"""로컬 HTTP 서버로 R1 전송 경계를 검증한다. Supabase·실제 키·학교 자료는 쓰지 않는다."""
import base64
import http.server
import json
import os
from pathlib import Path
import socket
import sys
import threading
import time
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from workers.collection_files.common import WorkerError
from workers.collection_files.transport import BUCKET, RPC_NAMES, SupabaseTransport


KEY = "sb_secret_" + "fixture-only-not-a-real-key-0001"
RPC = "workhub_file_worker_claim"
PATH = "school-1/12345678-1234-1234-1234-123456789abc/" + "a" * 32
HOSTED = "https://abcdefghijklmnopqrst.supabase.co"
passed = failed = 0


def test(label, action):
    global passed, failed
    try:
        action()
        passed += 1
        print("  ✓ " + label)
    except Exception as error:
        failed += 1
        print("  ✗ " + label + ": " + type(error).__name__ + " " + str(error))


def expect(code, action):
    try:
        action()
    except WorkerError as error:
        assert error.code == code, (error.code, code)
        assert str(error) == code and KEY not in repr(error)
    else:
        raise AssertionError("예상한 오류가 발생하지 않음")


def jwt(payload):
    encoded = base64.urlsafe_b64encode(json.dumps(payload).encode()).decode().rstrip("=")
    return "eyJhbGciOiJIUzI1NiJ9." + encoded + ".fixture-signature"


class Server(http.server.ThreadingHTTPServer):
    daemon_threads = True
    def handle_error(self, request, client_address):
        pass


class Handler(http.server.BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    def log_message(self, *args):
        pass
    def do_GET(self):
        self.answer()
    def do_POST(self):
        self.answer()
    def do_DELETE(self):
        self.answer()
    def answer(self):
        body = self.rfile.read(int(self.headers.get("Content-Length", "0")))
        self.server.calls.append((self.command, self.path, dict(self.headers), body))
        mode = self.server.mode
        if mode == "slow_headers":
            self.connection.sendall(b"HTTP/1.1 200 OK\r\nX-Slow: ")
            for _ in range(20):
                time.sleep(0.03)
                self.connection.sendall(b"a")
            return
        if mode == "delay":
            time.sleep(0.35)
        status = self.server.status
        raw = self.server.body
        headers = list(self.server.headers)
        self.send_response(status)
        for name, value in headers:
            self.send_header(name, value)
        if mode == "normal" or mode == "delay":
            self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        if mode == "trickle":
            for value in raw:
                time.sleep(0.03)
                self.wfile.write(bytes([value]))
                self.wfile.flush()
        else:
            self.wfile.write(raw)
        self.wfile.flush()
        self.close_connection = True


server = Server(("127.0.0.1", 0), Handler)
threading.Thread(target=server.serve_forever, daemon=True).start()
URL = "http://127.0.0.1:" + str(server.server_address[1])


def fixture(body=b"[]", status=200, headers=(), mode="normal", key=KEY, timeout=2):
    server.body, server.status, server.headers, server.mode, server.calls = body, status, headers, mode, []
    return SupabaseTransport(URL, key, timeout_seconds=timeout, allow_local=True)


def invalid_urls():
    for url in ("http://abcdefghijklmnopqrst.supabase.co", HOSTED + "/rest/v1", HOSTED + "?x=y", HOSTED + "#x",
                "https://user:pass@abcdefghijklmnopqrst.supabase.co", "https://abcdefghijklmnopqrst.supabase.co.attacker.test",
                "https://localhost", "https://127.0.0.1", "http://localhost:3333", HOSTED + ":444", " " + HOSTED):
        expect("INVALID_TRANSPORT_CONFIG", lambda: SupabaseTransport(url, KEY, allow_local=True))
    expect("INVALID_TRANSPORT_CONFIG", lambda: SupabaseTransport(URL, KEY))
    SupabaseTransport(HOSTED, KEY)

test("고정 Supabase HTTPS 또는 명시한 loopback만 허용한다", invalid_urls)


def invalid_keys():
    for key in ("sb_publishable_fixture-key-000000000", "short", "a.b.c", KEY + "\n", jwt({"role": "authenticated"}),
                jwt({"role": "service_role", "sub": "human-id"}), jwt({"role": "service_role", "sub": 7})):
        expect("INVALID_TRANSPORT_CONFIG", lambda: SupabaseTransport(HOSTED, key))
    for value in (True, 0, -1, float("nan"), 121, "10"):
        expect("INVALID_TRANSPORT_CONFIG", lambda: SupabaseTransport(HOSTED, KEY, timeout_seconds=value))

test("공개 키·사람 세션·깨진 키·잘못된 제한시간을 네트워크 전에 거부한다", invalid_keys)


def secret_headers():
    client = fixture(b'{"items":[]}')
    assert client.rpc(RPC, {"p_limit": 1}) == {"items": []}
    method, path, headers, body = server.calls[0]
    assert method == "POST" and path == "/rest/v1/rpc/" + RPC
    assert headers["apikey"] == KEY and "Authorization" not in headers
    assert json.loads(body) == {"p_limit": 1}
    assert KEY not in repr(client) and KEY not in str(client)

test("새 비밀 키는 apikey로만 보내고 객체 repr에 노출하지 않는다", secret_headers)


def legacy_headers():
    key = jwt({"role": "service_role", "iss": "supabase"})
    client = fixture(key=key)
    assert client.rpc(RPC, {}) == []
    headers = server.calls[0][2]
    assert headers["apikey"] == key and headers["Authorization"] == "Bearer " + key

test("기존 service_role JWT는 사람 세션 없이 전용 헤더로 연결한다", legacy_headers)


def no_proxy():
    client = fixture()
    with patch.dict(os.environ, {"HTTP_PROXY": "http://127.0.0.1:1", "HTTPS_PROXY": "http://127.0.0.1:1", "NO_PROXY": ""}):
        assert client.rpc(RPC, {}) == []
    assert len(server.calls) == 1

test("환경 프록시로 서비스 키를 전달하지 않는다", no_proxy)


def rpc_allowlist():
    client = fixture()
    assert len(RPC_NAMES) == 8
    for name in ("workhub_collection_list", "../auth/users", "workhub_file_worker_claim?x=1", None):
        expect("INVALID_TRANSPORT_REQUEST", lambda: client.rpc(name, {}))
    expect("INVALID_TRANSPORT_REQUEST", lambda: client.rpc(RPC, []))
    expect("INVALID_TRANSPORT_REQUEST", lambda: client.rpc(RPC, {"data": "x" * 70000}))
    expect("INVALID_TRANSPORT_REQUEST", lambda: client.rpc(RPC, {"data": float("nan")}))
    assert not server.calls

test("R1 작업자 8개 외 RPC·깨진 인자·과대한 요청을 거부한다", rpc_allowlist)


def download_and_remove():
    client = fixture(b"%PDF-1.7\nfixture")
    assert client.download(BUCKET, PATH, 100, time.monotonic() + 5).startswith(b"%PDF")
    assert server.calls[0][1] == "/storage/v1/object/" + BUCKET + "/" + PATH
    client = fixture(b'[]')
    assert client.remove(BUCKET, PATH) is None
    method, path, headers, body = server.calls[0]
    assert method == "DELETE" and path == "/storage/v1/object/" + BUCKET
    assert json.loads(body) == {"prefixes": [PATH]}

test("Storage 직접 내려받기와 단일 경로 remove가 실제 HTTP로 나간다", download_and_remove)


def invalid_objects():
    client = fixture()
    for path in ("../secret", PATH + "?token=x", PATH + "/", PATH.replace("/", "%2f"), PATH.replace("school-1", ".."), "https://attacker.test/file"):
        expect("INVALID_TRANSPORT_REQUEST", lambda: client.download(BUCKET, path, 10, time.monotonic() + 1))
        expect("INVALID_TRANSPORT_REQUEST", lambda: client.remove(BUCKET, path))
    expect("INVALID_TRANSPORT_REQUEST", lambda: client.remove("other-bucket", PATH))
    expect("INVALID_TRANSPORT_REQUEST", lambda: client.remove(BUCKET, PATH, deadline=float("nan")))
    expect("INVALID_TRANSPORT_REQUEST", lambda: client.download(BUCKET, PATH, True, time.monotonic() + 1))
    expect("INVALID_TRANSPORT_REQUEST", lambda: client.download(BUCKET, PATH, 10, float("nan")))
    assert not server.calls

test("다른 버킷·경로 탈출·쿼리·서명 URL·잘못된 상한을 호출 전에 차단한다", invalid_objects)


def redirects():
    for status in (301, 302, 303, 307, 308):
        client = fixture(status=status, headers=(("Location", "http://127.0.0.1:1/private"),))
        expect("TRANSPORT_REDIRECT", lambda: client.rpc(RPC, {}))
        assert len(server.calls) == 1

test("모든 리다이렉트를 따라가지 않아 키가 다른 주소에 나가지 않는다", redirects)


def errors():
    for status, code in ((401, "TRANSPORT_AUTH"), (403, "TRANSPORT_AUTH"), (429, "TRANSPORT_HTTP"), (500, "TRANSPORT_HTTP")):
        client = fixture(KEY.encode(), status=status)
        expect(code, lambda: client.rpc(RPC, {}))
    for message in ("FORBIDDEN", "CONFLICT", "NOT_READY", "INVALID_INPUT", "NOT_FOUND"):
        client = fixture(json.dumps({"code": "P0001", "message": message, "details": KEY}).encode(), status=400)
        expect("RPC_" + message, lambda: client.rpc(RPC, {}))
    client = fixture(b'{"code":"P0001","message":"CONFLICT secret"}', status=400)
    expect("TRANSPORT_HTTP", lambda: client.rpc(RPC, {}))

test("업무 오류 5종만 정확히 구별하고 서버 원문·비밀 상세는 제거한다", errors)


def storage_errors():
    for status, code in ((404, "STORAGE_NOT_FOUND"), (401, "TRANSPORT_AUTH"), (403, "TRANSPORT_AUTH"), (400, "TRANSPORT_HTTP")):
        client = fixture(status=status)
        expect(code, lambda: client.download(BUCKET, PATH, 100, time.monotonic() + 2))

test("Storage 접근 오류를 실물 없음이나 삭제 성공으로 바꾸지 않는다", storage_errors)


def invalid_json():
    for raw in (b"not json", b"", b"{", b"\xff", b'{"a":NaN}', b'{"a":1,"a":2}', b"[" * 1500):
        client = fixture(raw)
        expect("TRANSPORT_RESPONSE", lambda: client.rpc(RPC, {}))
    client = fixture(b'{"error":"hidden"}')
    expect("TRANSPORT_RESPONSE", lambda: client.remove(BUCKET, PATH))

test("깨진 UTF-8·JSON·중복 키·NaN·과도한 중첩·잘못된 삭제 응답을 거부한다", invalid_json)


def response_limit():
    client = fixture(b"x" * (1024 * 1024 + 1))
    expect("TRANSPORT_LIMIT", lambda: client.rpc(RPC, {}))
    client = fixture(b"x" * 12)
    expect("SIZE_LIMIT", lambda: client.download(BUCKET, PATH, 10, time.monotonic() + 2))
    client = fixture(b"x" * 12, mode="without_length")
    expect("SIZE_LIMIT", lambda: client.download(BUCKET, PATH, 10, time.monotonic() + 2))

test("Content-Length 유무와 관계없이 JSON·실물 크기 상한을 강제한다", response_limit)


def chunked_limit():
    client = fixture(b"c\r\n" + b"x" * 12 + b"\r\n0\r\n\r\n", headers=(("Transfer-Encoding", "chunked"),), mode="without_length")
    expect("SIZE_LIMIT", lambda: client.download(BUCKET, PATH, 10, time.monotonic() + 2))

test("분할 전송도 누적 바이트 상한을 넘으면 중단한다", chunked_limit)


def bad_headers():
    variants = [(("Content-Encoding", "gzip"),), (("Content-Length", "20"),),
                (("Content-Length", "-1"),), (("Transfer-Encoding", "chunked"), ("Content-Length", "2"))]
    for headers in variants:
        client = fixture(b"[]", headers=headers, mode="normal" if len(headers) == 1 and headers[0][1] == "20" else "without_length")
        expect("TRANSPORT_RESPONSE", lambda: client.rpc(RPC, {}))
    client = fixture(b"x", headers=(("Content-Length", "10"),), mode="without_length")
    expect("TRANSPORT_RESPONSE", lambda: client.download(BUCKET, PATH, 100, time.monotonic() + 2))

test("압축 응답·중복 길이·음수 길이·혼합 프레이밍·잘린 본문을 거부한다", bad_headers)


def total_deadline():
    client = fixture(b"x" * 20, mode="trickle", timeout=1)
    start = time.monotonic()
    expect("TRANSPORT_TIMEOUT", lambda: client.download(BUCKET, PATH, 100, start + 0.13))
    assert time.monotonic() - start < 0.6
    time.sleep(0.08)

test("조금씩 계속 도착하는 파일도 전체 마감시각을 넘기지 않는다", total_deadline)


def headers_deadline():
    client = fixture(mode="slow_headers", timeout=0.12)
    start = time.monotonic()
    expect("TRANSPORT_TIMEOUT", lambda: client.rpc(RPC, {}))
    assert time.monotonic() - start < 0.6
    time.sleep(0.08)

test("헤더가 느리게 도착해도 전체 제한시간에 멈춘다", headers_deadline)


def expired_deadline():
    client = fixture()
    expect("TRANSPORT_TIMEOUT", lambda: client.download(BUCKET, PATH, 100, time.monotonic() - 1))
    assert not server.calls

test("이미 끝난 임대 마감시각이면 네트워크를 열지 않는다", expired_deadline)


def cleanup_deadline():
    client = fixture()
    expect("TRANSPORT_TIMEOUT", lambda: client.remove(BUCKET, PATH, deadline=time.monotonic() - 1))
    assert not server.calls
    client = fixture(mode="delay", timeout=2)
    start = time.monotonic()
    expect("TRANSPORT_TIMEOUT", lambda: client.remove(BUCKET, PATH, deadline=start + 0.1))
    assert time.monotonic() - start < 0.6 and len(server.calls) == 1
    assert server.calls[0][0] == "DELETE"
    time.sleep(0.08)

test("삭제도 남은 임대시간 안에서 한 번만 요청하고 응답 유실을 성공 처리하지 않는다", cleanup_deadline)


def stalled_dns():
    client = fixture(timeout=0.08)
    original = socket.getaddrinfo
    gate = threading.Event()
    def delay(*args, **kwargs):
        gate.wait(2)
        return original(*args, **kwargs)
    with patch("socket.getaddrinfo", delay):
        start = time.monotonic()
        expect("TRANSPORT_TIMEOUT", lambda: client.rpc(RPC, {}))
        assert time.monotonic() - start < 0.5
        expect("TRANSPORT_BUSY", lambda: client.rpc(RPC, {}))
        gate.set()
        time.sleep(0.08)
    assert not server.calls
    client.rpc(RPC, {})
    assert len(server.calls) == 1

test("DNS 정지 시에도 호출은 끝나며 재시도 스레드 누적·늦은 키 전송이 없다", stalled_dns)


def refused_connection():
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        port = sock.getsockname()[1]
    client = SupabaseTransport("http://127.0.0.1:" + str(port), KEY, timeout_seconds=5, allow_local=True)
    expect("TRANSPORT_NETWORK", lambda: client.rpc(RPC, {}))

test("연결 실패는 주소·키·원문 없이 고정 오류로 끝난다", refused_connection)

server.shutdown()
server.server_close()
print(f"\n{passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
