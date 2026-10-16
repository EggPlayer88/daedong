"""임시 파일 정리의 모의 포트 시험. DB·Storage·네트워크를 사용하지 않는다."""
from copy import deepcopy
from datetime import datetime, timedelta, timezone
from pathlib import Path
import json
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from workers.collection_files.cleanup import run_cleanup
from workers.collection_files.common import WorkerError, canonical_hash


class Clock:
    def __init__(self):
        self.value = datetime(2026, 10, 15, 2, 0, tzinfo=timezone.utc)
    def __call__(self):
        return self.value


def make_job():
    return {
        "lease": {
            "job_id": "job-1", "run_id": "run-1", "lease_token": "secret-lease-1",
            "expires_at": "2026-10-15T03:00:00Z", "policy_version": "policy-4",
            "object": {
                "school_id": "school-1", "file_id": "file-1", "bucket": "workhub-collection-files",
                "path": "school-1/file-1/opaque-file-key-0001", "identity": "object-uuid-1:revision-1",
            },
        },
        "approval": {
            "approved": True, "reference": "approval-7", "policy_version": "policy-4",
            "retention_seconds": 86400, "eligible_after": "2026-10-14T00:00:00Z",
        },
    }


class Ledger:
    def __init__(self, job):
        self.snapshot = {
            "object": deepcopy(job["lease"]["object"]), "policy_version": "policy-4",
            "approval": deepcopy(job["approval"]), "state": "candidate",
            "orphaned_at": "2026-10-10T00:00:00Z",
            "references": {"template": 0, "draft": 0, "submission": 0, "other": 0},
            "holds": 0, "active_uploads": 0, "active_verifiers": 0,
            "recoverable_requests": 0, "ticket": None,
        }
        self.calls = []
        self.before_reserve = None
        self.before_recheck = None
        self.lose_reserve = False
        self.lose_finalize = False
        self.bad_finalize = False
        self.inspection_override = None
        self.after_finalize = None

    def inspect(self, job):
        self.calls.append(("inspect", deepcopy(job)))
        if self.inspection_override:
            return self.inspection_override(deepcopy(self.snapshot))
        return deepcopy(self.snapshot)

    def reserve(self, job, inspection_hash):
        self.calls.append(("reserve", inspection_hash))
        if self.before_reserve:
            self.before_reserve(self)
        # 모의 트랜잭션: 첨부/hold/정책 변경을 잠금 안에서 검사한다고 가정한다.
        if canonical_hash(self.snapshot) != inspection_hash:
            raise WorkerError("CONFLICT")
        assert not any(self.snapshot["references"].values())
        assert self.snapshot["approval"] == job["approval"]
        assert not any(self.snapshot[key] for key in ("holds", "active_uploads", "active_verifiers", "recoverable_requests"))
        ticket = {
            "deletion_id": "deletion-1", "deletion_token": "secret-deletion-1",
            "lease": deepcopy(job["lease"]), "object": deepcopy(job["lease"]["object"]),
            "policy_version": "policy-4", "inspection_hash": inspection_hash,
            "approval_hash": canonical_hash(job["approval"]), "blocked": True,
            "immutable_path_fence": True,
        }
        self.snapshot["state"] = "blocked"
        self.snapshot["ticket"] = deepcopy(ticket)
        if self.lose_reserve:
            self.lose_reserve = False
            raise OSError("secret SQL / internal path")
        return ticket

    def recheck(self, ticket):
        self.calls.append(("recheck", deepcopy(ticket)))
        if self.before_recheck:
            self.before_recheck(self)
        assert self.snapshot["ticket"] == ticket
        return deepcopy(self.snapshot)

    def finalize(self, ticket, evidence_hash):
        self.calls.append(("finalize", deepcopy(ticket), evidence_hash))
        assert self.snapshot["ticket"] == ticket
        assert self.snapshot["state"] == "blocked"
        self.snapshot["state"] = "purged"
        if self.lose_finalize:
            self.lose_finalize = False
            raise OSError("secret finalize response")
        response = {"status": "purged", "deletion_id": ticket["deletion_id"], "ticket_fingerprint": canonical_hash(ticket), "evidence_hash": evidence_hash}
        if self.bad_finalize:
            response["evidence_hash"] = "f" * 64
        if self.after_finalize:
            self.after_finalize()
        return response

    def try_attach(self, kind):
        if self.snapshot["state"] != "candidate":
            return False
        self.snapshot["references"][kind] += 1
        return True

    def try_hold(self):
        if self.snapshot["state"] != "candidate":
            return False
        self.snapshot["holds"] += 1
        return True


