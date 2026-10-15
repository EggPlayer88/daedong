"""실제 바이트와 합성 포트로 검사 결과·봉인·응답 유실을 검증한다. 네트워크는 사용하지 않는다."""
from copy import deepcopy
from datetime import datetime, timedelta, timezone
import hashlib
from io import BytesIO
from pathlib import Path
import sys
import zipfile
from pypdf import PdfWriter
from helpers.hwp_fixture import make_hwp

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from workers.collection_files.common import WorkerError, checked_ref, canonical_hash
from workers.collection_files.verification import run_verification, commit_verification, CommitAttempt


def document():
    output = BytesIO()
    with zipfile.ZipFile(output, "w", zipfile.ZIP_STORED) as archive:
        archive.writestr("[Content_Types].xml", '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>')
        archive.writestr("_rels/.rels", '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>')
        archive.writestr("word/document.xml", '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p/></w:body></w:document>')
    return output.getvalue()


class Fixture:
    def __init__(self):
        self.time = datetime(2026, 10, 15, 8, tzinfo=timezone.utc)
        self.body = document()
        self.ref = {"school_id": "school", "file_id": "file", "bucket": "workhub-collection-files", "path": "school/file/opaque-file-key-0001", "identity": "object-id-v1"}
        lease = {"job_id": "job", "run_id": "run", "lease_token": "private-lease-token", "expires_at": "2026-10-15T08:10:00Z", "object": self.ref, "policy_version": "policy-1"}
        self.job = {"lease": deepcopy(lease), "file": {"name": "응답.docx", "extension": "docx", "claimed_bytes": len(self.body), "claimed_sha256": hashlib.sha256(self.body).hexdigest(), "declared_mime": "application/vnd.openxmlformats-officedocument.wordprocessingml.document"}}
        self.policy = {"school_id": "school", "purpose": "collection_upload", "version": "policy-1", "approval_ref": "합성 시험 승인", "extensions": ["docx"], "max_file_bytes": 100000, "limits": {"max_archive_entries": 20, "max_entry_bytes": 100000, "max_expanded_bytes": 100000, "max_compression_ratio": 100, "max_xml_bytes": 100000}}
        self.current_job, self.current_policy = deepcopy(self.job), deepcopy(self.policy)
        self.commits, self.receipts, self.scans = [], {}, []
        self.reads, self.stats = 0, 0
        self.cancelled = False
        self.scan_state = "clean"
        self.scan_hook = lambda result: result
        self.inspect_hook = lambda result: result
        self.stat_hook = lambda result: result
        self.ack_hook = lambda result: result
        self.read_hook = lambda: None

    def now(self):
        return self.time

    def inspect(self, job):
        return self.inspect_hook({"job": deepcopy(self.current_job), "policy": deepcopy(self.current_policy)})

    def stat(self, ref):
        self.stats += 1
        assert ref == self.ref
        return self.stat_hook({"object": deepcopy(self.ref), "bytes": len(self.body), "mime": self.job["file"]["declared_mime"]})

    def read(self, ref, **options):
        assert ref == self.ref and options["max_bytes"] == self.policy["max_file_bytes"]
        self.reads += 1
        yield self.body[:100]
        self.read_hook()
        yield self.body[100:]

    def scan(self, data, **options):
        self.scans.append(options)
        assert data == self.body
        return self.scan_hook({"status": self.scan_state, "sha256": hashlib.sha256(data).hexdigest(), "object_identity": self.ref["identity"], "run_id": self.job["lease"]["run_id"], "engine": "synthetic-scanner", "engine_version": "1", "signature_version": "test-signatures", "scan_id": "scan-1", "scanned_at": self.time.isoformat()})

    def commit_result(self, lease, evidence, key, digest):
        self.commits.append(deepcopy({"lease": lease, "evidence": evidence, "key": key, "digest": digest}))
        assert lease == self.job["lease"] and digest == canonical_hash(evidence)
        if key in self.receipts:
            assert self.receipts[key]["evidence_hash"] == digest
        else:
            self.receipts[key] = {"request_key": key, "evidence_hash": digest, "decision": evidence["decision"], "status": "recorded"}
        return self.ack_hook(deepcopy(self.receipts[key]))

    def run(self, scanner=True, job=None, policy=None):
        return run_verification(self.job if job is None else job, self.policy if policy is None else policy, self, self, now=self.now, scanner=self if scanner else None, cancel=lambda: self.cancelled)


passed, failed = 0, 0
def test(name, run):
    global passed, failed
    try:
        run(); passed += 1; print("  ✓ " + name)
    except Exception as error:
        failed += 1; print("  ✗ " + name + ": " + repr(error))
        import traceback
        traceback.print_exc()


