"""실물 검사 오케스트레이션. 공급자 연결·서비스 자격·준비 상태 활성화는 포함하지 않는다."""
from copy import deepcopy
from dataclasses import dataclass, field
import hashlib
import math
import re
from weakref import WeakKeyDictionary

from .common import (WorkerError, canonical_hash, check_guard, checked_lease, checked_ref,
                     exact, identifier, instant, opaque, positive, utc_now)
from .inspection import inspect_document


EXTENSIONS = {"pdf", "hwp", "hwpx", "docx", "xlsx", "pptx"}
MIMES = {
    "pdf": {"application/pdf"},
    "hwp": {"application/x-hwp", "application/x-hwp-v5", "application/haansofthwp", "application/vnd.hancom.hwp"},
    "hwpx": {"application/hwp+zip", "application/haansofthwpx", "application/vnd.hancom.hwpx", "application/zip"},
    "docx": {"application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/zip"},
    "xlsx": {"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "application/zip"},
    "pptx": {"application/vnd.openxmlformats-officedocument.presentationml.presentation", "application/zip"},
}


@dataclass(frozen=True, eq=False)
class CommitAttempt:
    # 미확정 접수 재전송용 내부 메모리다. repr/log/사용자 응답에 lease와 경로를 넣지 않는다.
    _lease: dict = field(repr=False)
    _evidence: dict = field(repr=False)
    request_key: str
    evidence_hash: str


@dataclass(frozen=True)
class VerificationOutcome:
    status: str
    code: str
    decision: str | None = None
    evidence_hash: str | None = None
    pending: CommitAttempt | None = field(default=None, repr=False)


_issued_attempts = WeakKeyDictionary()
_error_codes = frozenset(("INVALID_CONTRACT", "INVALID_CLOCK", "INVALID_OBJECT", "LEASE_EXPIRED", "CANCELLED", "INVALID_POLICY", "POLICY_MISMATCH", "STALE_JOB", "OBJECT_CHANGED", "INVALID_STREAM", "SIZE_LIMIT", "EMPTY_FILE", "POLICY_DENIED", "INVALID_ATTEMPT"))


def _safe_error(error):
    code = error.code if isinstance(error.code, str) and error.code in _error_codes else "WORKER_ERROR"
    return VerificationOutcome("cancelled" if code == "CANCELLED" else "error", code)


def checked_job(raw, now):
    job = exact(raw, ("lease", "file"))
    lease = checked_lease(job["lease"], now)
    meta = exact(job["file"], ("name", "extension", "claimed_bytes", "claimed_sha256", "declared_mime"))
    extension, name = meta["extension"], meta["name"]
    if not isinstance(extension, str) or extension not in EXTENSIONS or not isinstance(name, str):
        raise WorkerError("INVALID_CONTRACT")
    if (name != name.strip() or not name.lower().endswith("." + extension) or
        not name[:-(len(extension) + 1)].replace(".", "").strip() or
        re.search(r'[\x00-\x1f\x7f<>:"/\\|?*\u202a-\u202e\u2066-\u2069]', name) or
        re.match(r"(?i)^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)", name)):
        raise WorkerError("INVALID_CONTRACT")
    try:
        if len(name.encode("utf-8")) > 240:
            raise WorkerError("INVALID_CONTRACT")
    except UnicodeError:
        raise WorkerError("INVALID_CONTRACT") from None
    positive(meta["claimed_bytes"], 100 * 1024 * 1024)
    if not isinstance(meta["claimed_sha256"], str) or re.fullmatch(r"[a-f0-9]{64}", meta["claimed_sha256"]) is None:
        raise WorkerError("INVALID_CONTRACT")
    if not isinstance(meta["declared_mime"], str) or len(meta["declared_mime"]) > 200:
        raise WorkerError("INVALID_CONTRACT")
    return {"lease": lease, "file": deepcopy(meta)}


def checked_policy(raw, lease):
    policy = exact(raw, ("school_id", "purpose", "version", "approval_ref", "extensions", "max_file_bytes", "limits"))
    if policy["school_id"] != lease["object"]["school_id"] or policy["purpose"] != "collection_upload" or policy["version"] != lease["policy_version"]:
        raise WorkerError("POLICY_MISMATCH")
    identifier(policy["version"])
    if not isinstance(policy["approval_ref"], str) or not policy["approval_ref"].strip() or len(policy["approval_ref"]) > 200:
        raise WorkerError("INVALID_POLICY")
    extensions = policy["extensions"]
    if not isinstance(extensions, list) or not extensions or any(not isinstance(value, str) or value not in EXTENSIONS for value in extensions) or len(set(extensions)) != len(extensions):
        raise WorkerError("INVALID_POLICY")
    positive(policy["max_file_bytes"], 100 * 1024 * 1024)
    limits = exact(policy["limits"], ("max_archive_entries", "max_entry_bytes", "max_expanded_bytes", "max_compression_ratio", "max_xml_bytes"))
    for key in ("max_archive_entries", "max_entry_bytes", "max_expanded_bytes", "max_xml_bytes"):
        positive(limits[key], 1024 * 1024 * 1024)
    ratio = limits["max_compression_ratio"]
    if type(ratio) not in (int, float) or not math.isfinite(ratio) or ratio < 1:
        raise WorkerError("INVALID_POLICY")
    return deepcopy(policy)


def _snapshot(ledger, job, policy, now, cancel):
    check_guard(job["lease"], now, cancel)
    snapshot = exact(ledger.inspect(deepcopy(job)), ("job", "policy"))
    check_guard(job["lease"], now, cancel)
    current = checked_job(snapshot["job"], now)
    current_policy = checked_policy(snapshot["policy"], current["lease"])
    if current != job or canonical_hash(current_policy) != canonical_hash(policy):
        raise WorkerError("STALE_JOB")


def _stat(storage, lease, now, cancel):
    check_guard(lease, now, cancel)
    state = exact(storage.stat(deepcopy(lease["object"])), ("object", "bytes", "mime"))
    check_guard(lease, now, cancel)
    if checked_ref(state["object"]) != lease["object"]:
        raise WorkerError("OBJECT_CHANGED")
    positive(state["bytes"], 100 * 1024 * 1024)
    if not isinstance(state["mime"], str) or len(state["mime"]) > 200:
        raise WorkerError("INVALID_CONTRACT")
    return deepcopy(state)


def _read(storage, lease, maximum, now, cancel):
    # Storage 어댑터도 timeout과 서버 응답 크기 상한을 별도로 강제해야 한다.
    stream = storage.read(deepcopy(lease["object"]), max_bytes=maximum, deadline=lease["expires_at"])
    data = bytearray()
    try:
        for chunk in stream:
            check_guard(lease, now, cancel)
            if not isinstance(chunk, bytes) or not chunk:
                raise WorkerError("INVALID_STREAM")
            if len(data) + len(chunk) > maximum:
                raise WorkerError("SIZE_LIMIT")
            data.extend(chunk)
        check_guard(lease, now, cancel)
        if not data:
            raise WorkerError("EMPTY_FILE")
        return bytes(data)
    finally:
        close = getattr(stream, "close", None)
        if close:
            try:
                close()
            except Exception:
                pass  # 정리 실패 원문은 결과나 로그로 전달하지 않는다.


def _format(data, extension, limits):
    try:
        result = exact(inspect_document(data, extension, limits), ("status", "code", "mime"))
        if result["status"] not in ("passed", "rejected", "unsupported", "error") or not isinstance(result["code"], str) or not re.fullmatch(r"[a-z0-9_]{1,80}", result["code"]):
            raise WorkerError("INVALID_FORMAT_RESULT")
        if result["mime"] is not None and result["mime"] not in MIMES[extension]:
            raise WorkerError("INVALID_FORMAT_RESULT")
        if result["status"] == "passed" and result["mime"] is None:
            raise WorkerError("INVALID_FORMAT_RESULT")
        return deepcopy(result)
    except Exception:
        return {"status": "error", "code": "inspection_error", "mime": None}


def _scan(scanner, data, lease, digest, started_at, now, cancel):
    empty = {"status": "not_scanned", "code": "scanner_unavailable", "engine": None, "engine_version": None, "signature_version": None, "scan_id": None, "scanned_at": None}
    if scanner is None:
        return empty
    try:
        check_guard(lease, now, cancel)
        result = exact(scanner.scan(data, sha256=digest, object_ref=deepcopy(lease["object"]), run_id=lease["run_id"], deadline=lease["expires_at"]), ("status", "sha256", "object_identity", "run_id", "engine", "engine_version", "signature_version", "scan_id", "scanned_at"))
        check_guard(lease, now, cancel)
        if (result["status"] not in ("pending", "clean", "rejected", "error", "not_scanned") or
            result["sha256"] != digest or result["object_identity"] != lease["object"]["identity"] or result["run_id"] != lease["run_id"] or
            not started_at <= instant(result["scanned_at"]) <= utc_now(now)):
            raise WorkerError("INVALID_SCAN_RESULT")
        for key in ("engine", "engine_version", "signature_version", "scan_id"):
            opaque(result[key])
        return {"status": result["status"], "code": "scanner_" + result["status"], **{key: result[key] for key in empty if key not in ("status", "code")}}
    except Exception:
        check_guard(lease, now, cancel)
        return {**empty, "status": "error", "code": "scanner_error"}


def commit_verification(attempt, ledger, *, now, cancel=lambda: False):
    """응답 유실은 같은 lease·본문·키로만 재확인한다. 재검사 결과로 덮어쓰지 않는다."""
    if not isinstance(attempt, CommitAttempt) or attempt not in _issued_attempts:
        return VerificationOutcome("error", "INVALID_ATTEMPT")
    try:
        lease = checked_lease(attempt._lease, now)
        check_guard(lease, now, cancel)
        evidence = deepcopy(attempt._evidence)
        issued = _issued_attempts[attempt]
        if (canonical_hash(evidence) != attempt.evidence_hash or attempt.request_key != "verify_" + lease["run_id"] or
            issued[:3] != (canonical_hash(lease), attempt.evidence_hash, attempt.request_key) or issued[3] is not ledger):
            raise WorkerError("INVALID_ATTEMPT")
    except WorkerError as error:
        return _safe_error(error)
    try:
        # 이 포트는 DB의 원자 검사·봉인이다. 기존 검증 결과와 현재 lease/정책/실물 정체성을 재검사해야 한다.
        receipt = ledger.commit_result(deepcopy(lease), evidence, attempt.request_key, attempt.evidence_hash)
        exact(receipt, ("request_key", "evidence_hash", "decision", "status"))
        if receipt["request_key"] != attempt.request_key or receipt["evidence_hash"] != attempt.evidence_hash or receipt["decision"] != evidence["decision"] or receipt["status"] not in ("recorded", "already_recorded"):
            raise WorkerError("INVALID_RECEIPT")
        # 확인한 접수는 응답 시각에 lease가 끝났다고 미확정으로 되돌리지 않는다.
        return VerificationOutcome("recorded", "RECORDED", evidence["decision"], attempt.evidence_hash)
    except Exception:
        return VerificationOutcome("result_unknown", "COMMIT_UNKNOWN", evidence["decision"], attempt.evidence_hash, attempt)


def run_verification(job, policy, ledger, storage, *, now, scanner=None, cancel=lambda: False):
    """주입한 신뢰 포트만 호출한다. 기본 scanner 없음은 clean/ready가 될 수 없다."""
    try:
        job = checked_job(job, now); lease = job["lease"]; meta = job["file"]
        policy = checked_policy(policy, lease)
        check_guard(lease, now, cancel)
        _snapshot(ledger, job, policy, now, cancel)
        if meta["extension"] not in policy["extensions"]:
            raise WorkerError("POLICY_DENIED")
        before = _stat(storage, lease, now, cancel)
        if before["bytes"] > policy["max_file_bytes"]:
            raise WorkerError("SIZE_LIMIT")
        started_at = utc_now(now)
        data = _read(storage, lease, policy["max_file_bytes"], now, cancel)
        digest = hashlib.sha256(data).hexdigest()
        check_guard(lease, now, cancel)
        after = _stat(storage, lease, now, cancel)
        if before != after or len(data) != before["bytes"]:
            raise WorkerError("OBJECT_CHANGED")
        if len(data) != meta["claimed_bytes"] or digest != meta["claimed_sha256"]:
            formatted = {"status": "rejected", "code": "claimed_content_mismatch", "mime": None}
        elif any(mime.lower() not in MIMES[meta["extension"]] | {"", "application/octet-stream"} for mime in (before["mime"], meta["declared_mime"])):
            formatted = {"status": "rejected", "code": "mime_mismatch", "mime": None}
        else:
            formatted = _format(data, meta["extension"], policy["limits"])
        check_guard(lease, now, cancel)
        scan = _scan(scanner if formatted["status"] == "passed" else None, data, lease, digest, started_at, now, cancel)
        if formatted["status"] != "passed":
            scan["code"] = "format_not_passed"
        decision = "rejected" if formatted["status"] == "rejected" or scan["status"] == "rejected" else "ready" if formatted["status"] == "passed" and scan["status"] == "clean" else "pending"
        check_guard(lease, now, cancel)
        if _stat(storage, lease, now, cancel) != before:
            raise WorkerError("OBJECT_CHANGED")
        _snapshot(ledger, job, policy, now, cancel)
        evidence = {"contract_version": 1, "job_id": lease["job_id"], "run_id": lease["run_id"], "object": lease["object"], "policy_version": policy["version"], "policy_hash": canonical_hash(policy), "actual_bytes": len(data), "actual_sha256": digest, "format": formatted, "scan": scan, "decision": decision, "checked_at": utc_now(now).isoformat()}
        attempt = CommitAttempt(deepcopy(lease), evidence, "verify_" + lease["run_id"], canonical_hash(evidence))
        _issued_attempts[attempt] = (canonical_hash(lease), attempt.evidence_hash, attempt.request_key, ledger)
        return commit_verification(attempt, ledger, now=now, cancel=cancel)
    except WorkerError as error:
        return _safe_error(error)
    except Exception:
        return VerificationOutcome("error", "WORKER_ERROR")
