"""확정 R1 RPC 계약을 사용하는 서버 전용 작업자. 기존 문서 검사 코어를 재사용한다."""
from copy import deepcopy
from datetime import datetime, timezone
import hashlib
import re
import time
from uuid import UUID

from .common import WorkerError, exact, identifier, instant, positive
from .inspection import MIMES
from .runtime import inspect_isolated

# 학교의 허용 정책이 아니라 검사 프로세스의 기술 상한이다.
DEFAULT_LIMITS = {"max_archive_entries": 4096, "max_entry_bytes": 32 * 1024**2,
                  "max_expanded_bytes": 128 * 1024**2, "max_compression_ratio": 100,
                  "max_xml_bytes": 16 * 1024**2}
MAX_BYTES = 100 * 1024**2
CHECKS = ("size", "sha256", "signature", "container", "encryption")
PREFIX = "workhub_file_worker_"
_UNKNOWN = frozenset(("TRANSPORT_TIMEOUT", "TRANSPORT_NETWORK", "TRANSPORT_BUSY",
                      "TRANSPORT_RESPONSE", "TRANSPORT_LIMIT", "TRANSPORT_HTTP"))
_POLICY_KEYS = ("uploadPolicyId", "commonPolicyId", "currentUploadPolicyId", "currentCommonPolicyId",
                "extensions", "maxFileBytes", "allowUnscanned")
_CLAIM_KEYS = ("jobId", "leaseToken", "leaseExpiresAt", "fileId", "bucket", "path", "storageObjectId",
               "extension", "claimedBytes", "claimedSha256", "maxFileBytes", "policy")
_JOB_KEYS = ("jobId", "fileId", "state", "outcome", "lastErrorCode", "leaseValid", "leaseExpiresAt",
             "fileState", "bucket", "path", "storageObjectId", "objectMatches", "policy")
_CLEAN_KEYS = ("ledgerId", "leaseToken", "fileId", "bucket", "path", "storageObjectId", "reason")
_CLEAN_INSPECT_KEYS = ("ledgerId", "fileId", "state", "outcome", "retainedReason", "leaseValid",
                       "leaseExpiresAt", "linked", "verifying", "bucket", "path", "storageObjectId",
                       "objectPresent", "objectMatches")


def _bool(value):
    if type(value) is not bool:
        raise WorkerError("INVALID_CONTRACT")
    return value


def _object(value, nullable=False):
    if value is None and nullable:
        return
    try:
        if not isinstance(value, str) or str(UUID(value)) != value:
            raise ValueError()
    except (ValueError, AttributeError):
        raise WorkerError("INVALID_CONTRACT") from None


def _policy(value):
    exact(value, _POLICY_KEYS)
    for key in _POLICY_KEYS[:4]:
        if key.startswith("current") and value[key] is None:
            continue
        identifier(value[key])
    extensions = value["extensions"]
    if (not isinstance(extensions, list) or any(not isinstance(e, str) or e not in MIMES for e in extensions)
            or len(extensions) != len(set(extensions))):
        raise WorkerError("INVALID_CONTRACT")
    positive(value["maxFileBytes"], MAX_BYTES)
    _bool(value["allowUnscanned"])
    return value


def _out(status, code, outcome=None):
    # 학교·파일·경로·임대 토큰·원문 오류를 운영 로그에 노출하지 않는다.
    result = {"status": status, "code": code}
    if outcome is not None:
        result["outcome"] = outcome
    return result


