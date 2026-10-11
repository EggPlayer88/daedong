"""입력 계약과 독립 검증. 학교 규칙은 데이터로 받으며 알 수 없는 조건은 거부한다."""

from collections import Counter, defaultdict
from copy import deepcopy
import math


class InputError(ValueError):
    def __init__(self, code, message, path=""):
        super().__init__(message)
        self.issue = {"code": code, "message": message, "path": path}


def fail(code, message, path=""):
    raise InputError(code, message, path)


def fields(value, allowed, path):
    if not isinstance(value, dict):
        fail("INVALID_OBJECT", "객체가 필요합니다.", path)
    unknown = set(value) - set(allowed)
    if unknown:
        fail("UNKNOWN_FIELD", f"지원하지 않는 필드: {', '.join(sorted(map(str, unknown)))}", path)


def array(value, path):
    if not isinstance(value, list):
        fail("INVALID_ARRAY", "배열이 필요합니다.", path)
    return value


def integer(value, path, minimum=1):
    if type(value) is not int or not minimum <= value <= 2**31 - 1:
        fail("INVALID_INTEGER", f"{minimum} 이상인 32비트 범위 정수가 필요합니다.", path)
    return value


def identifier(value, path):
    if not isinstance(value, str) or not value.strip():
        fail("INVALID_ID", "빈 문자열이 아닌 ID가 필요합니다.", path)
    return value


def boolean(value, path):
    if type(value) is not bool:
        fail("INVALID_BOOLEAN", "참/거짓이 필요합니다.", path)
    return value


def refs(value, known, path, nonempty=False):
    array(value, path)
    if nonempty and not value:
        fail("EMPTY_REFERENCE", "참여자/대상이 하나 이상 필요합니다.", path)
    if any(not isinstance(x, str) for x in value) or len(set(value)) != len(value):
        fail("DUPLICATE_REFERENCE", "ID는 중복 없는 문자열이어야 합니다.", path)
    if set(value) - set(known):
        fail("UNKNOWN_REFERENCE", f"존재하지 않는 ID: {set(value) - set(known)}", path)
    return value


def entity_map(items, allowed, path):
    result = {}
    for i, row in enumerate(array(items, path)):
        fields(row, allowed, f"{path}[{i}]")
        key = identifier(row.get("id"), f"{path}[{i}].id")
        if key in result:
            fail("DUPLICATE_ID", f"중복 ID: {key}", path)
        result[key] = row
    return result


def check_slot(problem, value, path):
    fields(value, {"day", "period"}, path)
    day = value.get("day")
    if not isinstance(day, str) or day not in problem["dayMap"]:
        fail("UNKNOWN_DAY", "존재하지 않는 요일입니다.", path)
    p = integer(value.get("period"), path + ".period")
    if p > problem["dayMap"][day]["periods"]:
        fail("INVALID_SLOT", "해당 요일의 교시 범위를 넘습니다.", path)
    return day, p


def check_availability(problem, con, path):
    fields(con, {"allowedDays", "blockedSlots", "morningOnly", "maxPeriod", "maxPeriodPerDay"}, path)
    if "allowedDays" in con:
        refs(con["allowedDays"], problem["dayMap"], path + ".allowedDays")
    if "morningOnly" in con:
        boolean(con["morningOnly"], path + ".morningOnly")
    if "maxPeriod" in con:
        integer(con["maxPeriod"], path + ".maxPeriod", 0)
    if "maxPeriodPerDay" in con:
        fields(con["maxPeriodPerDay"], problem["dayMap"], path + ".maxPeriodPerDay")
        for d, p in con["maxPeriodPerDay"].items():
            integer(p, path + f".maxPeriodPerDay.{d}", 0)
    for i, b in enumerate(array(con.get("blockedSlots", []), path + ".blockedSlots")):
        check_slot(problem, b, path + f".blockedSlots[{i}]")


def available(problem, con, day, p):
    if "allowedDays" in con and day not in con["allowedDays"]:
        return False
    if con.get("morningOnly") and p > problem["morningEnd"]:
        return False
    if p > con.get("maxPeriod", problem["dayMap"][day]["periods"]):
        return False
    if p > con.get("maxPeriodPerDay", {}).get(day, problem["dayMap"][day]["periods"]):
        return False
    return not any(b["day"] == day and b["period"] == p for b in con.get("blockedSlots", []))


