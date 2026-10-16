"""R1 실제 SQL + Python 작업자 통합 시험. Supabase/PostgREST/Storage 운영 시험이 아니다.

R0·R1-00~04만 설치한 빈 전용 로컬 DB를 준비한 뒤 실행한다. SQL 원문은
--sql-root의 승인본을 읽으며, 합성 R1-05/06·회원·파일만 이 시험 DB에 쓴다.
DB를 만들거나 지우지 않으며 다시 실행하려면 새 전용 DB가 필요하다.
필요 패키지: psycopg2-binary + workers/requirements.txt.
"""
from __future__ import annotations

import argparse
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
import hashlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import importlib.util
from io import BytesIO
import json
import os
from pathlib import Path
import re
import socket
import sys
import threading
import uuid

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
BUCKET = "workhub-collection-files"
RPC_ARGS = {
    "heartbeat": ("p_school_id", "p_worker_id", "p_capability", "p_ttl_seconds"),
    "claim": ("p_school_id", "p_worker_id", "p_limit"),
    "job_inspect": ("p_job_id", "p_lease_token"),
    "seal": ("p_job_id", "p_lease_token", "p_file_id", "p_path", "p_storage_object_id", "p_result"),
    "fail": ("p_job_id", "p_lease_token", "p_error_code", "p_retry_after_seconds"),
    "cleanup_claim": ("p_school_id", "p_worker_id", "p_limit"),
    "cleanup_inspect": ("p_ledger_id", "p_lease_token"),
    "cleanup_done": ("p_ledger_id", "p_lease_token", "p_outcome", "p_reason"),
}
RPC_ARGS = {"workhub_file_worker_" + key: fields for key, fields in RPC_ARGS.items()}


def checked_config(args):
    # DSN·외부 호스트·PG 환경 변수로 목적지를 바꾸지 않는다.
    if re.fullmatch(r"codex_r1_worker_[a-z0-9_]{1,35}", args.database or "") is None:
        raise ValueError("전용 codex_r1_worker_* DB만 허용합니다.")
    if type(args.port) is not int or not 1024 <= args.port <= 65535:
        raise ValueError("1024~65535의 로컬 시험 포트가 필요합니다.")
    if not args.expected_data_directory or not Path(args.expected_data_directory).is_absolute():
        raise ValueError("로컬 PostgreSQL data_directory의 절대 경로를 명시해야 합니다.")
    source = Path(args.sql_root).resolve()
    for filename in ("test/run_r1.py", "R1-03_공개함수_Storage.sql", "R1-05_검증작업자연결_양식.sql", "R1-06_정책게시_양식.sql"):
        if not (source / filename).is_file():
            raise ValueError("승인된 R1 SQL 루트와 시험 도우미가 필요합니다.")
    return {"host": "127.0.0.1", "port": args.port, "dbname": args.database,
            "user": "supabase_admin", "password": "", "sslmode": "disable", "connect_timeout": 5,
            "options": "-c statement_timeout=15000 -c lock_timeout=5000"}, source


