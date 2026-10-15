"""R1 실제 응답 모양으로 정책 경합·응답 유실·영구 정리 차단을 회귀 검증한다."""
from copy import deepcopy
from datetime import datetime, timedelta, timezone
import hashlib
from io import BytesIO, StringIO
from pathlib import Path
import sys
from contextlib import redirect_stdout
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from pypdf import PdfWriter
from workers.collection_files.common import WorkerError
from workers.collection_files.inspection import inspect_document
from workers.collection_files.r1_worker import R1Worker, CHECKS, PREFIX
from workers.collection_files.__main__ import main


class Fixture:
    def __init__(self):
        self.time = datetime(2026, 10, 15, 8, tzinfo=timezone.utc)
        stream = BytesIO(); writer = PdfWriter(); writer.add_blank_page(width=100, height=100); writer.write(stream)
        self.body = stream.getvalue()
        self.policy = {"uploadPolicyId": "p1", "commonPolicyId": "p2", "currentUploadPolicyId": "p1",
                       "currentCommonPolicyId": "p2", "extensions": ["pdf"], "maxFileBytes": 1024**2, "allowUnscanned": True}
        self.job = {"jobId": "job1", "leaseToken": 1, "leaseExpiresAt": self.iso(300), "fileId": "file1",
                    "bucket": "workhub-collection-files", "path": "school1/file1/1234567890abcdef1234567890abcdef",
                    "storageObjectId": "00000000-0000-4000-8000-000000000001", "extension": "pdf",
                    "claimedBytes": len(self.body), "claimedSha256": hashlib.sha256(self.body).hexdigest(),
                    "maxFileBytes": 1024**2, "policy": deepcopy(self.policy)}
        self.clean = {k: self.job[k] for k in ("leaseToken", "fileId", "bucket", "path", "storageObjectId")}
        self.clean.update(ledgerId="ledger1", reason="upload_expired")
        self.calls, self.downloads, self.removals = [], 0, 0
        self.inspections = 0
        self.lease, self.matches, self.present, self.linked, self.verifying = True, True, True, False, False
        self.sealed, self.deleted, self.queued = None, None, False
        self.fail_final = False
        self.rpc_hook = lambda name, result: result
        self.download_hook = lambda: None
        self.remove_hook = lambda: None
        self.job_hook = lambda: None
        self.clean_hook = lambda: None
        self.scan_value, self.scan_hook = "clean", lambda: None
        self.claims = []
        self.worker = R1Worker(self, "school1", "worker1", "test-1", now=lambda: self.time,
                               inspector=lambda data, ext, limits, **kwargs: inspect_document(data, ext, limits))

    def iso(self, seconds):
        return (self.time + timedelta(seconds=seconds)).isoformat()

    def rpc(self, name, args):
        name = name.removeprefix(PREFIX)
        self.calls.append((name, deepcopy(args)))
        if name == "job_inspect":
            self.inspections += 1; self.job_hook()
            result = {key: self.job[key] for key in ("jobId", "fileId", "bucket", "path", "storageObjectId", "leaseExpiresAt")}
            result.update(state="leased", outcome=None, lastErrorCode=None, leaseValid=self.lease,
                          fileState="verifying", objectMatches=self.matches, policy=deepcopy(self.policy))
        elif name == "seal":
            if self.sealed is not None and self.sealed != args:
                raise WorkerError("RPC_CONFLICT")
            replay = self.sealed is not None; self.sealed = deepcopy(args)
            result = {"fileId": self.job["fileId"], "state": args["p_result"]["outcome"], "replayed": replay}
        elif name == "fail":
            self.queued = True
            result = {"fileId": self.job["fileId"], "state": "rejected" if self.fail_final else "uploaded", "final": self.fail_final}
        elif name == "cleanup_inspect":
            self.clean_hook()
            result = {key: self.clean[key] for key in ("ledgerId", "fileId", "bucket", "path", "storageObjectId")}
            result.update(state="blocked", outcome=None, retainedReason=None, leaseValid=self.lease, leaseExpiresAt=self.iso(600),
                          linked=self.linked, verifying=self.verifying, objectPresent=self.present, objectMatches=self.present and self.matches)
        elif name == "cleanup_done":
            if args["p_outcome"] == "deleted" and self.present:
                raise WorkerError("RPC_CONFLICT")
            replay = self.deleted is not None; self.deleted = deepcopy(args)
            result = {"fileId": self.clean["fileId"], "ledgerId": self.clean["ledgerId"], "outcome": args["p_outcome"], "replayed": replay}
        elif name in ("claim", "cleanup_claim"):
            result = self.claims.pop(0) if self.claims else []
        elif name == "heartbeat":
            result = {"servicePrincipalId": "svc1", "expiresAt": self.iso(120)}
        else:
            raise AssertionError(name)
        return self.rpc_hook(name, result)

    def download(self, bucket, path, max_bytes, deadline):
        self.downloads += 1; self.download_hook()
        if len(self.body) > max_bytes:
            raise WorkerError("SIZE_LIMIT")
        return self.body

    def remove(self, bucket, path, *, deadline=None):
        self.removals += 1; self.present = False; self.remove_hook()

    def healthcheck(self):
        self.scan_hook()

    def scan(self, data, deadline):
        self.scan_hook()
        return self.scan_value


