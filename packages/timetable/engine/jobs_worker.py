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


def process_identity(pid):
    """PID 재사용을 구별할 생성 토큰만 읽는다. 확인 불가 시 추측하지 않는다."""
    if sys.platform.startswith('linux'):
        try:
            fields = Path(f'/proc/{pid}/stat').read_text().rsplit(')', 1)[1].strip().split()
            boot = Path('/proc/sys/kernel/random/boot_id').read_text().strip()
            return f'linux:{boot}:{fields[19]}'
        except (OSError, IndexError):
            return None
    if os.name == 'nt':
        import ctypes
        from ctypes import wintypes
        kernel = ctypes.WinDLL('kernel32', use_last_error=True)
        kernel.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
        kernel.OpenProcess.restype = wintypes.HANDLE
        kernel.GetProcessTimes.argtypes = [wintypes.HANDLE, *([ctypes.POINTER(wintypes.FILETIME)] * 4)]
        kernel.CloseHandle.argtypes = [wintypes.HANDLE]
        handle = kernel.OpenProcess(0x1000, False, pid)
        if not handle:
            return None
        try:
            values = [wintypes.FILETIME() for _ in range(4)]
            if not kernel.GetProcessTimes(handle, *(ctypes.byref(value) for value in values)):
                return None
            return f'windows:{(values[0].dwHighDateTime << 32) | values[0].dwLowDateTime}'
        finally:
            kernel.CloseHandle(handle)
    return None


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
        self.recovery_required = set()

    def heartbeat(self, state='ready', request_id=None, force=False):
        if force or time.monotonic() - self.last_heartbeat >= POLICY['heartbeatIntervalMilliseconds'] / 1000:
            try:
                atomic_json(self.store.root / 'worker.json', dict(contract=CONTRACT, queueId=self.store.queue['queueId'], workerId=self.worker_id,
                            state=state, updatedAt=now(), activeRequestId=request_id))
                self.last_heartbeat = time.monotonic()
            except (JobError, OSError):
                # 알림 파일 하나의 기록 실패로 계산·복구 감독까지 종료하지 않는다.
                return False
        return True

    def reconcile(self, confirm_stopped=None):
        """접수증을 복원하되 실행을 추측해서 다시 시작하지 않는다. 호출자는 작업자 잠금을 보유한다."""
        blocked = list(self.recovery_required)
        for directory in self.store.directories():
            manifest = None
            try:
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
                alive = pid is not None and process_alive(pid)
                recorded_identity = manifest.get('processIdentity')
                current_identity = process_identity(pid) if alive else None
                reused = alive and recorded_identity is not None and current_identity is not None and recorded_identity != current_identity
                # 죽은 작업자가 남긴 자식 프로세스는 직접 종료하지 않으며 존재하는 동안 다음 계산도 막는다.
                if not expired or (alive and not (reused and confirm_stopped == directory.name)) or (pid is None and confirm_stopped != directory.name):
                    blocked.append(directory.name)
                    continue
                self.store.transition(directory.name, 'interrupted', 'WORKER_INTERRUPTED')
            except (JobError, OSError):
                if manifest is None or manifest['deadlineAt'] is not None:
                    blocked.append(directory.name)
        return sorted(set(blocked))

    def cancellation(self, request_id):
        """파일 존재만으로 취소하지 않는다. 브라우저가 닫기 전/깨진 표식은 미확인이다."""
        try:
            return self.store.cancelled(request_id)
        except (JobError, OSError):
            return None

    @staticmethod
    def stop_child(child):
        try:
            if child.poll() is None:
                child.terminate()
                try:
                    child.wait(timeout=2)
                except subprocess.TimeoutExpired:
                    child.kill()
                    child.wait(timeout=5)
            return child.poll() is not None
        except (OSError, subprocess.TimeoutExpired):
            # kill 이후에도 종료 확인이 안 되면 완료 접수증과 다음 계산을 허용하지 않는다.
            return False

    def safe_status(self, request_id):
        try:
            return self.store.status(request_id)
        except (JobError, OSError):
            return None

    def finish(self, request_id, state, code=None):
        try:
            return self.store.transition(request_id, state, code)
        except (JobError, OSError):
            self.recovery_required.add(request_id)
            return self.safe_status(request_id)

    def stop_or_block(self, request_id, child):
        if child is None or self.stop_child(child):
            return True
        self.recovery_required.add(request_id)
        return False

    def execute(self, request_id):
        child = None
        temporary = None
        try:
            # 취소 표식의 폴더·요청 번호·해시는 그대로 검증하되,
            # 실행할 필요 없는 원본의 내용 오류나 저장 한도가 취소를 막지 않게 한다.
            status = self.store.status(request_id)
            if status and status['state'] in TERMINAL:
                return status
            require(status is None or status['state'] == 'queued', 'RECOVERY_REQUIRED', '기존 실행 결과를 먼저 복구해야 합니다.')
            cancellation = self.cancellation(request_id)
            if cancellation is None:
                return status
            if cancellation:
                return self.finish(request_id, 'cancelled', 'CANCELLED')
            size, _ = self.store.check_capacity(enforce_pending=False)
            original = self.store.request(request_id)
            from runner import canonical
            reserve = len(canonical(original).encode('utf-8')) + 2 * POLICY['maximumResultBytes'] + POLICY['maximumMetadataBytes'] * 4
            require(size + reserve <= POLICY['maximumStoreBytes'], 'STORE_FULL', '계산 결과를 안전하게 보관할 여유가 부족합니다. 완료 작업을 먼저 정리해 주세요.')
            request = self.store.admit(request_id)
            directory = self.store.path(request_id)
            temporary = directory / f'.engine.{uuid.uuid4()}.json'
            manifest = self.store.manifest(request_id)
            require(manifest['deadlineAt'] is None, 'RECOVERY_REQUIRED')
            duration = request['options']['maxSeconds'] + POLICY['hardTimeoutGraceSeconds']
            manifest['deadlineAt'] = (datetime.now(timezone.utc) + timedelta(seconds=duration)).isoformat(timespec='milliseconds').replace('+00:00', 'Z')
            atomic_json(directory / 'manifest.json', manifest)
            self.store.transition(request_id, 'running')
            self.heartbeat('busy', request_id, force=True)
            started = time.monotonic()
            # stdin/출력/로그를 상속하지 않는다. 키와 교사 자료가 터미널에 노출되지 않는다.
            child = subprocess.Popen([sys.executable, str(ENGINE), '--input', str(directory / 'request.snapshot.json'), '--output', str(temporary)],
                                     stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                     creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0),
                                     env={**os.environ, 'PYTHONUTF8': '1', 'PYTHONIOENCODING': 'utf-8'})
            manifest['processId'] = child.pid
            manifest['processIdentity'] = process_identity(child.pid)
            atomic_json(directory / 'manifest.json', manifest)
            while child.poll() is None:
                self.heartbeat('busy', request_id)
                if self.cancellation(request_id) is True:
                    self.store.transition(request_id, 'cancel_requested', 'CANCEL_REQUESTED')
                    if not self.stop_or_block(request_id, child):
                        return self.safe_status(request_id)
                    return self.finish(request_id, 'cancelled', 'CANCELLED')
                if time.monotonic() - started >= duration:
                    if not self.stop_or_block(request_id, child):
                        return self.safe_status(request_id)
                    return self.finish(request_id, 'timed_out', 'HARD_TIMEOUT')
                if temporary.exists():
                    no_link(temporary)
                    if temporary.stat().st_size > POLICY['maximumResultBytes']:
                        if not self.stop_or_block(request_id, child):
                            return self.safe_status(request_id)
                        return self.finish(request_id, 'failed', 'RESULT_TOO_LARGE')
                time.sleep(POLICY['pollIntervalMilliseconds'] / 1000)
            if self.cancellation(request_id) is True:
                return self.finish(request_id, 'cancelled', 'CANCELLED')
            require(child.returncode == 0, 'ENGINE_EXITED', '계산 프로세스가 정상적으로 끝나지 않았습니다.')
            result = validate_result(request, read_json(temporary, POLICY['maximumResultBytes']))
            # 마지막까지 원본/요청 번호를 재대조한다. 결과 파일을 닫고 난 뒤 완료 상태를 공개한다.
            require(self.store.request(request_id) == request and self.store.request(request_id, snapshot=True) == request, 'REQUEST_CONFLICT')
            atomic_json(directory / 'result.json', result, exclusive=True)
            return self.finish(request_id, 'succeeded')
        except JobError as error:
            if not self.stop_or_block(request_id, child):
                return self.safe_status(request_id)
            return self.finish(request_id, 'failed', error.code)
        except (KeyboardInterrupt, SystemExit):
            if self.stop_or_block(request_id, child):
                self.finish(request_id, 'interrupted', 'WORKER_INTERRUPTED')
            raise
        except OSError:
            if not self.stop_or_block(request_id, child):
                return self.safe_status(request_id)
            return self.finish(request_id, 'failed', 'ENGINE_START_FAILED')
        finally:
            if temporary is not None and request_id not in self.recovery_required:
                try:
                    temporary.unlink(missing_ok=True)
                except OSError:
                    pass  # 알려진 임시 결과는 명시 cleanup까지 보존해도 된다.
            self.heartbeat('busy' if request_id in self.recovery_required else 'ready', request_id if request_id in self.recovery_required else None, force=True)

    def run(self, once=False):
        with self.store.lock():
            try:
                self.heartbeat(force=True)
                while True:
                    # 대기 한도가 넘은 경우에도 사용자가 취소하여 줄일 수 있어야 한다.
                    for directory in self.store.directories():
                        if (directory / 'ready.json').exists() and (directory / 'cancel.json').exists():
                            try:
                                status = self.store.status(directory.name)
                                if (status is None or status['state'] == 'queued') and self.cancellation(directory.name) is True:
                                    self.store.transition(directory.name, 'cancelled', 'CANCELLED')
                            except (JobError, OSError):
                                continue  # 닫히지 않았거나 깨진 표식으로 접수증을 만들어내지 않는다.
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
                        try:
                            marker = self.store.marker(directory.name)
                            status = self.store.status(directory.name)
                            if self.cancellation(directory.name) is None:
                                continue
                            if status is None or status['state'] == 'queued':
                                jobs.append((marker['queuedAt'], directory.name))
                        except (JobError, OSError):
                            continue  # 다른 정상 요청은 계속 처리하고 다음 감시에서 다시 읽는다.
                    if jobs:
                        jobs.sort()
                        # 외부 도구가 한도를 넘겨 썼어도 먼저 접수한 정상 작업을 희생하지 않는다.
                        for _, excess_id in jobs[POLICY['maximumPendingJobs']:]:
                            self.finish(excess_id, 'failed', 'QUEUE_FULL')
                        try:
                            if not self.recovery_required:
                                self.execute(jobs[0][1])
                        except (JobError, OSError):
                            # 검사 뒤 표식이 바뀌었으면 오류 접수증도 꾸미지 않고 다시 조회한다.
                            pass
                    else:
                        self.heartbeat()
                    if once:
                        require(not self.recovery_required, 'RECOVERY_REQUIRED', '종료 또는 상태 기록을 확인하지 못했습니다. 다음 계산 전에 복구해 주세요.')
                        break
                    time.sleep(POLICY['pollIntervalMilliseconds'] / 1000)
            finally:
                self.heartbeat('stopped', force=True)
