"""미첨부 파일 정리의 오프라인 실행기. 실제 DB·Storage 어댑터는 제공하지 않는다.

포트는 신뢰된 서버 작업만 받는다. inspect는 읽기 전용이고 reserve는 승인 정책,
typed 관계, hold, 다른 작업을 같은 파일 잠금에서 다시 검사해 영구 차단을 만든다.
차단은 lease가 끝나도 풀리지 않으며 경로 교체·재첨부·새 임시 hold를 막아야 한다.
hold 생성도 같은 파일 잠금에서 먼저 확정한 작업만 성공해야 한다. Storage의
조건부 삭제 기능을 가정하지 않으므로 이 차단을 보장하지 못하면 연결하면 안 된다.
"""
from copy import deepcopy
import re

from .common import (
    WorkerError, canonical_hash, check_guard, checked_lease, checked_ref,
    exact, identifier, instant, opaque, utc_now,
)


_COUNTS = ("holds", "active_uploads", "active_verifiers", "recoverable_requests")
_REFERENCES = ("template", "draft", "submission", "other")
_SAFE_ERRORS = frozenset((
    "INVALID_CONTRACT", "INVALID_OBJECT", "INVALID_CLOCK", "LEASE_EXPIRED",
    "CANCELLED", "APPROVAL_MISMATCH", "OBJECT_CHANGED", "POLICY_CHANGED",
    "TICKET_MISMATCH", "FENCE_REQUIRED", "INSPECTION_CHANGED", "NOT_ELIGIBLE",
    "FORBIDDEN", "CONFLICT",
))


def _count(value):
    if type(value) is not int or not 0 <= value <= 9007199254740991:
        raise WorkerError("INVALID_CONTRACT")
    return value


def _approval(raw):
    value = exact(raw, ("approved", "reference", "policy_version", "retention_seconds", "eligible_after"))
    if value["approved"] is not True:
        raise WorkerError("APPROVAL_MISMATCH")
    # 승인 식별자는 로그용 문장이 아니라 서버가 발급한 불변 참조다.
    identifier(value["reference"]); identifier(value["policy_version"])
    _count(value["retention_seconds"]); instant(value["eligible_after"])
    return deepcopy(value)


def _job(raw, now):
    value = exact(raw, ("lease", "approval"))
    lease = checked_lease(value["lease"], now)
    approval = _approval(value["approval"])
    if approval["policy_version"] != lease["policy_version"]:
        raise WorkerError("POLICY_CHANGED")
    return {"lease": lease, "approval": approval}


def _fingerprint(value):
    if not isinstance(value, str) or re.fullmatch(r"[0-9a-f]{64}", value) is None:
        raise WorkerError("INVALID_CONTRACT")
    return value


def _ticket(raw, job):
    value = exact(raw, (
        "deletion_id", "deletion_token", "lease", "object", "policy_version",
        "inspection_hash", "approval_hash", "blocked", "immutable_path_fence",
    ))
    identifier(value["deletion_id"]); opaque(value["deletion_token"])
    checked_ref(value["object"]); _fingerprint(value["inspection_hash"])
    _fingerprint(value["approval_hash"])
    if value["blocked"] is not True or value["immutable_path_fence"] is not True:
        raise WorkerError("FENCE_REQUIRED")
    if value["lease"] != job["lease"] or value["object"] != job["lease"]["object"]:
        raise WorkerError("TICKET_MISMATCH")
    if value["policy_version"] != job["lease"]["policy_version"]:
        raise WorkerError("POLICY_CHANGED")
    if value["approval_hash"] != canonical_hash(job["approval"]):
        raise WorkerError("APPROVAL_MISMATCH")
    return deepcopy(value)


def _inspection(raw, job):
    value = exact(raw, (
        "object", "policy_version", "approval", "state", "orphaned_at",
        "references", *_COUNTS, "ticket",
    ))
    checked_ref(value["object"])
    if value["object"] != job["lease"]["object"]:
        raise WorkerError("OBJECT_CHANGED")
    if value["policy_version"] != job["lease"]["policy_version"]:
        raise WorkerError("POLICY_CHANGED")
    if _approval(value["approval"]) != job["approval"]:
        raise WorkerError("APPROVAL_MISMATCH")
    if value["state"] not in ("candidate", "blocked", "purged"):
        raise WorkerError("INVALID_CONTRACT")
    instant(value["orphaned_at"])
    refs = exact(value["references"], _REFERENCES)
    for count in (*refs.values(), *(value[key] for key in _COUNTS)):
        _count(count)
    if value["state"] == "candidate":
        if value["ticket"] is not None:
            raise WorkerError("TICKET_MISMATCH")
    else:
        ticket = _ticket(value["ticket"], job)
        basis = deepcopy(value)
        basis["state"], basis["ticket"] = "candidate", None
        if canonical_hash(basis) != ticket["inspection_hash"]:
            raise WorkerError("INSPECTION_CHANGED")
    return deepcopy(value)


def _ineligible(snapshot, now):
    if any(snapshot["references"].values()):
        return "REFERENCED"
    if snapshot["holds"]:
        return "HELD"
    if snapshot["active_uploads"] or snapshot["active_verifiers"]:
        return "ACTIVE_WORK"
    if snapshot["recoverable_requests"]:
        return "RECOVERABLE_REQUEST"
    current = utc_now(now)
    approval = snapshot["approval"]
    if current < instant(approval["eligible_after"]):
        return "NOT_YET_ELIGIBLE"
    # 기본 보존기간을 가정하지 않고 실제 고아 상태 시점부터 승인된 기간을 센다.
    if (current - instant(snapshot["orphaned_at"])).total_seconds() < approval["retention_seconds"]:
        return "RETENTION_NOT_MET"
    return None