def require(condition, value=None):
    assert condition, value


passed = failed = 0

def test(name, fn):
    global passed, failed
    try:
        fn(); passed += 1; print("  ✓ " + name)
    except Exception as exc:
        failed += 1; print("  ✗ " + name + ": " + repr(exc))


def ready_without_scanner():
    f = Fixture(); r = f.worker.verify(f.job)
    require(r["outcome"] == "ready", r)
    require(f.sealed["p_result"]["scanState"] == "not_scanned")
    require("malware" not in f.sealed["p_result"]["checks"])
    require(all(f.sealed["p_result"]["checks"][k] is True for k in CHECKS))


def scanner_required():
    f = Fixture(); f.policy["allowUnscanned"] = False
    r = f.worker.verify(f.job)
    require(r["status"] == "retry" and f.downloads == 0 and f.sealed is None, r)


def scanned(rejected=False):
    f = Fixture(); f.worker.scanner = f; f.policy["allowUnscanned"] = False
    f.scan_value = "rejected" if rejected else "clean"
    r = f.worker.verify(f.job)
    require(r["outcome"] == ("quarantined" if rejected else "ready"), r)
    require(f.sealed["p_result"]["checks"]["malware"] is (not rejected))


def changed_bytes(kind):
    f = Fixture()
    if kind == "size": f.body += b"extra"
    else: f.body = b"z" + f.body[1:]
    r = f.worker.verify(f.job)
    require(r["outcome"] == "rejected", r)
    require(f.sealed["p_result"]["rejectReason"] == kind + "_mismatch")


def policy_race(field, value):
    f = Fixture(); f.download_hook = lambda: f.policy.update({field: value})
    r = f.worker.verify(f.job)
    require(r["status"] == "retry" and f.sealed is None, r)


def lease_or_object(kind):
    f = Fixture()
    f.download_hook = lambda: setattr(f, kind, False)
    r = f.worker.verify(f.job)
    require(r["status"] == "stopped" and f.sealed is None, r)


def unknown_seal(always=False):
    f = Fixture(); lost = [False]
    def hook(name, result):
        if name == "seal" and (always or not lost[0]):
            lost[0] = True; raise WorkerError("TRANSPORT_TIMEOUT")
        return result
    f.rpc_hook = hook
    r = f.worker.verify(f.job)
    require(r["status"] == ("unknown" if always else "recorded"), r)
    calls = [a for n, a in f.calls if n == "seal"]
    require(len(calls) == 2 and calls[0] == calls[1] and not f.queued)


def definite_seal_refusal():
    f = Fixture()
    def hook(name, result):
        if name == "seal": raise WorkerError("RPC_CONFLICT")
        return result
    f.rpc_hook = hook; r = f.worker.verify(f.job)
    require(r["status"] == "error" and len([n for n, _ in f.calls if n == "seal"]) == 1 and not f.queued, r)


def malformed_receipt():
    f = Fixture(); f.rpc_hook = lambda name, result: {**result, "state": "deleted"} if name == "seal" else result
    r = f.worker.verify(f.job)
    require(r["status"] == "unknown" and not f.queued, r)


def invalid_job(field, value):
    f = Fixture(); f.job[field] = value
    r = f.worker.verify(f.job)
    require(r["status"] == "error" and not f.calls, r)


def parser_unavailable(status):
    f = Fixture(); f.worker.inspector = lambda *args, **kw: {"status": status, "code": "parser_missing", "mime": None}
    r = f.worker.verify(f.job)
    require(r["status"] == ("retry" if status == "error" else "recorded"), r)
    if status == "unsupported": require(f.sealed["p_result"]["rejectReason"] == "unsupported")


