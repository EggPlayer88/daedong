"""전용 폴더를 감시하고 실제 계산 자식 프로세스를 감독하는 로컬 작업자."""
from datetime import datetime, timedelta, timezone
import os
from pathlib import Path
import subprocess
import sys
import time
import uuid

from jobs_contract import CONTRACT, POLICY, TERMINAL, JobError, now, require, timestamp, validate_result
from jobs_runtime import atomic_json, no_link, read_json

ENGINE = Path(__file__).with_name('runner.py')


def process_alive(pid):
    """기존 PID는 조회만 한다. PID 재사용 가능성이 있으므로 저장된 PID를 종료하지 않는다."""
    if os.name == 'nt':
        import ctypes
        from ctypes import wintypes
        kernel = ctypes.WinDLL('kernel32', use_last_error=True)
        kernel.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
        kernel.OpenProcess.restype = wintypes.HANDLE
        kernel.GetExitCodeProcess.argtypes = [wintypes.HANDLE, ctypes.POINTER(wintypes.DWORD)]
        kernel.CloseHandle.argtypes = [wintypes.HANDLE]
        handle = kernel.OpenProcess(0x1000, False, pid)
        if not handle:
            return ctypes.get_last_error() != 87  # 조회 권한 없음도 실행 중으로 보수적으로 판단한다.
        try:
            code = wintypes.DWORD()
            return not kernel.GetExitCodeProcess(handle, ctypes.byref(code)) or code.value == 259
        finally:
            kernel.CloseHandle(handle)
    if sys.platform.startswith('linux'):
        try:
            # 부모가 갑자기 종료된 뒤 init의 수거를 기다리는 zombie는 더 이상 계산하지 않는다.
            process_state = Path(f'/proc/{pid}/stat').read_text().rsplit(')', 1)[1].strip().split()[0]
            if process_state == 'Z':
                return False
        except (OSError, IndexError):
            pass
    try:
        os.kill(pid, 0)
        return True
    except ProcessLookupError:
        return False
    except PermissionError:
        return True