class Storage:
    def __init__(self, ledger, job):
        self.ledger = ledger
        self.object = deepcopy(job["lease"]["object"])
        self.calls = []
        self.after_head = None
        self.remove_mode = "normal"
        self.head_mode = "normal"

    def head(self, reference):
        self.calls.append(("head", deepcopy(reference)))
        if self.head_mode == "error":
            raise OSError("secret permission error, not missing")
        result = {"exists": self.object is not None, "object": deepcopy(self.object)}
        if self.head_mode == "malformed":
            result = None
        if self.after_head:
            self.after_head(self)
        return result

    def remove(self, reference, ticket):
        self.calls.append(("remove", deepcopy(reference), deepcopy(ticket)))
        assert self.ledger.snapshot["state"] == "blocked"
        assert self.ledger.snapshot["ticket"] == ticket
        assert self.object == reference
        if self.remove_mode == "truthy_only":
            return True
        if self.remove_mode == "raise_before":
            raise TimeoutError("secret delete status unknown")
        self.object = None
        if self.remove_mode == "lose_response":
            self.remove_mode = "normal"
            raise TimeoutError("secret delete status unknown")
        return None

    def try_replace(self, identity):
        if self.ledger.snapshot["state"] != "candidate":
            return False
        self.object["identity"] = identity
        return True


class Fixture:
    def __init__(self):
        self.job, self.clock = make_job(), Clock()
        self.ledger = Ledger(self.job)
        self.storage = Storage(self.ledger, self.job)
        self.cancelled = False
    def run(self, *, dry_run=False):
        return run_cleanup(self.job, self.ledger, self.storage, now=self.clock, cancel=lambda: self.cancelled, dry_run=dry_run)


passed, failed = 0, 0
def test(name, body):
    global passed, failed
    try:
        body()
        passed += 1
        print("  ✓ " + name)
    except Exception as error:
        failed += 1
        print("  ✗ " + name + ": " + repr(error))
        import traceback
        traceback.print_exc()


def expect_result(fixture, status, code, *, dry_run=False):
    result = fixture.run(dry_run=dry_run)
    assert (result["status"], result["code"]) == (status, code), result
    assert set(result) == {"status", "code", "deletion_id", "ticket_fingerprint"}
    text = json.dumps(result)
    for secret in ("secret-", "school-1", "file-1", "opaque-file", "internal path"):
        assert secret not in text, text
    return result


def no_write(f):
    assert [c[0] for c in f.ledger.calls] in ([], ["inspect"])
    assert f.storage.calls == []


def default_preview():
    f = Fixture()
    result = run_cleanup(f.job, f.ledger, f.storage, now=f.clock)
    assert result["status"] == "preview"
    no_write(f)
    assert f.ledger.snapshot["state"] == "candidate"
test("기본 실행은 원장 읽기만 하고 Storage·차단·삭제를 호출하지 않는다", default_preview)


