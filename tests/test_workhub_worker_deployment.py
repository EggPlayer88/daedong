"""배포 사전점검의 비연결 경계, 비밀 파일 실패와 기본 실행을 검증한다."""
from contextlib import redirect_stdout
from io import StringIO
import json
import os
from pathlib import Path
import stat
import sys
import tempfile
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from workers.collection_files import deployment, container_entrypoint
from workers.collection_files.common import WorkerError
from workers.collection_files.r1_worker import CHECKS

KEY = "sb_secret_" + "fakeForTestsOnly" * 3
PROJECT = "abcdefghijklmnopqrst"
ENV = {"WORKHUB_SUPABASE_URL": "https://" + PROJECT + ".supabase.co",
       "WORKHUB_EXPECTED_PROJECT_REF": PROJECT, "WORKHUB_SERVICE_ROLE_KEY": KEY,
       "WORKHUB_SCHOOL_ID": "school-test", "WORKHUB_WORKER_ID": "worker-test",
       "WORKHUB_WORKER_RELEASE": "git-1234567", "WORKHUB_SCANNER_MODE": "clamav",
       "WORKHUB_CLAMAV_SOCKET": str(ROOT / "not-a-live-clamd.sock")}


def check(name, fn):
    try:
        fn()
    except BaseException:
        print("  ✗ " + name)
        raise
    print("  ✓ " + name)


def preflight(env=ENV, scanner=False):
    with patch.object(deployment, "runtime_capabilities", return_value=list(CHECKS)), \
         patch.object(deployment.SupabaseTransport, "_execute", side_effect=AssertionError("클라우드 요청 금지")), \
         patch.object(deployment.R1Worker, "run_once", side_effect=AssertionError("작업 실행 금지")):
        return deployment.preflight(env, scanner=scanner)


def blocked(env, code=None):
    result = preflight(env)
    assert result["status"] == "blocked", result
    if code:
        assert result["checks"][0]["code"] == code, result
    assert KEY not in json.dumps(result) and not result["activationVerified"]


def expected_error(code, fn):
    try:
        fn()
    except WorkerError as error:
        assert error.code == code, error.code
        return
    raise AssertionError("오류가 필요함: " + code)


def capture(fn):
    output = StringIO()
    with redirect_stdout(output):
        code = fn()
    return code, json.loads(output.getvalue())


def good():
    result = preflight()
    assert result["status"] == "checked" and not result["activationVerified"]
    assert not result["databaseCalled"] and not result["storageCalled"] and not result["scannerCalled"]
    assert result["checks"][-1] == {"name": "scanner", "status": "not_checked"}
    assert result["capabilities"] == list(CHECKS)
    text = json.dumps(result)
    assert all(value not in text for value in (KEY, PROJECT, ENV["WORKHUB_SCHOOL_ID"], ENV["WORKHUB_CLAMAV_SOCKET"]))


def secret_file(contents, fn):
    with tempfile.TemporaryDirectory(prefix="worker-secret-") as folder:
        path = Path(folder) / "test-key"
        path.write_bytes(contents)
        path.chmod(0o600)
        env = {key: value for key, value in ENV.items() if key != "WORKHUB_SERVICE_ROLE_KEY"}
        env["WORKHUB_SERVICE_ROLE_KEY_FILE"] = str(path)
        fn(path, env)


def file_success(path, env):
    original = dict(env)
    resolved = deployment.configured_environment(env)
    assert resolved["WORKHUB_SERVICE_ROLE_KEY"] == KEY
    assert "WORKHUB_SERVICE_ROLE_KEY_FILE" not in resolved
    assert env == original and preflight(env)["status"] == "checked"


def file_permission(path, env):
    if os.name == "posix":
        path.chmod(0o644)
        try:
            expected_error("SECRET_FILE_PERMISSIONS", lambda: deployment.configured_environment(env))
        finally:
            path.chmod(0o600)
    else:
        # Linux의 실제 fstat 권한분기를 다른 OS에서도 실행한다.
        actual = os.stat(path)
        bad = type("Stat", (), {"st_mode": stat.S_IFREG | 0o644, "st_dev": actual.st_dev,
                                 "st_ino": actual.st_ino, "st_size": actual.st_size})()
        with patch.object(deployment.os, "name", "posix"), patch.object(deployment.os, "fstat", return_value=bad):
            expected_error("SECRET_FILE_PERMISSIONS", lambda: deployment.configured_environment(env))