def malformed_format():
    f = Fixture(); f.worker.inspector = lambda *args, **kw: {"status": "passed", "code": "ok", "mime": "text/html"}
    r = f.worker.verify(f.job); require(r["status"] == "retry" and f.sealed is None, r)


def scanner_error():
    f = Fixture(); f.worker.scanner = f
    def err(): raise RuntimeError("SECRET_AND_PRIVATE_FILE")
    f.scan_hook = err; r = f.worker.verify(f.job)
    require(r["status"] == "retry" and "SECRET" not in str(r), r)


def final_attempt():
    f = Fixture(); f.fail_final = True; f.policy["allowUnscanned"] = False
    r = f.worker.verify(f.job); require(r["status"] == "rejected" and f.sealed is None, r)


def normal_cleanup(absent=False):
    f = Fixture(); f.present = not absent
    if absent: f.clean["storageObjectId"] = None; f.matches = False
    r = f.worker.cleanup(f.clean)
    require(r["outcome"] == "deleted" and f.removals == (0 if absent else 1), r)


def changed_cleanup(null=False):
    f = Fixture(); f.matches = False
    if null: f.clean["storageObjectId"] = None
    r = f.worker.cleanup(f.clean)
    require(r["outcome"] == "retained" and f.removals == 0, r)


def cleanup_blocked(field):
    f = Fixture(); setattr(f, field, field != "lease")
    r = f.worker.cleanup(f.clean)
    require(r["status"] == "stopped" and f.removals == 0 and f.deleted is None, r)


def lost_delete():
    f = Fixture()
    def err(): raise WorkerError("TRANSPORT_TIMEOUT")
    f.remove_hook = err; r = f.worker.cleanup(f.clean)
    require(r["status"] == "unknown" and f.removals == 1 and f.deleted is None, r)
    f.clean["leaseToken"] = 2; r = f.worker.cleanup(f.clean)
    require(r["outcome"] == "deleted" and f.removals == 1, r)


def retained_metadata():
    f = Fixture(); f.remove_hook = lambda: setattr(f, "present", True)
    r = f.worker.cleanup(f.clean)
    require(r["status"] == "unknown" and f.deleted is None, r)


def lost_done():
    f = Fixture(); lost = [False]
    def hook(name, result):
        if name == "cleanup_done" and not lost[0]:
            lost[0] = True; raise WorkerError("TRANSPORT_NETWORK")
        return result
    f.rpc_hook = hook; r = f.worker.cleanup(f.clean)
    require(r["outcome"] == "deleted", r)
    calls = [a for n, a in f.calls if n == "cleanup_done"]
    require(len(calls) == 2 and calls[0] == calls[1] and f.removals == 1)


def boundary_change():
    f = Fixture(); count = [0]
    def hook():
        count[0] += 1
        if count[0] == 2: f.matches = False
    f.clean_hook = hook; r = f.worker.cleanup(f.clean)
    require(r["status"] == "stopped" and f.removals == 0, r)


def dry_run():
    for cleanup in (False, True):
        f = Fixture(); r = f.worker.run_once(cleanup=cleanup)
        require(r["mode"] == "dry_run" and not f.calls and not f.downloads and not f.removals)


def claim_serial():
    f = Fixture(); f.claims = [[deepcopy(f.job)], []]
    r = f.worker.run_once(execute=True, max_jobs=2)
    require(len(r["verification"]) == 1 and r["verification"][0]["outcome"] == "ready", r)
    require(all(a["p_limit"] == 1 for n, a in f.calls if n == "claim"))
    require([n for n, _ in f.calls].index("seal") < len(f.calls) - 1)


def cli_local():
    output = StringIO()
    with patch("workers.collection_files.__main__.runtime_capabilities", return_value=list(CHECKS)), patch("workers.collection_files.__main__.SupabaseTransport") as t, redirect_stdout(output):
        require(main(["cleanup"], {}) == 0); t.assert_not_called()
    require('"databaseCalled": false' in output.getvalue())


def cli_secret_safe():
    output = StringIO()
    with patch("workers.collection_files.__main__.runtime_capabilities", return_value=list(CHECKS)), redirect_stdout(output):
        require(main(["verify", "--execute"], {"WORKHUB_SERVICE_ROLE_KEY": "SECRET"}) == 1)
    require("SECRET" not in output.getvalue() and "PROJECT_MISMATCH" in output.getvalue())


