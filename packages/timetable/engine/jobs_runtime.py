"""로컬 폴더 작업 보관소. 실행 정책과 파일 접근을 계산 프로세스에서 분리한다."""
from contextlib import AbstractContextManager
from datetime import datetime, timedelta, timezone
import json
import os
from pathlib import Path
import re
import stat
import uuid

from jobs_contract import CONTRACT, POLICY, TERMINAL, UUID, JobError, digest, exact, now, require, timestamp, validate_marker, validate_queue, validate_request, validate_result, validate_status
import runner

JOB_FILES = frozenset(('request.json', 'ready.json', 'cancel.json', 'manifest.json', 'request.snapshot.json', 'status.json', 'result.json'))


def owned_job_file(name):
    return name in JOB_FILES or incidental_file(name) or bool(re.fullmatch(r'\.engine\.[0-9a-f-]{36}\.json', name))


def incidental_file(name):
    # Finder 표식과 이 모듈이 원자 기록 중 남긴 임시 파일만 허용한다.
    return name == '.DS_Store' or any(re.fullmatch(r'\.' + re.escape(base) + r'\.[0-9a-f-]{36}\.tmp', name) for base in JOB_FILES)


def no_link(path):
    """Windows junction도 거부한다. 공유/동기화 폴더는 이 계약의 대상이 아니다."""
    try:
        info = path.lstat()
    except FileNotFoundError:
        return
    require(not stat.S_ISLNK(info.st_mode) and not (getattr(info, 'st_file_attributes', 0) & 1024), 'UNSAFE_PATH', '링크나 연결 디렉터리는 작업 폴더로 사용할 수 없습니다.')


