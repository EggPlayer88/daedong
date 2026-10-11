"""JSON 입력/출력의 로컬 CLI. 운영 서비스 설정이나 DB를 변경하지 않는다."""

import argparse
import json
import sys
sys.stdin.reconfigure(encoding="utf-8")
sys.stdout.reconfigure(encoding="utf-8")
sys.stderr.reconfigure(encoding="utf-8")

from engine.solver import solve_timetable


def main():
    parser = argparse.ArgumentParser(description="하드조건을 준수하는 시간표 후보 생성")
    parser.add_argument("--input", help="시간표 문제 JSON. 생략하면 표준입력")
    parser.add_argument("--options", help="탐색 옵션 JSON 파일")
    parser.add_argument("--output", help="결과 JSON 파일. 생략하면 표준출력")
    parser.add_argument("--progress", action="store_true", help="진행 상황을 표준에러로 출력")
    args = parser.parse_args()
    try:
        if args.input:
            with open(args.input, encoding="utf-8-sig") as stream:
                problem = json.load(stream)
        else:
            problem = json.load(sys.stdin)
        options = {}
        if args.options:
            with open(args.options, encoding="utf-8-sig") as stream:
                options = json.load(stream)
        progress = (lambda row: print(json.dumps(row, ensure_ascii=False), file=sys.stderr, flush=True)) if args.progress else None
        result = solve_timetable(problem, options, progress)
        text = json.dumps(result, ensure_ascii=False, indent=2, allow_nan=False)
        if args.output:
            with open(args.output, "w", encoding="utf-8") as stream:
                stream.write(text + "\n")
        else:
            print(text)
        return 0 if result["status"] == "feasible" else 2
    except (OSError, ValueError) as exc:
        print(json.dumps({"status": "invalid_input", "candidates": [], "diagnostics": [str(exc)]}, ensure_ascii=False))
        return 2
    except Exception as exc:
        print(json.dumps({"status": "internal_error", "candidates": [], "diagnostics": [str(exc)]}, ensure_ascii=False))
        return 1


if __name__ == "__main__":
    sys.exit(main())