def signature(lesson):
    return lesson["subjectId"], tuple(sorted(lesson["teacherIds"]))


def cell_matches(lesson, fixed):
    return (fixed.get("subjectId", lesson["subjectId"]) == lesson["subjectId"]
            and ("teacherIds" not in fixed or set(fixed["teacherIds"]) == set(lesson["teacherIds"]))
            and fixed.get("lessonId", lesson["id"]) == lesson["id"])


def check_fixed(problem, row, path):
    fields(row, {"classId", "day", "period", "subjectId", "teacherIds", "lessonId"}, path)
    refs([row.get("classId")], problem["classMap"], path)
    check_slot(problem, {"day": row.get("day"), "period": row.get("period")}, path)
    if not any(k in row for k in ["subjectId", "teacherIds", "lessonId"]):
        fail("EMPTY_FIXED", "고정할 과목/교사/수업을 지정해야 합니다.", path)
    if "subjectId" in row:
        refs([row["subjectId"]], problem["subjectMap"], path)
    if "teacherIds" in row:
        refs(row["teacherIds"], problem["teacherMap"], path, True)
    if "lessonId" in row:
        refs([row["lessonId"]], problem["lessonMap"], path)
    if (row["classId"], row["day"], row["period"]) in problem["reservationMap"]:
        fail("FIXED_RESERVED", "빈칸 예약에 일반 수업을 고정할 수 없습니다.", path)


