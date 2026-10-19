"""로컬 시간표 작업 CLI. HTTP 서버·인증·DB 연결을 열지 않는다."""
import argparse
import json
from pathlib import Path
import sys

from jobs_contract import JobError, POLICY, require
from jobs_runtime import JobStore, read_json
from jobs_worker import LocalWorker
import runner


def main():
    parser = argparse.ArgumentParser(description='시간표 전용 로컬 작업 폴더')
    sub = parser.add_subparsers(dest='command', required=True)
    for name in ('init', 'work', 'submit', 'status', 'cancel', 'result', 'recover', 'cleanup'):
        command = sub.add_parser(name)
        command.add_argument('--store', required=True)
        if name == 'work':
            command.add_argument('--once', action='store_true', help='최대 작업 하나를 처리하고 종료')
        elif name == 'submit':
            command.add_argument('--input', required=True)
        elif name in ('status', 'cancel', 'result'):
            command.add_argument('--request-id', required=True)
        elif name == 'recover':
            command.add_argument('--confirm-stopped', help='PID 미기록 또는 생성 토큰으로 PID 재사용을 확인한 작업의 실제 종료를 사용자가 확인한 UUID')
        elif name == 'cleanup':
            command.add_argument('--apply', action='store_true', help='미리보기 뒤 적용: 완료 작업 삭제, 1시간 지난 미접수 파일은 원본 보존 격리')
            command.add_argument('--request-id', help='직접 선택한 완료 작업은 보관기간 전 정리; 미접수 파일은 최소 1시간 경과 필수')
    args = parser.parse_args()
    try:
        store = JobStore.initialize(args.store) if args.command == 'init' else JobStore(args.store)
        if args.command == 'init':
            result = store.queue
        elif args.command == 'work':
            LocalWorker(store).run(args.once)
            result = {'state': 'stopped'}
        elif args.command == 'submit':
            # CLI 접수끼리의 충돌은 원본 배타 생성으로 막는다. 실행 중 작업자를 멈추지 않는다.
            request = read_json(Path(args.input), runner.POLICY['maximumRequestBytes'])
            result = {'requestId': request.get('requestId'), 'status': store.submit(request)}
        elif args.command == 'status':
            store.marker(args.request_id)
            result = store.status(args.request_id)
        elif args.command == 'cancel':
            result = {'status': store.cancel(args.request_id), 'cancelRequested': True}
        elif args.command == 'result':
            result = store.result(args.request_id)
        elif args.command == 'recover':
            if args.confirm_stopped is not None:
                store.path(args.confirm_stopped)
            with store.lock():
                result = {'blockedRequestIds': LocalWorker(store).reconcile(args.confirm_stopped)}
        else:
            with store.lock():
                result = store.cleanup(args.apply, args.request_id)
        print(json.dumps(result, ensure_ascii=False, allow_nan=False))
        return 0
    except JobError as error:
        print(json.dumps({'error': {'code': error.code, 'message': str(error)}}, ensure_ascii=False))
        return 1
    except KeyboardInterrupt:
        return 130
    except OSError:
        print(json.dumps({'error': {'code': 'FILE_ACCESS_FAILED', 'message': '전용 작업 폴더의 읽기·쓰기 권한을 확인해 주세요.'}}, ensure_ascii=False))
        return 1


if __name__ == '__main__':
    sys.exit(main())