class FileLock(AbstractContextManager):
    def __init__(self, path):
        self.path = path
        self.stream = None

    def __enter__(self):
        no_link(self.path)
        self.stream = open(self.path, 'a+b')
        try:
            if os.name == 'nt':
                import msvcrt
                if self.path.stat().st_size == 0:
                    self.stream.write(b'0')
                    self.stream.flush()
                self.stream.seek(0)
                msvcrt.locking(self.stream.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(self.stream.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            self.stream.close()
            self.stream = None
            raise JobError('WORKER_BUSY', '이 작업 폴더는 다른 작업자가 사용 중입니다.') from None
        return self

    def __exit__(self, *args):
        if self.stream:
            if os.name == 'nt':
                import msvcrt
                self.stream.seek(0)
                msvcrt.locking(self.stream.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                import fcntl
                fcntl.flock(self.stream.fileno(), fcntl.LOCK_UN)
            self.stream.close()


def read_json(path, maximum):
    no_link(path)
    try:
        require(path.is_file() and path.stat().st_size <= maximum, 'FILE_LIMIT', '작업 파일 크기 한도를 확인해 주세요.')
        with open(path, 'rb') as source:
            raw = source.read(maximum + 1)
        require(len(raw) <= maximum, 'FILE_LIMIT', '작업 파일 크기 한도를 초과했습니다.')
        return json.loads(raw.decode('utf-8-sig'), object_pairs_hook=runner.unique_object,
                          parse_constant=lambda _: (_ for _ in ()).throw(ValueError('상수 불가')))
    except (UnicodeError, json.JSONDecodeError, ValueError, OSError):
        raise JobError('FILE_UNREADABLE', '작업 파일을 온전히 읽을 수 없습니다.') from None


def atomic_json(path, value, exclusive=False):
    no_link(path.parent)
    no_link(path)
    temporary = path.with_name(f'.{path.name}.{uuid.uuid4()}.tmp')
    try:
        with open(temporary, 'x', encoding='utf-8', newline='\n') as target:
            target.write(runner.canonical(value))
            target.flush()
            os.fsync(target.fileno())
        if exclusive:
            # 이미 있는 원본/마커를 교체하지 않는다. 링크는 같은 파일시스템 안에서만 쓴다.
            try:
                os.link(temporary, path)
            except FileExistsError:
                raise JobError('REQUEST_CONFLICT', '이미 있는 작업 파일은 덮어쓰지 않습니다.') from None
        else:
            os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


class JobStore:
    def __init__(self, root):
        original = Path(root).absolute()
        for part in (original, *original.parents):
            no_link(part)
        self.root = original.resolve()
        require(self.root.is_dir(), 'STORE_MISSING', '먼저 init으로 전용 작업 폴더를 만들어 주세요.')
        self.queue = validate_queue(read_json(self.root / 'queue.json', POLICY['maximumMetadataBytes']))
        no_link(self.root / 'jobs')
        require((self.root / 'jobs').is_dir(), 'INVALID_JOB', '작업 목록 디렉터리가 없습니다.')

    @classmethod
    def initialize(cls, root):
        target = Path(root).absolute()
        for part in (target, *target.parents):
            no_link(part)
        target.mkdir(parents=True, exist_ok=True)
        if (target / 'queue.json').exists():
            return cls(target)
        entries = list(target.iterdir())
        for entry in entries:
            no_link(entry)
        require(all(entry.name == '.DS_Store' and entry.is_file() for entry in entries), 'STORE_NOT_EMPTY', '비어 있는 전용 폴더를 선택해 주세요. 기존 파일은 바꾸지 않습니다.')
        (target / 'jobs').mkdir()
        atomic_json(target / 'queue.json', dict(contract=CONTRACT, queueId=str(uuid.uuid4()), createdAt=now(), policyVersion=POLICY['version']), exclusive=True)
        return cls(target)

    def lock(self):
        return FileLock(self.root / '.worker.lock')

    def submission_lock(self):
        return FileLock(self.root / '.submission.lock')

    def path(self, request_id):
        require(type(request_id) is str and bool(UUID.fullmatch(request_id)), 'INVALID_REQUEST_ID', '작업 번호는 소문자 UUID여야 합니다.')
        no_link(self.root)
        no_link(self.root / 'jobs')
        path = self.root / 'jobs' / request_id
        no_link(path)
        require(path.parent.resolve() == self.root / 'jobs', 'UNSAFE_PATH')
        return path

    def directories(self):
        no_link(self.root)
        no_link(self.root / 'jobs')
        result = []
        for entry in (self.root / 'jobs').iterdir():
            no_link(entry)
            if entry.name == '.DS_Store' and entry.is_file():
                continue
            require(bool(UUID.fullmatch(entry.name)) and entry.is_dir(), 'INVALID_LAYOUT', '작업 폴더에는 UUID 이름의 작업 디렉터리만 둘 수 있습니다.')
            result.append(entry)
        return sorted(result, key=lambda p: p.name)

    def check_capacity(self):
        size = 0
        pending = 0
        directories = self.directories()
        require(len(directories) <= POLICY['maximumRetainedJobs'], 'STORE_FULL', '완료 작업을 검토하고 cleanup으로 정리해 주세요.')
        for directory in directories:
            for entry in directory.iterdir():
                no_link(entry)
                require(entry.is_file(), 'INVALID_LAYOUT', '작업 디렉터리 안의 하위 디렉터리는 지원하지 않습니다.')
                size += entry.stat().st_size
                require(size <= POLICY['maximumStoreBytes'], 'STORE_FULL', '작업 보관 용량이 가득 찼습니다.')
            if (directory / 'ready.json').exists():
                try:
                    status = self.status(directory.name)
                except JobError:
                    status = None  # 읽는 중이거나 깨진 표식은 완료로 빼지 않고 대기 수에 보수적으로 포함한다.
                pending += status is None or status['state'] not in TERMINAL
                require(pending <= POLICY['maximumPendingJobs'], 'QUEUE_FULL', '대기 중인 계산이 너무 많습니다.')
        return size, pending

    def marker(self, request_id):
        path = self.path(request_id)
        marker = validate_marker(read_json(path / 'ready.json', POLICY['maximumMetadataBytes']), self.queue, request_id)
        if (path / 'manifest.json').exists():
            manifest = self.manifest(request_id)
            require(manifest['ready'] == marker, 'REQUEST_CONFLICT', '접수한 작업의 마커가 바뀌었습니다.')
        return marker

    def manifest(self, request_id):
        result = read_json(self.path(request_id) / 'manifest.json', POLICY['maximumMetadataBytes'])
        exact(result, 'ready requestDigest acceptedAt deadlineAt processId' + (' processIdentity' if type(result) is dict and 'processIdentity' in result else ''))
        validate_marker(result['ready'], self.queue, request_id)
        require(type(result['requestDigest']) is str and len(result['requestDigest']) == 64)
        timestamp(result['acceptedAt'])
        if result['deadlineAt'] is not None:
            timestamp(result['deadlineAt'])
        require(result['processId'] is None or (type(result['processId']) is int and result['processId'] > 0))
        require(result.get('processIdentity') is None or (type(result['processIdentity']) is str and bool(re.fullmatch(r'(linux|windows):[A-Za-z0-9:-]{1,150}', result['processIdentity']))))
        return result

    def request(self, request_id, snapshot=False):
        marker = self.marker(request_id)
        path = self.path(request_id) / ('request.snapshot.json' if snapshot else 'request.json')
        result = validate_request(read_json(path, runner.POLICY['maximumRequestBytes']), marker)
        if (self.path(request_id) / 'manifest.json').exists():
            require(digest(result) == self.manifest(request_id)['requestDigest'], 'REQUEST_CONFLICT', '접수한 요청의 원본이 바뀌었습니다.')
        return result

    def status(self, request_id):
        path = self.path(request_id) / 'status.json'
        if not path.exists():
            return None
        return validate_status(read_json(path, POLICY['maximumMetadataBytes']), self.marker(request_id))

    def transition(self, request_id, state, code=None):
        marker = self.marker(request_id)
        previous = self.status(request_id)
        if previous and previous['state'] in TERMINAL:
            require(previous['state'] == state and previous['code'] == code, 'TERMINAL_JOB', '끝난 작업은 다시 실행하거나 바꾸지 않습니다.')
            return previous
        current = now()
        value = {**marker, 'sequence': 1 if previous is None else previous['sequence'] + 1,
                 'state': state, 'updatedAt': current, 'startedAt': previous['startedAt'] if previous else None,
                 'finishedAt': current if state in TERMINAL else None, 'code': code}
        if state == 'running':
            value['startedAt'] = current
        validate_status(value, marker)
        atomic_json(self.path(request_id) / 'status.json', value)
        return value

    def admit(self, request_id):
        marker = self.marker(request_id)
        request = self.request(request_id)
        directory = self.path(request_id)
        if (directory / 'manifest.json').exists():
            self.request(request_id, snapshot=True)
        else:
            snapshot = directory / 'request.snapshot.json'
            if snapshot.exists():
                require(read_json(snapshot, runner.POLICY['maximumRequestBytes']) == request, 'REQUEST_CONFLICT')
            else:
                atomic_json(snapshot, request, exclusive=True)
            atomic_json(directory / 'manifest.json', dict(ready=marker, requestDigest=digest(request), acceptedAt=now(), deadlineAt=None, processId=None, processIdentity=None), exclusive=True)
        if self.status(request_id) is None:
            self.transition(request_id, 'queued')
        return request

    def submit(self, request):
        with self.submission_lock():
            return self._submit(request)

    def _submit(self, request):
        request_id = request.get('requestId') if type(request) is dict else None
        directory = self.path(request_id)
        marker = dict(contract=CONTRACT, queueId=self.queue['queueId'], requestId=request_id, inputHash=request.get('inputHash'), queuedAt=now())
        validate_marker(marker, self.queue, request_id)
        validate_request(request, marker)
        if directory.exists() and (directory / 'ready.json').exists():
            require(self.request(request_id) == request, 'REQUEST_CONFLICT', '같은 번호에 다른 요청을 보낼 수 없습니다.')
            return self.status(request_id)
        size, pending = self.check_capacity()
        require(pending < POLICY['maximumPendingJobs'], 'QUEUE_FULL', '대기 중인 계산이 너무 많습니다.')
        require(size + (0 if directory.exists() else len(runner.canonical(request).encode('utf-8'))) + POLICY['maximumMetadataBytes'] <= POLICY['maximumStoreBytes'], 'STORE_FULL')
        if directory.exists():
            require({entry.name for entry in directory.iterdir() if not incidental_file(entry.name)} == {'request.json'}, 'REQUEST_CONFLICT', '미확인 파일이 있는 작업 번호를 재사용할 수 없습니다.')
            require(read_json(directory / 'request.json', runner.POLICY['maximumRequestBytes']) == request, 'REQUEST_CONFLICT')
            atomic_json(directory / 'ready.json', marker, exclusive=True)
            return None
        require(len(self.directories()) < POLICY['maximumRetainedJobs'], 'STORE_FULL')
        directory.mkdir()
        atomic_json(directory / 'request.json', request, exclusive=True)
        atomic_json(directory / 'ready.json', marker, exclusive=True)
        return None

    def cancelled(self, request_id):
        path = self.path(request_id) / 'cancel.json'
        if not path.exists():
            return False
        marker = validate_marker(read_json(path, POLICY['maximumMetadataBytes']), self.queue, request_id, cancel=True)
        require(marker['inputHash'] == self.marker(request_id)['inputHash'], 'REQUEST_CONFLICT')
        return True

    def cancel(self, request_id):
        marker = self.marker(request_id)
        path = self.path(request_id) / 'cancel.json'
        status = self.status(request_id)
        if status and status['state'] in TERMINAL:
            return status
        if not path.exists():
            value = {key: marker[key] for key in ('contract', 'queueId', 'requestId', 'inputHash')}
            atomic_json(path, {**value, 'requestedAt': now()}, exclusive=True)
        self.cancelled(request_id)
        return status

    def result(self, request_id):
        status = self.status(request_id)
        require(status is not None and status['state'] == 'succeeded', 'RESULT_NOT_READY', '완료된 계산 결과가 아직 없습니다.')
        return validate_result(self.request(request_id, snapshot=True), read_json(self.path(request_id) / 'result.json', POLICY['maximumResultBytes']))

    def cleanup(self, apply=False, request_id=None):
        cutoff = datetime.now(timezone.utc) - timedelta(days=POLICY['retentionDays'])
        candidates = []
        directories = [self.path(request_id)] if request_id is not None else self.directories()
        for directory in directories:
            status = self.status(directory.name)
            if request_id is not None:
                require(status is not None and status['state'] in TERMINAL, 'JOB_NOT_FINISHED', '완료된 작업만 정리할 수 있습니다.')
            if status is None or status['state'] not in TERMINAL or (request_id is None and timestamp(status['finishedAt']) > cutoff):
                continue
            entries = list(directory.iterdir())
            require(all(owned_job_file(item.name) and item.is_file() for item in entries), 'UNKNOWN_FILES', '알 수 없는 파일이 있어 이 작업은 지우지 않습니다.')
            for entry in entries:
                no_link(entry)
            candidates.append(directory.name)
        if apply:
            for request_id in candidates:
                directory = self.path(request_id)
                # 확인한 전용 파일만 지운다. 재귀 삭제/연결 추적은 하지 않는다.
                for entry in directory.iterdir():
                    no_link(entry)
                    require(owned_job_file(entry.name) and entry.is_file(), 'UNKNOWN_FILES')
                    entry.unlink()
                directory.rmdir()
        return dict(applied=apply, retentionDays=POLICY['retentionDays'], requestIds=candidates)
