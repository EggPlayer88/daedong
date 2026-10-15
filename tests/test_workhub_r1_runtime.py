"""별도 프로세스 종료와 ClamAV 실제 전송 프레임/실패 판정을 검사한다."""
from datetime import datetime, timedelta, timezone
from io import BytesIO
import multiprocessing
import json
import os
from pathlib import Path
import socket
import struct
import sys
import tempfile
import threading
import time
import zipfile
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from workers.collection_files import runtime
from workers.collection_files.common import WorkerError

LIMITS = {"max_archive_entries": 100, "max_entry_bytes": 1024 * 1024,
          "max_expanded_bytes": 4 * 1024 * 1024,
          "max_compression_ratio": 1000, "max_xml_bytes": 1024 * 1024}


def check(title, fn):
    try:
        fn()
    except Exception:
        print("  ✗ " + title)
        raise
    print("  ✓ " + title)


def expect_error(code, fn):
    try:
        fn()
    except WorkerError as error:
        assert error.code == code, error.code
        return
    raise AssertionError("오류가 필요함: " + code)


def child_environment(connection, *args):
    runtime._parser_environment()
    safe = "WORKHUB_SERVICE_ROLE_KEY" not in os.environ and "UNRELATED_SECRET" not in os.environ
    connection.send_bytes(json.dumps({"status": "passed" if safe else "error", "code": "environment_checked", "mime": None}).encode("ascii"))
    connection.close()


def parser_environment():
    with patch.dict(os.environ, {"WORKHUB_SERVICE_ROLE_KEY": "test-only-key", "UNRELATED_SECRET": "test-only-secret", "TZ": "UTC"}):
        before = dict(os.environ)
        with patch.object(runtime, "_child", child_environment):
            result = runtime.inspect_isolated(b"x", "pdf", LIMITS)
        assert result == {"status": "passed", "code": "environment_checked", "mime": None}, result
        assert dict(os.environ) == before
    with patch.dict(os.environ, {"WORKHUB_SERVICE_ROLE_KEY": "test-only-key", "UNKNOWN_SETTING": "x", "PATH": "runtime-path", "TZ": "UTC"}, clear=True):
        runtime._parser_environment()
        assert dict(os.environ) == {"PATH": "runtime-path", "TZ": "UTC"}


def child_hangs(*args):
    time.sleep(10)


def child_crashes(*args):
    os._exit(7)


def child_bad_result(connection, *args):
    connection.send_bytes(b'{"status":"passed","code":"ok","mime":null,"extra":"private"}')
    connection.close()


def child_large_result(connection, *args):
    connection.send_bytes(b"x" * 8192)
    connection.close()


def pdf():
    from pypdf import PdfWriter
    output = BytesIO()
    writer = PdfWriter()
    writer.add_blank_page(width=72, height=72)
    writer.write(output)
    return output.getvalue()


def unsupported_zip64():
    output = BytesIO()
    with zipfile.ZipFile(output, "w") as archive:
        archive.writestr("part.xml", "<x/>")
    data = bytearray(output.getvalue())
    offset = data.rfind(b"PK\x05\x06")
    struct.pack_into("<HH", data, offset + 8, 65535, 65535)
    result = runtime.inspect_isolated(bytes(data), "docx", LIMITS)
    assert result == {"status": "unsupported", "code": "archive_zip64_unsupported", "mime": None}, result


def process_test(target, expected, timeout=5):
    children = {p.pid for p in multiprocessing.active_children()}
    started = time.monotonic()
    with patch.object(runtime, "_child", target):
        result = runtime.inspect_isolated(b"data", "pdf", LIMITS, timeout_seconds=timeout)
    assert result["status"] == "error" and result["code"] == expected, result
    assert time.monotonic() - started < timeout + 3
    assert {p.pid for p in multiprocessing.active_children()} <= children