def ready():
    f = Fixture(); result = f.run()
    assert result.status == "recorded" and result.decision == "ready", result
    evidence = f.commits[0]["evidence"]
    assert evidence["actual_sha256"] == hashlib.sha256(f.body).hexdigest()
    assert evidence["format"]["status"] == "passed" and evidence["scan"]["status"] == "clean"
    assert f.stats == 3 and len(f.scans) == 1
test("형식 검사와 실제 바이트에 결합한 악성 검사 모두 통과해야 ready를 기록한다", ready)

def without_scanner():
    f = Fixture(); result = f.run(scanner=False)
    assert result.status == "recorded" and result.decision == "pending"
    assert f.commits[0]["evidence"]["scan"]["status"] == "not_scanned"
test("스캐너가 없으면 정상 컨테이너여도 미검사·pending을 보존한다", without_scanner)

for state in ("pending", "error", "not_scanned", "rejected"):
    def scenario(state=state):
        f = Fixture(); f.scan_state = state; result = f.run()
        assert result.decision == ("rejected" if state == "rejected" else "pending")
        assert f.commits[0]["evidence"]["scan"]["status"] == state
    test("악성 검사 상태 " + state + "를 clean으로 바꾸지 않는다", scenario)

for key, value in (("sha256", "a" * 64), ("object_identity", "other-object"), ("run_id", "other-run"), ("signature_version", ""), ("scanned_at", "2026-10-15T07:00:00Z"), ("scanned_at", "2026-10-15T09:00:00Z")):
    def scenario(key=key, value=value):
        f = Fixture(); f.scan_hook = lambda item: {**item, key: value}; result = f.run()
        assert result.decision == "pending" and f.commits[0]["evidence"]["scan"]["status"] == "error"
    test("다른 파일·검사 실행·시각 등 잘못된 scanner " + key + " 증거를 거부한다", scenario)

def scan_error():
    f = Fixture()
    def reject(_):
        raise RuntimeError("secret-key-and-private-path")
    f.scan_hook = reject
    result = f.run()
    assert result.decision == "pending" and "secret" not in repr(result) and "secret" not in str(f.commits)
test("스캐너 예외는 미확인으로 기록하고 원시 오류를 노출하지 않는다", scan_error)

for field, value in (("claimed_bytes", 8), ("claimed_sha256", "b" * 64), ("declared_mime", "application/pdf")):
    def scenario(field=field, value=value):
        f = Fixture(); f.job["file"][field] = value; f.current_job = deepcopy(f.job)
        result = f.run(); assert result.decision == "rejected" and not f.scans
    test("신고값 " + field + "를 실물 확인 없이 채택하지 않는다", scenario)

def invalid_pdf():
    f = Fixture(); f.body = b"%PDF-1.7\nnot a parsed document\n%%EOF"
    f.job["file"].update(name="응답.pdf", extension="pdf", claimed_bytes=len(f.body), claimed_sha256=hashlib.sha256(f.body).hexdigest(), declared_mime="application/pdf")
    f.policy["extensions"] = ["pdf"]; f.current_job, f.current_policy = deepcopy(f.job), deepcopy(f.policy)
    f.read = lambda *_args, **_kwargs: iter([f.body])
    result = f.run(); assert result.decision == "rejected" and not f.scans
    assert f.commits[0]["evidence"]["format"]["status"] == "rejected"
test("PDF 표식만 있는 손상 문서는 파서 검사에서 거부하고 스캔하지 않는다", invalid_pdf)

def mutated_object():
    f = Fixture()
    f.stat_hook = lambda item: {**item, "object": {**item["object"], "identity": "new-object"}} if f.stats > 1 else item
    result = f.run(); assert result.code == "OBJECT_CHANGED" and not f.commits
test("실물 읽기 도중 객체 판이 바뀌면 검사 결과를 봉인하지 않는다", mutated_object)

def mutation_after_scan():
    f = Fixture()
    def scan(item):
        f.stat_hook = lambda state: {**state, "object": {**state["object"], "identity": "new-object"}}
        return item
    f.scan_hook = scan
    result = f.run(); assert result.code == "OBJECT_CHANGED" and not f.commits
test("악성 검사 뒤 객체 교체도 마지막 확인에서 차단한다", mutation_after_scan)

def policy_changed():
    f = Fixture()
    def scan(item):
        f.current_policy["approval_ref"] = "다른 승인"
        return item
    f.scan_hook = scan
    result = f.run(); assert result.code == "STALE_JOB" and not f.commits