def _head(raw, reference):
    value = exact(raw, ("exists", "object"))
    if type(value["exists"]) is not bool:
        raise WorkerError("INVALID_CONTRACT")
    if value["exists"]:
        if checked_ref(value["object"]) != reference:
            raise WorkerError("OBJECT_CHANGED")
    elif value["object"] is not None:
        raise WorkerError("INVALID_CONTRACT")
    return value["exists"]


def _result(status, code, ticket=None):
    # 토큰·학교/파일 경로·포트 예외의 원문은 결과에 넣지 않는다.
    return {
        "status": status, "code": code,
        "deletion_id": ticket["deletion_id"] if ticket else None,
        "ticket_fingerprint": canonical_hash(ticket) if ticket else None,
    }


def run_cleanup(job, ledger, storage, *, now, cancel=lambda: False, dry_run=True):
    """기본값은 inspect만 호출한다. 실제 어댑터 없이 주입한 포트로만 실행한다.

    포트: inspect(job)→snapshot, reserve(job,inspection_hash)→ticket,
    recheck(ticket)→snapshot, finalize(ticket,evidence_hash)→일치하는 purged 접수증.
    storage.head(ref)→{exists,object}, storage.remove(ref,ticket)→임의 응답.
    remove 응답을 삭제 증거로 사용하지 않고 head로 부재를 확인한다. head는
    권한 실패를 부재로 바꾸면 안 된다. 응답 유실 뒤에도 영구 차단을 유지한다.
    만료 후 새 lease로 재인수하는 계약은 아직 미구현이다. SQL 어댑터의 명시적인
    재인수 전에는 새 lease를 기존 티켓에 자동으로 끼워 넣거나 차단을 해제하지 않는다.
    """
    ticket = None
    mutation_started = False
    physical_delete_started = False
    try:
        if type(dry_run) is not bool:
            raise WorkerError("INVALID_CONTRACT")
        job = _job(deepcopy(job), now)
        lease = job["lease"]
        check_guard(lease, now, cancel)
        snapshot = _inspection(ledger.inspect(deepcopy(job)), job)
        check_guard(lease, now, cancel)
        ticket = snapshot["ticket"]
        if snapshot["state"] == "purged":
            return _result("skipped", "ALREADY_PURGED", ticket)
        reason = _ineligible(snapshot, now)
        if reason:
            return _result("skipped", reason, ticket)
        if dry_run:
            return _result("preview", "ELIGIBLE", ticket)

        if ticket is None:
            check_guard(lease, now, cancel)
            inspection_hash = canonical_hash(snapshot)
            mutation_started = True
            ticket = _ticket(ledger.reserve(deepcopy(job), inspection_hash), job)
            if ticket["inspection_hash"] != inspection_hash:
                raise WorkerError("INSPECTION_CHANGED")
            check_guard(lease, now, cancel)

        def recheck():
            check_guard(lease, now, cancel)
            current = _inspection(ledger.recheck(deepcopy(ticket)), job)
            check_guard(lease, now, cancel)
            if current["state"] != "blocked" or current["ticket"] != ticket:
                raise WorkerError("TICKET_MISMATCH")
            if _ineligible(current, now):
                raise WorkerError("NOT_ELIGIBLE")

        recheck()
        reference = lease["object"]
        exists = _head(storage.head(deepcopy(reference)), reference)
        check_guard(lease, now, cancel)
        if exists:
            # 실물 확인 직후에도 다시 확인한다. 이후 경합은 영구 차단으로 막는다.
            recheck()
            physical_delete_started = True
            storage.remove(deepcopy(reference), deepcopy(ticket))
            check_guard(lease, now, cancel)
            if _head(storage.head(deepcopy(reference)), reference):
                return _result("result_unknown", "DELETION_NOT_CONFIRMED", ticket)
            check_guard(lease, now, cancel)

        recheck()
        evidence_hash = canonical_hash({
            "object": reference, "observed": "absent", "deletion_id": ticket["deletion_id"],
            "ticket_fingerprint": canonical_hash(ticket),
        })
        check_guard(lease, now, cancel)
        mutation_started = True
        acknowledgement = ledger.finalize(deepcopy(ticket), evidence_hash)
        expected = {
            "status": "purged", "deletion_id": ticket["deletion_id"],
            "ticket_fingerprint": canonical_hash(ticket), "evidence_hash": evidence_hash,
        }
        if acknowledgement != expected:
            return _result("result_unknown", "FINALIZE_NOT_CONFIRMED", ticket)
        # 이미 원장이 확정한 일치 접수증은 응답 직후 취소·만료돼도 결과 불명이 아니다.
        return _result("deleted", "PURGED", ticket)
    except WorkerError as error:
        code = error.code if isinstance(error.code, str) and error.code in _SAFE_ERRORS else "PORT_ERROR"
        if physical_delete_started or mutation_started:
            return _result("result_unknown", code, ticket)
        return _result("skipped" if code in ("CANCELLED", "LEASE_EXPIRED") else "error", code, ticket)
    except Exception:
        return _result("result_unknown" if physical_delete_started or mutation_started else "error", "PORT_ERROR", ticket)