def version(age=0, commands="PING VERSIONCOMMANDS INSTREAM"):
    timestamp = datetime.now(timezone.utc) - timedelta(seconds=age)
    weekdays = "Mon Tue Wed Thu Fri Sat Sun".split()
    months = "Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split()
    value = (f"ClamAV 1.4.3/27800/{weekdays[timestamp.weekday()]} "
             f"{months[timestamp.month - 1]} {timestamp.day:2d} {timestamp:%H:%M:%S %Y}| COMMANDS: {commands}")
    return value.encode("ascii") + b"\0"


class FakeSocket:
    def __init__(self, response):
        self.response = response
        self.sent = bytearray()
        self.timeouts = []
        self.closed = False
        self.address = None

    def __enter__(self):
        return self

    def __exit__(self, *args):
        self.closed = True

    def settimeout(self, value):
        self.timeouts.append(value)

    def connect(self, address):
        self.address = address

    def sendall(self, value):
        self.sent.extend(value)

    def recv(self, size):
        if isinstance(self.response, Exception):
            raise self.response
        chunk, self.response = self.response[:min(size, 11)], self.response[min(size, 11):]
        return chunk


class Sockets:
    def __init__(self, responses):
        self.pending = list(responses)
        self.opened = []

    def __call__(self, family, kind):
        assert family == socket.AF_UNIX and kind == socket.SOCK_STREAM
        value = FakeSocket(self.pending.pop(0))
        self.opened.append(value)
        return value


def scanner(**kwargs):
    return runtime.ClamAVScanner(str(ROOT / "test-clamd.sock"), **kwargs)


def scan_test(response, expected=None, code=None, data=b"test data", **kwargs):
    sockets = Sockets([b"PONG\0", version(), response])
    with patch.object(runtime.socket, "AF_UNIX", getattr(socket, "AF_UNIX", 1), create=True), patch.object(runtime.socket, "socket", sockets):
        if code:
            expect_error(code, lambda: scanner(**kwargs).scan(data))
        else:
            assert scanner(**kwargs).scan(data) == expected
    assert all(s.closed for s in sockets.opened)
    return sockets


def framing():
    data = b"a" * 70000
    opened = scan_test(b"stream: OK\0", "clean", data=data).opened
    expected = (b"zINSTREAM\0" + struct.pack(">I", 65536) + data[:65536]
                + struct.pack(">I", 4464) + data[65536:] + b"\0\0\0\0")
    assert bytes(opened[-1].sent) == expected
    assert bytes(opened[0].sent) == b"zPING\0"
    assert bytes(opened[1].sent) == b"zVERSIONCOMMANDS\0"
    assert all(0 < t <= 30 for s in opened for t in s.timeouts)


def healthcheck(rejected=True):
    sockets = Sockets([b"PONG\0", version(), b"stream: Eicar-Signature FOUND\0" if rejected else b"stream: OK\0"])
    with patch.object(runtime.socket, "AF_UNIX", getattr(socket, "AF_UNIX", 1), create=True), patch.object(runtime.socket, "socket", sockets):
        if rejected:
            assert scanner().healthcheck() is None
        else:
            expect_error("SCANNER_SELFTEST_FAILED", scanner().healthcheck)
    assert b"EICAR-STANDARD" in sockets.opened[-1].sent
    assert all(s.closed for s in sockets.opened)


def daemon_error(response, code):
    sockets = Sockets([b"PONG\0", response])
    with patch.object(runtime.socket, "AF_UNIX", getattr(socket, "AF_UNIX", 1), create=True), patch.object(runtime.socket, "socket", sockets):
        expect_error(code, lambda: scanner().scan(b"x"))
    assert len(sockets.opened) == 2 and all(s.closed for s in sockets.opened)


def missing_dependency():
    with patch.object(runtime.importlib, "import_module", side_effect=ImportError("secret")):
        try:
            runtime._selftest()
        except ImportError:
            return
    raise AssertionError("의존성 없이 자체시험이 성공함")


def capabilities_failure():
    with patch.object(runtime, "_run_isolated", return_value={"status": "error", "code": "x", "mime": None}):
        expect_error("RUNTIME_UNAVAILABLE", runtime.runtime_capabilities)