class Fixture:
    def __init__(self, args):
        import psycopg2
        self.pg = psycopg2
        self.config, self.source = checked_config(args)
        self.results = []
        self.blobs = {}
        self.calls = []
        self.downloads = []
        self.removes = []
        self.drop_seal_response = False
        self.handler_errors = []
        # 쓰기 전에 실제 서버의 경로·버전·DB명·빈 상태를 한 번에 확인한다.
        with self.connection() as connection:
            with connection.cursor() as cursor:
                cursor.execute("SELECT current_database(), current_setting('data_directory'), current_setting('server_version_num')")
                database, directory, version = cursor.fetchone()
                if database != args.database or Path(directory).resolve() != Path(args.expected_data_directory).resolve() or not 170000 <= int(version) < 180000:
                    raise ValueError("전용 로컬 PostgreSQL 17 서버 확인에 실패했습니다.")
                cursor.execute("SELECT (SELECT count(*) FROM workhub.file_objects), (SELECT count(*) FROM workhub.policy_versions), "
                               "(SELECT count(*) FROM workhub_private.api_role_principals), "
                               "(SELECT count(*) FROM auth.users WHERE id='00000000-0000-0000-0000-000000000021')")
                if cursor.fetchone() != (0, 0, 0, 0):
                    raise ValueError("R0·R1 설치 직후의 빈 시험 DB가 아닙니다. 새 전용 DB를 준비하세요.")
        os.environ.update(R0_PGHOST="127.0.0.1", R0_PG_PORT=str(args.port), R1_DIR=str(self.source))
        spec = importlib.util.spec_from_file_location("r1_approved_fixtures", self.source / "test/run_r1.py")
        self.original = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.original)
        self.original.DB = args.database
        self.school = self.original.fixtures()
        self.member = self.scalar("SELECT m.id FROM workhub.memberships m JOIN workhub.accounts a ON a.id=m.account_id WHERE a.auth_user_id=%s", (self.original.U1,))
        self.teacher = self.original.Who(self.original.U1, self.member)
        self.closed = False

    @contextmanager
    def connection(self, *, api=False):
        config = {**self.config, "user": "authenticator" if api else "supabase_admin"}
        connection = self.pg.connect(**config)
        connection.autocommit = True
        try:
            if api:
                with connection.cursor() as cursor:
                    cursor.execute("SET ROLE service_role")
                    cursor.execute("SELECT set_config('request.jwt.claims', %s, false)", (json.dumps({"role": "service_role"}),))
            yield connection
        finally:
            connection.close()

    def scalar(self, sql, args=()):
        with self.connection() as connection, connection.cursor() as cursor:
            cursor.execute(sql, args or None)
            return cursor.fetchone()[0] if cursor.description else None

    def check(self, name, valid):
        self.results.append({"name": name, "passed": bool(valid)})
        print(("PASS " if valid else "FAIL ") + name, flush=True)
        if not valid:
            raise AssertionError(name)

    def rpc(self, name, args):
        fields = RPC_ARGS.get(name)
        if fields is None or set(args) != set(fields):
            raise ValueError("허용하지 않는 시험 RPC")
        values = [json.dumps(args[field]) if isinstance(args[field], (dict, list)) else args[field] for field in fields]
        with self.connection(api=True) as connection, connection.cursor() as cursor:
            cursor.execute("SELECT public." + name + "(" + ",".join(["%s"] * len(values)) + ")", values)
            return cursor.fetchone()[0]

    def configure(self):
        original = self.original
        for filename, payload in (
            ("R1-05_검증작업자연결_양식.sql", {"approver_user_id": original.U1, "approval_ref": "합성 로컬 통합 시험"}),
            ("R1-06_정책게시_양식.sql", {
                "approver_user_id": original.U1, "approval_ref": "합성 로컬 통합 시험", "effective_from": (original.TODAY - timedelta(days=1)).isoformat(),
                "common_file_safety": {"extensions": ["pdf"], "maxFileBytes": 8000000, "maxFiles": 3, "allowUnscanned": True},
                "school_file_upload": {"extensions": ["pdf"], "maxFileBytes": 8000000, "maxFiles": 3, "allowUnscanned": True, "uploadTtlMinutes": 30},
                "school_submission": {"allowWithdrawal": True, "allowCorrectionWindow": True, "maxCorrectionDays": 14, "unattachedRetentionDays": 7}}),
        ):
            original.run_sql(original.fill_json(str(self.source / filename), payload))

    def reserve(self, content, *, digest=None, put=True, complete=True):
        original = self.original
        metadata = {"name": "합성시험.pdf", "extension": "pdf", "claimedBytes": len(content), "claimedSha256": digest or hashlib.sha256(content).hexdigest()}
        envelope = self.teacher.rpc("workhub_file_prepare", self.parent, metadata, original.key())
        upload = original.data(envelope)
        if upload is None:
            raise AssertionError("시험 파일 예약 실패")
        if put:
            if original.upload_object(original.U1, upload["path"]) != "OK":
                raise AssertionError("합성 Storage INSERT 실패")
            self.blobs[upload["path"]] = content
        if complete:
            status = original.data(self.teacher.rpc("workhub_file_complete", upload["fileId"], original.key()))
            if status["state"] != "pending_verification":
                raise AssertionError("complete 계약 불일치")
        return upload

    def state(self, file_id):
        return self.scalar("SELECT state FROM workhub.file_objects WHERE id=%s", (file_id,))

    def age_reservations(self, uploads):
        # 불변 시각의 시간 경과만 합성한다. 이 연결은 전용 로컬 DB의 superuser이며 종료 즉시 설정도 사라진다.
        with self.connection() as connection, connection.cursor() as cursor:
            cursor.execute("SET session_replication_role=replica")
            cursor.execute("UPDATE workhub.file_objects SET created_at=clock_timestamp()-interval '3 days', upload_expires_at=clock_timestamp()-interval '2 days' WHERE id=ANY(%s)", ([item["fileId"] for item in uploads],))

    def close(self):
        if not self.closed:
            self.teacher.c.close()
            self.closed = True


