#!/usr/bin/env python3
"""계승 참조의 generate 쪽 계약 (짝: tests/test_carry.mjs).

carry 참조는 chat.js 가 응답을 내보내기 전에 작년 원문으로 펼친다. 그래서
generate 가 받는 계획은 지금까지와 똑같은 **완성된 계획**이다.

여기서 지키는 것 둘:
  1. 그래도 carry 가 남아 오면 **막는다.** 무시하면 그 칸이 조용히 빈 채로 결재까지
     간다 — 안 되는 걸 되는 것처럼 하지 않는다 (제0원칙).
  2. 작년 원문을 그대로 계승하면 양식 한도를 넘는 교과가 있다 (실측: 사회 1학년의
     학기 성취수준은 수준당 8칸인데 양식은 4칸). **자르되 말없이 자르지 않는다.**
"""
import importlib.util
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
API = ROOT / "apps/main/api/doc-ai"
PREFILL = API / "_assets/prefill"

spec = importlib.util.spec_from_file_location("gen", API / "generate.py")
gen = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gen)
M = gen.load_manifest()
TM = gen.load_token_map()
V = gen._fill

FAIL = []


def check(name, fn):
    try:
        fn()
        print(f"  ✓ {name}")
    except AssertionError as e:
        FAIL.append(name)
        print(f"  ✗ {name}: {e}")
    except Exception as e:  # noqa: BLE001
        FAIL.append(name)
        print(f"  ✗ {name}: {type(e).__name__}: {e}")


def free_plan(**over):
    plan = {
        "year": 2026, "semester": 2, "grade": 1, "subject": "디지털 리터러시",
        "teacher_name": "김교사", "weekly_hours": 2,
        "monthly_plan": [{"month": m, "hours_cum": "", "units": f"{i+1}단원",
                          "standards": "[9임01-01]", "eval_elements": "형성평가"}
                         for i, m in enumerate(("8월", "9월", "10월", "11월", "12월"))],
        "eval_purpose": ["목적 하나."],
        "achievement_levels": {k: f"{k} 진술" for k in "ABCDE"},
        "free_activities": [
            {"name": f"활동{i+1}", "task": "과제", "standards": "[9임01-01]",
             "levels": {k: f"{k} 서술" for k in "ABCDE"}, "methods": ["프로젝트"]}
            for i in range(3)
        ],
        "min_achievement_plan": "보충학습",
    }
    plan.update(over)
    return plan


print("\n[1] 펼쳐지지 않은 계승 참조는 막는다")


def t_carry_blocked():
    plan = free_plan(carry=["monthly_plan"])
    try:
        gen.generate_v2(M, plan, check_only=True)
    except gen.BadRequest as e:
        assert "계승 참조" in str(e), str(e)
        assert "한 번 더 확정" in str(e), f"무엇을 해야 하는지 안 알림: {e}"
        return
    raise AssertionError("carry 가 남았는데 통과했다")


check("carry 가 남아 있으면 BadRequest (조용히 무시하지 않는다)", t_carry_blocked)


def t_carry_blocked_on_generate():
    """확인 카드(check_only)만이 아니라 실제 생성 경로도 막아야 한다."""
    try:
        gen.generate_v2(M, free_plan(carry=["free_activities"]))
    except gen.BadRequest:
        return
    raise AssertionError("생성 경로가 통과시켰다")


check("생성 경로도 같이 막는다", t_carry_blocked_on_generate)


def t_free_semester_too():
    """자유학기는 배점 검증을 건너뛴다 — 그 조기 return 앞에서 막아야 한다."""
    spec_free = V.route_spec(M, TM, "grade1_semester2")
    assert not spec_free["scoring"], "자유학기 전제가 깨졌다"
    try:
        gen.validate_v2(M, free_plan(carry=["monthly_plan"]), spec_free)
    except gen.BadRequest:
        return
    raise AssertionError("자유학기 경로가 carry 를 통과시켰다")


check("자유학기(배점 검증 건너뛰는 경로)에서도 막힌다", t_free_semester_too)