def normalize(raw, quality):
    fields(raw, {"version", "metadata", "morningEnd", "days", "classes", "teachers", "subjects", "resources", "lessons",
                 "reservations", "fixed", "subjectWindows", "hardConstraints"}, "problem")
    if type(raw.get("version")) is not int or raw.get("version") != 1:
        fail("UNSUPPORTED_VERSION", "version은 1이어야 합니다.", "problem.version")
    problem = deepcopy(raw)
    metadata = problem.setdefault("metadata", {})
    fields(metadata, {"source", "notes"}, "problem.metadata")
    if "source" in metadata:
        identifier(metadata["source"], "problem.metadata.source")
    for note in array(metadata.get("notes", []), "problem.metadata.notes"):
        if not isinstance(note, str):
            fail("INVALID_NOTE", "모델 확인 사항은 문자열이어야 합니다.", "problem.metadata.notes")
    integer(problem.get("morningEnd"), "problem.morningEnd")
    for key in ["resources", "reservations", "fixed", "subjectWindows", "hardConstraints"]:
        problem.setdefault(key, [])
    problem["dayMap"] = entity_map(problem.get("days"), {"id", "periods", "breaksAfter"}, "days")
    if not problem["dayMap"]:
        fail("EMPTY_DAYS", "요일이 필요합니다.", "days")
    for day in problem["days"]:
        integer(day.get("periods"), "days.periods")
        for p in array(day.get("breaksAfter", []), "days.breaksAfter"):
            integer(p, "days.breaksAfter")
            if p >= day["periods"]:
                fail("INVALID_BREAK", "휴식 경계는 마지막 교시 전이어야 합니다.")
    for kind in ["class", "teacher", "subject", "resource"]:
        key = {"class": "classes", "teacher": "teachers", "subject": "subjects", "resource": "resources"}[kind]
        extra = {"class": {"grade"}, "resource": {"capacity"}}.get(kind, set())
        problem[kind + "Map"] = entity_map(problem.get(key), {"id", "name", "availability"} | extra, key)
        for row in problem[key]:
            check_availability(problem, row.get("availability", {}), key + ".availability")
            if kind == "resource":
                integer(row.get("capacity"), key + ".capacity")
    if not problem["classMap"]:
        fail("EMPTY_CLASSES", "학급이 필요합니다.")
    problem["lessonMap"] = entity_map(problem.get("lessons"),
        {"id", "classId", "subjectId", "teacherIds", "hours", "blocks", "resourceIds", "allowAcrossBreak"}, "lessons")
    problem["units"] = []
    for lesson in problem["lessons"]:
        refs([lesson.get("classId")], problem["classMap"], "lessons.classId")
        refs([lesson.get("subjectId")], problem["subjectMap"], "lessons.subjectId")
        refs(lesson.get("teacherIds"), problem["teacherMap"], "lessons.teacherIds", True)
        refs(lesson.setdefault("resourceIds", []), problem["resourceMap"], "lessons.resourceIds")
        hours = integer(lesson.get("hours"), "lessons.hours")
        if hours > sum(d["periods"] for d in problem["days"]):
            fail("LESSON_EXCEEDS_WEEK", "수업 시수가 해당 학급의 주간 슬롯 수를 초과합니다.")
        blocks = array(lesson.setdefault("blocks", []), "lessons.blocks")
        for length in blocks:
            integer(length, "lessons.blocks", 2)
        if sum(blocks) > hours:
            fail("BLOCK_EXCEEDS_HOURS", f"{lesson['id']}: 블록이 배정 시수를 초과합니다.")
        boolean(lesson.setdefault("allowAcrossBreak", True), "lessons.allowAcrossBreak")
        lengths = blocks + [1] * (hours - sum(blocks))
        for i, length in enumerate(lengths):
            problem["units"].append({"id": f"{lesson['id']}@{i}", "lessonId": lesson["id"], "length": length})
    problem["unitMap"] = {u["id"]: u for u in problem["units"]}
    problem["reservationMap"] = {}
    for i, r in enumerate(array(problem["reservations"], "reservations")):
        fields(r, {"classId", "day", "period", "teacherIds", "resourceIds", "name"}, "reservations")
        refs([r.get("classId")], problem["classMap"], "reservations.classId")
        d, p = check_slot(problem, {"day": r.get("day"), "period": r.get("period")}, "reservations")
        refs(r.setdefault("teacherIds", []), problem["teacherMap"], "reservations.teacherIds")
        refs(r.setdefault("resourceIds", []), problem["resourceMap"], "reservations.resourceIds")
        key = r["classId"], d, p
        if key in problem["reservationMap"]:
            fail("DUPLICATE_RESERVATION", "같은 학급의 예약이 중복됐습니다.", f"reservations[{i}]")
        problem["reservationMap"][key] = r
    for c in problem["classMap"]:
        required = sum(d["periods"] for d in problem["days"]) - sum(k[0] == c for k in problem["reservationMap"])
        actual = sum(l["hours"] for l in problem["lessons"] if l["classId"] == c)
        if actual != required:
            fail("CLASS_HOURS_MISMATCH", f"{c}: 수업 {actual}시수, 채워야 할 슬롯 {required}개.")
    for w in array(problem["subjectWindows"], "subjectWindows"):
        fields(w, {"classIds", "subjectIds", "slots"}, "subjectWindows")
        refs(w.get("classIds"), problem["classMap"], "subjectWindows.classIds", True)
        refs(w.get("subjectIds"), problem["subjectMap"], "subjectWindows.subjectIds", True)
        w["slotSet"] = {check_slot(problem, s, "subjectWindows.slots") for s in array(w.get("slots"), "subjectWindows.slots")}
    for i, f in enumerate(array(problem["fixed"], "fixed")):
        check_fixed(problem, f, f"fixed[{i}]")
    hard_fields = {
        "maxDailyLoad": {"teacherId", "max"},
        "maxConsecutive": {"teacherId", "max", "acrossBreak"},
        "subjectDailyLimit": {"classId", "subjectId", "max"},
        "sameTime": {"lessonIds"}, "differentDays": {"lessonIds"},
    }
    for h in array(problem["hardConstraints"], "hardConstraints"):
        if not isinstance(h, dict) or not isinstance(h.get("type"), str) or h.get("type") not in hard_fields:
            fail("UNKNOWN_HARD_CONSTRAINT", "지원하지 않는 하드조건입니다.", "hardConstraints")
        fields(h, {"type"} | hard_fields[h["type"]], "hardConstraints")
        if "teacherId" in hard_fields[h["type"]]:
            refs([h.get("teacherId")], problem["teacherMap"], "hardConstraints.teacherId")
        if "classId" in hard_fields[h["type"]]:
            refs([h.get("classId")], problem["classMap"], "hardConstraints.classId")
            refs([h.get("subjectId")], problem["subjectMap"], "hardConstraints.subjectId")
        if "max" in hard_fields[h["type"]]:
            integer(h.get("max"), "hardConstraints.max", 0)
        if h["type"] == "maxConsecutive":
            boolean(h.setdefault("acrossBreak", True), "hardConstraints.acrossBreak")
        if "lessonIds" in hard_fields[h["type"]]:
            refs(h.get("lessonIds"), problem["lessonMap"], "hardConstraints.lessonIds", True)
            if h["type"] == "sameTime" and any(sum(u["lessonId"] == lid for u in problem["units"]) != 1 for lid in h["lessonIds"]):
                fail("AMBIGUOUS_SAME_TIME", "동시수업은 단일 활동인 수업끼리 지정해야 합니다.")
    return problem


