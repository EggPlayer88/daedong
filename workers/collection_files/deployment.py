"""배포 설정·파서·선택한 로컬 스캐너만 검사한다. DB/Storage 요청은 만들지 않는다."""
from __future__ import annotations

import argparse
import json
import os
import re
import stat
import sys

from .__main__ import _configuration
from .common import WorkerError
from .r1_worker import R1Worker
from .runtime import ClamAVScanner, runtime_capabilities
from .transport import SupabaseTransport

_KEY = "WORKHUB_SERVICE_ROLE_KEY"
_KEY_FILE = _KEY + "_FILE"
_MAX_SECRET_BYTES = 8192


def configured_environment(env):
    """명시한 파일만 읽는다. .env 검색/설정 변경/연결 시도는 하지 않는다."""
    resolved = dict(env)
    path = resolved.get(_KEY_FILE, "")
    if not path:
        return resolved
    if resolved.get(_KEY):
        raise WorkerError("SECRET_SOURCE_AMBIGUOUS")
    if not isinstance(path, str) or not os.path.isabs(path) or "\x00" in path:
        raise WorkerError("SECRET_FILE_INVALID")
    descriptor = None
    try:
        # FIFO에서 멈추거나 링크를 따라 다른 파일을 읽지 않는다.
        before = os.lstat(path)
        if not stat.S_ISREG(before.st_mode):
            raise WorkerError("SECRET_FILE_INVALID")
        flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_NONBLOCK", 0)
        descriptor = os.open(path, flags)
        current = os.fstat(descriptor)
        if not stat.S_ISREG(current.st_mode) or (before.st_dev, before.st_ino) != (current.st_dev, current.st_ino):
            raise WorkerError("SECRET_FILE_INVALID")
        if os.name == "posix" and stat.S_IMODE(current.st_mode) & 0o077:
            raise WorkerError("SECRET_FILE_PERMISSIONS")
        if current.st_size > _MAX_SECRET_BYTES:
            raise WorkerError("SECRET_FILE_TOO_LARGE")
        raw = os.read(descriptor, _MAX_SECRET_BYTES + 1)
        if len(raw) > _MAX_SECRET_BYTES:
            raise WorkerError("SECRET_FILE_TOO_LARGE")
        # 텍스트 파일 마지막 개행 한 개만 허용한다. 키 속 공백/추가 줄은 기존 검증기가 거부한다.
        value = raw.decode("ascii")
        if value.endswith("\r\n"):
            value = value[:-2]
        elif value.endswith("\n"):
            value = value[:-1]
        resolved[_KEY] = value
        resolved.pop(_KEY_FILE, None)
        return resolved
    except (OSError, UnicodeError, ValueError):
        raise WorkerError("SECRET_FILE_UNAVAILABLE") from None
    finally:
        if descriptor is not None:
            os.close(descriptor)


def safe_code(error):
    code = getattr(error, "code", None)
    return code if isinstance(code, str) and re.fullmatch(r"[A-Z_]{2,50}", code) else "PREFLIGHT_FAILED"


def preflight(env, *, scanner=False):
    """형식 검사는 인증/권한 검증이 아니다. 성공해도 활성화 완료를 반환하지 않는다."""
    checks = []
    configured = None
    mode = None
    capabilities = []
    scanner_called = False

    def check(name, operation):
        try:
            result = operation()
            checks.append({"name": name, "status": "passed"})
            return result
        except Exception as error:
            checks.append({"name": name, "status": "blocked", "code": safe_code(error)})
            return None

    def configuration():
        nonlocal configured, mode
        configured = configured_environment(env)
        url, key, mode = _configuration(configured)
        transport = SupabaseTransport(url, key)
        # 기존 생성자는 값 모양만 검사한다. 호출 메서드를 실행하지 않는다.
        R1Worker(transport, configured.get("WORKHUB_SCHOOL_ID", ""),
                 configured.get("WORKHUB_WORKER_ID", ""), configured.get("WORKHUB_WORKER_RELEASE", ""))
        if mode == "clamav":
            ClamAVScanner(configured.get("WORKHUB_CLAMAV_SOCKET", ""))
        return True

    config_ok = check("configuration", configuration)
    verified = check("runtime", runtime_capabilities)
    if verified:
        capabilities = verified
    if scanner:
        if not config_ok or mode != "clamav":
            checks.append({"name": "scanner", "status": "blocked", "code": "SCANNER_PROBE_UNAVAILABLE"})
        else:
            def inspect_scanner():
                nonlocal scanner_called
                scanner_called = True
                ClamAVScanner(configured["WORKHUB_CLAMAV_SOCKET"]).healthcheck()
                return True
            if check("scanner", inspect_scanner):
                capabilities = [*capabilities, "malware"]
    else:
        checks.append({"name": "scanner", "status": "not_checked"})
    blocked = any(row["status"] == "blocked" for row in checks)
    return {"status": "blocked" if blocked else "checked", "mode": "deployment_preflight",
            "checks": checks, "capabilities": capabilities, "databaseCalled": False, "storageCalled": False,
            "scannerCalled": scanner_called, "activationVerified": False,
            "remaining": ["sql_connection_and_policy", "actual_supabase_storage", "live_worker_readiness"]}


class QuietParser(argparse.ArgumentParser):
    def error(self, message):
        # 잘못 붙인 인자에 비밀값이 있어도 argparse 원문으로 출력하지 않는다.
        raise WorkerError("INVALID_ARGUMENTS")


def main(argv=None, env=None):
    try:
        parser = QuietParser(description="파일 검사기 배포 사전점검. DB·Storage·정책을 변경하지 않습니다.")
        parser.add_argument("--scanner", action="store_true", help="로컬 Unix 소켓의 실제 ClamAV 자체시험 추가")
        args = parser.parse_args(argv)
        result = preflight(os.environ if env is None else env, scanner=args.scanner)
        print(json.dumps(result, separators=(",", ":")))
        return 0 if result["status"] == "checked" else 1
    except Exception as error:
        print(json.dumps({"status": "blocked", "code": safe_code(error),
                          "databaseCalled": False, "storageCalled": False, "activationVerified": False}))
        return 1


if __name__ == "__main__":
    sys.exit(main())
