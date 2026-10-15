"""격리된 문서 검사와 선택형 로컬 ClamAV 연결. 파일 본문은 디스크에 쓰지 않는다.

문서 파서는 별도 프로세스이며 Linux에서는 주소 공간/CPU 상한을 함께 적용한다.
이는 컨테이너의 권한·네트워크 격리를 대신하지 않는다. ClamAV 사용 시 데몬의
시간대를 UTC로 설정해야 VERSION의 시간대 없는 서명 시각을 비교할 수 있다.
프로토콜: https://docs.clamav.net/manual/Usage/ClamdProtocol.html
"""
from __future__ import annotations

from datetime import datetime, timezone
from io import BytesIO
import hashlib
import importlib
import json
import math
import multiprocessing
import os
import re
import socket
import struct
import sys
import time

from .common import WorkerError, instant

_CHECKS = ["size", "sha256", "signature", "container", "encryption"]
_MAX_INPUT_BYTES = 100 * 1024 * 1024
_MAX_RESULT_BYTES = 4096
_DEFAULT_MEMORY_BYTES = 1024 * 1024 * 1024
_SELFTEST_LIMITS = {"max_archive_entries": 100, "max_entry_bytes": 1024 * 1024,
                    "max_expanded_bytes": 4 * 1024 * 1024,
                    "max_compression_ratio": 1000, "max_xml_bytes": 1024 * 1024}


def _error(code):
    return {"status": "error", "code": code, "mime": None}


def _positive_number(value, maximum):
    return type(value) in (int, float) and math.isfinite(value) and 0 < value <= maximum


def _resource_limits(memory_limit_bytes, cpu_seconds):
    if not sys.platform.startswith("linux"):
        return
    import resource
    # 부모보다 느슨한 제한으로 바꾸지 않는다. 코어 덤프에도 본문이 남지 않게 한다.
    for kind, proposed in ((resource.RLIMIT_AS, memory_limit_bytes),
                           (resource.RLIMIT_CPU, cpu_seconds), (resource.RLIMIT_CORE, 0)):
        _, hard = resource.getrlimit(kind)
        limit = proposed if hard == resource.RLIM_INFINITY else min(proposed, hard)
        resource.setrlimit(kind, (limit, limit))


def _selftest():
    # 설치된 이름만 확인하지 않고 각 파서가 실제로 로드되는지 확인한다.
    etree = importlib.import_module("lxml.etree")
    pypdf = importlib.import_module("pypdf")
    olefile = importlib.import_module("olefile")
    image = importlib.import_module("PIL.Image")
    if not all((callable(etree.fromstring), callable(pypdf.PdfReader),
                callable(olefile.OleFileIO), callable(image.open))):
        raise RuntimeError("dependency_missing")
    from .inspection import inspect_document
    output = BytesIO()
    writer = pypdf.PdfWriter()
    writer.add_blank_page(width=72, height=72)
    writer.write(output)
    if inspect_document(output.getvalue(), "pdf", _SELFTEST_LIMITS)["status"] != "passed":
        raise RuntimeError("pdf_selftest_failed")
    if etree.fromstring(b"<check/>").tag != "check":
        raise RuntimeError("xml_selftest_failed")
    image.new("RGB", (1, 1)).save(output := BytesIO(), format="PNG")
    with image.open(BytesIO(output.getvalue())) as decoded:
        decoded.load()
    if olefile.isOleFile(BytesIO(b"not-an-ole-document")):
        raise RuntimeError("ole_selftest_failed")
    for extension in ("docx", "xlsx", "pptx", "hwpx", "hwp", "pdf"):
        if inspect_document(b"not-a-document", extension, _SELFTEST_LIMITS)["status"] != "rejected":
            raise RuntimeError("signature_selftest_failed")
    if len(b"abc") != 3 or hashlib.sha256(b"abc").hexdigest() != "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad":
        raise RuntimeError("content_selftest_failed")
    return {"status": "passed", "code": "runtime_selftest_passed", "mime": None}


def _parser_environment():
    # spawn도 부모 환경값을 상속한다. 파서는 DB·Storage 키를 사용할 이유가 없다.
    # 운영 OS에 필요한 값만 남기며 부모 프로세스 환경은 변경하지 않는다.
    allowed = {"PATH", "SYSTEMROOT", "WINDIR", "TEMP", "TMP", "LANG", "LC_ALL", "TZ",
               "PYTHONUTF8", "PYTHONIOENCODING", "PYTHONDONTWRITEBYTECODE"}
    retained = {key: value for key, value in os.environ.items() if key.upper() in allowed}
    os.environ.clear()
    os.environ.update(retained)


