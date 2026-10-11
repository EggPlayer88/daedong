"""같은 학교 조건·시간 예산으로 Git의 이전 엔진과 현재 탐색을 순차 비교한다."""

import argparse
import io
import json
from pathlib import Path
import platform
import statistics
import subprocess
import sys
import tarfile
import tempfile

import ortools

from engine.model import normalize, inspect_schedule
from engine.quality import read_quality, evaluate_quality
from engine.solver import ScheduleModel, parse_options

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
RUNNER = """
import json,sys,time
sys.stdout.reconfigure(encoding='utf-8')
sys.path.insert(0,sys.argv[1])
from engine.solver import solve_timetable
request=json.load(sys.stdin)
started=time.monotonic()
result=solve_timetable(request['problem'],request['options'])
result['wallSeconds']=time.monotonic()-started
print(json.dumps(result,ensure_ascii=False,allow_nan=False))
"""


def run(base, raw, options, p, q, baselines):
    completed = subprocess.run([sys.executable, "-c", RUNNER, str(base)],
                               input=json.dumps({"problem": raw, "options": options}, ensure_ascii=False),
                               capture_output=True, text=True, encoding="utf-8", check=True, cwd=ROOT)
    result = json.loads(completed.stdout)
    if result["qualityPolicy"] != q:
        raise ValueError("이전 엔진과 현재 엔진의 평가 정책이 다릅니다.")
    for candidate in result["candidates"]:
        validation = inspect_schedule(p, candidate["placements"])
        evaluation = evaluate_quality(p, candidate["placements"], q, baselines)
        if not validation["valid"] or evaluation != candidate["evaluation"]:
            raise ValueError("공통 하드조건·평가표 재검증에 실패했습니다.")
    return result


def main():
    parser = argparse.ArgumentParser(description="이전 Git 엔진과 현재 엔진의 동일 예산 품질 비교")
    parser.add_argument("--baseline-ref", required=True)
    parser.add_argument("--input", default=str(HERE / "_assets/school-2026-2.json"))
    parser.add_argument("--seconds", type=float, default=60)
    parser.add_argument("--workers", type=int, default=8)
    parser.add_argument("--seeds", default="1,2,3")
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    baseline_sha = subprocess.check_output(["git", "rev-parse", "--verify", args.baseline_ref + "^{commit}"],
                                           cwd=ROOT, text=True).strip()
    raw = json.loads(Path(args.input).read_text(encoding="utf-8-sig"))
    q = read_quality()
    p = normalize(raw, q)
    baselines = ScheduleModel(p, q, parse_options(p, {})).baselines
    report = {"baselineCommit": baseline_sha, "environment": {"python": platform.python_version(),
              "ortools": ortools.__version__, "platform": platform.system()}, "qualityPolicy": q,
              "method": "동일 입력·평가표·예산. 서로 다른 프로세스에서 순차 실행, 실행 순서 교대. 시간은 함수 호출부터 반환까지.",
              "runs": []}
    # Git에서 지정한 패키지 경로만 내보낸다. 작업 트리·운영 설정은 변경하지 않는다.
    archive = subprocess.check_output(["git", "archive", "--format=tar", baseline_sha,
                                       "packages/timetable/engine", "packages/timetable/_assets"], cwd=ROOT)
    with tempfile.TemporaryDirectory(prefix="timetable-compare-") as directory:
        with tarfile.open(fileobj=io.BytesIO(archive)) as source:
            source.extractall(directory, filter="data")
        bases = {"baseline": Path(directory) / "packages/timetable", "improved": HERE}
        for index, seed in enumerate(map(int, args.seeds.split(","))):
            row = {"seed": seed, "options": {"timeLimitSeconds": args.seconds, "workers": args.workers, "seed": seed}}
            for name in (("baseline", "improved") if index % 2 == 0 else ("improved", "baseline")):
                row[name] = run(bases[name], raw, row["options"], p, q, baselines)
                print(f"seed={seed} {name}: {[c['evaluation']['totalPenalty'] for c in row[name]['candidates']]}", flush=True)
            report["runs"].append(row)
            Path(args.output).write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    if report["runs"] and all(row[name]["candidates"] for row in report["runs"] for name in bases):
        means = {name: statistics.mean(row[name]["candidates"][0]["evaluation"]["totalPenalty"]
                                      for row in report["runs"]) for name in bases}
        report["summary"] = {"meanBestPenalty": means,
                             "penaltyReduction": None if means["baseline"] == 0 else 1 - means["improved"] / means["baseline"]}
    Path(args.output).write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main()
