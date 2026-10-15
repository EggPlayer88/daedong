"""컨테이너의 파일형 비밀값을 기존 단발 CLI에 전달한다. 기본은 비연결 자체점검이다."""
import json
import os
import sys

from . import __main__ as worker_cli
from . import deployment


def main(argv=None, env=None):
    argv = list(sys.argv[1:] if argv is None else argv)
    env = os.environ if env is None else env
    if argv and argv[0] == "preflight":
        return deployment.main(argv[1:], env=env)
    try:
        parser = deployment.QuietParser(description="수합 컨테이너. 기본 check, 연결은 verify/cleanup --execute 명시.")
        parser.add_argument("mode", choices=("check", "verify", "cleanup"), nargs="?", default="check")
        parser.add_argument("--execute", action="store_true")
        parser.add_argument("--max-jobs", type=int, default=1, choices=range(1, 21))
        args = parser.parse_args(argv)
        # check와 --execute 없는 명령은 비밀 파일도 열지 않는다.
        resolved = deployment.configured_environment(env) if args.execute and args.mode != "check" else env
        return worker_cli.main(argv, env=resolved)
    except Exception as error:
        print(json.dumps({"status": "error", "code": deployment.safe_code(error)}))
        return 1


if __name__ == "__main__":
    sys.exit(main())