def delete_success():
    f = Fixture()
    result = expect_result(f, "deleted", "PURGED")
    assert f.storage.object is None
    assert f.ledger.snapshot["state"] == "purged"
    assert result["deletion_id"] == "deletion-1"
    assert [c[0] for c in f.storage.calls] == ["head", "remove", "head"]
    assert [c[0] for c in f.ledger.calls] == ["inspect", "reserve", "recheck", "recheck", "recheck", "finalize"]
    original = deepcopy(f.ledger.snapshot)
    expect_result(f, "skipped", "ALREADY_PURGED")
    assert f.ledger.snapshot == original
    assert len([c for c in f.storage.calls if c[0] == "remove"]) == 1
test("차단 후 Storage API 삭제와 실제 부재 확인을 거쳐 한 번만 확정한다", delete_success)


for kind in ("template", "draft", "submission", "other"):
    def preserve_reference(kind=kind):
        f = Fixture(); f.ledger.snapshot["references"][kind] = 1
        expect_result(f, "skipped", "REFERENCED"); no_write(f)
    test("배부·초안·과거 제출·알 수 없는 참조를 보존한다: " + kind, preserve_reference)

for field, code in (("holds", "HELD"), ("active_uploads", "ACTIVE_WORK"), ("active_verifiers", "ACTIVE_WORK"), ("recoverable_requests", "RECOVERABLE_REQUEST")):
    def preserve_active(field=field, code=code):
        f = Fixture(); f.ledger.snapshot[field] = 1
        expect_result(f, "skipped", code); no_write(f)
    test("보류·진행·결과 재확인 가능 작업이 있으면 보존한다: " + field, preserve_active)


def retention_unmet():
    f = Fixture(); f.ledger.snapshot["orphaned_at"] = "2026-10-15T01:00:00Z"
    expect_result(f, "skipped", "RETENTION_NOT_MET"); no_write(f)
test("승인 보존기간이 지나지 않은 고아 파일은 남긴다", retention_unmet)


def future_eligibility():
    f = Fixture()
    f.job["approval"]["eligible_after"] = "2026-10-16T00:00:00Z"
    f.ledger.snapshot["approval"] = deepcopy(f.job["approval"])
    expect_result(f, "skipped", "NOT_YET_ELIGIBLE"); no_write(f)
test("승인된 최소 정리 시각 이전에는 정리하지 않는다", future_eligibility)


def retention_boundary():
    f = Fixture(); f.ledger.snapshot["orphaned_at"] = "2026-10-14T02:00:00Z"
    expect_result(f, "preview", "ELIGIBLE", dry_run=True); no_write(f)
test("보존기간과 최소 시각의 정확한 경계는 명시한 정책대로 처리한다", retention_boundary)


def missing_retention():
    f = Fixture(); del f.job["approval"]["retention_seconds"]
    expect_result(f, "error", "INVALID_CONTRACT"); no_write(f)
test("보존기간이 빠지면 기본 일수를 추측하지 않는다", missing_retention)


def unapproved():
    f = Fixture(); f.job["approval"]["approved"] = False
    expect_result(f, "error", "APPROVAL_MISMATCH"); no_write(f)
test("미승인 작업은 원장 호출 전에 거부한다", unapproved)


def current_approval_differs():
    f = Fixture(); f.ledger.snapshot["approval"]["reference"] = "revoked-approval"
    expect_result(f, "error", "APPROVAL_MISMATCH"); no_write(f)
test("작업의 approved 값만 믿지 않고 현재 원장의 승인과 대조한다", current_approval_differs)


def policy_changed():
    f = Fixture(); f.ledger.snapshot["policy_version"] = "policy-5"
    expect_result(f, "error", "POLICY_CHANGED"); no_write(f)
test("원장 정책판이 바뀌면 삭제하지 않는다", policy_changed)


for field in ("holds", "active_uploads", "active_verifiers", "recoverable_requests"):
    def race(field=field):
        f = Fixture(); f.ledger.before_reserve = lambda ledger: ledger.snapshot.__setitem__(field, 1)
        expect_result(f, "result_unknown", "CONFLICT")
        assert not f.storage.calls and f.ledger.snapshot["state"] == "candidate"
    test("조회 후 차단 예약 전 경합도 원자 재검사로 막는다: " + field, race)