def resource_limits():
    class Resource:
        RLIM_INFINITY = -1
        RLIMIT_AS, RLIMIT_CPU, RLIMIT_CORE = range(3)
        def __init__(self):
            self.calls = []
        def getrlimit(self, kind):
            return (5, 5) if kind == self.RLIMIT_CPU else (-1, -1)
        def setrlimit(self, kind, value):
            self.calls.append((kind, value))
    resource = Resource()
    with patch.object(runtime.sys, "platform", "linux"), patch.dict(sys.modules, {"resource": resource}):
        runtime._resource_limits(256 * 1024 * 1024, 30)
    assert resource.calls == [(0, (256 * 1024 * 1024,) * 2), (1, (5, 5)), (2, (0, 0))]


def actual_socket():
    # 지원하는 OS에서는 로컬 소켓 서버로 SDK 없는 실제 왕복도 확인한다.
    # 미지원 Windows에서는 동일 프로토콜을 위의 주입 소켓 시험으로 검증한다.
    try:
        listener = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    except (AttributeError, OSError):
        framing()
        return
    errors = []
    with tempfile.TemporaryDirectory(prefix="r1clam-") as directory:
        address = str(Path(directory) / "s")
        try:
            listener.bind(address)
            listener.listen()
            listener.settimeout(3)
        except OSError:
            listener.close()
            framing()
            return
        def serve():
            try:
                for expected, response in ((b"zPING\0", b"PONG\0"),
                                           (b"zVERSIONCOMMANDS\0", version()),
                                           (b"zINSTREAM\0", b"stream: OK\0")):
                    with listener.accept()[0] as connection:
                        connection.settimeout(3)
                        command = bytearray()
                        while not command.endswith(b"\0"):
                            command.extend(connection.recv(1))
                        assert command == expected
                        if expected == b"zINSTREAM\0":
                            def read_exact(size):
                                value = bytearray()
                                while len(value) < size:
                                    piece = connection.recv(size - len(value))
                                    if not piece:
                                        raise AssertionError("stream eof")
                                    value.extend(piece)
                                return bytes(value)
                            body = bytearray()
                            while True:
                                size = struct.unpack(">I", read_exact(4))[0]
                                if not size:
                                    break
                                body.extend(read_exact(size))
                            assert body == b"live socket check"
                        connection.sendall(response)
            except BaseException as error:
                errors.append(error)
            finally:
                listener.close()
        thread = threading.Thread(target=serve)
        thread.start()
        try:
            assert runtime.ClamAVScanner(address).scan(b"live socket check") == "clean"
        finally:
            thread.join(5)
        assert not thread.is_alive() and not errors, errors


