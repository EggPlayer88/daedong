#!/usr/bin/env python3
"""독점 JSON 게시·원본 보존·Windows 후속 교체를 실제 임시파일로 확인한다."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
from types import SimpleNamespace
from unittest.mock import patch

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / 'packages/timetable/engine'))
import jobs_runtime as runtime
from jobs_contract import JobError


def wait_until(predicate, seconds=15):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        if predicate():
            return
        time.sleep(0.01)
    raise AssertionError('독점 게시 시험의 동기화 대기 시간 초과')


def contender():
    target, identity, directory = Path(sys.argv[2]), sys.argv[3], Path(sys.argv[4])
    (directory / f'ready-{identity}').write_text('ready')
    wait_until(lambda: (directory / 'start').exists())
    value = {'writer': identity, 'payload': identity * 10000}
    try:
        runtime.atomic_json(target, value, exclusive=True)
        result = {'writer': identity, 'state': 'published'}
    except JobError as error:
        result = {'writer': identity, 'state': error.code}
    print(json.dumps(result))


def assert_clean(directory, *names):
    assert {path.name for path in directory.iterdir()} == set(names)


def assert_conflict(action):
    try:
        action()
    except JobError as error:
        assert error.code == 'REQUEST_CONFLICT', error.code
    else:
        raise AssertionError('기존 원본을 덮어썼습니다.')


def publication_then_replacement(directory):
    for index in range(100):
        target = directory / f'manifest-{index}.json'
        original = {'requestId': str(index), 'text': '합성 원본', 'data': 'x' * 360}
        runtime.atomic_json(target, original, exclusive=True)
        assert json.loads(target.read_text(encoding='utf-8')) == original
        updated = {**original, 'deadlineAt': '2026-11-25T00:00:00.000Z'}
        runtime.atomic_json(target, updated)
        assert json.loads(target.read_text(encoding='utf-8')) == updated
    assert len(list(directory.iterdir())) == 100


def existing_original(directory):
    target = directory / 'request.json'
    original = b'{"original":"keep exact bytes"}\n'
    target.write_bytes(original)
    assert_conflict(lambda: runtime.atomic_json(target, {'original': 'changed'}, exclusive=True))
    assert target.read_bytes() == original
    assert_clean(directory, target.name)


def concurrent_publication(directory):
    target = directory / 'request.json'
    children = [subprocess.Popen([sys.executable, str(Path(__file__).resolve()), '--contender', str(target), str(index), str(directory)],
                                 stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
                                 encoding='utf-8', creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
                for index in range(6)]
    try:
        wait_until(lambda: all((directory / f'ready-{index}').exists() for index in range(6)))
        (directory / 'start').write_text('start')
        observed = []

        def finished():
            if target.exists():
                content = target.read_bytes()
                parsed = json.loads(content)
                assert parsed['payload'] == parsed['writer'] * 10000
                observed.append(content)
            return all(child.poll() is not None for child in children)

        wait_until(finished)
        results = []
        for child in children:
            stdout, stderr = child.communicate(timeout=5)
            assert child.returncode == 0, stderr
            results.append(json.loads(stdout))
        winners = [result for result in results if result['state'] == 'published']
        assert len(winners) == 1, results
        assert sum(result['state'] == 'REQUEST_CONFLICT' for result in results) == 5, results
        final = target.read_bytes()
        assert json.loads(final)['writer'] == winners[0]['writer']
        assert observed and all(value == final for value in observed)
        assert not list(directory.glob('.*.tmp'))
    finally:
        for child in children:
            if child.poll() is None:
                child.kill()
            child.communicate(timeout=5)


def failed_write(directory):
    target = directory / 'request.json'
    error = OSError(28, '합성 저장 실패')
    with patch.object(runtime.os, 'fsync', side_effect=error):
        try:
            runtime.atomic_json(target, {'partial': 'never public'}, exclusive=True)
        except OSError as caught:
            assert caught is error
        else:
            raise AssertionError('저장 실패를 성공으로 공개했습니다.')
    assert_clean(directory)


def denied_publication(directory):
    target = directory / 'request.json'
    error = PermissionError(13, '합성 접근 거부')
    method = 'rename' if os.name == 'nt' else 'link'
    with patch.object(runtime.os, method, side_effect=error) as publish:
        try:
            runtime.atomic_json(target, {'value': 'new'}, exclusive=True)
        except OSError as caught:
            assert caught is error
        else:
            raise AssertionError('접근 거부를 성공으로 바꿨습니다.')
        assert publish.call_count == 1
    assert_clean(directory)


def denied_replacement(directory):
    target = directory / 'status.json'
    target.write_bytes(b'{"state":"original"}\n')
    original = target.read_bytes()
    error = PermissionError(13, '합성 교체 거부')
    with patch.object(runtime.os, 'replace', side_effect=error) as replace:
        try:
            runtime.atomic_json(target, {'state': 'new'})
        except OSError as caught:
            assert caught is error
        else:
            raise AssertionError('교체 실패를 숨겼습니다.')
        assert replace.call_count == 1
    assert target.read_bytes() == original
    assert_clean(directory, target.name)


def posix_exclusive(directory):
    target = directory / 'request.json'
    # Windows에서도 POSIX 분기는 실제 hardlink로 실행하며 전역 os.name은 바꾸지 않는다.
    isolated_os = SimpleNamespace(name='posix', link=os.link, fsync=os.fsync,
                                  rename=lambda *_: (_ for _ in ()).throw(AssertionError('POSIX rename은 원본을 덮어쓸 수 있습니다.')))
    with patch.object(runtime, 'os', isolated_os):
        runtime.atomic_json(target, {'value': 'original'}, exclusive=True)
        original = target.read_bytes()
        assert_conflict(lambda: runtime.atomic_json(target, {'value': 'changed'}, exclusive=True))
    assert target.read_bytes() == original
    assert_clean(directory, target.name)


def windows_branch(directory):
    target = directory / 'request.json'
    calls = []

    def no_replace(source, destination):
        calls.append((source, destination))
        # Linux CI의 분기 선택 회귀다. 실제 Windows rename 검증은 위 파일·경합 시험이 맡는다.
        os.link(source, destination)
        source.unlink()

    def forbidden(*_):
        raise AssertionError('Windows 독점 게시에서 link/replace를 호출했습니다.')

    isolated_os = SimpleNamespace(name='nt', rename=no_replace, link=forbidden, replace=forbidden, fsync=os.fsync)
    with patch.object(runtime, 'os', isolated_os):
        runtime.atomic_json(target, {'value': 'original'}, exclusive=True)
        original = target.read_bytes()
        assert_conflict(lambda: runtime.atomic_json(target, {'value': 'changed'}, exclusive=True))
    assert len(calls) == 2
    assert target.read_bytes() == original
    assert_clean(directory, target.name)


def blocked_link(directory, kind):
    target = directory / 'request.json'
    target.write_bytes(b'original')
    blocked = directory if kind == 'parent' else target
    real_lstat = Path.lstat

    def with_reparse(path, *args, **kwargs):
        value = real_lstat(path, *args, **kwargs)
        return SimpleNamespace(st_mode=value.st_mode, st_file_attributes=1024) if path == blocked else value

    # Windows 링크 생성 권한에 의존하지 않고 OS의 reparse 속성 응답만 주입한다.
    with patch.object(Path, 'lstat', with_reparse):
        try:
            runtime.atomic_json(target, {'value': 'changed'}, exclusive=True)
        except JobError as error:
            assert error.code == 'UNSAFE_PATH'
        else:
            raise AssertionError('링크 경로를 허용했습니다.')
    assert target.read_bytes() == b'original'
    assert_clean(directory, target.name)


def main():
    checks = [
        ('독점 생성 직후 교체 100회가 완전한 JSON과 단일 파일을 유지한다', publication_then_replacement),
        ('기존 원본은 독점 게시 충돌에도 정확한 bytes를 보존한다', existing_original),
        ('여섯 동시 작성자 중 한 개만 게시하고 부분 JSON·덮어쓰기가 없다', concurrent_publication),
        ('닫기 전 저장 실패는 공개 파일과 임시 파일을 남기지 않는다', failed_write),
        ('게시 권한 오류는 재시도·복사 없이 원래 예외를 반환한다', denied_publication),
        ('일반 교체 실패는 기존 bytes와 원래 예외를 보존한다', denied_replacement),
        ('POSIX 독점 게시도 기존 원본과 충돌 거부를 유지한다', posix_exclusive),
        ('모의 Windows 분기는 덮어쓰기 없는 rename만 선택한다', windows_branch),
        ('대상 reparse 링크는 원본 변경 전에 거부한다', lambda directory: blocked_link(directory, 'target')),
        ('상위 reparse 링크는 원본 변경 전에 거부한다', lambda directory: blocked_link(directory, 'parent')),
    ]
    failures = []
    for name, action in checks:
        try:
            with tempfile.TemporaryDirectory(prefix='timetable-atomic-') as temporary:
                action(Path(temporary))
            print(f'  ✓ {name}', flush=True)
        except Exception as error:
            failures.append(name)
            print(f'  ✗ {name}: {type(error).__name__}: {error}', flush=True)
    if failures:
        raise SystemExit(1)
    print(f'전부 통과 ({len(checks)}건)')


if __name__ == '__main__':
    if len(sys.argv) > 1 and sys.argv[1] == '--contender':
        contender()
    else:
        main()