test("검사 중 현재 정책이 바뀌면 이전 정책 결과를 적용하지 않는다", policy_changed)

def forged_policy():
    f = Fixture(); forged = {**f.policy, "max_file_bytes": 99999}
    result = f.run(policy=forged); assert result.code == "STALE_JOB" and not f.reads
test("호출자가 만든 정책값은 원장의 현재 승인 정책과 대조한다", forged_policy)

def expired():
    f = Fixture(); f.read_hook = lambda: setattr(f, "time", f.time + timedelta(hours=1))
    result = f.run(); assert result.code == "LEASE_EXPIRED" and not f.commits
test("읽기 중 lease가 만료되면 스캔·봉인을 진행하지 않는다", expired)

def cancel():
    f = Fixture(); f.read_hook = lambda: setattr(f, "cancelled", True)
    result = f.run(); assert result.status == "cancelled" and not f.commits
test("파일 읽기 중 취소하면 늦은 결과를 봉인하지 않는다", cancel)

def too_large():
    f = Fixture(); f.policy["max_file_bytes"] = 1; f.current_policy = deepcopy(f.policy)
    result = f.run(); assert result.code == "SIZE_LIMIT" and not f.reads
test("파일 크기가 승인 한도를 넘으면 원문 읽기를 시작하지 않는다", too_large)

def false_stream():
    f = Fixture(); f.read = lambda *_args, **_kwargs: iter([f.body, b"x" * 100000])
    result = f.run(); assert result.code == "SIZE_LIMIT" and not f.commits
test("Storage 크기 신고를 믿지 않고 스트림 누적 바이트를 제한한다", false_stream)

def no_ack():
    f = Fixture()
    def lose(_):
        raise RuntimeError("private-network-path")
    f.ack_hook = lose
    first = f.run(); assert first.status == "result_unknown" and first.pending is not None
    assert "private-lease" not in repr(first) and "private-lease" not in repr(first.pending)
    f.ack_hook = lambda item: item
    second = commit_verification(first.pending, f, now=f.now)
    assert second.status == "recorded" and len(f.receipts) == 1 and f.commits[0] == f.commits[1] and len(f.scans) == 1
test("봉인 응답 유실은 같은 본문·키로 재확인하고 다시 스캔하지 않는다", no_ack)

def malformed_ack():
    f = Fixture(); f.ack_hook = lambda _: True
    result = f.run(); assert result.status == "result_unknown" and result.pending is not None
test("봉인 응답 true·깨진 응답을 저장 성공으로 추측하지 않는다", malformed_ack)

def stale_pending():
    f = Fixture(); f.ack_hook = lambda _: None
    first = f.run(); f.time += timedelta(hours=1)
    result = commit_verification(first.pending, f, now=f.now)
    assert result.code == "LEASE_EXPIRED" and len(f.commits) == 1
test("미확정 봉인도 만료된 lease로 재전송하지 않는다", stale_pending)

def tampered_pending():
    f = Fixture(); f.ack_hook = lambda _: None
    first = f.run(); first.pending._evidence["decision"] = "rejected"
    result = commit_verification(first.pending, f, now=f.now)
    assert result.code == "INVALID_ATTEMPT" and len(f.commits) == 1
test("미확정 요청의 본문이 바뀌면 같은 키로 보내지 않는다", tampered_pending)

def forged_attempt():
    f = Fixture()
    evidence = {"decision": "ready", "object": {"file_id": "other"}, "format": {"status": "unsupported"}, "scan": {"status": "not_scanned"}}
    attempt = CommitAttempt(deepcopy(f.job["lease"]), evidence, "verify_run", canonical_hash(evidence))
    result = commit_verification(attempt, f, now=f.now)
    assert result.code == "INVALID_ATTEMPT" and not f.commits
test("임의로 만든 ready 증거는 해시가 맞아도 봉인 포트에 전달하지 않는다", forged_attempt)

def changed_ledger():
    f, other = Fixture(), Fixture(); f.ack_hook = lambda _: None
    first = f.run(); result = commit_verification(first.pending, other, now=f.now)
    assert result.code == "INVALID_ATTEMPT" and not other.commits
test("미확정 봉인은 다른 원장 연결로 옮겨 재전송하지 않는다", changed_ledger)

def secret_code():
    f = Fixture()
    def reject(_):
        raise WorkerError("secret-key/private-object-path")
    f.inspect_hook = reject
    result = f.run()
    assert result.code == "WORKER_ERROR" and "secret" not in repr(result) and not f.commits
