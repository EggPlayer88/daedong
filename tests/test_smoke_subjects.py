#!/usr/bin/env python3
"""전 교과 스모크 — prefill 색인 35건 전부를 "생성 시작 ~ 완료" 로 돌린다.

왜 있는가: 2026-08-26, 1학년 '디지털 리터러시' 에서만 생성이 죽었다. 교과 하나가
특이한 경로를 타는 것을 **사람이 먼저 발견했다.** 그 일이 다시 없도록, 색인에 있는
교과·학년 전부를 자동으로 통과시킨다.

무엇을 보는가 (판정이 아니라 **크래시 0**):
  · route_key → route_spec → validate → 규정검증 → 실제 hwpx 생성까지 예외 없이 끝나는가
  · 성취기준 DB 에 없는 교과(디지털 리터러시·보건)도 같은 경로를 끝까지 가는가
  · 교과명 표기가 갈려도(공백·가운뎃점 유무) 같은 결과가 나오는가

여기서 막지 않는 것: 규정 위반(RegulationViolation)은 **정상 동작**이다.
계획을 일부러 규정에 맞춰 만들었으므로 위반이 나오면 그것도 실패로 본다 —
단, 위반은 JSON 400 으로 나가므로 "크래시" 와 구분해서 보고한다.
"""
import base64
import importlib.util
import io
import json
import re
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
API = ROOT / "apps/main/api/doc-ai"
PREFILL = API / "_assets/prefill"

spec = importlib.util.spec_from_file_location("gen", API / "generate.py")
gen = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gen)
M = gen.load_manifest()
DB = json.loads((API / "_assets/standards-db.json").read_text(encoding="utf-8"))

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


def norm(s):
    return re.sub(r"[\s·・･ㆍ_]", "", str(s or ""))


def load_index():
    """prefill 색인 — 파일명이 아니라 파일 안의 subject/grade 를 믿는다 (chat.js 와 같은 규칙)."""
    out = []
    for f in sorted(PREFILL.glob("*.json")):
        d = json.loads(f.read_text(encoding="utf-8"))
        subject = str(d.get("subject") or "").strip()
        try:
            grade = int(d.get("grade"))
        except (TypeError, ValueError):
            continue
        if subject:
            out.append((f.name, subject, grade, d))
    return out


INDEX = load_index()


def months(names=("8월", "9월", "10월", "11월", "12월")):
    return [{"month": m, "hours_cum": "", "units": f"{i+1}단원",
             "standards": "[9임01-01]", "eval_elements": "형성평가"}
            for i, m in enumerate(names)]


def free_plan(subject, grade):
    return {
        "year": 2026, "semester": 2, "grade": grade, "subject": subject,
        "teacher_name": "김교사", "weekly_hours": 2,
        "monthly_plan": months(),
        "eval_purpose": ["목적 하나.", "목적 둘."],
        "achievement_levels": {k: f"{k} 학기 성취수준" for k in "ABCDE"},
        "free_activities": [
            {"name": f"활동{i+1}", "task": f"활동{i+1} 과제", "standards": "[9임01-01]",
             "levels": {k: f"활동{i+1} {k} 서술" for k in "ABCDE"},
             "methods": ["프로젝트"]}
            for i in range(3)
        ],
        "min_achievement_plan": "보충학습 후 재평가",
    }


def scored_plan(subject, grade, exams):
    """규정을 통과하는 점수형 계획 — 회차 100점 / 영역 합 100점 / 반영비율 100%."""
    exam_ratio = 40 if exams else 0
    perf_ratio = 100 - exam_ratio
    areas_n = 2 if exams else 3
    per = round(perf_ratio / areas_n, 4)
    rounds = [{"label": f"{i+1}회", "period": f"{9+i*2}월", "standards": "[9임01-01]",
               "ratio": exam_ratio / exams, "mc": 60, "short": 10, "essay": 30,
               "essay_ratio": round(30 * (exam_ratio / exams) / 100, 4)}
              for i in range(exams)]
    ess_exam = sum(r["essay_ratio"] for r in rounds)
    need = max(0.0, 30 - ess_exam)
    areas = []
    for i in range(areas_n):
        areas.append({
            # 각 수행은 100점 만점이고 가중치는 반영비율(%)로만 준다 (_fill.check_scales)
            "name": f"수행{i+1}", "points": 100, "ratio": per,
            "period": "수시",
            "essay_ratio": round(need, 4) if i == 0 else 0,
        })
    return {
        "year": 2026, "semester": 2, "grade": grade, "subject": subject,
        "teacher_name": "김교사", "weekly_hours": 3,
        "monthly_plan": months(),
        "eval_purpose": ["목적 하나.", "목적 둘."],
        "exam": {"count": exams, "ratio": exam_ratio, "rounds": rounds},
        "perf_areas": areas,
        "perf_plans": [
            {"name": f"수행{i+1}", "task": "과제", "standards": "[9임01-01]",
             "criteria_high": "상", "criteria_mid": "중", "criteria_low": "하",
             "methods": ["서술·논술"], "absentee_points": "각 영역당 20점",
             "elements": [{"name": "요소1",
                           "levels": [{"desc": f"수준{k+1}", "points": str(10 - 2 * k)}
                                      for k in range(4)]}]}
            for i in range(areas_n)
        ],
        "achievement_levels": {k: f"{k} 학기 성취수준" for k in "ABCDE"},
        "min_achievement_plan": "보충학습 후 재평가",
    }


