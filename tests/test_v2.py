#!/usr/bin/env python3
"""generate.py v2 — 실제 template.hwpx 로 전 구간 검증."""
import base64, importlib.util, io, json, re, sys, zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

ROOT = ROOT
API = ROOT / "apps/main/api/doc-ai"
spec = importlib.util.spec_from_file_location("gen", API / "generate.py")
gen = importlib.util.module_from_spec(spec); spec.loader.exec_module(gen)
M = gen.load_manifest()
FINAL = json.loads((ROOT / "doc-ai-template/template-manifest.v2.final.json").read_text())

FAIL = []
def check(n, fn):
    try: fn(); print(f"  ✓ {n}")
    except AssertionError as e: FAIL.append(n); print(f"  ✗ {n}: {e}")
    except Exception as e: FAIL.append(n); print(f"  ✗ {n}: {type(e).__name__}: {e}")

def body_of(b64):
    with zipfile.ZipFile(io.BytesIO(base64.b64decode(b64))) as z:
        return z.read("Contents/section0.xml").decode("utf-8")

def el(name, *lv):
    return {"name": name, "levels": [{"desc": d, "points": p} for d, p in lv]}

PLAN2 = {  # 2학년 · 시험 2회 · 수행 2개
    "year": 2026, "semester": 2, "grade": 2, "subject": "과학",
    "teacher_name": "이영준", "weekly_hours": 4,
    "monthly_plan": [
        {"month": "8월", "hours_cum": "9/9", "units": "Ⅰ. 물질의 구성", "standards": "[9과01-01]", "eval_elements": "원소 기호"},
        {"month": "9월", "hours_cum": "16/25", "units": "Ⅰ. 물질의 구성", "standards": "[9과01-02]", "eval_elements": "이온"},
        {"month": "10월", "hours_cum": "17/42", "units": "Ⅱ. 전기와 자기", "standards": "[9과02-01]", "eval_elements": "전기력"},
        {"month": "11월", "hours_cum": "16/58", "units": "Ⅱ. 전기와 자기", "standards": "[9과02-03]", "eval_elements": "전류"},
        {"month": "12월", "hours_cum": "18/76", "units": "Ⅲ. 태양계", "standards": "", "eval_elements": ""},
    ],
    "eval_purpose": ["탐구 능력을 기른다.", "과학적 태도를 함양한다.", "협력적 문제해결력을 기른다."],
    "exam": {"count": 2, "ratio": 60, "mc_points": 70, "essay_points": 30, "rounds": [
        {"label": "1회고사", "period": "9.29.~10.1.", "standards": "[9과01-01]~[9과01-03]", "mc": "70점", "essay": "30점", "essay_ratio": "9%"},
        {"label": "2회고사", "period": "12.1.~12.3.", "standards": "[9과02-01]~[9과02-04]", "mc": "70점", "essay": "30점", "essay_ratio": "9%"},
    ]},
    "perf_areas": [
        # 실측 규약: 각 영역이 100점 만점, 가중치는 반영비율(ratio)로만
        {"name": "실험 보고서", "points": 100, "ratio": 25, "essay_ratio": "10", "standards": "[9과01-02]", "period": "10월"},
        {"name": "탐구 발표", "points": 100, "ratio": 15, "essay_ratio": "5", "standards": "[9과02-01]", "period": "11월"},
    ],
    "essay_total_ratio": 33,
    "achievement_levels": {"A": "체계적으로 설계한다.", "B": "대체로 설계한다.", "C": "부분적으로 설계한다.", "D": "도움이 필요하다.", "E": ""},
    "perf_plans": [
        {"name": "실험 보고서", "task": "이온 반응 실험 설계·수행", "standards": "[9과01-02]",
         "criteria_high": "변인 통제가 정확하다.", "criteria_mid": "일부 오류가 있다.", "criteria_low": "수행이 미흡하다.",
         "methods": ["실험·실습", "서술·논술", "교사 관찰 및 기록"],
         "elements": [
             el("실험 설계", ("변인을 모두 통제", "10"), ("일부 통제", "8"), ("미흡", "6"), ("무응답", "4")),
             el("결과 해석", ("근거 제시 충실", "10"), ("근거 일부", "8"), ("근거 미흡", "6"), ("무응답", "4")),
         ],
         "absentee_rule": "결시자는 별도 과제로 대체한다."},
        {"name": "탐구 발표", "task": "주제 탐구 발표", "standards": "[9과02-01]",
         "criteria_high": "논리적이다.", "criteria_mid": "보통이다.", "criteria_low": "미흡하다.",
         "methods": ["구술·발표", "동료평가"],
         "elements": [el("발표 내용", ("충실", "10"), ("보통", "8"), ("미흡", "6"), ("무응답", "4"))],
         "absentee_rule": "추후 평가 기회를 부여한다."},
    ],
    "min_achievement_plan": "방과후 보충 지도를 실시한다.",
}