def legal_start(problem, unit, day, start, fixed):
    """후보 생성에도 쓰되 최종 검증은 입력에서 다시 실행한다."""
    lesson = problem["lessonMap"][unit["lessonId"]]
    end = start + unit["length"] - 1
    if day not in problem["dayMap"] or start < 1 or end > problem["dayMap"][day]["periods"]:
        return False
    if not lesson["allowAcrossBreak"] and any(start <= b < end for b in problem["dayMap"][day].get("breaksAfter", [])):
        return False
    entities = [problem["classMap"][lesson["classId"]], problem["subjectMap"][lesson["subjectId"]]]
    entities += [problem["teacherMap"][t] for t in lesson["teacherIds"]]
    entities += [problem["resourceMap"][r] for r in lesson["resourceIds"]]
    for p in range(start, end + 1):
        if (lesson["classId"], day, p) in problem["reservationMap"]:
            return False
        if any(not available(problem, e.get("availability", {}), day, p) for e in entities):
            return False
        for w in problem["subjectWindows"]:
            if lesson["classId"] in w["classIds"] and ((lesson["subjectId"] in w["subjectIds"]) != ((day, p) in w["slotSet"])):
                return False
        for f in fixed:
            if (f["classId"], f["day"], f["period"]) == (lesson["classId"], day, p) and not cell_matches(lesson, f):
                return False
    return True


def expand_cells(problem, placements):
    cells = {}
    for place in placements:
        unit = problem["unitMap"][place["unitId"]]
        lesson = problem["lessonMap"][unit["lessonId"]]
        for p in range(place["start"], place["start"] + unit["length"]):
            cells[lesson["classId"], place["day"], p] = signature(lesson)
    return cells


def hard_windows(problem, day, length, across_break=True):
    for p in range(1, problem["dayMap"][day]["periods"] - length + 2):
        if across_break or not any(p <= b < p + length - 1 for b in problem["dayMap"][day].get("breaksAfter", [])):
            yield list(range(p, p + length))


