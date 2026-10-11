"""동일한 새 평가표로 v1과 새 엔진을 비교한다. 성능은 CI 합격 조건으로 쓰지 않는다."""

import argparse
from pathlib import Path
import json
import subprocess
import time

from engine.model import normalize, inspect_schedule
from engine.quality import read_quality, evaluate_quality
from engine.solver import ScheduleModel, parse_options, solve_timetable

HERE = Path(__file__).resolve().parent

LEGACY = r"""
import {execFileSync} from 'node:child_process';
const read=p=>execFileSync('git',['show','origin/v1-final:'+p],{encoding:'utf8'});
const url=s=>'data:text/javascript;base64,'+Buffer.from(s).toString('base64');
const du=url(read('src/lib/timetableData.js'));const D=await import(du);
const S=await import(url(read('src/lib/solver.js').replace("'./timetableData.js'",JSON.stringify(du))));
let seed=Number(process.argv[1]);Math.random=()=>((seed=(1664525*seed+1013904223)>>>0)/4294967296);
const L=S.buildLessons();let answer=null,start=Date.now(),attempt=0;
for(attempt=1;attempt<=50;attempt++){const r=S.cpSolve(L,120000);if(r.success){S.localSearch(L,r.asgn,4000);answer=r.asgn;break;}}
const placements=[];
if(answer){
 for(const t of D.TCH)for(const a of t.as){
  const group=L.filter(l=>l.tid===t.id&&l.cid===a.c&&l.sid===a.s);
  let k=0,i=0;
  while(k<group.length){
   const l=group[k],pos=D.decS(answer[l.id]);
   placements.push({unitId:[t.id,a.c,a.s].join('-')+'@'+i++,day:D.DAYS[pos.d],start:pos.p});
   if(l.blkNext!=null){while(group[k].blkNext!=null)k++;}
   k++;
  }
 }
}
console.log(JSON.stringify({success:!!answer,attempts:Math.min(attempt,50),elapsedSeconds:(Date.now()-start)/1000,placements}));
"""


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--seconds", type=float, default=180)
    parser.add_argument("--workers", type=int, default=8)
    parser.add_argument("--seeds", default="1,2,3")
    parser.add_argument("--legacy-compatible", action="store_true", help="원어민·창체 확인 이전 입력의 기록 재현용")
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    raw = json.loads((HERE / "_assets/school-2026-2.json").read_text(encoding="utf-8"))
    if args.legacy_compatible:
        raw["teachers"] = [t for t in raw["teachers"] if t["id"] != "native-1"]
        for lesson in raw["lessons"]:
            lesson["teacherIds"] = [t for t in lesson["teacherIds"] if t != "native-1"]
        for reservation in raw["reservations"]:
            reservation["teacherIds"] = []
        raw["metadata"]["notes"] = ["확인 이전 v1 호환 입력의 비교 전용. 실제 학교 시간표로 사용하지 않음."]
    overrides = {"weights": {"blockBreakCrossing": 0}} if args.legacy_compatible else None
    q = read_quality(overrides); p = normalize(raw, q)
    sm = ScheduleModel(p, q, parse_options(p, {}))
    report = {"source": raw["metadata"]["source"], "qualityPolicy": q, "modelNotes": raw["metadata"]["notes"],
              "mode": "legacy_compatible" if args.legacy_compatible else "confirmed_school",
              "method": "두 엔진의 결과를 동일한 하드조건·품질 평가표로 재검증. 99점으로 환산하지 않음.", "runs": []}
    for seed in map(int, args.seeds.split(",")):
        legacy = subprocess.run(["node", "--input-type=module", "-e", LEGACY, str(seed)], cwd=HERE.parents[1], capture_output=True, text=True, encoding="utf-8", check=True)
        before = json.loads(legacy.stdout)
        old = {"success": before["success"], "attempts": before["attempts"], "elapsedSeconds": before["elapsedSeconds"]}
        if before["success"]:
            old["validation"] = inspect_schedule(p, before["placements"])
            old["evaluation"] = evaluate_quality(p, before["placements"], q, sm.baselines) if old["validation"]["valid"] else None
        print(f"seed={seed}: 원본 검증 완료", flush=True)
        after = solve_timetable(raw, {"timeLimitSeconds": args.seconds, "workers": args.workers, "seed": seed,
                                     "quality": overrides} if overrides else
                                    {"timeLimitSeconds": args.seconds, "workers": args.workers, "seed": seed})
        report["runs"].append({"seed": seed, "legacy": old, "improved": after})
        Path(args.output).write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"seed={seed}: 새 후보 {[c['evaluation']['totalPenalty'] for c in after['candidates']]}", flush=True)


if __name__ == "__main__":
    import sys
    sys.stdout.reconfigure(encoding="utf-8")
    main()