R = {}
print("\n[1] 시험 2회 · 수행 2개 (풀 케이스)")
def t_gen():
    fn, b64, _ = gen.generate({"fields": PLAN2})
    R["fn"], R["b64"], R["body"] = fn, b64, body_of(b64)
check("생성 성공", t_gen)
check("파일명에 (초안) 포함", lambda: (
    lambda f=R["fn"]: (_ for _ in ()).throw(AssertionError(f)) if f != "2026학년도_2학기_과학_2학년_평가계획서(초안).hwpx" else None)())
check("잔여 '{{' 0", lambda: (_ for _ in ()).throw(AssertionError(R["body"][R["body"].index("{{"):][:60])) if "{{" in R["body"] else None)
check("ZIP 규칙(mimetype 첫 엔트리·무압축)", lambda: [
    (_ for _ in ()).throw(AssertionError("mimetype 아님")) if z.namelist()[0] != "mimetype" else None,
    (_ for _ in ()).throw(AssertionError("압축됨")) if z.getinfo("mimetype").compress_type != zipfile.ZIP_STORED else None,
][0] if (z := zipfile.ZipFile(io.BytesIO(base64.b64decode(R["b64"])))) else None)

def t_direct():
    b = R["body"]
    # 시수/누계는 고정표가 덮어쓴다 (주당 4 → 8/8 … 16/72). AI 가 준 9/9·18/76 은 사라져야 한다.
    for s in ["2026", "과학", "8/8", "16/72", "Ⅰ. 물질의 구성", "탐구 능력을 기른다.",
              "방과후 보충 지도", "체계적으로 설계한다."]:
        assert s in b, f"누락: {s}"
    for s in ["9/9", "18/76"]:
        assert s not in b, f"AI 가 계산한 시수가 남음: {s}"
check("direct_tokens 치환 + 시수는 고정표로 교정", t_direct)

def t_exam_intro():
    b = R["body"]
    assert FINAL["composition_rules"]["EXAM_INTRO"]["2"] in b, "EXAM_INTRO(2회) 미조립"
    assert "정기시험의 반영비율은 60%로 하고" in b, "EXAM_RATIO_SENT 미조립"
    assert "선택형 70점, 서술형 30점" in b, "배점 치환 실패"
check("composition: EXAM_INTRO / EXAM_RATIO_SENT", t_exam_intro)

def t_computed():
    b = R["body"]
    assert "60%" in b and "40%" in b, "정기/수행 반영비율 표기 누락"
    assert "100(100%)" in b, "POINTS_SUM 계산 오류"
    # 만점 표기 N점(M%) — 서버가 계산 (회차 30%, 수행 40% 기준)
    # 표기 관행 "만점(반영비율%)" — 회차 반영비율 30%, 수행 영역 25%/15%
    assert "70(21%)" in b and "30(9%)" in b, "회차 만점 표기 오류"
    assert "100(25%)" in b and "100(15%)" in b, "수행 만점 표기 오류"
    assert "점(" not in b, "옛 'N점(M%)' 표기가 남음"
    assert "33%" in b, "서·논술 합계 누락"
    assert "15%" in b, "수행 서논술 합계(10+5) 오류"
check("computed: 반영비율·합계·서논술", t_computed)

def t_methods():
    b = R["body"]
    # 선택된 것만 ■
    assert "■ 서술·논술" in b, "서술·논술 미선택 표기"
    assert "■ 실험･실습" in b, "실험･실습(반각 ･) 미선택 표기"
    assert "□ 토의･토론" in b, "미선택이 □ 가 아님"
    assert "■ 교사 관찰 및 기록" in b, "2줄 규칙 미적용"
    assert "■ 동료평가" in b, "2번 블록 동료평가 미선택"