def file_link(path, env):
    bad = type("Stat", (), {"st_mode": stat.S_IFLNK | 0o777})()
    with patch.object(deployment.os, "lstat", return_value=bad), patch.object(deployment.os, "open") as opened:
        expected_error("SECRET_FILE_INVALID", lambda: deployment.configured_environment(env))
        opened.assert_not_called()


def changed_identity(path, env):
    actual = os.stat(path)
    changed = type("Stat", (), {"st_mode": stat.S_IFREG | 0o600, "st_dev": actual.st_dev,
                                "st_ino": actual.st_ino + 1, "st_size": actual.st_size})()
    with patch.object(deployment.os, "fstat", return_value=changed):
        expected_error("SECRET_FILE_INVALID", lambda: deployment.configured_environment(env))


def scanner_result(error=None):
    with patch.object(deployment.ClamAVScanner, "healthcheck", side_effect=error) as call:
        result = preflight(scanner=True)
        assert call.call_count == 1 and result["scannerCalled"]
        assert not result["databaseCalled"] and not result["activationVerified"]
        if error:
            assert result["status"] == "blocked" and "malware" not in result["capabilities"]
        else:
            assert result["status"] == "checked" and "malware" in result["capabilities"]


def scanner_skipped():
    with patch.object(deployment.ClamAVScanner, "healthcheck") as call:
        result = preflight({**ENV, "WORKHUB_SCANNER_MODE": "policy_unscanned"}, scanner=True)
        call.assert_not_called()
    assert result["status"] == "blocked" and not result["scannerCalled"]


def runtime_failure():
    with patch.object(deployment, "runtime_capabilities", side_effect=RuntimeError(KEY)):
        code, result = capture(lambda: deployment.main([], ENV))
    assert code == 1 and KEY not in json.dumps(result) and result["status"] == "blocked"


def entry_no_execute(args):
    with patch.object(deployment, "configured_environment", side_effect=AssertionError("비밀 파일 읽기 금지")), \
         patch.object(container_entrypoint.worker_cli, "main", return_value=0) as run:
        assert container_entrypoint.main(args, ENV) == 0
        assert run.call_args.kwargs["env"] is ENV


def entry_execute(path, env):
    for mode in ("verify", "cleanup"):
        with patch.object(container_entrypoint.worker_cli, "main", return_value=0) as run:
            assert container_entrypoint.main([mode, "--execute", "--max-jobs", "1"], env) == 0
            assert run.call_args.kwargs["env"]["WORKHUB_SERVICE_ROLE_KEY"] == KEY
            assert run.call_args.args[0] == [mode, "--execute", "--max-jobs", "1"]
    assert "WORKHUB_SERVICE_ROLE_KEY" not in env


def entry_failure():
    with patch.object(container_entrypoint.worker_cli, "main") as run:
        code, result = capture(lambda: container_entrypoint.main(["verify", "--execute"],
            {**ENV, "WORKHUB_SERVICE_ROLE_KEY_FILE": "also-configured"}))
        assert code == 1 and result["code"] == "SECRET_SOURCE_AMBIGUOUS"
        run.assert_not_called()


def cli_bad_input():
    code, result = capture(lambda: container_entrypoint.main([KEY], ENV))
    assert code == 1 and result == {"status": "error", "code": "INVALID_ARGUMENTS"}
    code, result = capture(lambda: deployment.main([KEY], ENV))
    assert code == 1 and KEY not in json.dumps(result)


def entry_preflight():
    with patch.object(deployment, "main", return_value=7) as call:
        assert container_entrypoint.main(["preflight", "--scanner"], ENV) == 7
        assert call.call_args.args == (["--scanner"],) and call.call_args.kwargs["env"] is ENV