def attach_race():
    f = Fixture(); f.ledger.before_reserve = lambda ledger: ledger.try_attach("draft")
    expect_result(f, "result_unknown", "CONFLICT")
    assert not f.storage.calls and f.ledger.snapshot["references"]["draft"] == 1
test("판단 직후 초안 저장이 먼저 이기면 삭제를 예약하지 못한다", attach_race)


def fence_blocks_late_save():
    f = Fixture(); rejected = []
    def compete(storage):
        rejected.append(f.ledger.try_attach("submission"))
        rejected.append(f.ledger.try_hold())
        rejected.append(storage.try_replace("replacement-identity"))
    f.storage.after_head = compete
    expect_result(f, "deleted", "PURGED")
    assert rejected and not any(rejected)
test("예약 후 저장·새 hold·파일 교체는 영구 경로 차단으로 막는 계약을 시험한다", fence_blocks_late_save)


def expired():
    f = Fixture(); f.clock.value += timedelta(hours=1)
    expect_result(f, "skipped", "LEASE_EXPIRED"); no_write(f)
test("만료된 작업 lease는 읽기 전에도 중단한다", expired)


def expires_after_head():
    f = Fixture(); f.storage.after_head = lambda storage: setattr(f.clock, "value", f.clock.value + timedelta(hours=1))
    expect_result(f, "result_unknown", "LEASE_EXPIRED")
    assert f.ledger.snapshot["state"] == "blocked"
    assert [c[0] for c in f.storage.calls] == ["head"]
    assert not f.ledger.try_attach("draft")
test("실물 확인 도중 lease가 끝나면 삭제하지 않고 차단은 유지한다", expires_after_head)


def cancellation():
    f = Fixture(); f.cancelled = True
    expect_result(f, "skipped", "CANCELLED"); no_write(f)
test("시작 전 취소는 포트를 호출하지 않는다", cancellation)


def cancellation_after_head():
    f = Fixture(); f.storage.after_head = lambda storage: setattr(f, "cancelled", True)
    expect_result(f, "result_unknown", "CANCELLED")
    assert f.ledger.snapshot["state"] == "blocked"
    assert [c[0] for c in f.storage.calls] == ["head"]
test("실물 확인 뒤 취소는 삭제를 멈추고 차단을 남긴다", cancellation_after_head)


def foreign_path():
    f = Fixture(); f.job["lease"]["object"]["path"] = "other-school/file-1/opaque-file-key-0001"
    expect_result(f, "error", "INVALID_OBJECT"); no_write(f)
test("다른 학교 경로를 작업자로 주입할 수 없다", foreign_path)


def stale_identity():
    f = Fixture(); f.storage.object["identity"] = "object-uuid-2:revision-1"
    expect_result(f, "result_unknown", "OBJECT_CHANGED")
    assert [c[0] for c in f.storage.calls] == ["head"]
    assert f.ledger.snapshot["state"] == "blocked"
test("같은 경로라도 물체 정체성이 바뀌면 삭제하지 않는다", stale_identity)


def missing_head_is_error():
    f = Fixture(); f.storage.head_mode = "error"
    expect_result(f, "result_unknown", "PORT_ERROR")
    assert f.storage.object and f.ledger.snapshot["state"] == "blocked"
    assert not [c for c in f.ledger.calls if c[0] == "finalize"]
test("실물 조회 오류를 파일 부재로 취급하지 않는다", missing_head_is_error)


def malformed_head():
    f = Fixture(); f.storage.head_mode = "malformed"
    expect_result(f, "result_unknown", "INVALID_CONTRACT")
    assert f.storage.object and f.ledger.snapshot["state"] == "blocked"
test("불완전한 실물 응답은 삭제 성공으로 처리하지 않는다", malformed_head)


