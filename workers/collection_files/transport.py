"""R1 전용 서버 HTTP 연결. 키·요청·원문 오류를 출력하지 않고 고정 코드만 돌려준다."""
import base64
import http.client
import json
import math
import queue
import re
import socket
import threading
import time
from urllib.parse import urlsplit

from .common import WorkerError


BUCKET = "workhub-collection-files"
RPC_NAMES = frozenset("workhub_file_worker_" + name for name in (
    "heartbeat", "claim", "job_inspect", "seal", "fail", "cleanup_claim", "cleanup_inspect", "cleanup_done"))
_RPC_ERRORS = frozenset(("FORBIDDEN", "CONFLICT", "NOT_READY", "INVALID_INPUT", "NOT_FOUND"))
_JSON_LIMIT = 1024 * 1024
_REQUEST_LIMIT = 64 * 1024
_FILE_LIMIT = 100 * 1024 * 1024
_PATH = re.compile(r"[A-Za-z0-9_-]{1,100}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{32}")


def _pairs(items):
    result = {}
    for key, value in items:
        if key in result:
            raise ValueError()
        result[key] = value
    return result


def _json(data):
    try:
        return json.loads(data.decode("utf-8"), object_pairs_hook=_pairs,
                          parse_constant=lambda _: (_ for _ in ()).throw(ValueError()))
    except (UnicodeError, ValueError, TypeError, RecursionError):
        raise WorkerError("TRANSPORT_RESPONSE") from None


def _body(value):
    try:
        encoded = json.dumps(value, ensure_ascii=False, allow_nan=False, separators=(",", ":")).encode("utf-8")
    except (ValueError, TypeError, UnicodeError, RecursionError):
        raise WorkerError("INVALID_TRANSPORT_REQUEST") from None
    if len(encoded) > _REQUEST_LIMIT:
        raise WorkerError("INVALID_TRANSPORT_REQUEST")
    return encoded


def _service_headers(key):
    if not isinstance(key, str) or not 20 <= len(key) <= 8192 or re.search(r"[^A-Za-z0-9_.-]", key):
        raise WorkerError("INVALID_TRANSPORT_CONFIG")
    if key.startswith("sb_secret_"):
        # 새 비밀 키는 JWT가 아니므로 apikey로만 보낸다(공식 API 키 계약).
        return {"apikey": key}
    try:
        parts = key.split(".")
        if len(parts) != 3 or any(not part for part in parts):
            raise ValueError()
        payload = _json(base64.urlsafe_b64decode(parts[1] + "=" * (-len(parts[1]) % 4)))
        if not isinstance(payload, dict) or payload.get("role") != "service_role" or payload.get("sub") not in (None, ""):
            raise ValueError()
    except (ValueError, TypeError, WorkerError):
        raise WorkerError("INVALID_TRANSPORT_CONFIG") from None
    # 서명 검증은 Supabase가 한다. 여기서는 사람 세션을 잘못 넣는 설정 오류만 막는다.
    return {"apikey": key, "Authorization": "Bearer " + key}


def _object(bucket, path):
    if bucket != BUCKET or not isinstance(path, str) or _PATH.fullmatch(path) is None:
        raise WorkerError("INVALID_TRANSPORT_REQUEST")
    return path


def _close(connection, connected_socket=None):
    try:
        sock = connected_socket if connected_socket is not None else (connection.sock if connection else None)
        if sock:
            sock.shutdown(socket.SHUT_RDWR)
    except OSError:
        pass
    if connection:
        connection.close()