def actual_local_check():
    # 새 컨테이너 진입점에서 실제 격리 파서가 돌며 비밀 파일/서버 연결은 하지 않는다.
    with patch.object(deployment, "configured_environment", side_effect=AssertionError("비밀 파일 읽기 금지")):
        code, result = capture(lambda: container_entrypoint.main([], {"WORKHUB_SERVICE_ROLE_KEY_FILE": "absent"}))
    assert code == 0 and result["mode"] == "local_only"
    assert result["checks"] == list(CHECKS) and not result["databaseCalled"] and not result["storageCalled"]


def main():
    check("설정 점검은 키·학교·프로젝트를 출력하거나 서버에 연결하지 않음", good)
    for key, value in (("WORKHUB_SUPABASE_URL", "http://" + PROJECT + ".supabase.co"),
                       ("WORKHUB_EXPECTED_PROJECT_REF", "z" * 20),
                       ("WORKHUB_SERVICE_ROLE_KEY", "sb_publishable_public_only"),
                       ("WORKHUB_SCHOOL_ID", "학교 이름"),
                       ("WORKHUB_WORKER_ID", "bad worker"),
                       ("WORKHUB_WORKER_RELEASE", "r" * 51),
                       ("WORKHUB_SCANNER_MODE", "none"),
                       ("WORKHUB_CLAMAV_SOCKET", "tcp://clamav:3310")):
        check("잘못된 배포 설정 거부 " + key, lambda key=key, value=value: blocked({**ENV, key: value}))
    check("빈 키 거부", lambda: blocked({**ENV, "WORKHUB_SERVICE_ROLE_KEY": ""}))
    check("파일형 키 로드·부모 환경 보존", lambda: secret_file(KEY.encode(), file_success))
    check("파일 끝 CRLF 한 개 허용", lambda: secret_file((KEY + "\r\n").encode(), file_success))
    check("파일·환경값 중복 거부", lambda: blocked({**ENV, "WORKHUB_SERVICE_ROLE_KEY_FILE": "/any"}, "SECRET_SOURCE_AMBIGUOUS"))
    check("큰 비밀 파일 거부", lambda: secret_file(b"x" * 8193, lambda p, e: expected_error("SECRET_FILE_TOO_LARGE", lambda: deployment.configured_environment(e))))
    check("비ASCII 비밀 파일 내용 미출력", lambda: secret_file(b"\xff", lambda p, e: expected_error("SECRET_FILE_UNAVAILABLE", lambda: deployment.configured_environment(e))))
    check("여러 줄 키 거부", lambda: secret_file((KEY + "\n\n").encode(), lambda p, e: blocked(e)))
    check("다른 사용자에게 공개된 비밀 파일 거부", lambda: secret_file(KEY.encode(), file_permission))
    check("링크 파일을 열기 전에 거부", lambda: secret_file(KEY.encode(), file_link))
    check("파일 검사와 열기 사이 실물 교체 거부", lambda: secret_file(KEY.encode(), changed_identity))
    check("스캐너 점검 성공도 DB 활성화로 표시하지 않음", scanner_result)
    for error in (WorkerError("SCANNER_SIGNATURES_STALE"), WorkerError("SCANNER_SELFTEST_FAILED"), RuntimeError(KEY)):
        check("스캐너 오류·낡은 서명·예외는 실패", lambda error=error: scanner_result(error))
    check("미검사 모드에 악성 검사 성공 표시 금지", scanner_skipped)
    check("파서 자체시험 실패 원문 비밀 미출력", runtime_failure)
    for args in ([], ["check"], ["check", "--execute"], ["verify"], ["cleanup"]):
        check("명시 실행 없는 컨테이너 명령은 비밀 파일 미열람 " + str(args), lambda args=args: entry_no_execute(args))
    check("검사/정리 명시 실행 때만 파일형 키 전달", lambda: secret_file(KEY.encode(), entry_execute))
    check("비밀 준비 실패 때 기존 실행기 호출 금지", entry_failure)
    check("인자 오류에서 붙여 넣은 키를 출력하지 않음", cli_bad_input)
    check("컨테이너 preflight는 사전점검에만 전달", entry_preflight)
    check("실제 기본 진입점·격리 파서·비연결 자체시험", actual_local_check)


if __name__ == "__main__":
    main()