def forged_malware_capability():
    f = Fixture()
    try: f.worker.heartbeat([*CHECKS, "malware"])
    except WorkerError: pass
    else: raise AssertionError("missing scanner accepted")
    require(not f.calls)


test("허용 정책에서만 미검사 상태를 그대로 봉인", ready_without_scanner)
test("악성 검사 필수 정책에서 스캐너 없으면 완료 금지", scanner_required)
test("실제 clean 결과와 검사표 연결", scanned)
test("악성 결과는 격리로 기록", lambda: scanned(True))
for kind in ("size", "hash"): test("실물 " + kind + " 불일치 확정 거절", lambda kind=kind: changed_bytes(kind))
for field, value in (("extensions", []), ("maxFileBytes", 1), ("allowUnscanned", False)):
    test("검사 도중 엄격해진 정책 " + field, lambda f=field, v=value: policy_race(f, v))
for kind in ("lease", "matches"): test("검사 뒤 " + kind + " 변경이면 봉인 중지", lambda kind=kind: lease_or_object(kind))
test("봉인 응답 유실은 같은 인자로만 재전송", unknown_seal)
test("봉인 두 번 유실이면 fail로 덮어쓰지 않음", lambda: unknown_seal(True))
test("확정 CONFLICT는 재전송하지 않음", definite_seal_refusal)
test("다른 접수증이면 결과 미확정 유지", malformed_receipt)
for field, value in (("leaseToken", True), ("path", "other/file1/1234567890abcdef"), ("storageObjectId", None),
                     ("claimedSha256", "private"), ("leaseExpiresAt", "2020-01-01T00:00:00Z")):
    test("잘못된 작업은 네트워크 호출 전 거부 " + field, lambda f=field, v=value: invalid_job(f, v))
test("미지원 형식은 유한한 명시적 거절", lambda: parser_unavailable("unsupported"))
test("파서 장애는 일시 재시도", lambda: parser_unavailable("error"))
test("파서의 잘못된 MIME은 성공으로 보지 않음", malformed_format)
test("검사 공급자 예외에 비밀·파일 정보 없음", scanner_error)
test("서버가 정한 마지막 재시도 종료 반영", final_attempt)
test("일치하는 정리 대상만 Storage 삭제", normal_cleanup)
test("실물 없으면 삭제 API 없이 원장 완료", lambda: normal_cleanup(True))
test("실물 교체되면 원장 보존 처리", changed_cleanup)
test("원장 NULL 뒤 실물 생성도 보존", lambda: changed_cleanup(True))
for field in ("lease", "linked", "verifying"):
    test("정리 전 " + field + " 변화로 삭제 차단", lambda field=field: cleanup_blocked(field))
test("Storage 응답 유실 뒤 재인수는 부재 확인부터 복구", lost_delete)
test("삭제 성공 응답이어도 실물 남으면 완료 금지", retained_metadata)
test("정리 접수 응답 유실은 동일 인자로만 재전송", lost_done)
test("삭제 직전 객체가 바뀌면 삭제 안 함", boundary_change)
test("기본 dry run은 claim/heartbeat/Storage를 모두 호출 안 함", dry_run)
test("작업은 한 건씩 인수하여 뒤쪽 임대 만료 방지", claim_serial)
test("CLI 기본 동작은 자격 없이 로컬 검사만", cli_local)
test("잘못된 프로젝트 설정과 키 출력 방지", cli_secret_safe)
test("스캐너 없이 malware 준비 상태 신고 금지", forged_malware_capability)

def lost_scanner_heartbeat():
    f = Fixture(); f.worker.scanner = f
    def broken(): raise WorkerError("SCANNER_UNAVAILABLE")
    f.scan_hook = broken
    try: f.worker.heartbeat([*CHECKS, "malware"])
    except WorkerError: pass
    else: raise AssertionError("dead scanner reported healthy")
    require(not f.calls)

def failed_batch_stops():
    f = Fixture(); f.policy["allowUnscanned"] = False
    f.claims = [[deepcopy(f.job)], [deepcopy(f.job)]]
    r = f.worker.run_once(execute=True, max_jobs=2)
    require(len(r["verification"]) == 1)
    require(len([n for n, _ in f.calls if n == "heartbeat"]) == 1)

test("스캐너 장애면 malware heartbeat 갱신 안 함", lost_scanner_heartbeat)
test("파일 처리 실패면 다음 작업을 인수하지 않음", failed_batch_stops)
print(f"\n{passed} passed, {failed} failed")
if failed: raise SystemExit(1)
