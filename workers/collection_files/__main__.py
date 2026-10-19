"""서버 작업자 명령행. 기본 동작은 로컬 검사이며 DB/Storage에 쓰지 않는다."""
import argparse
import json
import os
import re
import sys
from urllib.parse import urlsplit

from .common import WorkerError
from .r1_worker import R1Worker
from .runtime import ClamAVScanner, runtime_capabilities
from .transport import SupabaseTransport


def _configuration(env):
    url = env.get("WORKHUB_SUPABASE_URL", "")
    project = env.get("WORKHUB_EXPECTED_PROJECT_REF", "")
    if (not re.fullmatch(r"[a-z0-9]{20}", project)
            or urlsplit(url).hostname != project + ".supabase.co"):
        raise WorkerError("PROJECT_MISMATCH")
    mode = env.get("WORKHUB_SCANNER_MODE", "clamav")
    if mode not in ("clamav", "policy_unscanned"):
        raise WorkerError("INVALID_SCANNER_MODE")
    return url, env.get("WORKHUB_SERVICE_ROLE_KEY", ""), mode


def main(argv=None, env=None):
    parser = argparse.ArgumentParser(description="수합 서버 검사기. --execute 없이는 DB·Storage 요청을 하지 않습니다.")
    parser.add_argument("mode", choices=("check", "verify", "cleanup"), nargs="?", default="check")
    parser.add_argument("--execute", action="store_true", help="승인된 작업자 연결/정책이 적용된 서버에서 실제 실행")
    parser.add_argument("--max-jobs", type=int, default=1, choices=range(1, 21), metavar="1..20")
    args = parser.parse_args(argv)
    env = os.environ if env is None else env
    try:
        checks = runtime_capabilities()
        if args.mode == "check" or not args.execute:
            print(json.dumps({"status": "checked", "mode": "local_only", "checks": checks,
                              "databaseCalled": False, "storageCalled": False, "malwareChecked": False}))
            return 0
        url, key, mode = _configuration(env)
        scanner = None
        if args.mode == "verify" and mode == "clamav":
            socket_path = env.get("WORKHUB_CLAMAV_SOCKET", "")
            if not socket_path:
                raise WorkerError("SCANNER_NOT_CONFIGURED")
            scanner = ClamAVScanner(socket_path)
            scanner.healthcheck()
            checks = [*checks, "malware"]
        worker = R1Worker(SupabaseTransport(url, key), env.get("WORKHUB_SCHOOL_ID", ""),
                          env.get("WORKHUB_WORKER_ID", ""), env.get("WORKHUB_WORKER_RELEASE", ""), scanner=scanner)
        result = worker.run_once(execute=True, cleanup=args.mode == "cleanup", max_jobs=args.max_jobs, checks=checks)
        print(json.dumps(result, separators=(",", ":")))
        return 0 if all(row["status"] == "recorded" for row in result["verification"] + result["cleanup"]) else 1
    except WorkerError as error:
        code = error.code if isinstance(error.code, str) and re.fullmatch(r"[A-Z_]{2,50}", error.code) else "WORKER_FAILED"
        print(json.dumps({"status": "error", "code": code}))
        return 1
    except Exception:
        print(json.dumps({"status": "error", "code": "WORKER_FAILED"}))
        return 1


if __name__ == "__main__":
    sys.exit(main())