class SupabaseTransport:
    """한 인스턴스는 순차 실행한다. RPC 결과의 업무 계약은 호출자가 검증한다."""
    __slots__ = ("_host", "_port", "_https", "_headers", "_timeout", "_inflight")

    def __init__(self, url, service_key, timeout_seconds=15, allow_local=False):
        try:
            parsed = urlsplit(url) if isinstance(url, str) else None
            if (parsed is None or re.search(r"[\x00-\x20\x7f]", url) or type(allow_local) is not bool or parsed.username is not None or
                parsed.password is not None or parsed.query or parsed.fragment or parsed.path not in ("", "/")):
                raise ValueError()
            local = (allow_local and parsed.scheme == "http" and parsed.hostname in ("127.0.0.1", "::1"))
            hosted = (parsed.scheme == "https" and parsed.hostname is not None and
                      re.fullmatch(r"[a-z0-9]{20}\.supabase\.co", parsed.hostname) is not None and parsed.port in (None, 443))
            if not local and not hosted:
                raise ValueError()
            if type(timeout_seconds) not in (int, float) or not math.isfinite(timeout_seconds) or not 0 < timeout_seconds <= 120:
                raise ValueError()
            self._host, self._port, self._https = parsed.hostname, parsed.port, parsed.scheme == "https"
        except (ValueError, TypeError):
            raise WorkerError("INVALID_TRANSPORT_CONFIG") from None
        self._headers = _service_headers(service_key)
        self._timeout = timeout_seconds
        self._inflight = threading.Lock()

    def rpc(self, name, args):
        if not isinstance(name, str) or name not in RPC_NAMES or not isinstance(args, dict):
            raise WorkerError("INVALID_TRANSPORT_REQUEST")
        data = self._execute("POST", "/rest/v1/rpc/" + name, _body(args), _JSON_LIMIT, rpc=True)
        return _json(data)

    def download(self, bucket, path, max_bytes, deadline):
        path = _object(bucket, path)
        if (type(max_bytes) is not int or not 1 <= max_bytes <= _FILE_LIMIT or
            type(deadline) not in (int, float) or not math.isfinite(deadline)):
            raise WorkerError("INVALID_TRANSPORT_REQUEST")
        return self._execute("GET", "/storage/v1/object/" + bucket + "/" + path, None,
                             max_bytes, deadline=deadline, download=True)

    def remove(self, bucket, path, *, deadline=None):
        path = _object(bucket, path)
        if deadline is not None and (type(deadline) not in (int, float) or not math.isfinite(deadline)):
            raise WorkerError("INVALID_TRANSPORT_REQUEST")
        data = self._execute("DELETE", "/storage/v1/object/" + bucket, _body({"prefixes": [path]}),
                             _JSON_LIMIT, deadline=deadline)
        result = _json(data)
        # 삭제 API의 성공은 파일 부재의 증명이 아니다. 호출자는 cleanup_done에서 다시 확인한다.
        if not isinstance(result, list) or any(not isinstance(item, dict) for item in result):
            raise WorkerError("TRANSPORT_RESPONSE")

    def _execute(self, method, path, body, maximum, *, deadline=None, rpc=False, download=False):
        deadline = min(time.monotonic() + self._timeout, deadline) if deadline is not None else time.monotonic() + self._timeout
        if deadline <= time.monotonic():
            raise WorkerError("TRANSPORT_TIMEOUT")
        if not self._inflight.acquire(blocking=False):
            raise WorkerError("TRANSPORT_BUSY")
        result = queue.Queue(maxsize=1)
        cancelled = threading.Event()
        state = {}

        def request():
            try:
                value = self._request(method, path, body, maximum, deadline, cancelled, state, rpc, download)
                outcome = (True, value)
            except WorkerError as error:
                outcome = (False, error.code)
            except Exception:
                outcome = (False, "TRANSPORT_NETWORK")
            finally:
                try:
                    _close(state.get("connection"), state.get("socket"))
                finally:
                    self._inflight.release()
            result.put(outcome)

        # DNS·응답 헤더·느린 전송도 총시간을 제한한다. DNS가 멈추면 같은 인스턴스의
        # 다음 호출을 BUSY로 닫아 대기 스레드가 계속 늘지 않게 한다. 종료 뒤 재사용 가능하다.
        thread = threading.Thread(target=request, daemon=True, name="collection-http")
        try:
            thread.start()
        except Exception:
            self._inflight.release()
            raise WorkerError("TRANSPORT_NETWORK") from None
        try:
            ok, value = result.get(timeout=max(0, deadline - time.monotonic()))
        except queue.Empty:
            cancelled.set()
            _close(state.get("connection"), state.get("socket"))
            raise WorkerError("TRANSPORT_TIMEOUT") from None
        if not ok:
            raise WorkerError(value) from None
        return value

    def _request(self, method, path, body, maximum, deadline, cancelled, state, rpc, download):
        def remaining():
            seconds = deadline - time.monotonic()
            if cancelled.is_set() or seconds <= 0:
                raise WorkerError("TRANSPORT_TIMEOUT")
            return seconds

        connection_type = http.client.HTTPSConnection if self._https else http.client.HTTPConnection
        connection = connection_type(self._host, self._port, timeout=remaining())
        state["connection"] = connection
        try:
            # 환경의 HTTP(S)_PROXY·쿠키 저장소를 사용하지 않는다. 목적지는 생성자에서 고정한다.
            connection.connect()
            state["socket"] = connection.sock
            connection.auto_open = 0
            connection.sock.settimeout(remaining())
            headers = {**self._headers, "Accept": "application/json" if not download else "application/octet-stream",
                       "Accept-Encoding": "identity", "User-Agent": "workhub-collection-worker", "Connection": "close"}
            if body is not None:
                headers["Content-Type"] = "application/json"
            connection.request(method, path, body=body, headers=headers)
            remaining()
            response = connection.getresponse()
            try:
                if 300 <= response.status <= 399:
                    raise WorkerError("TRANSPORT_REDIRECT")
                if response.status in (401, 403):
                    raise WorkerError("TRANSPORT_AUTH")
                if download and response.status == 404:
                    raise WorkerError("STORAGE_NOT_FOUND")
                if response.getheader("Content-Encoding", "identity").lower() != "identity":
                    raise WorkerError("TRANSPORT_RESPONSE")
                lengths = response.headers.get_all("Content-Length", [])
                transfer = response.getheader("Transfer-Encoding")
                if len(lengths) > 1 or (lengths and transfer) or (transfer is not None and transfer.lower() != "chunked"):
                    raise WorkerError("TRANSPORT_RESPONSE")
                expected = None
                if lengths:
                    if re.fullmatch(r"[0-9]+", lengths[0]) is None or len(lengths[0]) > 12:
                        raise WorkerError("TRANSPORT_RESPONSE")
                    expected = int(lengths[0])
                success = 200 <= response.status <= 299
                limit = maximum if success else _JSON_LIMIT
                overflow = "SIZE_LIMIT" if success and download else "TRANSPORT_LIMIT"
                if expected is not None and expected > limit:
                    raise WorkerError(overflow)
                chunks, size = [], 0
                while True:
                    remaining()
                    part = response.read1(min(64 * 1024, limit - size + 1))
                    if not part:
                        break
                    chunks.append(part)
                    size += len(part)
                    if size > limit:
                        raise WorkerError(overflow)
                remaining()
                if expected is not None and size != expected:
                    raise WorkerError("TRANSPORT_RESPONSE")
                data = b"".join(chunks)
                if not success:
                    if rpc:
                        try:
                            error = _json(data)
                            if (isinstance(error, dict) and error.get("code") == "P0001" and
                                isinstance(error.get("message"), str) and error["message"] in _RPC_ERRORS):
                                raise WorkerError("RPC_" + error["message"])
                        except WorkerError as error:
                            if error.code.startswith("RPC_"):
                                raise
                    raise WorkerError("TRANSPORT_HTTP")
                return data
            finally:
                response.close()
        except (TimeoutError, socket.timeout):
            raise WorkerError("TRANSPORT_TIMEOUT") from None
        except http.client.HTTPException:
            raise WorkerError("TRANSPORT_RESPONSE") from None
        except (OSError, ValueError):
            raise WorkerError("TRANSPORT_NETWORK") from None