check("methods 2줄 체크박스 (원본 ･ 보존)", t_methods)

def t_elements():
    b = R["body"]
    assert "변인을 모두 통제" in b and "근거 제시 충실" in b, "E1/E2 수준 진술 누락"
    assert "발표 내용" in b, "2번 블록 요소명 누락"
check("elements 3그룹×4수준 (미사용 그룹은 공백)", t_elements)

print("\n[2] 시험 1회 · 수행 1개 (블록 삭제 + 빈칸 처리)")
# ⚠ 지필 1회는 규정상 도덕·기술가정 또는 3학년 2학기만 가능하고 반영비율 ≤40% 다.
#   수행이 60% 가 되므로 영역 1개(>40%)로는 만들 수 없어 2영역 30/30 으로 나눈다.
PLAN1 = json.loads(json.dumps(PLAN2))
PLAN1["subject"] = "도덕"
PLAN1["exam"] = {"count": 1, "ratio": 40, "mc_points": 60, "essay_points": 40,
                 "rounds": [{"label": "정기시험", "period": "11.2.~11.5.", "standards": "[9도01-01]", "ratio": 40, "mc": "60점", "essay": "40점", "essay_ratio": "16%"}]}
PLAN1["perf_areas"] = [{"name": "토론 활동", "points": 100, "ratio": 30, "essay_ratio": "8"},
                       {"name": "실천 기록", "points": 100, "ratio": 30, "essay_ratio": "8"}]
PLAN1["perf_plans"] = PLAN2["perf_plans"][:1]
R1 = {}
check("생성 성공", lambda: R1.update(zip(("fn", "b64", "_n"), gen.generate({"fields": PLAN1}))) or R1.update(body=body_of(R1["b64"])))
check("잔여 '{{' 0", lambda: (_ for _ in ()).throw(AssertionError("토큰 잔존")) if "{{" in R1["body"] else None)
def t_pp2_deleted():
    b = R1["body"]
    assert "PP2" not in b, "PP2 토큰 잔존"
    assert "나. 수행평가명" not in b, "2번째 출제계획 블록이 남음"
    assert "가. 수행평가명" in b, "1번째 블록까지 지워짐"
    assert "※ 수행평가는 평가 방법과" in b, "말미 안내문이 지워짐"
check("PP2 블록 삭제 (이름+표+결시자+빈문단)", t_pp2_deleted)
def t_blank():
    b = R1["body"]
    assert "12.1.~12.3." not in b, "2회차 시기가 남음"
    assert "11.2.~11.5." in b, "1회차 시기 누락"
check("EX2_* 빈칸 처리 (미사용 회차)", t_blank)
check("EXAM_INTRO(1회) 문구", lambda: (_ for _ in ()).throw(AssertionError("1회 문구 아님"))
      if FINAL["composition_rules"]["EXAM_INTRO"]["1"] not in R1["body"] else None)
check("합계 칸은 100(100%)", lambda: (_ for _ in ()).throw(AssertionError("합계 오류"))
      if "100(100%)" not in R1["body"] else None)

print("\n[3] 시험 0회 (자유학기)")
PLAN0 = json.loads(json.dumps(PLAN1))
PLAN0["exam"] = {"count": 0, "ratio": 0, "mc_points": 0, "essay_points": 0, "rounds": []}
PLAN0["subject"] = "정보"   # 수행 100% 는 규정이 정한 교과만 가능 (제10조 ⑥)
PLAN0["perf_areas"] = [{"name": "프로젝트 산출물", "points": 100, "ratio": 40, "essay_ratio": "0", "standards": "[9정01-01]", "period": "10월"},
                       {"name": "코드 작성 수행", "points": 100, "ratio": 30, "essay_ratio": "0", "standards": "", "period": "11월"},
                       {"name": "협업 과정 관찰", "points": 100, "ratio": 30, "essay_ratio": "0", "standards": "", "period": "12월"}]