def truthy_delete_is_not_proof():
    f = Fixture(); f.storage.remove_mode = "truthy_only"
    expect_result(f, "result_unknown", "DELETION_NOT_CONFIRMED")
    assert f.storage.object and f.ledger.snapshot["state"] == "blocked"
    assert not [c for c in f.ledger.calls if c[0] == "finalize"]
test("삭제 API의 true 응답만으로 purged를 기록하지 않는다", truthy_delete_is_not_proof)


def lost_delete_resume():
    f = Fixture(); f.storage.remove_mode = "lose_response"
    first = expect_result(f, "result_unknown", "PORT_ERROR")
    assert f.storage.object is None and f.ledger.snapshot["state"] == "blocked"
    second = expect_result(f, "deleted", "PURGED")
    assert first["ticket_fingerprint"] == second["ticket_fingerprint"]
    assert first["deletion_id"] == second["deletion_id"]
    assert len([c for c in f.storage.calls if c[0] == "remove"]) == 1
    assert len([c for c in f.ledger.calls if c[0] == "reserve"]) == 1
test("삭제 응답 유실 뒤 같은 티켓으로 부재를 재확인하고 중복 삭제하지 않는다", lost_delete_resume)


def failed_delete_resume():
    f = Fixture(); f.storage.remove_mode = "raise_before"
    first = expect_result(f, "result_unknown", "PORT_ERROR")
    assert f.storage.object and f.ledger.snapshot["state"] == "blocked"
    f.storage.remove_mode = "normal"
    second = expect_result(f, "deleted", "PURGED")
    assert first["ticket_fingerprint"] == second["ticket_fingerprint"]
    assert len([c for c in f.ledger.calls if c[0] == "reserve"]) == 1
test("삭제가 안 된 결과 불명확 작업도 새 예약 없이 같은 티켓으로 재시도한다", failed_delete_resume)


def reserve_ack_lost():
    f = Fixture(); f.ledger.lose_reserve = True
    result = expect_result(f, "result_unknown", "PORT_ERROR")
    assert result["deletion_id"] is None and f.ledger.snapshot["state"] == "blocked"
    assert not f.storage.calls
    expect_result(f, "deleted", "PURGED")
    assert len([c for c in f.ledger.calls if c[0] == "reserve"]) == 1
test("예약 응답이 유실돼도 다음 조회가 기존 영구 차단 티켓을 재사용한다", reserve_ack_lost)


def finalize_ack_lost():
    f = Fixture(); f.ledger.lose_finalize = True
    first = expect_result(f, "result_unknown", "PORT_ERROR")
    second = expect_result(f, "skipped", "ALREADY_PURGED")
    assert first["ticket_fingerprint"] == second["ticket_fingerprint"]
    assert len([c for c in f.ledger.calls if c[0] == "finalize"]) == 1
    assert len([c for c in f.storage.calls if c[0] == "remove"]) == 1
test("원장 확정 응답 유실도 기존 접수 기록으로 복구한다", finalize_ack_lost)


def finalize_mismatch():
    f = Fixture(); f.ledger.bad_finalize = True
    expect_result(f, "result_unknown", "FINALIZE_NOT_CONFIRMED")
test("삭제 확정 접수증의 증거 해시가 다르면 성공으로 표시하지 않는다", finalize_mismatch)


def expiry_after_confirmed_receipt():
    f = Fixture()
    f.ledger.after_finalize = lambda: setattr(f.clock, "value", f.clock.value + timedelta(hours=2))
    expect_result(f, "deleted", "PURGED")
    assert f.ledger.snapshot["state"] == "purged" and f.storage.object is None
test("확정 접수증을 받은 직후 lease 만료를 결과 불명으로 바꾸지 않는다", expiry_after_confirmed_receipt)


def cancel_after_confirmed_receipt():
    f = Fixture()
    f.ledger.after_finalize = lambda: setattr(f, "cancelled", True)
    expect_result(f, "deleted", "PURGED")
    assert f.ledger.snapshot["state"] == "purged" and f.storage.object is None