def _child(connection, mode, data, extension, limits, memory_limit_bytes, cpu_seconds):
    try:
        _parser_environment()
        # 라이브러리의 경고/예외에 파일 일부가 섞여도 작업자 로그에 내보내지 않는다.
        with open(os.devnull, "w") as sink:
            sys.stdout = sys.stderr = sink
            _resource_limits(memory_limit_bytes, cpu_seconds)
            if mode == "selftest":
                result = _selftest()
            else:
                from .inspection import inspect_document
                result = inspect_document(data, extension, limits)
        connection.send_bytes(json.dumps(result, ensure_ascii=True).encode("ascii"))
    except BaseException:
        try:
            connection.send_bytes(json.dumps(_error("inspection_process_failed")).encode("ascii"))
        except Exception:
            pass
    finally:
        connection.close()


def _run_isolated(mode, data, extension, limits, timeout_seconds, memory_limit_bytes, cpu_seconds):
    if (not _positive_number(timeout_seconds, 120)
            or type(memory_limit_bytes) is not int or not 128 * 1024 * 1024 <= memory_limit_bytes <= 4 * 1024 * 1024 * 1024
            or (cpu_seconds is not None and (type(cpu_seconds) is not int or not 1 <= cpu_seconds <= 120))):
        return _error("inspection_runtime_limits_invalid")
    cpu_seconds = cpu_seconds or max(1, math.ceil(timeout_seconds))
    context = multiprocessing.get_context("spawn")
    receiving, sending = context.Pipe(duplex=False)
    process = context.Process(target=_child, args=(sending, mode, data, extension, limits, memory_limit_bytes, cpu_seconds), daemon=True)
    started = False
    deadline = time.monotonic() + timeout_seconds
    try:
        process.start()
        started = True
        sending.close()
        remaining = deadline - time.monotonic()
        if remaining <= 0 or not receiving.poll(remaining):
            return _error("inspection_timeout")
        # pickle을 받지 않는다. 검사 프로세스 결과도 작은 JSON만 허용한다.
        raw = receiving.recv_bytes(maxlength=_MAX_RESULT_BYTES)
        result = json.loads(raw)
        if (not isinstance(result, dict) or set(result) != {"status", "code", "mime"}
                or result["status"] not in ("passed", "rejected", "unsupported", "error")
                or not isinstance(result["code"], str) or re.fullmatch(r"[a-z0-9_]{2,80}", result["code"]) is None
                or (result["mime"] is not None and (not isinstance(result["mime"], str) or len(result["mime"]) > 200))):
            return _error("inspection_result_invalid")
        process.join(max(0, deadline - time.monotonic()))
        if process.is_alive():
            return _error("inspection_timeout")
        if process.exitcode != 0:
            return _error("inspection_process_failed")
        return result
    except (OSError, EOFError, ValueError, RuntimeError):
        return _error("inspection_process_failed")
    finally:
        if started:
            if process.is_alive():
                process.terminate()
                process.join(1)
            if process.is_alive():
                process.kill()
                process.join(1)
            process.close()
        receiving.close()
        sending.close()


def inspect_isolated(data: bytes, extension: str, limits: dict, *, timeout_seconds=30,
                     memory_limit_bytes=_DEFAULT_MEMORY_BYTES, cpu_seconds=None) -> dict:
    """한 파일을 격리해 검사한다. 실패/종료를 성공이나 악성 발견으로 바꾸지 않는다."""
    if not isinstance(data, bytes) or not isinstance(extension, str) or not isinstance(limits, dict):
        return _error("inspection_input_invalid")
    if len(data) > _MAX_INPUT_BYTES:
        return _error("inspection_input_limit")
    # 임의 객체의 pickle 훅이 아닌 기본 JSON 값으로만 자식 인자를 구성한다.
    try:
        plain_limits = json.loads(json.dumps(limits, allow_nan=False))
    except (TypeError, ValueError):
        return _error("inspection_limits_invalid")
    return _run_isolated("inspect", data, extension, plain_limits, timeout_seconds, memory_limit_bytes, cpu_seconds)


def runtime_capabilities(*, timeout_seconds=30, memory_limit_bytes=_DEFAULT_MEMORY_BYTES, cpu_seconds=None):
    """자체 시험이 통과한 기본 검사만 반환한다. 악성 검사 능력은 포함하지 않는다."""
    result = _run_isolated("selftest", b"", "", {}, timeout_seconds, memory_limit_bytes, cpu_seconds)
    if result != {"status": "passed", "code": "runtime_selftest_passed", "mime": None}:
        raise WorkerError("RUNTIME_UNAVAILABLE")
    return list(_CHECKS)