R0 = {}
check("생성 성공", lambda: R0.update(zip(("fn", "b64", "_n"), gen.generate({"fields": PLAN0}))) or R0.update(body=body_of(R0["b64"])))
check("잔여 '{{' 0", lambda: (_ for _ in ()).throw(AssertionError("토큰 잔존")) if "{{" in R0["body"] else None)
def t_zero():
    b = R0["body"]
    assert FINAL["composition_rules"]["EXAM_INTRO"]["0"] in b, "0회 문구 아님"
    assert FINAL["composition_rules"]["EXAM_RATIO_SENT"]["0"] in b, "수행 100% 문장 아님"
    assert "0%" in b and "100%" in b, "정기 0% / 수행 100% 표기 누락"
    assert "9.29." not in b and "11.2." not in b, "시험 회차 정보가 남음"
check("정기 0% / 수행 100% + 회차 전부 공백", t_zero)

print("\n[4] 한도 검증 (양식은 수행 2개까지)")
def t_over():
    """한도 초과는 거부가 아니라 수용분 생성 + 안내 (제0원칙)."""
    p = json.loads(json.dumps(PLAN2))
    p["perf_areas"] = [{"name": f"수행 영역 {i}", "points": 100, "ratio": 10, "essay_ratio": "4"} for i in range(1, 5)]
    p["perf_plans"] = [{"name": f"수행 영역 {i}", "absentee_rule": "대체"} for i in range(1, 5)]
    fn, b64, notices = gen.generate({"fields": p})
    assert notices, "안내가 없음"
    assert "한글에서 직접 편집" in " ".join(notices), notices
    b = body_of(b64)
    assert "수행 영역 1" in b and "수행 영역 3" not in b, "수용분/초과분 처리 오류"
check("수행 4개 → 2개 생성 + 안내 (거부 아님)", t_over)
def t_nosubject():
    p = json.loads(json.dumps(PLAN2)); p["subject"] = ""
    try: gen.generate({"fields": p})
    except gen.BadRequest as e:
        assert "교과" in str(e), str(e); return
    raise AssertionError("교과 누락이 통과됨")
check("교과 누락 거부", t_nosubject)

print("\n[5] 빈칸 허용 (공란은 실패가 아니다)")
def t_sparse():
    # ⚠ 학년·교과가 양식 유형을 결정한다 — default 유형을 태우려면 2학년 주지교과여야 한다
    #   (1학년 2학기 → grade1_free, 미술 → arts. 그 유형들은 test_variant.py 가 본다)
    p = {"year": 2026, "semester": 2, "grade": 2, "subject": "정보",
         "exam": {"count": 0, "rounds": []},
         "perf_areas": [{"name": "프로젝트 산출물", "points": 100, "ratio": 40},
                        {"name": "코드 작성 수행", "points": 100, "ratio": 30},
                        {"name": "협업 과정 관찰", "points": 100, "ratio": 30}],
         "perf_plans": [{"name": "프로젝트 산출물", "absentee_rule": "추후 평가 기회 부여"}]}
    fn, b64, _ = gen.generate({"fields": p})
    b = body_of(b64)
    assert "{{" not in b, "토큰 잔존"
    assert "정보" in b, "교과 누락"
    assert fn.endswith("평가계획서(초안).hwpx"), fn
check("대부분 공란이어도 생성됨", t_sparse)

print("\n[6] 계약 원문 보존")
def t_contract():
    cur = gen.load_manifest()
    for k in ("direct_tokens", "perf_plan_block_tokens", "composition_rules", "unused_handling",
              "limits", "filename_pattern"):
        assert cur[k] == FINAL[k], f"{k} 가 FINAL 과 다름"
check("배치본의 계약 4+2 섹션이 FINAL 원문과 동일", t_contract)
def t_template_same():
    import hashlib
    a = hashlib.sha256((ROOT/"doc-ai-template/template.hwpx").read_bytes()).hexdigest()
    b = hashlib.sha256((API/"_assets/template.hwpx").read_bytes()).hexdigest()
    assert a == b, "template.hwpx 가 변형됨"
check("template.hwpx 무수정 (sha256 일치)", t_template_same)

print()
if FAIL: print(f"{len(FAIL)}건 실패: {', '.join(FAIL)}"); sys.exit(1)
print("전부 통과")