@contextmanager
def bridge(fixture):
    # 인증 키·URL은 합성 값이다. 실제 PostgREST/Storage 서버를 대신하는 HTTP 시험 대역이다.
    class Handler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def log_message(self, *_):
            pass

        def respond(self, value, status=200, binary=False):
            body = value if binary else json.dumps(value, ensure_ascii=False).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/octet-stream" if binary else "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Connection", "close")
            self.end_headers()
            self.wfile.write(body)

        def do_POST(self):
            try:
                name = self.path.removeprefix("/rest/v1/rpc/")
                if name not in RPC_ARGS:
                    return self.respond({}, 404)
                length = int(self.headers.get("Content-Length", "0"))
                if not 0 < length <= 65536:
                    return self.respond({}, 400)
                args = json.loads(self.rfile.read(length))
                fixture.calls.append((name, args))
                result = fixture.rpc(name, args)
                if name.endswith("_seal") and fixture.drop_seal_response:
                    fixture.drop_seal_response = False
                    self.connection.shutdown(socket.SHUT_RDWR)
                    self.connection.close()
                    return
                self.respond(result)
            except fixture.pg.Error as error:
                self.respond({"code": error.pgcode, "message": error.diag.message_primary, "details": None, "hint": None}, 400)
            except Exception as error:
                fixture.handler_errors.append(type(error).__name__)
                self.respond({}, 500)

        def do_GET(self):
            prefix = "/storage/v1/object/" + BUCKET + "/"
            if not self.path.startswith(prefix):
                return self.respond({}, 404)
            path = self.path[len(prefix):]
            fixture.downloads.append(path)
            exists = fixture.scalar("SELECT EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id=%s AND name=%s)", (BUCKET, path))
            if not exists or path not in fixture.blobs:
                return self.respond({}, 404)
            self.respond(fixture.blobs[path], binary=True)

        def do_DELETE(self):
            try:
                if self.path != "/storage/v1/object/" + BUCKET:
                    return self.respond({}, 404)
                args = json.loads(self.rfile.read(int(self.headers.get("Content-Length", "0"))))
                paths = args.get("prefixes")
                if not isinstance(paths, list) or len(paths) != 1 or not isinstance(paths[0], str):
                    return self.respond({}, 400)
                path = paths[0]
                # 합성 Storage 대역만 메타데이터를 지운다. 실제 작업자는 이 SQL을 호출할 수 없다.
                fixture.scalar("DELETE FROM storage.objects WHERE bucket_id=%s AND name=%s", (BUCKET, path))
                fixture.blobs.pop(path, None)
                fixture.removes.append(path)
                self.respond([{"name": path}])
            except Exception as error:
                fixture.handler_errors.append(type(error).__name__)
                self.respond({}, 500)

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield "http://127.0.0.1:" + str(server.server_address[1])
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)


