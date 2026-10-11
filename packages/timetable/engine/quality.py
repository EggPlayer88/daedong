"""학교 규정이 아닌 조정 가능한 품질 평가표. 하드조건은 점수에 포함하지 않는다."""

from collections import Counter, defaultdict
from pathlib import Path
import json
import math

from .model import available, fields, integer, boolean, fail, hard_windows


ASSETS = Path(__file__).resolve().parents[1] / "_assets"
QUALITY_KEYS = ("subjectDaily", "subjectAdjacency", "teacherDailyLoad", "teacherGaps",
                "teacherConsecutive", "morningBalance", "lateSpread", "teacherFairness", "blockBreakCrossing")


def read_quality(raw=None):
    quality = json.loads((ASSETS / "quality-defaults.json").read_text(encoding="utf-8"))
    if raw is not None:
        fields(raw, set(quality), "quality")
        quality.update({k: v for k, v in raw.items() if k != "weights"})
        if "weights" in raw:
            fields(raw["weights"], QUALITY_KEYS, "quality.weights")
            quality["weights"].update(raw["weights"])
    integer(quality["preferredMaxConsecutive"], "quality.preferredMaxConsecutive")
    boolean(quality["consecutiveAcrossBreak"], "quality.consecutiveAcrossBreak")
    for key, value in quality["weights"].items():
        integer(value, "quality.weights." + key, 0)
        if value > 2**31 - 1:
            fail("INVALID_WEIGHT", "가중치는 솔버의 32비트 정수 범위여야 합니다.", "quality.weights." + key)
    return quality


def teacher_targets(problem):
    duty = Counter()
    for l in problem["lessons"]:
        for t in l["teacherIds"]:
            duty[t] += l["hours"]
    for r in problem["reservations"]:
        for t in r["teacherIds"]:
            duty[t] += 1
    result = {}
    for t, teacher in problem["teacherMap"].items():
        con = teacher.get("availability", {})
        slots = [(d["id"], p) for d in problem["days"] for p in range(1, d["periods"] + 1)
                 if available(problem, con, d["id"], p)]
        days = len({d for d, _ in slots})
        late = sum(p == problem["dayMap"][d]["periods"] for d, p in slots)
        result[t] = {"daily": math.ceil(duty[t] / max(1, days)),
                     "late": math.ceil(duty[t] * late / max(1, len(slots))), "duty": duty[t]}
    return result


def morning_baselines(problem, choices):
    # 처음부터 오후 전용인 주제선택 등을 오전·오후 불균형으로 벌주지 않는다.
    reachable = {}
    totals = Counter()
    for unit in problem["units"]:
        l = problem["lessonMap"][unit["lessonId"]]
        key = l["classId"], l["subjectId"]
        counts = [sum(p <= problem["morningEnd"] for p in range(start, start + unit["length"]))
                  for _, start in choices[unit["id"]]]
        reachable[key] = {a + b for a in reachable.get(key, {0}) for b in set(counts)}
        totals[key] += unit["length"]
    return {k: min(abs(2 * am - totals[k]) for am in values) for k, values in reachable.items()}


def evaluate_quality(problem, placements, quality, baselines):
    units = problem["unitMap"]
    sessions, subject_hours, morning = Counter(), Counter(), Counter()
    block_crossings = []
    busy = defaultdict(set)
    for place in placements:
        u = units[place["unitId"]]
        l = problem["lessonMap"][u["lessonId"]]
        key = l["classId"], l["subjectId"]
        crosses = sum(place["start"] <= boundary < place["start"] + u["length"] - 1
                      for boundary in set(problem["dayMap"][place["day"]].get("breaksAfter", [])))
        if crosses:
            block_crossings.append((crosses, u["id"], place["day"]))
        sessions[key + (place["day"],)] += 1
        subject_hours[key] += u["length"]
        for p in range(place["start"], place["start"] + u["length"]):
            morning[key] += p <= problem["morningEnd"]
            for t in l["teacherIds"]:
                busy[t, place["day"]].add(p)
    for r in problem["reservations"]:
        for t in r["teacherIds"]:
            busy[t, r["day"]].add(r["period"])
    raw = dict.fromkeys(QUALITY_KEYS, 0)
    issues = []
    def add(kind, amount, **details):
        raw[kind] += amount
        if amount:
            issues.append({"type": kind, "amount": amount, "penalty": amount * quality["weights"][kind], **details})
    for amount, uid, day in block_crossings:
        add("blockBreakCrossing", amount, unitId=uid, day=day)
    for (c, s, d), count in sessions.items():
        add("subjectDaily", count * (count - 1) // 2, classId=c, subjectId=s, day=d)
    day_ids = list(problem["dayMap"])
    for c, s in subject_hours:
        for a, b in zip(day_ids, day_ids[1:]):
            if sessions[c, s, a] and sessions[c, s, b]:
                add("subjectAdjacency", 1, classId=c, subjectId=s, days=[a, b])
        add("morningBalance", max(0, abs(2 * morning[c, s] - subject_hours[c, s]) - baselines[c, s]),
            classId=c, subjectId=s)
    targets = teacher_targets(problem)
    by_teacher = {}
    for t, teacher in problem["teacherMap"].items():
        personal = 0
        late = 0
        for d in problem["days"]:
            ps = busy[t, d["id"]]
            load = max(0, len(ps) - targets[t]["daily"]) ** 2
            gaps = sum(p not in ps and min(ps, default=999) < p < max(ps, default=0)
                       and available(problem, teacher.get("availability", {}), d["id"], p)
                       for p in range(1, d["periods"] + 1))
            consecutive = sum(all(p in ps for p in w) for w in hard_windows(problem, d["id"],
                              quality["preferredMaxConsecutive"] + 1, quality["consecutiveAcrossBreak"]))
            for kind, amount in [("teacherDailyLoad", load), ("teacherGaps", gaps), ("teacherConsecutive", consecutive)]:
                add(kind, amount, teacherId=t, day=d["id"])
                personal += amount * quality["weights"][kind]
            late += d["periods"] in ps
        amount = max(0, late - targets[t]["late"]) ** 2
        add("lateSpread", amount, teacherId=t)
        personal += amount * quality["weights"]["lateSpread"]
        by_teacher[t] = {"penalty": personal, "dutyHours": targets[t]["duty"]}
    raw["teacherFairness"] = max((x["penalty"] for x in by_teacher.values()), default=0)
    if raw["teacherFairness"]:
        issues.append({"type": "teacherFairness", "amount": raw["teacherFairness"],
                       "penalty": raw["teacherFairness"] * quality["weights"]["teacherFairness"]})
    breakdown = {k: {"amount": raw[k], "weight": quality["weights"][k],
                     "penalty": raw[k] * quality["weights"][k]} for k in QUALITY_KEYS}
    return {"totalPenalty": sum(x["penalty"] for x in breakdown.values()), "breakdown": breakdown,
            "teacherBurden": by_teacher, "weaknesses": sorted(issues, key=lambda x: x["penalty"], reverse=True)}