test("포트가 WorkerError에 넣은 임의 원문도 고정 오류 코드로 바꾼다", secret_code)

def expired_after_ack():
    f = Fixture()
    def ack(item):
        f.time += timedelta(hours=1)
        return item
    f.ack_hook = ack
    assert f.run().status == "recorded"
test("서버가 확인해 준 접수는 응답 직후 lease 만료로 되돌리지 않는다", expired_after_ack)

def bad_inputs():
    f = Fixture()
    for change in ({"school_id": "other"}, {"bucket": "legacy"}, {"path": "school/file/../outside"}, {"path": "school/file/short"}):
        job = deepcopy(f.job); job["lease"]["object"].update(change)
        assert f.run(job=job).status == "error"
    assert not f.reads and not f.commits
test("다른 학교·기존 bucket·경로 이탈·짧은 키는 원문 요청 전에 거부한다", bad_inputs)

def malformed():
    f = Fixture()
    for job in (None, [], {}, {**f.job, "verified": True}):
        assert f.run(job=job if job is not None else {}).status == "error"
    for field in ("max_file_bytes",):
        policy = deepcopy(f.policy); policy[field] = True
        assert f.run(policy=policy).status == "error"
    assert not f.reads
test("깨진 입력·검증됨 플래그 주입·불리언 숫자는 실행하지 않는다", malformed)


def format_fixture(body, name):
    f = Fixture()
    extension = name.rsplit(".", 1)[-1]
    mime = {"pdf": "application/pdf", "hwp": "application/x-hwp", "hwpx": "application/hwp+zip"}[extension]
    f.body = body
    f.job["file"].update(name=name, extension=extension, claimed_bytes=len(body),
                         claimed_sha256=hashlib.sha256(body).hexdigest(), declared_mime=mime)
    f.policy["extensions"] = [extension]
    f.policy["max_file_bytes"] = 10 * 1024 * 1024
    f.policy["limits"].update(max_archive_entries=1000, max_entry_bytes=32 * 1024 * 1024,
                              max_expanded_bytes=64 * 1024 * 1024, max_xml_bytes=32 * 1024 * 1024,
                              max_compression_ratio=1000)
    f.current_job, f.current_policy = deepcopy(f.job), deepcopy(f.policy)
    return f


def pdf_document():
    writer = PdfWriter()
    writer.add_blank_page(width=595, height=842)
    output = BytesIO()
    writer.write(output)
    writer.close()
    return output.getvalue()


for scanner in (False, True):
    def pdf_pipeline(scanner=scanner):
        f = format_fixture(pdf_document(), "수합.pdf")
        result = f.run(scanner=scanner)
        assert result.status == "recorded" and result.decision == ("ready" if scanner else "pending"), result
        evidence = f.commits[0]["evidence"]
        assert evidence["format"]["code"] == "pdf_structure_passed"
        assert evidence["scan"]["status"] == ("clean" if scanner else "not_scanned")
    test("실제 PDF 파서→검증 접수의 스캔 분리 " + str(scanner), pdf_pipeline)


for compressed, footer in ((False, False), (True, False), (True, True)):
    for scanner in (False, True):
        def hwp_pipeline(compressed=compressed, footer=footer, scanner=scanner):
            f = format_fixture(make_hwp(compressed=compressed, footer=footer), "수합.hwp")
            result = f.run(scanner=scanner)
            assert result.status == "recorded" and result.decision == ("ready" if scanner else "pending"), result
            evidence = f.commits[0]["evidence"]
            assert evidence["format"]["status"] == "passed"
            assert evidence["scan"]["status"] == ("clean" if scanner else "not_scanned")
        test("HWP 압축/검사 접수 " + str((compressed, footer, scanner)), hwp_pipeline)


for template in sorted((Path(__file__).resolve().parents[1] / "apps/main/api/doc-ai/_assets").glob("tpl-*.hwpx")):
    for scanner in (False, True):
        def hwpx_pipeline(template=template, scanner=scanner):
            f = format_fixture(template.read_bytes(), "수합.hwpx")
            result = f.run(scanner=scanner)
            assert result.status == "recorded" and result.decision == ("ready" if scanner else "pending"), result
            evidence = f.commits[0]["evidence"]
            assert evidence["format"]["status"] == "passed"
            assert evidence["scan"]["status"] == ("clean" if scanner else "not_scanned")
        test("보호 양식 원문→검증 접수 " + template.name + " 스캔=" + str(scanner), hwpx_pipeline)

print(f"\n{passed} passed, {failed} failed")
if failed:
    raise SystemExit(1)