class LocalWorker:
    def __init__(self, store):
        self.store = store
        self.worker_id = str(uuid.uuid4())
        self.last_heartbeat = 0

    def heartbeat(self, state='ready', request_id=None, force=False):
        if force or time.monotonic() - self.last_heartbeat >= POLICY['heartbeatIntervalMilliseconds'] / 1000:
            atomic_json(self.store.root / 'worker.json', dict(contract=CONTRACT, queueId=self.store.queue['queueId'], workerId=self.worker_id,
                        state=state, updatedAt=now(), activeRequestId=request_id))
            self.last_heartbeat = time.monotonic()

    def reconcile(self, confirm_stopped=None):
        """접수증을 복원하되 실행을 추측해서 다시 시작하지 않는다. 호출자는 작업자 잠금을 보유한다."""
        blocked = []
        for directory in self.store.directories():
            if not (directory / 'manifest.json').exists():
                continue
            manifest = self.store.manifest(directory.name)
            status = self.store.status(directory.name)
            if status and status['state'] in TERMINAL:
                continue
            if manifest['deadlineAt'] is None:
                continue
            if (directory / 'result.json').exists():
                validate_result(self.store.request(directory.name, snapshot=True), read_json(directory / 'result.json', POLICY['maximumResultBytes']))
                self.store.transition(directory.name, 'succeeded')
                continue
            expired = timestamp(manifest['deadlineAt']) < datetime.now(timezone.utc)
            pid = manifest['processId']
            # 죽은 작업자가 남긴 자식 프로세스는 직접 종료하지 않으며 존재하는 동안 다음 계산도 막는다.
            if not expired or (pid is not None and process_alive(pid)) or (pid is None and confirm_stopped != directory.name):
                blocked.append(directory.name)
                continue
            self.store.transition(directory.name, 'interrupted', 'WORKER_INTERRUPTED')
        return blocked

    @staticmethod
    def stop_child(child):
        if child.poll() is None:
            child.terminate()
            try:
                child.wait(timeout=2)
            except subprocess.TimeoutExpired:
                child.kill()
                child.wait(timeout=5)

    def execute(self, request_id):
        size, _ = self.store.check_capacity()
        original = self.store.request(request_id)
        from runner import canonical
        reserve = len(canonical(original).encode('utf-8')) + 2 * POLICY['maximumResultBytes'] + POLICY['maximumMetadataBytes'] * 4
        require(size + reserve <= POLICY['maximumStoreBytes'], 'STORE_FULL', '계산 결과를 안전하게 보관할 여유가 부족합니다. 완료 작업을 먼저 정리해 주세요.')
        request = self.store.admit(request_id)
        status = self.store.status(request_id)
        if status['state'] in TERMINAL:
            return status
        require(status['state'] == 'queued', 'RECOVERY_REQUIRED', '기존 실행 결과를 먼저 복구해야 합니다.')
        if self.store.cancelled(request_id):
            return self.store.transition(request_id, 'cancelled', 'CANCELLED')
        directory = self.store.path(request_id)
        temporary = directory / f'.engine.{uuid.uuid4()}.json'
        manifest = self.store.manifest(request_id)
        require(manifest['deadlineAt'] is None, 'RECOVERY_REQUIRED')
        duration = request['options']['maxSeconds'] + POLICY['hardTimeoutGraceSeconds']
        manifest['deadlineAt'] = (datetime.now(timezone.utc) + timedelta(seconds=duration)).isoformat(timespec='milliseconds').replace('+00:00', 'Z')
        atomic_json(directory / 'manifest.json', manifest)
        self.store.transition(request_id, 'running')
        self.heartbeat('busy', request_id, force=True)
        child = None
        started = time.monotonic()
        try:
            # stdin/출력/로그를 상속하지 않는다. 키와 교사 자료가 터미널에 노출되지 않는다.
            child = subprocess.Popen([sys.executable, str(ENGINE), '--input', str(directory / 'request.snapshot.json'), '--output', str(temporary)],
                                     stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                     creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0),
                                     env={**os.environ, 'PYTHONUTF8': '1', 'PYTHONIOENCODING': 'utf-8'})
            manifest['processId'] = child.pid
            atomic_json(directory / 'manifest.json', manifest)
            while child.poll() is None:
                self.heartbeat('busy', request_id)
                if self.store.cancelled(request_id):
                    self.store.transition(request_id, 'cancel_requested', 'CANCEL_REQUESTED')
                    self.stop_child(child)
                    return self.store.transition(request_id, 'cancelled', 'CANCELLED')
                if time.monotonic() - started >= duration:
                    self.stop_child(child)
                    return self.store.transition(request_id, 'timed_out', 'HARD_TIMEOUT')
                if temporary.exists():
                    no_link(temporary)
                    if temporary.stat().st_size > POLICY['maximumResultBytes']:
                        self.stop_child(child)
                        return self.store.transition(request_id, 'failed', 'RESULT_TOO_LARGE')
                time.sleep(POLICY['pollIntervalMilliseconds'] / 1000)
            if self.store.cancelled(request_id):
                return self.store.transition(request_id, 'cancelled', 'CANCELLED')
            require(child.returncode == 0, 'ENGINE_EXITED', '계산 프로세스가 정상적으로 끝나지 않았습니다.')
            result = validate_result(request, read_json(temporary, POLICY['maximumResultBytes']))
            # 마지막까지 원본/요청 번호를 재대조한다. 결과 파일을 닫고 난 뒤 완료 상태를 공개한다.
            require(self.store.request(request_id) == request and self.store.request(request_id, snapshot=True) == request, 'REQUEST_CONFLICT')
            atomic_json(directory / 'result.json', result, exclusive=True)
            return self.store.transition(request_id, 'succeeded')
        except JobError as error:
            if child is not None:
                self.stop_child(child)
            return self.store.transition(request_id, 'failed', error.code)
        except (KeyboardInterrupt, SystemExit):
            if child is not None:
                self.stop_child(child)
            self.store.transition(request_id, 'interrupted', 'WORKER_INTERRUPTED')
            raise
        except OSError:
            if child is not None:
                self.stop_child(child)
            return self.store.transition(request_id, 'failed', 'ENGINE_START_FAILED')
        finally:
            temporary.unlink(missing_ok=True)
            self.heartbeat('ready', force=True)

    def run(self, once=False):
        with self.store.lock():
            try:
                self.heartbeat(force=True)
                while True:
                    # 대기 한도가 넘은 경우에도 사용자가 취소하여 줄일 수 있어야 한다.
                    for directory in self.store.directories():
                        if (directory / 'ready.json').exists() and (directory / 'cancel.json').exists():
                            status = self.store.status(directory.name)
                            if status is None or status['state'] == 'queued':
                                self.store.request(directory.name)
                                if self.store.cancelled(directory.name):
                                    self.store.transition(directory.name, 'cancelled', 'CANCELLED')
                    self.store.check_capacity()
                    blocked = self.reconcile()
                    if blocked:
                        self.heartbeat('busy', blocked[0], force=True)
                        if once:
                            raise JobError('RECOVERY_REQUIRED', '이전 계산의 종료를 아직 확인하지 못했습니다. 자동 재실행하지 않습니다.')
                        time.sleep(POLICY['pollIntervalMilliseconds'] / 1000)
                        continue
                    jobs = []
                    for directory in self.store.directories():
                        if not (directory / 'ready.json').exists():
                            continue  # 브라우저가 request.json을 닫는 도중에는 읽지 않는다.
                        marker = self.store.marker(directory.name)
                        status = self.store.status(directory.name)
                        if status is None or status['state'] == 'queued':
                            jobs.append((marker['queuedAt'], directory.name))
                    if jobs:
                        self.execute(min(jobs)[1])
                    else:
                        self.heartbeat()
                    if once:
                        break
                    time.sleep(POLICY['pollIntervalMilliseconds'] / 1000)
            finally:
                self.heartbeat('stopped', force=True)