def t_no_carry_passes():
    """carry 가 없거나 비어 있으면 지금까지와 똑같이 지나간다."""
    for value in (None, [], {}):
        plan = free_plan()
        if value is not None:
            plan["carry"] = value
        gen.generate_v2(M, plan, check_only=True)


check("carry 가 없거나 비어 있으면 그대로 통과 (기존 계약 보존)", t_no_carry_passes)


print("\n[2] 작년 원문이 양식 한도를 넘으면 — 자르되 말없이 자르지 않는다")
# 실측: 사회 1학년 팩의 학기 성취수준은 수준당 8칸, 양식(tpl-g1-free)은 4칸.
SOCIAL = json.loads((PREFILL / "사회_1.json").read_text(encoding="utf-8"))
LV_CAP = V.route_spec(M, TM, "grade1_semester2")["limits"]["level_cells_max"]


def t_premise():
    cells = SOCIAL.get("achievement_levels_last_year") or {}
    assert cells, "사회 1학년 팩에 작년 성취수준이 없다"
    worst = max(len(v) for v in cells.values() if isinstance(v, list))
    assert worst > LV_CAP, f"작년 {worst}칸 ≤ 양식 {LV_CAP}칸 — 이 테스트의 전제가 깨졌다"


check(f"전제: 작년 자료가 양식({LV_CAP}칸)보다 많은 교과가 있다", t_premise)


def t_notice():
    plan = free_plan(achievement_levels={
        k: list(v) for k, v in SOCIAL["achievement_levels_last_year"].items()
    })
    _fn, _b64, notices = gen.generate_v2(M, plan)
    hit = [n for n in notices if "학기 성취수준" in n]
    assert hit, f"안내가 없다: {notices}"
    assert str(LV_CAP) in hit[0], f"양식 한도를 안 밝힘: {hit[0]}"
    assert "한글에서 직접" in hit[0], f"교사가 무엇을 해야 하는지 안 밝힘: {hit[0]}"


check("넘친 칸을 알린다 (몇 칸까지 담기는지 + 무엇을 해야 하는지)", t_notice)


def t_truncates_not_crashes():
    plan = free_plan(achievement_levels={
        k: list(v) for k, v in SOCIAL["achievement_levels_last_year"].items()
    })
    V.apply_capacity(plan, M, V.route_spec(M, TM, "grade1_semester2")["limits"])
    for lv, cells in plan["achievement_levels"].items():
        assert len(cells) <= LV_CAP, f"{lv}: {len(cells)}칸이 남았다"


check("한도까지만 남기고 나머지는 잘라 낸다 (거부가 아니다)", t_truncates_not_crashes)


def t_within_cap_silent():
    """한도 안이면 안내하지 않는다 — 필요 없는 경고는 진짜 경고를 묻는다."""
    plan = free_plan(achievement_levels={k: [f"{k}1", f"{k}2"] for k in "ABCDE"})
    _fn, _b64, notices = gen.generate_v2(M, plan)
    assert not [n for n in notices if "학기 성취수준" in n], notices


check("한도 안이면 안내하지 않는다", t_within_cap_silent)


def t_activities_cap():
    """자유학기 활동도 블록 수를 넘으면 알린다 (지금까지 조용히 사라졌다)."""
    cap = V.route_spec(M, TM, "grade1_semester2")["limits"]["free_blocks_max"]
    acts = [{"name": f"활동{i+1}", "task": "과제", "standards": "[9임01]",
             "levels": {k: "x" for k in "ABCDE"}, "methods": []} for i in range(cap + 2)]
    plan = free_plan(free_activities=acts)
    _fn, _b64, notices = gen.generate_v2(M, plan)
    hit = [n for n in notices if "자유학기 활동" in n]
    assert hit, f"안내가 없다 (cap={cap}): {notices}"
    assert f"활동{cap + 1}" in hit[0], f"빠진 항목을 안 밝힘: {hit[0]}"


check("활동 블록도 넘치면 무엇이 빠졌는지 알린다", t_activities_cap)


print()
if FAIL:
    print(f"✗ 실패 {len(FAIL)}건: {', '.join(FAIL)}")
    sys.exit(1)
print("전부 통과")