def exercise(fixture, url):
    from pypdf import PdfWriter
    from workers.collection_files.r1_worker import R1Worker
    from workers.collection_files.transport import SupabaseTransport

    transport = SupabaseTransport(url, "sb_secret_synthetic_local_fixture_only", allow_local=True)
    worker = R1Worker(transport, fixture.school, "integration-worker", "integration-r1")
    invoke = lambda name, args: transport.rpc("workhub_file_worker_" + name, args)
    readiness = lambda: fixture.original.data(fixture.teacher.rpc("workhub_collection_readiness"))
    fixture.check("SQL만 설치하면 verification_missing", readiness()["reason"] == "verification_missing")
    fixture.configure()
    invoke("heartbeat", {"p_school_id": fixture.school, "p_worker_id": "integration-worker", "p_capability": {"checks": ["size", "sha256", "signature", "container", "encryption"], "release": "integration-r1"}, "p_ttl_seconds": 120})
    fixture.check("합성 미검사 허용 정책과 5종 heartbeat로 준비 완료", readiness()["available"] is True)
    source = fixture.original.coll_input(fileCollection={"policy": {"extensions": ["pdf"], "maxFileBytes": 5000000, "maxFiles": 3}, "required": False, "templates": []})
    created = fixture.original.data(fixture.teacher.mutate({"kind": "create", "input": source}))
    fixture.parent = {"kind": "template", "requestId": created["requestId"], "version": 1}
    output = BytesIO()
    writer = PdfWriter()
    writer.add_blank_page(width=72, height=72)
    writer.write(output)
    content = output.getvalue()

    def claim(upload):
        jobs = invoke("claim", {"p_school_id": fixture.school, "p_worker_id": "integration-worker", "p_limit": 20})
        return next(job for job in jobs if job["fileId"] == upload["fileId"])

    upload = fixture.reserve(content)
    job = claim(upload)
    fixture.check("실제 SQL claim의 필드·정책을 HTTP로 수신", job["policy"]["allowUnscanned"] is True and job["storageObjectId"] is not None)
    fixture.drop_seal_response = True
    worker.verify(job)
    fixture.check("실제 PDF 검사 뒤 R1 seal이 ready 기록", fixture.state(upload["fileId"]) == "ready")
    final = fixture.scalar("SELECT jsonb_build_object('scan',scan_state,'checks',verification,'hash',sha256) FROM workhub.file_objects WHERE id=%s", (upload["fileId"],))
    fixture.check("스캐너 미실행 사실과 실물 해시 보존", final["scan"] == "not_scanned" and final["hash"] == hashlib.sha256(content).hexdigest() and "malware" not in final["checks"])
    seal_args = next(args for name, args in fixture.calls if name.endswith("_seal") and args["p_file_id"] == upload["fileId"])
    replay = invoke("seal", seal_args)
    fixture.check("봉인 응답 유실 뒤 동일 인자 재전송은 replayed", replay == {"fileId": upload["fileId"], "state": "ready", "replayed": True})
    fixture.check("재전송해도 감사 한 건", fixture.scalar("SELECT count(*) FROM workhub.audit_events WHERE resource_id=%s AND operation='file.verify'", (upload["fileId"],)) == 1)
    status = fixture.original.data(fixture.teacher.rpc("workhub_file_status", upload["fileId"]))
    fixture.check("교사 상태 RPC에서 ready 파일 참조 확인", status["state"] == "ready" and status["file"]["sha256"] == hashlib.sha256(content).hexdigest())

    rpc_count = len(fixture.calls)
    dry = worker.run_once()
    fixture.check("기본 dry run은 실제 RPC·임대·정리 원장을 만들지 않음", dry["mode"] == "dry_run" and len(fixture.calls) == rpc_count)
    automatic = fixture.reserve(content)
    batch = worker.run_once(execute=True, max_jobs=1)
    fixture.check("run_once가 heartbeat→claim→검사→seal을 실제 SQL로 수행", fixture.state(automatic["fileId"]) == "ready" and batch["verification"][0]["status"] == "recorded")

    bad = fixture.reserve(content, digest="0" * 64)
    worker.verify(claim(bad))
    fixture.check("신고 해시와 다른 실제 파일은 rejected", fixture.state(bad["fileId"]) == "rejected")

    with fixture.connection() as connection, connection.cursor() as cursor:
        # 불변 heartbeat 이력의 시간 경과만 합성한다. 운영 변경 기능이 아니다.
        cursor.execute("SET session_replication_role=replica")
        cursor.execute("UPDATE workhub.file_verifier_heartbeats SET reported_at=clock_timestamp()-interval '3 minutes', expires_at=clock_timestamp()-interval '1 minute'")
    fixture.check("마지막 heartbeat TTL이 지나면 준비 상태가 다시 닫힘", readiness()["reason"] == "verification_missing")
    worker.heartbeat(["size", "sha256", "signature", "container", "encryption"])

    in_flight = fixture.reserve(content)
    in_flight_job = claim(in_flight)
    paused = fixture.reserve(content)
    paused_job = claim(paused)
    queued = fixture.reserve(content)
    fixture.scalar("UPDATE workhub_private.r1_switch SET state='writes_stopped', reason='합성 통합 시험'")
    closed_jobs = invoke("claim", {"p_school_id": fixture.school, "p_worker_id": "integration-worker", "p_limit": 20})
    worker.verify(in_flight_job)
    fixture.check("쓰기 중지는 새 인수를 막고 기존 임대 봉인은 허용", closed_jobs == [] and fixture.state(in_flight["fileId"]) == "ready")
    fixture.scalar("UPDATE workhub_private.r1_switch SET state='all_stopped', reason='합성 통합 시험'")
    reads = len(fixture.downloads)
    closed_jobs = invoke("claim", {"p_school_id": fixture.school, "p_worker_id": "integration-worker", "p_limit": 20})
    worker.verify(paused_job)
    fixture.check("전체 중지는 새 인수와 기존 임대 검사를 모두 차단", closed_jobs == [] and len(fixture.downloads) == reads and fixture.state(paused["fileId"]) == "verifying")
    from workers.collection_files.common import WorkerError
    try:
        invoke("seal", {"p_job_id": paused_job["jobId"], "p_lease_token": paused_job["leaseToken"], "p_file_id": paused_job["fileId"],
                        "p_path": paused_job["path"], "p_storage_object_id": paused_job["storageObjectId"], "p_result": seal_args["p_result"]})
        refused = False
    except WorkerError as error:
        refused = error.code == "RPC_NOT_READY"
    fixture.check("전체 중지 중 직접 봉인도 SQL NOT_READY로 거부", refused)
    fixture.scalar("UPDATE workhub_private.r1_switch SET state='open', reason='합성 통합 시험 종료'")
    worker.verify(paused_job)
    worker.run_once(execute=True, max_jobs=1)
    fixture.check("재개하면 살아 있는 임대와 대기 작업을 모두 마무리", fixture.state(paused["fileId"]) == "ready" and fixture.state(queued["fileId"]) == "ready")

    stale = fixture.reserve(content)
    stale_job = claim(stale)
    fixture.scalar("UPDATE workhub.file_verification_jobs SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE id=%s", (stale_job["jobId"],))
    download_count = len(fixture.downloads)
    worker.verify(stale_job)
    fixture.check("만료된 SQL lease는 내려받기·봉인 차단", len(fixture.downloads) == download_count and fixture.state(stale["fileId"]) == "verifying")

    first = fixture.reserve(content, complete=False)
    absent = fixture.reserve(content, put=False, complete=False)
    replaced = fixture.reserve(content, complete=False)
    fixture.age_reservations([first, absent, replaced])
    cleanups = invoke("cleanup_claim", {"p_school_id": fixture.school, "p_worker_id": "integration-worker", "p_limit": 50})
    by_file = {item["fileId"]: item for item in cleanups}
    cleanup = by_file[first["fileId"]]
    original_id = fixture.scalar("SELECT id::text FROM storage.objects WHERE bucket_id=%s AND name=%s", (BUCKET, first["path"]))
    fixture.check("F7: complete 생략 파일의 실물 ID를 정리 인수 때 고정", cleanup["storageObjectId"] == original_id)
    worker.cleanup(cleanup)
    fixture.check("Storage HTTP 삭제 뒤 SQL 원장 completed", fixture.state(first["fileId"]) == "deleted" and first["path"] in fixture.removes)
    done_args = next(args for name, args in fixture.calls if name.endswith("_cleanup_done") and args["p_ledger_id"] == cleanup["ledgerId"])
    fixture.check("정리 확정도 같은 인자로 재전송 가능", invoke("cleanup_done", done_args)["replayed"] is True)

    count = len(fixture.removes)
    worker.cleanup(by_file[absent["fileId"]])
    fixture.check("처음부터 실물 없는 NULL ID는 Storage 삭제 없이 확정", fixture.state(absent["fileId"]) == "deleted" and len(fixture.removes) == count)
    fixture.scalar("UPDATE storage.objects SET id=%s WHERE bucket_id=%s AND name=%s", (str(uuid.uuid4()), BUCKET, replaced["path"]))
    worker.cleanup(by_file[replaced["fileId"]])
    fixture.check("고정 ID와 다른 객체는 삭제하지 않음", replaced["path"] not in fixture.removes and fixture.scalar("SELECT count(*) FROM storage.objects WHERE bucket_id=%s AND name=%s", (BUCKET, replaced["path"])) == 1)
    fixture.check("HTTP 대역 처리 예외 없음", not fixture.handler_errors)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--sql-root", required=True)
    parser.add_argument("--port", type=int, default=55446)
    parser.add_argument("--database", required=True)
    parser.add_argument("--expected-data-directory", required=True)
    parser.add_argument("--output")
    args = parser.parse_args()
    fixture = None
    passed = False
    try:
        fixture = Fixture(args)
        with bridge(fixture) as url:
            exercise(fixture, url)
        passed = all(item["passed"] for item in fixture.results)
        return 0 if passed else 1
    except Exception as error:
        # 연결 정보·SQL 오류 원문·파일 내용을 출력하지 않는다.
        print("FAIL 통합 시험 중단: " + type(error).__name__, flush=True)
        return 1
    finally:
        if fixture is not None:
            fixture.close()
            result = {"passed": passed, "checks": fixture.results,
                      "sqlSha256": hashlib.sha256((fixture.source / "R1-03_공개함수_Storage.sql").read_bytes()).hexdigest(),
                      "scope": "로컬 PostgreSQL 17 실제 R1 SQL + 실제 Python 작업자/HTTP 클라이언트; HTTP PostgREST/Storage는 합성 대역"}
            print(f"R1 작업자 SQL 통합: {sum(item['passed'] for item in fixture.results)}/{len(fixture.results)}", flush=True)
            if args.output:
                Path(args.output).write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")


if __name__ == "__main__":
    raise SystemExit(main())