class R1Worker:
    def __init__(self, transport, school_id, worker_id, release, *, now=None,
                 monotonic=time.monotonic, inspector=inspect_isolated, scanner=None, limits=None):
        identifier(school_id)
        if not isinstance(worker_id, str) or not re.fullmatch(r"[A-Za-z0-9_.:-]{1,100}", worker_id):
            raise WorkerError("INVALID_CONFIG")
        if not isinstance(release, str) or not re.fullmatch(r"[A-Za-z0-9_.:+-]{1,50}", release):
            raise WorkerError("INVALID_CONFIG")
        self.transport, self.school_id, self.worker_id, self.release = transport, school_id, worker_id, release
        self.now = now or (lambda: datetime.now(timezone.utc))
        self.monotonic, self.inspector, self.scanner = monotonic, inspector, scanner
        self.limits = deepcopy(DEFAULT_LIMITS if limits is None else limits)
        exact(self.limits, DEFAULT_LIMITS)
        for key, value in self.limits.items():
            positive(value, DEFAULT_LIMITS[key])

    def _rpc(self, suffix, args):
        return self.transport.rpc(PREFIX + suffix, deepcopy(args))

    def _remaining(self, expires):
        current = self.now()
        if not isinstance(current, datetime) or current.tzinfo is None:
            raise WorkerError("INVALID_CLOCK")
        remaining = (instant(expires) - current).total_seconds()
        if remaining <= 2:
            raise WorkerError("LEASE_EXPIRED")
        return remaining - 1

    def _reference(self, value, nullable=False):
        identifier(value["fileId"])
        if (value["bucket"] != "workhub-collection-files" or not isinstance(value["path"], str)
                or re.fullmatch(re.escape(self.school_id + "/" + value["fileId"] + "/")
                                + r"[A-Za-z0-9_-]{16,100}", value["path"]) is None):
            raise WorkerError("INVALID_CONTRACT")
        _object(value["storageObjectId"], nullable)

    def _job(self, job):
        exact(job, _CLAIM_KEYS)
        identifier(job["jobId"])
        positive(job["leaseToken"], 2**63 - 1)
        self._reference(job)
        self._remaining(job["leaseExpiresAt"])
        if job["extension"] not in MIMES:
            raise WorkerError("INVALID_CONTRACT")
        positive(job["claimedBytes"], MAX_BYTES)
        if not isinstance(job["claimedSha256"], str) or not re.fullmatch("[0-9a-f]{64}", job["claimedSha256"]):
            raise WorkerError("INVALID_CONTRACT")
        _policy(job["policy"])
        if job["maxFileBytes"] != job["policy"]["maxFileBytes"]:
            raise WorkerError("INVALID_CONTRACT")

    def _inspect_job(self, job):
        result = self._rpc("job_inspect", {"p_job_id": job["jobId"], "p_lease_token": job["leaseToken"]})
        exact(result, _JOB_KEYS)
        for key in ("jobId", "fileId", "bucket", "path", "storageObjectId"):
            if result[key] != job[key]:
                raise WorkerError("OBJECT_CHANGED")
        _bool(result["leaseValid"]); _bool(result["objectMatches"])
        if (not result["leaseValid"] or result["state"] != "leased" or result["fileState"] != "verifying"
                or result["outcome"] is not None):
            raise WorkerError("LEASE_EXPIRED")
        if not result["objectMatches"]:
            raise WorkerError("OBJECT_CHANGED")
        self._remaining(result["leaseExpiresAt"])
        return _policy(result["policy"])

    def _retry_sealed(self, suffix, args, validate):
        # 응답을 잃으면 같은 인자만 한 번 재전송한다. 새 결과·토큰을 만들어 덮어쓰지 않는다.
        for attempt in range(2):
            try:
                receipt = self._rpc(suffix, args)
                validate(receipt)
                return True
            except WorkerError as error:
                if error.code not in _UNKNOWN | {"INVALID_RECEIPT"}:
                    raise
                if attempt:
                    return False
        return False

    def _seal(self, job, result):
        args = {"p_job_id": job["jobId"], "p_lease_token": job["leaseToken"], "p_file_id": job["fileId"],
                "p_path": job["path"], "p_storage_object_id": job["storageObjectId"], "p_result": result}
        def validate(receipt):
            if (not isinstance(receipt, dict) or set(receipt) != {"fileId", "state", "replayed"}
                    or receipt["fileId"] != job["fileId"] or receipt["state"] != result["outcome"]
                    or type(receipt["replayed"]) is not bool):
                raise WorkerError("INVALID_RECEIPT")
        recorded = self._retry_sealed("seal", args, validate)
        return _out("recorded" if recorded else "unknown", "SEALED" if recorded else "SEAL_UNKNOWN", result["outcome"])

    def _fail(self, job, reason):
        try:
            result = self._rpc("fail", {"p_job_id": job["jobId"], "p_lease_token": job["leaseToken"],
                                       "p_error_code": reason, "p_retry_after_seconds": 60})
            exact(result, ("fileId", "state", "final"))
            _bool(result["final"])
            if result["fileId"] != job["fileId"] or result["state"] != ("rejected" if result["final"] else "uploaded"):
                raise WorkerError("INVALID_CONTRACT")
            return _out("rejected" if result["final"] else "retry", "ATTEMPTS_EXHAUSTED" if result["final"] else "RETRY_QUEUED")
        except WorkerError:
            # fail도 접수 여부를 모르면 다른 결과로 재봉인하지 않는다. 만료 후 서버가 재인수한다.
            return _out("unknown", "RETRY_UNKNOWN")

    def verify(self, raw_job):
        job, sealing = deepcopy(raw_job), False
        try:
            self._job(job)
        except (WorkerError, TypeError, KeyError):
            return _out("error", "INVALID_JOB")
        try:
            policy = self._inspect_job(job)
            if job["extension"] not in policy["extensions"] or job["claimedBytes"] > policy["maxFileBytes"]:
                return self._fail(job, "policy_changed")
            if self.scanner is None and not policy["allowUnscanned"]:
                return self._fail(job, "scanner_required")
            deadline = self.monotonic() + min(60, self._remaining(job["leaseExpiresAt"]))
            data = self.transport.download(job["bucket"], job["path"], max_bytes=policy["maxFileBytes"], deadline=deadline)
            if not isinstance(data, bytes) or len(data) > policy["maxFileBytes"]:
                raise WorkerError("SIZE_LIMIT")
            self._remaining(job["leaseExpiresAt"])
            digest = hashlib.sha256(data).hexdigest()
            checks = {"size": len(data) == job["claimedBytes"], "sha256": digest == job["claimedSha256"]}
            outcome, reason, mime, scan = "rejected", None, "application/octet-stream", "not_scanned"
            if not checks["size"]:
                reason = "size_mismatch"
            elif not checks["sha256"]:
                reason = "hash_mismatch"
            else:
                formatted = self.inspector(data, job["extension"], deepcopy(self.limits),
                                           timeout_seconds=min(30, self._remaining(job["leaseExpiresAt"])))
                exact(formatted, ("status", "code", "mime"))
                if formatted["status"] == "error":
                    return self._fail(job, "inspection_error")
                if formatted["status"] not in ("passed", "rejected", "unsupported"):
                    raise WorkerError("INVALID_CONTRACT")
                if formatted["status"] != "passed":
                    # 미지원은 악성으로 단정하지 않는다. 유한한 확정 거절로 재시도 소모를 막는다.
                    reason = "unsupported" if formatted["status"] == "unsupported" else (
                        formatted["code"] if isinstance(formatted["code"], str)
                        and re.fullmatch(r"[a-z_]{2,40}", formatted["code"]) else "format_invalid")
                else:
                    if formatted["mime"] != MIMES[job["extension"]]:
                        raise WorkerError("INVALID_CONTRACT")
                    mime = formatted["mime"]
                    checks.update({name: True for name in CHECKS[2:]})
                    if self.scanner is not None:
                        scan = self.scanner.scan(data, deadline=job["leaseExpiresAt"])
                        if scan not in ("clean", "rejected"):
                            raise WorkerError("SCANNER_ERROR")
                        checks["malware"] = scan == "clean"
                    if scan == "rejected":
                        outcome, reason = "quarantined", "malware_detected"
                    else:
                        outcome = "ready"
            latest = self._inspect_job(job)
            # 검사 도중 더 엄격해진 승인 정책을 무시하지 않는다. SQL 첨부 단계도 정책을 검사한다.
            if outcome == "ready" and (job["extension"] not in latest["extensions"] or len(data) > latest["maxFileBytes"]
                    or (scan != "clean" and not latest["allowUnscanned"])):
                return self._fail(job, "policy_changed")
            result = {"outcome": outcome, "sizeBytes": len(data), "sha256": digest, "detectedMime": mime,
                      "expandedBytes": None, "scanState": scan, "rejectReason": reason, "checks": checks}
            sealing = True
            return self._seal(job, result)
        except WorkerError as error:
            if sealing:
                return _out("error", "SEAL_REFUSED")
            if error.code in ("LEASE_EXPIRED", "OBJECT_CHANGED", "RPC_FORBIDDEN", "RPC_NOT_FOUND", "RPC_CONFLICT", "RPC_NOT_READY"):
                return _out("stopped", "LEASE_OR_OBJECT_CHANGED")
            return self._fail(job, "size_limit" if error.code == "SIZE_LIMIT" else "worker_unavailable")
        except Exception:
            # 알 수 없는 전송/스캐너 오류 원문이나 학교 자료를 노출하지 않는다.
            return _out("unknown", "SEAL_UNKNOWN") if sealing else self._fail(job, "worker_unavailable")

    def _inspect_cleanup(self, job):
        value = self._rpc("cleanup_inspect", {"p_ledger_id": job["ledgerId"], "p_lease_token": job["leaseToken"]})
        exact(value, _CLEAN_INSPECT_KEYS)
        for key in ("ledgerId", "fileId", "bucket", "path", "storageObjectId"):
            if value[key] != job[key]:
                raise WorkerError("OBJECT_CHANGED")
        for key in ("leaseValid", "linked", "verifying", "objectPresent", "objectMatches"):
            _bool(value[key])
        if not value["leaseValid"] or value["state"] != "blocked" or value["outcome"] is not None:
            raise WorkerError("LEASE_EXPIRED")
        self._remaining(value["leaseExpiresAt"])
        if value["linked"] or value["verifying"]:
            raise WorkerError("NOT_ELIGIBLE")
        if value["objectMatches"] and (not value["objectPresent"] or job["storageObjectId"] is None):
            raise WorkerError("INVALID_CONTRACT")
        return value

    def cleanup(self, raw_job):
        job, mutating = deepcopy(raw_job), False
        try:
            exact(job, _CLEAN_KEYS)
            identifier(job["ledgerId"]); positive(job["leaseToken"], 2**63 - 1)
            self._reference(job, nullable=True)
            if job["reason"] not in ("upload_expired", "rejected_file", "unattached_retention"):
                raise WorkerError("INVALID_CONTRACT")
            current = self._inspect_cleanup(job)
            outcome, reason = "deleted", None
            if current["objectPresent"]:
                if not current["objectMatches"]:
                    outcome, reason = "retained", "object_changed"
                else:
                    # 삭제 직전 다시 확인. 이후 정상 업로드/complete는 SQL의 영구 원장 차단이 막는다.
                    current = self._inspect_cleanup(job)
                    if current["objectPresent"] and not current["objectMatches"]:
                        raise WorkerError("OBJECT_CHANGED")
                    if current["objectPresent"]:
                        mutating = True
                        self.transport.remove(job["bucket"], job["path"],
                                              deadline=self.monotonic() + self._remaining(current["leaseExpiresAt"]))
            current = self._inspect_cleanup(job)
            if outcome == "deleted" and current["objectPresent"]:
                return _out("unknown", "DELETE_NOT_CONFIRMED")
            args = {"p_ledger_id": job["ledgerId"], "p_lease_token": job["leaseToken"],
                    "p_outcome": outcome, "p_reason": reason}
            def validate(receipt):
                if (not isinstance(receipt, dict) or set(receipt) != {"fileId", "ledgerId", "outcome", "replayed"}
                        or receipt["fileId"] != job["fileId"] or receipt["ledgerId"] != job["ledgerId"]
                        or receipt["outcome"] != outcome or type(receipt["replayed"]) is not bool):
                    raise WorkerError("INVALID_RECEIPT")
            mutating = True
            recorded = self._retry_sealed("cleanup_done", args, validate)
            return _out("recorded" if recorded else "unknown", "CLEANUP_RECORDED" if recorded else "CLEANUP_UNKNOWN", outcome)
        except Exception:
            # 삭제 응답 유실 때 remove를 맹목적으로 반복하지 않는다. 다음 임대에서 inspect부터 재개.
            return _out("unknown" if mutating else "stopped", "CLEANUP_NOT_CONFIRMED")

    def heartbeat(self, checks):
        if set(checks) not in (set(CHECKS), set(CHECKS) | {"malware"}):
            raise WorkerError("INVALID_CAPABILITY")
        if ("malware" in checks) != (self.scanner is not None):
            raise WorkerError("INVALID_CAPABILITY")
        if self.scanner is not None:
            self.scanner.healthcheck()
        receipt = self._rpc("heartbeat", {"p_school_id": self.school_id, "p_worker_id": self.worker_id,
                            "p_capability": {"checks": list(checks), "release": self.release}, "p_ttl_seconds": 120})
        exact(receipt, ("servicePrincipalId", "expiresAt"))
        identifier(receipt["servicePrincipalId"]); self._remaining(receipt["expiresAt"])

    def run_once(self, *, execute=False, cleanup=False, max_jobs=1, checks=None):
        if type(execute) is not bool or type(cleanup) is not bool:
            raise WorkerError("INVALID_CONFIG")
        positive(max_jobs, 20)
        result = {"mode": "execute" if execute else "dry_run", "verification": [], "cleanup": []}
        if not execute:
            # cleanup_claim은 이미 영구 차단을 만든다. dry run에서는 heartbeat/claim도 보내지 않는다.
            return result
        if not cleanup:
            self.heartbeat(checks or list(CHECKS))
        for _ in range(max_jobs):
            suffix = "cleanup_claim" if cleanup else "claim"
            jobs = self._rpc(suffix, {"p_school_id": self.school_id, "p_worker_id": self.worker_id, "p_limit": 1})
            if not isinstance(jobs, list) or len(jobs) > 1:
                raise WorkerError("INVALID_CONTRACT")
            if not jobs:
                break
            outcome = self.cleanup(jobs[0]) if cleanup else self.verify(jobs[0])
            result["cleanup" if cleanup else "verification"].append(outcome)
            if outcome["status"] != "recorded":
                break
            # 한꺼번에 20개를 임대해 뒤쪽 파일의 검사 전에 만료시키지 않는다.
            if not cleanup:
                self.heartbeat(checks or list(CHECKS))
        return result