def main():
    check("격리 프로세스에서 정상 PDF 검사", lambda: assert_passed(runtime.inspect_isolated(pdf(), "pdf", LIMITS)))
    check("격리 프로세스에서 변조 서명 거부", lambda: assert_status(runtime.inspect_isolated(b"fake pdf", "pdf", LIMITS), "rejected"))
    check("숫자 포함 ZIP64 미지원 코드를 그대로 보존", unsupported_zip64)
    check("검사기 의존성 및 자체시험 5종, malware 주장 없음", lambda: assert_equal(runtime.runtime_capabilities(), ["size", "sha256", "signature", "container", "encryption"]))
    check("파서 자식 비밀 환경 제거·부모 환경 보존", parser_environment)
    check("프로세스 시간 초과 강제 종료·자식 잔류 없음", lambda: process_test(child_hangs, "inspection_timeout", .2))
    check("자식 비정상 종료는 검사 실패", lambda: process_test(child_crashes, "inspection_process_failed"))
    check("자식 잘못된 JSON 계약 거부", lambda: process_test(child_bad_result, "inspection_result_invalid"))
    check("자식 과도한 응답 길이 제한", lambda: process_test(child_large_result, "inspection_process_failed"))
    check("Linux 메모리·CPU 기존 상한 유지·코어 덤프 금지", resource_limits)
    check("의존성 누락 시 자체시험 실패", missing_dependency)
    check("자체시험 실패 시 heartbeat 능력 반환 금지", capabilities_failure)
    for invalid in (0, -1, True, float("nan"), float("inf"), 121):
        check("잘못된 프로세스 시간 한도 " + str(invalid), lambda invalid=invalid: assert_equal(runtime.inspect_isolated(b"x", "pdf", LIMITS, timeout_seconds=invalid)["code"], "inspection_runtime_limits_invalid"))
    check("바이트 외 입력 거부", lambda: assert_equal(runtime.inspect_isolated("private", "pdf", LIMITS)["code"], "inspection_input_invalid"))
    check("무한대 파서 한도 거부", lambda: assert_equal(runtime.inspect_isolated(b"x", "pdf", {"ratio": float("inf")})["code"], "inspection_limits_invalid"))
    check("ClamAV INSTREAM 실제 분할·종료 프레임", framing)
    check("ClamAV 악성 발견 반환", lambda: scan_test(b"stream: Test-Signature FOUND\0", "rejected"))
    check("ClamAV ERROR를 성공 처리하지 않음", lambda: scan_test(b"stream: failure ERROR\0", code="SCANNER_FAILED"))
    check("ClamAV StreamMaxLength 오류를 성공 처리하지 않음", lambda: scan_test(b"INSTREAM size limit exceeded. ERROR\0", code="SCANNER_FAILED"))
    check("ClamAV 잘린 응답 거부", lambda: scan_test(b"stream: OK", code="SCANNER_RESPONSE_INVALID"))
    check("ClamAV 여러 결과에서 마지막 OK만 사용 금지", lambda: scan_test(b"stream: Eicar FOUND\0stream: OK\0", code="SCANNER_RESPONSE_INVALID"))
    check("ClamAV 과도한 응답 거부", lambda: scan_test(b"x" * 5000, code="SCANNER_RESPONSE_INVALID"))
    check("ClamAV 소켓 시간 초과는 실패", lambda: scan_test(TimeoutError("secret"), code="SCANNER_TIMEOUT"))
    check("ClamAV 연결 실패는 고정 오류", lambda: scan_test(OSError("secret"), code="SCANNER_UNAVAILABLE"))
    check("ClamAV 오래된 서명으로 검사 금지", lambda: daemon_error(version(age=3 * 86400), "SCANNER_SIGNATURES_STALE"))
    check("ClamAV 미래 서명 시각 거부", lambda: daemon_error(version(age=-3600), "SCANNER_SIGNATURES_STALE"))
    check("ClamAV 필요한 명령 미지원 거부", lambda: daemon_error(version(commands="PING VERSION"), "SCANNER_RESPONSE_INVALID"))
    check("ClamAV VERSION 정보 불명 거부", lambda: daemon_error(b"COMMAND UNAVAILABLE\0", "SCANNER_RESPONSE_INVALID"))
    check("ClamAV 표준 시험 문자열 실제 검출 확인", healthcheck)
    check("ClamAV 시험 문자열 미검출 시 능력 주장 금지", lambda: healthcheck(False))
    check("ClamAV 만료된 lease로 송신 금지", lambda: expect_error("SCANNER_TIMEOUT", lambda: scanner().scan(b"x", deadline="2000-01-01T00:00:00Z")))
    check("ClamAV 최대 송신량 검증", lambda: expect_error("SCANNER_INPUT_INVALID", lambda: scanner(max_stream_bytes=1).scan(b"xx")))
    check("ClamAV TCP URL 설정 거부", lambda: expect_error("SCANNER_CONFIG_INVALID", lambda: runtime.ClamAVScanner("tcp://example.com:3310")))
    check("로컬 Unix 소켓 실제 왕복 또는 미지원 OS 주입 검증", actual_socket)


def assert_passed(result):
    assert result == {"status": "passed", "code": "pdf_structure_passed", "mime": "application/pdf"}, result


def assert_status(result, status):
    assert result["status"] == status, result


def assert_equal(value, expected):
    assert value == expected, (value, expected)


if __name__ == "__main__":
    main()