class ClamAVScanner:
    """동일 호스트의 Unix 소켓만 사용한다. 미확인/오류를 clean으로 바꾸지 않는다."""

    def __init__(self, socket_path, *, max_signature_age_seconds=48 * 3600,
                 timeout_seconds=30, max_stream_bytes=_MAX_INPUT_BYTES):
        if (not isinstance(socket_path, str) or not os.path.isabs(socket_path) or "\x00" in socket_path
                or not _positive_number(max_signature_age_seconds, 7 * 86400)
                or not _positive_number(timeout_seconds, 120)
                or type(max_stream_bytes) is not int or not 1 <= max_stream_bytes <= _MAX_INPUT_BYTES):
            raise WorkerError("SCANNER_CONFIG_INVALID")
        self.socket_path = socket_path
        self.max_signature_age_seconds = max_signature_age_seconds
        self.timeout_seconds = timeout_seconds
        self.max_stream_bytes = max_stream_bytes

    def _deadline(self, deadline=None):
        seconds = self.timeout_seconds
        if deadline is not None:
            seconds = min(seconds, (instant(deadline) - datetime.now(timezone.utc)).total_seconds())
        if seconds <= 0:
            raise WorkerError("SCANNER_TIMEOUT")
        return time.monotonic() + seconds

    @staticmethod
    def _remaining(until):
        remaining = until - time.monotonic()
        if remaining <= 0:
            raise WorkerError("SCANNER_TIMEOUT")
        return remaining

    def _exchange(self, command, until, data=None):
        if not hasattr(socket, "AF_UNIX"):
            raise WorkerError("SCANNER_UNAVAILABLE")
        try:
            with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as connection:
                connection.settimeout(self._remaining(until))
                connection.connect(self.socket_path)
                connection.settimeout(self._remaining(until))
                connection.sendall(b"z" + command + b"\0")
                if data is not None:
                    for offset in range(0, len(data), 65536):
                        chunk = data[offset:offset + 65536]
                        connection.settimeout(self._remaining(until))
                        connection.sendall(struct.pack(">I", len(chunk)) + chunk)
                    connection.settimeout(self._remaining(until))
                    connection.sendall(b"\0\0\0\0")
                reply = bytearray()
                while True:
                    connection.settimeout(self._remaining(until))
                    part = connection.recv(min(1024, 4097 - len(reply)))
                    if not part:
                        break
                    reply.extend(part)
                    if len(reply) > 4096:
                        raise WorkerError("SCANNER_RESPONSE_INVALID")
                # 단일 명령에 여러 결과가 있으면 마지막 OK만 보고 통과시키지 않는다.
                if not reply.endswith(b"\0") or reply.count(0) != 1:
                    raise WorkerError("SCANNER_RESPONSE_INVALID")
                try:
                    return bytes(reply[:-1]).decode("ascii")
                except UnicodeDecodeError:
                    raise WorkerError("SCANNER_RESPONSE_INVALID") from None
        except TimeoutError:
            raise WorkerError("SCANNER_TIMEOUT") from None
        except OSError:
            raise WorkerError("SCANNER_UNAVAILABLE") from None

    def _validate_daemon(self, until):
        if self._exchange(b"PING", until) != "PONG":
            raise WorkerError("SCANNER_UNAVAILABLE")
        version = self._exchange(b"VERSIONCOMMANDS", until)
        match = re.fullmatch(r"ClamAV [A-Za-z0-9_.+-]+/[0-9]+/([A-Za-z]{3}) ([A-Za-z]{3}) +([0-9]{1,2}) ([0-9]{2}:[0-9]{2}:[0-9]{2}) ([0-9]{4})\| COMMANDS: ([A-Z0-9_ ]+)", version)
        if not match or not {"INSTREAM", "PING", "VERSIONCOMMANDS"} <= set(match.group(6).split()):
            raise WorkerError("SCANNER_RESPONSE_INVALID")
        try:
            months = "Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split()
            signature_time = datetime.fromisoformat(f"{match.group(5)}-{months.index(match.group(2)) + 1:02d}-{int(match.group(3)):02d}T{match.group(4)}+00:00")
        except (ValueError, OverflowError):
            raise WorkerError("SCANNER_RESPONSE_INVALID") from None
        age = (datetime.now(timezone.utc) - signature_time).total_seconds()
        if age < -300 or age > self.max_signature_age_seconds:
            raise WorkerError("SCANNER_SIGNATURES_STALE")

    def _scan(self, data, until):
        result = self._exchange(b"INSTREAM", until, data)
        if result == "stream: OK":
            return "clean"
        if re.fullmatch(r"stream: [^\x00-\x1f\x7f]{1,512} FOUND", result):
            return "rejected"
        raise WorkerError("SCANNER_FAILED")

    def healthcheck(self):
        """서명 갱신 상태와 표준 무해 시험 문자열 검출까지 확인한다."""
        until = self._deadline()
        self._validate_daemon(until)
        # 표준 EICAR 문자열을 메모리에서만 만든다. 실행하거나 파일에 저장하지 않는다.
        sample = b"X5O!P%@AP[4" + bytes((92,)) + b"PZX54(P^)7CC)7}$" + b"EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*"
        if self._scan(sample, until) != "rejected":
            raise WorkerError("SCANNER_SELFTEST_FAILED")

    def scan(self, data, *, deadline=None):
        if not isinstance(data, bytes) or not data or len(data) > self.max_stream_bytes:
            raise WorkerError("SCANNER_INPUT_INVALID")
        until = self._deadline(deadline)
        self._validate_daemon(until)
        return self._scan(data, until)