test("확정 접수증을 받은 직후 취소를 결과 불명으로 바꾸지 않는다", cancel_after_confirmed_receipt)


def no_fence():
    f = Fixture(); original = f.ledger.reserve
    def unsafe(job, digest):
        ticket = original(job, digest); ticket["immutable_path_fence"] = False; return ticket
    f.ledger.reserve = unsafe
    expect_result(f, "result_unknown", "FENCE_REQUIRED")
    assert not f.storage.calls
test("저장·교체를 막는 영구 차단 증명 없이는 Storage를 호출하지 않는다", no_fence)


def changed_approval_before_delete():
    f = Fixture()
    f.ledger.before_recheck = lambda ledger: ledger.snapshot["approval"].__setitem__("reference", "approval-revoked")
    expect_result(f, "result_unknown", "APPROVAL_MISMATCH")
    assert not f.storage.calls
test("예약 후 삭제 직전 정책 승인이 바뀌어도 멈춘다", changed_approval_before_delete)


def falsy_counters():
    f = Fixture(); f.ledger.snapshot["references"]["draft"] = False
    expect_result(f, "error", "INVALID_CONTRACT"); no_write(f)
test("참조 개수의 false를 0으로 받아들이지 않는다", falsy_counters)


def unknown_counter():
    f = Fixture(); f.ledger.snapshot["references"]["new_kind"] = 0
    expect_result(f, "error", "INVALID_CONTRACT"); no_write(f)
test("예상하지 못한 참조 종류 계약은 조용히 무시하지 않는다", unknown_counter)


def blocked_preview():
    f = Fixture(); f.ledger.lose_reserve = True; f.run()
    f.ledger.calls.clear(); f.storage.calls.clear()
    result = expect_result(f, "preview", "ELIGIBLE", dry_run=True)
    no_write(f); assert result["deletion_id"] == "deletion-1"
test("복구할 차단 티켓이 있어도 dry run은 삭제를 재개하지 않는다", blocked_preview)


def lease_rebinding_is_not_implicit():
    f = Fixture(); f.ledger.lose_reserve = True; f.run()
    f.clock.value += timedelta(hours=2)
    f.job["lease"]["run_id"] = "run-2"
    f.job["lease"]["lease_token"] = "secret-new-lease"
    f.job["lease"]["expires_at"] = "2026-10-15T05:00:00Z"
    expect_result(f, "error", "TICKET_MISMATCH")
    assert f.ledger.snapshot["state"] == "blocked" and not f.storage.calls
    assert not f.ledger.try_attach("draft")
test("만료 후 새 lease를 기존 삭제 티켓에 임의 결합하지 않는다", lease_rebinding_is_not_implicit)


def orphan_clock_is_pinned():
    f = Fixture()
    f.ledger.before_recheck = lambda ledger: ledger.snapshot.__setitem__("orphaned_at", "2026-10-09T00:00:00Z")
    expect_result(f, "result_unknown", "INSPECTION_CHANGED")
    assert f.ledger.snapshot["state"] == "blocked" and not f.storage.calls
test("여전히 보존기간을 충족해도 예약 뒤 고아 시각이 바뀌면 중단한다", orphan_clock_is_pinned)


def private_input():
    f = Fixture(); original = deepcopy(f.job)
    expect_result(f, "deleted", "PURGED")
    assert f.job == original
test("호출자의 작업 입력을 변경하지 않고 민감한 토큰도 결과에 노출하지 않는다", private_input)


def untrusted_error_code():
    f = Fixture()
    def malformed_error(job):
        raise WorkerError(["secret-error-detail"])
    f.ledger.inspect = malformed_error
    expect_result(f, "error", "PORT_ERROR")
    assert not f.storage.calls
test("포트 오류 코드가 깨져도 원문 노출이나 처리되지 않은 예외가 없다", untrusted_error_code)

print(f"\n{passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