def inspect_schedule(problem, placements, fixed=None):
    """솔버 변수나 후보 도메인을 읽지 않고 전체 시수·점유·입력 조건을 재검증한다."""
    errors = []
    fixed = problem["fixed"] if fixed is None else fixed
    if not isinstance(placements, list):
        return {"valid": False, "errors": [{"code": "INVALID_PLACEMENTS"}]}
    seen = Counter()
    class_occ, teacher_occ, resource_occ = defaultdict(list), defaultdict(list), defaultdict(list)
    hours, lesson_days, starts = Counter(), defaultdict(list), defaultdict(list)
    def issue(code, **details):
        errors.append({"code": code, **details})
    for row in placements:
        if not isinstance(row, dict) or set(row) != {"unitId", "day", "start"}:
            issue("INVALID_PLACEMENT"); continue
        uid, day, start = row["unitId"], row["day"], row["start"]
        if not isinstance(uid, str) or uid not in problem["unitMap"]:
            issue("UNKNOWN_UNIT"); continue
        seen[uid] += 1
        unit = problem["unitMap"][uid]
        lesson = problem["lessonMap"][unit["lessonId"]]
        if not isinstance(day, str) or type(start) is not int or not legal_start(problem, unit, day, start, fixed):
            issue("ILLEGAL_PLACEMENT", unitId=uid); continue
        lesson_days[lesson["id"]].append(day)
        starts[lesson["id"]].append((day, start))
        hours[lesson["id"]] += unit["length"]
        for p in range(start, start + unit["length"]):
            class_occ[lesson["classId"], day, p].append(lesson)
            for t in lesson["teacherIds"]:
                teacher_occ[t, day, p].append(uid)
            for r in lesson["resourceIds"]:
                resource_occ[r, day, p].append(uid)
    for uid in problem["unitMap"]:
        if seen[uid] != 1:
            issue("UNIT_COUNT", unitId=uid, count=seen[uid])
    for lesson in problem["lessons"]:
        if hours[lesson["id"]] != lesson["hours"]:
            issue("LESSON_HOURS", lessonId=lesson["id"], actual=hours[lesson["id"]])
    for key, r in problem["reservationMap"].items():
        if class_occ[key]:
            issue("RESERVATION_COLLISION", slot=list(key))
        _, day, p = key
        if not available(problem, problem["classMap"][key[0]].get("availability", {}), day, p):
            issue("RESERVATION_CLASS_UNAVAILABLE", classId=key[0])
        for t in r["teacherIds"]:
            if not available(problem, problem["teacherMap"][t].get("availability", {}), day, p):
                issue("RESERVATION_TEACHER_UNAVAILABLE", teacherId=t)
            teacher_occ[t, day, p].append("reservation")
        for rid in r["resourceIds"]:
            if not available(problem, problem["resourceMap"][rid].get("availability", {}), day, p):
                issue("RESERVATION_RESOURCE_UNAVAILABLE", resourceId=rid)
            resource_occ[rid, day, p].append("reservation")
    for c in problem["classMap"]:
        for d in problem["days"]:
            for p in range(1, d["periods"] + 1):
                key = c, d["id"], p
                expected = 0 if key in problem["reservationMap"] else 1
                if len(class_occ[key]) != expected:
                    issue("CLASS_SLOT_COUNT", slot=list(key), count=len(class_occ[key]))
    for key, occ in teacher_occ.items():
        if len(occ) > 1:
            issue("TEACHER_COLLISION", slot=list(key))
    for key, occ in resource_occ.items():
        if len(occ) > problem["resourceMap"][key[0]]["capacity"]:
            issue("RESOURCE_CAPACITY", slot=list(key))
    for f in fixed:
        occ = class_occ[f["classId"], f["day"], f["period"]]
        if len(occ) != 1 or not cell_matches(occ[0], f):
            issue("FIXED_VIOLATION", fixed=f)
    for h in problem["hardConstraints"]:
        kind = h["type"]
        if kind in ["maxDailyLoad", "maxConsecutive"]:
            for d in problem["days"]:
                occupied = {p for p in range(1, d["periods"] + 1) if teacher_occ[h["teacherId"], d["id"], p]}
                if kind == "maxDailyLoad" and len(occupied) > h["max"]:
                    issue("DAILY_LOAD", teacherId=h["teacherId"], day=d["id"])
                if kind == "maxConsecutive" and any(all(p in occupied for p in w) for w in hard_windows(problem, d["id"], h["max"] + 1, h["acrossBreak"])):
                    issue("CONSECUTIVE", teacherId=h["teacherId"], day=d["id"])
        if kind == "subjectDailyLimit":
            for d in problem["days"]:
                count = sum(l["subjectId"] == h["subjectId"] for p in range(1, d["periods"] + 1) for l in class_occ[h["classId"], d["id"], p])
                if count > h["max"]:
                    issue("SUBJECT_DAILY", classId=h["classId"], day=d["id"])
        if kind == "sameTime" and len({s for lid in h["lessonIds"] for s in starts[lid]}) != 1:
            issue("SAME_TIME")
        if kind == "differentDays":
            ds = [d for lid in h["lessonIds"] for d in lesson_days[lid]]
            if len(ds) != len(set(ds)):
                issue("DIFFERENT_DAYS")
    return {"valid": not errors, "errors": errors}