def plan_for(subject, grade, data):
    if grade == 1 or data.get("type") == "free_semester":
        return free_plan(subject, grade)
    exams = int(gen._fill.first_num((data.get("exam") or {}).get("count"), 0))
    if grade == 3 and exams > 1:
        exams = 1  # 3학년 양식은 0·1회뿐 — 색인 값이 아니라 양식 한도를 따른다
    return scored_plan(subject, grade, exams)


print(f"[1] prefill 색인 전 교과 생성 ({len(INDEX)}건) — 크래시 0")
GENERATED = {}


def one(subject, grade, data, label):
    plan = plan_for(subject, grade, data)

    # 확인 카드 경로 (check_only)
    card = gen.generate_v2(M, json.loads(json.dumps(plan)), check_only=True)
    assert isinstance(card, dict), "check_only 가 dict 를 돌려주지 않음"

    # 실제 생성 경로
    fn, b64, notices = gen.generate_v2(M, json.loads(json.dumps(plan)))
    raw = base64.b64decode(b64)
    with zipfile.ZipFile(io.BytesIO(raw)) as z:
        body = z.read("Contents/section0.xml").decode("utf-8")
    assert "{{" not in body, "치환되지 않은 토큰이 남았다"
    assert fn.endswith(".hwpx"), fn
    GENERATED[label] = (fn, len(raw), card)


for fname, subject, grade, data in INDEX:
    label = f"{subject} {grade}학년"
    check(f"{label} ({fname})", lambda s=subject, g=grade, d=data, l=label: one(s, g, d, l))

print(f"\n[2] 성취기준 DB 에 없는 교과도 같은 경로를 끝까지 간다")
DB_NAMES = {norm(k) for k in (DB.get("subjects") or {})}
MISSING = sorted({s for _f, s, _g, _d in INDEX if norm(s) not in DB_NAMES})
print(f"  (DB 미수록: {', '.join(MISSING) or '없음'})")


def t_missing_db_generated():
    assert MISSING, "DB 미수록 교과가 하나도 없다 — 이 테스트의 전제가 깨졌다"
    for s in MISSING:
        hit = [l for l in GENERATED if l.startswith(s + " ")]
        assert hit, f"{s} 가 생성되지 않았다"


check("DB 미수록 교과가 전부 생성까지 도달", t_missing_db_generated)

print(f"\n[3] 교과명 표기가 갈려도 같은 결과 (공백·가운뎃점)")


def t_name_variants():
    for _f, subject, grade, data in INDEX:
        if norm(subject) == subject:
            continue  # 표기 변형이 없는 이름
        base = plan_for(subject, grade, data)
        a = gen.generate_v2(M, json.loads(json.dumps(base)), check_only=True)
        alt = json.loads(json.dumps(base))
        alt["subject"] = norm(subject)
        b = gen.generate_v2(M, alt, check_only=True)
        assert a["variant"] == b["variant"], f"{subject}: 변형 표기에서 양식이 달라졌다"
        assert a["findings"] == b["findings"], f"{subject}: 변형 표기에서 규정 판정이 달라졌다"


check("공백 유무가 양식·규정 판정을 바꾸지 않는다", t_name_variants)

print()
if FAIL:
    print(f"✗ 실패 {len(FAIL)}건: {', '.join(FAIL)}")
    sys.exit(1)
print(f"전부 통과 ({len(INDEX)}개 교과·학년)")
