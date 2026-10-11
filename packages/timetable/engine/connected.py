"""현재 배치의 이동을 막는 수업을 따라 부분 재최적화 영역을 만든다."""

from collections import Counter, defaultdict
import math


class MoveGraph:
    def __init__(self, sm, placements):
        self.sm = sm
        self.placed = {p["unitId"]: p for p in placements}
        self.lessons = {uid: sm.p["lessonMap"][sm.p["unitMap"][uid]["lessonId"]] for uid in self.placed}
        self.occupied = defaultdict(set)
        self.reserved = Counter()
        self.domains = {uid: set(sm.choices[uid]) for uid in self.placed}
        self.family = {uid: {uid} for uid in self.placed}
        for h in sm.p["hardConstraints"]:
            if h["type"] == "sameTime":
                linked = {uid for uid, lesson in self.lessons.items() if lesson["id"] in h["lessonIds"]}
                merged = set().union(*(self.family[uid] for uid in linked))
                for uid in merged:
                    self.family[uid] = merged
        self.selected = {(sm.representative[uid], p["day"], p["start"]) for uid, p in self.placed.items()}
        for uid, p in self.placed.items():
            for key in self.keys(uid, p["day"], p["start"]):
                self.occupied[key].add(uid)
        for r in sm.p["reservations"]:
            for kind, ids in (("class", [r["classId"]]), ("teacher", r["teacherIds"]), ("resource", r["resourceIds"])):
                for entity in ids:
                    self.reserved[kind, entity, r["day"], r["period"]] += 1

    def keys(self, uid, day, start):
        lesson = self.lessons[uid]
        for period in range(start, start + self.sm.p["unitMap"][uid]["length"]):
            yield "class", lesson["classId"], day, period
            for teacher in lesson["teacherIds"]:
                yield "teacher", teacher, day, period
            for resource in lesson["resourceIds"]:
                yield "resource", resource, day, period

    def blockers(self, uid, day, start):
        """동시수업 전체 목표를 검사한다. 예약 충돌은 이동으로 해제하지 않는다."""
        family = self.family[uid]
        if any((day, start) not in self.domains[member] for member in family):
            return None
        demand = Counter(key for member in family for key in self.keys(member, day, start))
        blocked = set()
        for key, amount in demand.items():
            capacity = self.sm.p["resourceMap"][key[1]]["capacity"] if key[0] == "resource" else 1
            if amount + self.reserved[key] > capacity:
                return None
            occupants = self.occupied[key] - family
            if len(occupants) + amount + self.reserved[key] > capacity:
                blocked.update(occupants)
        # 교시가 비어 있어도 하루 상한·요일 분리 때문에 움직여야 하는 수업을 함께 연다.
        for h in self.sm.p["hardConstraints"]:
            for member in family:
                lesson = self.lessons[member]
                if h["type"] == "differentDays" and lesson["id"] in h["lessonIds"]:
                    blocked.update(u for u, l in self.lessons.items() if l["id"] in h["lessonIds"] and self.placed[u]["day"] == day)
                if h["type"] == "maxDailyLoad" and h["teacherId"] in lesson["teacherIds"]:
                    blocked.update(u for u, l in self.lessons.items() if h["teacherId"] in l["teacherIds"] and self.placed[u]["day"] == day)
                if h["type"] == "subjectDailyLimit" and (h["classId"], h["subjectId"]) == (lesson["classId"], lesson["subjectId"]):
                    blocked.update(u for u, l in self.lessons.items() if (l["classId"], l["subjectId"]) == (lesson["classId"], lesson["subjectId"]) and self.placed[u]["day"] == day)
        return set().union(*(self.family[u] for u in blocked), family)


def connected_neighborhood(sm, placements, evaluation, rng, visit, fraction, policy):
    graph = MoveGraph(sm, placements)
    issues = [x for x in evaluation["weaknesses"] if "classId" in x or "teacherId" in x or "unitId" in x]
    issue = issues[visit % len(issues)] if issues else {}
    seeds = [uid for uid, lesson in graph.lessons.items()
             if ("classId" not in issue or lesson["classId"] == issue["classId"])
             and ("subjectId" not in issue or lesson["subjectId"] == issue["subjectId"])
             and ("teacherId" not in issue or issue["teacherId"] in lesson["teacherIds"])
             and ("day" not in issue or graph.placed[uid]["day"] == issue["day"])
             and ("unitId" not in issue or uid == issue["unitId"])]
    if not seeds:
        seeds = list(graph.placed)
    free = set().union(*(graph.family[uid] for uid in rng.sample(seeds, min(2, len(seeds)))))
    frontier = sorted(free)
    limit = max(len(free), math.ceil(len(graph.placed) * fraction))
    for _ in range(policy["connectedDepth"]):
        next_frontier = set()
        for uid in frontier:
            old = graph.placed[uid]
            targets = []
            for day, start in sm.choices[uid]:
                if (sm.representative[uid], day, start) in graph.selected:
                    continue
                blockers = graph.blockers(uid, day, start)
                if blockers is None:
                    continue
                same_day = int(day == old["day"]) if issue.get("type") in ("subjectDaily", "subjectAdjacency", "teacherDailyLoad") else 0
                targets.append((same_day, len(blockers - free), rng.random(), blockers))
            for _, _, _, blockers in sorted(targets, key=lambda item: item[:3])[:policy["connectedTargets"]]:
                if len(free | blockers) <= limit:
                    next_frontier.update(blockers - free)
                    free.update(blockers)
        frontier = sorted(next_frontier)
    return free
