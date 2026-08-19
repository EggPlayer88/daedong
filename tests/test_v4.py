#!/usr/bin/env python3
"""generate.py v4 — 유형별 양식 6종으로 실제 hwpx 생성 전 구간.

핵심 계약: **양식이 가진 토큰만 채우고, 하나도 남기지 않는다.**
token-map.json 이 어느 양식에 어떤 칸이 있는지의 유일한 근거이고, 치환표가 그것과
어긋나면 여기서 실패한다 (양식이 늘거나 토큰이 바뀌면 제일 먼저 걸리는 자리).
"""
import base64, importlib.util, io, json, re, zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
API = ROOT / "apps/main/api/doc-ai"
spec = importlib.util.spec_from_file_location("gen", API / "generate.py")
gen = importlib.util.module_from_spec(spec); spec.loader.exec_module(gen)
M = gen.load_manifest()
TM = gen.load_token_map()
V = gen._fill
FINAL = json.loads((ROOT / "doc-ai-templates-v4/template-manifest.v4.final.json").read_text(encoding="utf-8"))
MARK = "˙"

FAIL = []
def check(n, fn):
    try: fn(); print(f"  ✓ {n}")
    except AssertionError as e: FAIL.append(n); print(f"  ✗ {n}: {e}")
    except Exception as e: FAIL.append(n); print(f"  ✗ {n}: {type(e).__name__}: {e}")

def body_of(b64):
    with zipfile.ZipFile(io.BytesIO(base64.b64decode(b64))) as z:
        return z.read("Contents/section0.xml").decode("utf-8")

def text_of(b64):
    return re.sub(r"<[^>]+>", " ", body_of(b64))


def months(names=("8월", "9월", "10월", "11월", "12월")):
    return [{"month": m, "hours_cum": "", "units": f"{i+1}단원",
             "standards": f"[9수0{i+1}]", "eval_elements": "형성평가"}
            for i, m in enumerate(names)]


def pp(name, methods=("서술·논술",), groups=1):
    return {"name": name, "task": f"{name} 과제", "standards": "[9수01]",
            "criteria_high": f"{name} 상", "criteria_mid": f"{name} 중", "criteria_low": f"{name} 하",
            "methods": list(methods), "absentee_points": "각 영역당 20점",
            "elements": [{"name": f"{name} 요소{g+1}",
                          "levels": [{"desc": f"{name} 수준{k+1}", "points": str(10 - 2 * k)}
                                     for k in range(4)]} for g in range(groups)]}


def scored(grade, exams, areas, subject="수학", levels="ABCDE", exam_ratio=None):
    """점수형 계획 — 회차·영역 비율은 규정을 통과하도록 잡는다."""
    exam_ratio = 0 if exams == 0 else (40 if exam_ratio is None else exam_ratio)
    perf_ratio = 100 - exam_ratio
    per = round(perf_ratio / areas, 4)
    rounds = [{"label": f"{i+1}회", "period": f"{9+i*3}월", "standards": f"[9수0{i+1}]",
               "ratio": exam_ratio / exams if exams else 0,
               "mc": 60, "short": 10, "essay": 30,
               "essay_ratio": round(30 * (exam_ratio / exams) / 100, 4)} for i in range(exams)]
    ess_exam = sum(r["essay_ratio"] for r in rounds)
    need = max(0, 30 - ess_exam)
    return {
        "year": 2026, "semester": 2, "grade": grade, "subject": subject,
        "teacher_name": "이영준", "weekly_hours": 4,
        "monthly_plan": months(),
        "eval_purpose": ["목적 하나.", "목적 둘.", "목적 셋."],
        "exam": {"count": exams, "ratio": exam_ratio, "mc_points": 60,
                 "short_points": 10, "essay_points": 30, "rounds": rounds},
        "perf_ratio": perf_ratio,
        "perf_areas": [
            {"name": f"수행{i+1}", "points": 100, "ratio": per,
             "essay_ratio": round(need / areas, 4) if i < areas else 0,
             "period": f"{9+i}월"} for i in range(areas)],
        "achievement_levels": {k: f"{k} 수준 진술" for k in levels},
        "perf_plans": [pp(f"수행{i+1}", methods=(("서술·논술",) if i == 0 else ("구술·발표",)))
                       for i in range(areas)],
        "min_achievement_plan": "보충학습 및 과제 수행 후 성취 수준 재평가",
    }


print("\n[1] token-map 전수 대조 — 치환표가 양식과 어긋나면 여기서 걸린다")
def t_map_matches_files():
    for f, toks in TM.items():
        x = zipfile.ZipFile(API / "_assets" / f).read("Contents/section0.xml").decode("utf-8")
        real = sorted(set(re.findall(r"\{\{([A-Z0-9_]+)\}\}", x)))
        assert sorted(toks) == real, f"{f}: 맵 {len(toks)} vs 실제 {len(real)} — {set(toks) ^ set(real)}"
check(f"token-map == 실제 양식 토큰 ({len(TM)}종)", t_map_matches_files)

def t_every_token_has_rule():
    """모든 양식의 모든 토큰에 치환 규칙이 있는가. 하나라도 없으면 생성이 막힌다."""
    data = V.derive(scored(2, 2, 2), M)
    composed = V.compose_sentences(data, M)
    missing = {}
    for f, toks in TM.items():
        gap = [t for t in toks if V.token_value(t, data, M, composed) is None]
        if gap:
            missing[f] = gap
    assert not missing, missing
check("모든 양식의 모든 토큰에 치환 규칙이 있다", t_every_token_has_rule)

def t_unknown_token_fails():
    """양식에 새 토큰이 생기면 조용히 넘기지 않고 생성을 막는다."""
    sp = V.route_spec(M, TM, "grade2_exam2")
    sp = {**sp, "tokens": sp["tokens"] | {"NEW_TOKEN_XYZ"}}
    try:
        V.build_token_values(scored(2, 2, 2), M, sp)
    except KeyError as e:
        assert "NEW_TOKEN_XYZ" in str(e), e
        return
    raise AssertionError("모르는 토큰이 조용히 통과됨")
check("모르는 토큰은 즉시 실패 (조용히 빈칸으로 두지 않는다)", t_unknown_token_fails)


print("\n[2] 양식 6종 전부 생성 — 잔여 '{{' 0")
CASES = {
    "grade2_exam2": scored(2, 2, 2),
    "grade2_exam1": scored(2, 1, 2, subject="한문"),
    "grade2_exam0": scored(2, 0, 3, subject="음악", levels="ABC"),
    "grade3_exam1": scored(3, 1, 2, levels=""),
    "grade3_exam0": scored(3, 0, 3, subject="체육", levels=""),
}
OUT = {}
def t_all_forms():
    for key, plan in CASES.items():
        fn, b64, _n = gen.generate_v2(M, json.loads(json.dumps(plan)))
        OUT[key] = b64
        b = body_of(b64)
        assert "{{" not in b, f"{key}: 토큰 잔존 {b[b.index('{{'):][:60]}"
        assert fn.endswith("(초안).hwpx"), fn
check("점수형 5유형 생성", t_all_forms)

def t_zip_rules():
    z = zipfile.ZipFile(io.BytesIO(base64.b64decode(OUT["grade2_exam2"])))
    assert z.namelist()[0] == "mimetype", z.namelist()[0]
    assert z.getinfo("mimetype").compress_type == zipfile.ZIP_STORED, "mimetype 압축됨"
check("ZIP 규칙 (mimetype 첫 엔트리·무압축)", t_zip_rules)

def t_months_scored():
    """점수형 학년도 월은 서버 고정이다 (기존 동작 유지 — 회귀 확인)."""
    for key in ("grade2_exam2", "grade3_exam1"):
        t = text_of(OUT[key])
        row = gen.load_fixed_hours()["variants"]["common"]["4"]
        for cell in row["months"]:
            assert cell in t, f"{key}: 시수 칸 누락 {cell}"
check("점수형 학년 시수 주입 영향 없음", t_months_scored)

def t_common():
    t = text_of(OUT["grade2_exam2"])
    for s in ("수학", "1단원", "목적 하나.", "보충학습 및 과제 수행 후 성취 수준 재평가",
              "8/8", "16/72", "각 영역당 20점", "수행1 상", "수행1 수준1"):
        assert s in t, f"누락: {s}"
    for s in ("9/9", "18/76"):
        assert s not in t, f"AI 가 계산한 시수가 남음: {s}"
check("공통 칸 + 시수는 서버 고정표", t_common)


print("\n[3] 조립 문장 — short=0 이면 그 항을 뺀다")
def t_ratio_sent():
    t = text_of(OUT["grade2_exam2"])
    assert FINAL["composition_rules"]["EXAM_INTRO"]["2"] in t, "EXAM_INTRO(2회) 미조립"
    assert "선택형 60점, 단답형·완성형 10점, 서·논술형 30점" in t, "3분류 배점 문장 아님"
check("3분류 배점 문장", t_ratio_sent)

def t_short_zero():
    p = scored(2, 2, 2)
    p["exam"]["short_points"] = 0
    p["exam"]["mc_points"] = 70
    for r in p["exam"]["rounds"]:
        r["mc"], r["short"] = 70, 0
    t = text_of(gen.generate_v2(M, p)[1])
    assert "선택형 70점, 서·논술형 30점" in t, "short=0 인데 항이 남음"
    assert "단답형·완성형" not in t.split("의 비율로 출제한다")[0], "0점짜리 항이 문장에 남음"
check("단답형·완성형 0점 → 문장에서 항 생략", t_short_zero)

def t_zero_exam():
    t = text_of(OUT["grade2_exam0"])
    assert FINAL["composition_rules"]["EXAM_INTRO"]["0"] in t, "0회 문구 아님"
    assert FINAL["composition_rules"]["EXAM_RATIO_SENT"]["0"] in t, "수행 100% 문장 아님"
check("시험 0회 → 미실시 문장", t_zero_exam)

def t_computed():
    t = text_of(OUT["grade2_exam2"])
    assert "100(100%)" in t, "POINTS_SUM 오류"
    assert "30%" in t, "서·논술 합계(서버 재계산) 누락"
    assert "60(12%)" in t and "10(2%)" in t, "회차 3분류 만점 표기 오류"
check("POINTS_SUM · ESSAY_TOTAL_RATIO 서버 재계산", t_computed)


print("\n[4] 성취수준 — 양식이 가진 단계만")
def t_levels_arts():
    t = text_of(OUT["grade2_exam0"])
    for lv in ("A 수준 진술", "B 수준 진술", "C 수준 진술"):
        assert lv in t, lv
    assert "D 수준 진술" not in t and "E 수준 진술" not in t, "예체능판에 D·E 가 들어감"
check("2학년 예체능 → A~C 만", t_levels_arts)

def t_levels_g3():
    """3학년 양식에는 성취수준 절 자체가 없다 — 교사가 실어 보내도 갈 곳이 없다."""
    p = scored(3, 1, 2, levels="")
    p["achievement_levels"] = {k: f"{k} 진술은 3학년 양식에 없다" for k in "ABCDE"}
    b = body_of(gen.generate_v2(M, p)[1])
    assert "3학년 양식에 없다" not in b, "3학년 문서에 성취수준이 새어 들어감"
    assert "LV_" not in b, "LV 토큰 잔존"
check("3학년 → 성취수준이 문서에 없다", t_levels_g3)


def base_marks(key):
    """양식에 인쇄돼 있는 '˙' 개수 — v4 는 대부분 양식 내장이라 기준선이 0이 아니다."""
    f = V.route_spec(M, TM, key)["file"]
    x = zipfile.ZipFile(API / "_assets" / f).read("Contents/section0.xml").decode("utf-8")
    return re.sub(r"<[^>]+>", " ", x).count(MARK)


def t_perf_one():
    """2학년 시험2 양식은 수행 2열이다. 1개만 쓰면 2번째 열은 '˙', PP2 블록은 삭제.

    ⚠ 수행 1개는 영역당 40% 상한 때문에 수행 비율이 40% 이하일 때만 성립한다
       (규정 V02). 그래서 정기 70 : 수행 30 으로 잡는다.
    """
    p = scored(2, 2, 1, exam_ratio=70)
    b64 = gen.generate_v2(M, p)[1]
    b, t = body_of(b64), text_of(b64)
    assert "{{" not in b, "토큰 잔존"
    assert t.count(MARK) >= base_marks("grade2_exam2") + 3, (
        f"P2 계열 3칸에 '˙' 가 더 찍혀야 하는데 {t.count(MARK)}개 "
        f"(양식 내장 {base_marks('grade2_exam2')}개)")
    assert "수행2" not in t, "쓰지 않는 블록이 남음"
check("수행 1개 → P2 는 '˙', PP2 블록 삭제", t_perf_one)

def t_level_cells():
    """v4.1 — 수준마다 칸이 4개. 칸마다 성취기준 하나의 진술이 따로 들어간다."""
    p = scored(2, 2, 2)
    p["achievement_levels"] = {
        lv: [f"{lv} 기준{i+1} 진술" for i in range(4)] for lv in "ABCDE"}
    t = text_of(gen.generate_v2(M, p)[1])
    for lv in "ABCDE":
        for i in range(4):
            assert f"{lv} 기준{i+1} 진술" in t, f"{lv} {i+1}번 칸 누락"
check("수준당 4칸이 각각 들어간다", t_level_cells)

def t_level_cells_partial():
    """성취기준이 4개 미만이면 남는 칸은 빈칸으로 둔다 (억지로 채우지 않는다)."""
    p = scored(2, 2, 2)
    p["achievement_levels"] = {lv: [f"{lv} 하나", f"{lv} 둘"] for lv in "ABCDE"}
    b64 = gen.generate_v2(M, p)[1]
    b, t = body_of(b64), text_of(b64)
    assert "{{" not in b, "빈 칸 토큰이 남음"
    assert "A 하나" in t and "A 둘" in t, "채운 칸이 안 들어감"
    assert t.count(MARK) == base_marks("grade2_exam2"), "빈 칸에 '˙' 가 찍힘 (공란이어야 한다)"
check("칸이 모자라면 빈칸 (˙ 가 아니다)", t_level_cells_partial)

def t_level_string_ok():
    """AI 가 예전처럼 문장 하나만 줘도 문서가 깨지지 않는다 (1칸으로 받는다)."""
    p = scored(2, 2, 2)
    p["achievement_levels"] = {lv: f"{lv} 한 줄" for lv in "ABCDE"}
    t = text_of(gen.generate_v2(M, p)[1])
    assert "A 한 줄" in t, "문자열 하나를 못 받음"
check("문자열 하나도 1칸으로 받는다", t_level_string_ok)

def t_arts_cells():
    p = scored(2, 0, 3, subject="음악", levels="ABC")
    p["achievement_levels"] = {lv: [f"{lv} 실기{i+1}" for i in range(4)] for lv in "ABCDE"}
    t = text_of(gen.generate_v2(M, p)[1])
    for lv in "ABC":
        assert all(f"{lv} 실기{i+1}" in t for i in range(4)), f"{lv} 칸 누락"
    assert "D 실기1" not in t and "E 실기1" not in t, "예체능판에 D·E 가 들어감"
check("예체능(A~C)도 칸별로 채운다", t_arts_cells)


print("\n[5] 미사용 처리 — v4 는 2가지만 남았다")
def t_no_mark_when_full():
    """칸을 다 쓰면 서버가 '˙' 를 **더** 찍지 않는다 (공란과 구분)."""
    p = scored(2, 2, 2)
    p["min_achievement_plan"] = ""
    p["achievement_levels"]["E"] = ""
    got = text_of(gen.generate_v2(M, p)[1]).count(MARK)
    assert got == base_marks("grade2_exam2"), f"공란에 '˙' 가 추가됨 ({got})"
check("공란(교사 미정)에는 '˙' 를 찍지 않는다", t_no_mark_when_full)

def t_over_capacity():
    """한도 초과는 거부가 아니라 수용분 생성 + 안내 (제0원칙)."""
    cap = V.route_spec(M, TM, "grade2_exam2")["limits"]["perf_areas_max"]
    p = scored(2, 2, cap + 2)
    fn, b64, notices = gen.generate_v2(M, p)
    t = text_of(b64)
    assert notices and "한글에서 직접 편집" in " ".join(notices), notices
    assert "수행1" in t and f"수행{cap + 1}" not in t, "수용분/초과분 처리 오류"
check("한도 초과 → 수용분만 + 안내", t_over_capacity)


print("\n[6] 자유학기 — 점수 없는 양식")
FREE = {
    "year": 2026, "semester": 2, "grade": 1, "subject": "과학",
    "teacher_name": "김교사", "weekly_hours": 3,
    "monthly_plan": months(("9월", "10월", "11월", "12월", "1월")),
    "eval_purpose": ["자유학기 목적 하나.", "목적 둘.", "목적 셋."],
    "achievement_levels": {k: f"{k} 학기 성취수준" for k in "ABCDE"},
    "free_activities": [
        {"name": f"활동{i+1}", "task": f"활동{i+1} 과제", "standards": f"[9과0{i+1}]",
         "levels": {k: f"활동{i+1} {k} 서술" for k in "ABCDE"},
         "methods": ["프로젝트"] if i % 2 else ["서술·논술"]}
        for i in range(3)
    ],
    "min_achievement_plan": "보충학습 및 과제 수행 후 성취 수준 재평가",
}
FR = {}
def t_free_gen():
    fn, b64, notices = gen.generate_v2(M, json.loads(json.dumps(FREE)))
    FR["fn"], FR["b64"], FR["t"] = fn, b64, text_of(b64)
    assert "{{" not in body_of(b64), "토큰 잔존"
    assert fn.startswith("2026학년도_2학기_과학_1학년"), fn
check("생성 성공 (활동 3개)", t_free_gen)

def t_free_months():
    """월 이름은 **서버가 행 순서로** 넣는다 — 학년 무관 8~12월 5행 고정.

    자유학기 양식은 월 이름도 칸이라 교사·AI 값이 들어갈 수 있었지만,
    2026-08-19 확정으로 서버 고정값을 쓴다 (작년 "12, 1월" 병합 표기 미계승).
    """
    want = M["monthly_plan"]["months"]
    for m in want:
        assert m in FR["t"], f"월 누락: {m}"
    assert "1월" not in FR["t"].replace("11월", "").replace("12월", ""), "1월 행이 생김"
check("M{n}_MONTH = 서버 고정 (8~12월 5행)", t_free_months)

def t_free_months_ignore_input():
    """교사·prefill 이 준 월 라벨은 쓰지 않는다 (행 순서가 곧 월이다)."""
    p = json.loads(json.dumps(FREE))
    for r in p["monthly_plan"]:
        r["month"] = "12, 1월"
    t = text_of(gen.generate_v2(M, p)[1])
    assert "12, 1월" not in t, "작년 병합 표기가 계승됨"
    for m in M["monthly_plan"]["months"]:
        assert m in t, f"서버 고정 월 누락: {m}"
check("입력 월 라벨을 무시하고 고정값을 쓴다", t_free_months_ignore_input)

def t_free_hours():
    """자유학기도 시수·누계는 다른 학년과 똑같이 서버 고정표로 채운다."""
    p = json.loads(json.dumps(FREE))
    p["weekly_hours"] = 4
    fn, b64, notices = gen.generate_v2(M, p)
    t = text_of(b64)
    row = gen.load_fixed_hours()["variants"]["common"]["4"]
    for cell in row["months"]:
        assert cell in t, f"시수 칸 누락: {cell}"
    assert row["months"][-1].endswith("/72"), row["months"]
    assert not [n for n in notices if "시수" in n], notices
check("시수 5행 전부 + 누계 끝값 72 (주당 4)", t_free_hours)

def t_free_hours_missing():
    """시수를 못 받았으면 **왜 비었는지** 말해 준다 — 양식 오류로 오해하지 않게."""
    p = json.loads(json.dumps(FREE))
    p.pop("weekly_hours", None)
    fn, b64, notices = gen.generate_v2(M, p)
    assert any("주당 시수를 받지 못해" in n for n in notices), notices
check("시수 미입력 → 이유를 알린다", t_free_hours_missing)

def t_free_blocks():
    for i in (1, 2, 3):
        assert f"활동{i}" in FR["t"], f"활동{i} 누락"
        assert f"활동{i} A 서술" in FR["t"], f"활동{i} 성취수준 누락"
    assert "활동4" not in FR["t"], "쓰지 않는 4번째 블록이 남음"
check("활동 3개 채우고 4번째 블록은 삭제", t_free_blocks)

def t_free_no_scoring():
    """배점·미응시 점수·반영비율 문장이 아예 없다."""
    assert "각 영역당 20점" not in FR["t"], "미응시 점수가 들어감"
    for s in ("정기시험의 반영비율", "100(100%)"):
        assert s not in FR["t"], f"점수형 문장이 들어감: {s}"
    assert "A 학기 성취수준" in FR["t"], "학기 성취수준 누락"
check("점수 관련 칸이 없다 (scoring=false)", t_free_no_scoring)

def t_free_skips_scale_check():
    """배점이 아예 없는 계획도 거부되지 않는다 (검증 자체가 성립하지 않는다)."""
    p = json.loads(json.dumps(FREE))
    p.pop("exam", None)
    gen.generate_v2(M, p, check_only=True)
check("배점 검증을 건너뛴다", t_free_skips_scale_check)

def t_free_methods():
    assert "■ 서술·논술" in FR["t"], "체크 표시 안 됨"
    assert "□ 포트폴리오" in FR["t"], "미선택이 □ 가 아님"
check("평가방법 체크박스", t_free_methods)


print("\n[7] 계약 원문 보존 · 확정본 무수정")
def t_contract():
    cur = gen.load_manifest()
    for k in ("routing", "composition_rules", "unused_handling", "fixed_texts",
              "token_families", "final_check", "filename_pattern", "manifest_version"):
        assert cur[k] == FINAL[k], f"{k} 가 FINAL 과 다름"
check("배치본 계약 섹션이 v4 FINAL 원문과 동일", t_contract)

def t_files_same():
    import hashlib
    for f in TM:
        a = hashlib.sha256((ROOT / "doc-ai-templates-v4" / f).read_bytes()).hexdigest()
        b = hashlib.sha256((API / "_assets" / f).read_bytes()).hexdigest()
        assert a == b, f"{f} 가 변형됨"
check(f"양식 {len(TM)}종 무수정 (sha256 일치)", t_files_same)

def t_fixed_text():
    assert "수행평가 세부 기준 참고" in text_of(OUT["grade2_exam2"]), "수행 성취기준 고정 문구 없음"
    assert "추후 평가 기회 부여" in FR["t"], "자유학기 미응시 고정 문구 없음"
check("고정 문구 유지 (토큰 아님)", t_fixed_text)

def t_nosubject():
    p = scored(2, 2, 2); p["subject"] = ""
    try:
        gen.generate_v2(M, p)
    except gen.BadRequest as e:
        assert "교과" in str(e), str(e); return
    raise AssertionError("교과 누락이 통과됨")
check("교과 누락 거부", t_nosubject)

def t_missing_route():
    """표에 없는 조합(3학년 시험 2회)은 어느 유형인지 밝히며 중단한다."""
    p = scored(3, 2, 2, levels="")
    try:
        gen.generate_v2(M, p)
    except gen.TemplateMissing as e:
        assert e.variant == "grade3_exam2", e.variant
        assert e.label, "label 이 비었다"
        return
    raise AssertionError("없는 조합인데 생성됨")
check("표에 없는 조합 → TemplateMissing", t_missing_route)

print("\n[8] 프롬프트 골격 ↔ 치환 경로 (두 언어를 잇는 이음매)")
def t_skeleton_paths():
    """chat.js 가 AI 에게 준 골격의 key 로 실제 값이 흘러오는지.

    골격의 문자열 칸마다 고유 표식을 심고 모든 토큰을 치환해 본다. key 이름이
    한 글자라도 어긋나면 그 토큰이 빈 문자열로 나오고 여기서 잡힌다 —
    "생성은 되는데 칸이 비어 있다" 는 가장 알아채기 어려운 고장이다.
    """
    import subprocess
    raw = subprocess.run(
        ["node", "-e",
         "import('./apps/main/api/doc-ai/chat.js').then(m=>console.log(m.buildSkeleton(m.manifest)))"],
        cwd=ROOT, capture_output=True, text=True, timeout=120)
    assert raw.returncode == 0, raw.stderr[-500:]
    skel = json.loads(raw.stdout)

    seen = {}
    def stamp(node, path=""):
        if isinstance(node, dict):
            return {k: stamp(v, f"{path}.{k}") for k, v in node.items()}
        if isinstance(node, list):
            return [stamp(v, f"{path}[{i}]") for i, v in enumerate(node)] or node
        mark = f"MARK{len(seen)}"
        seen[mark] = path or "?"
        return mark

    plan = stamp(skel)
    # 표식이 숫자 칸까지 덮으면 파생 계산이 깨진다 — 숫자는 원래 값으로 되돌린다
    plan.update({"year": 2026, "semester": 2, "grade": 2, "subject": "수학",
                 "weekly_hours": 4, "hours_manual": False})
    plan["exam"].update({"count": 2, "ratio": 40})
    for r in plan["exam"]["rounds"]:
        r.update({"ratio": 20, "mc": 60, "short": 10, "essay": 30, "essay_ratio": 6})
    plan["perf_ratio"] = 60
    for a in plan["perf_areas"]:
        a.update({"points": 100, "ratio": 60, "essay_ratio": 18})
    plan["free_activities"] = [{"name": "MARK_FA_NAME", "task": "MARK_FA_TASK",
                                "standards": "MARK_FA_STD",
                                "levels": {k: f"MARK_FA_LV{k}" for k in "ABCDE"},
                                "methods": ["서술·논술"]}]

    data = V.derive(plan, M)
    composed = V.compose_sentences(data, M)
    # 값이 비면 안 되는 토큰 — 골격이 채워 준 자리들
    # 골격은 배열마다 **샘플 1개**만 보여준다 (개수는 프롬프트 문구가 지시).
    # 그래서 2번째 회차·영역·블록·요소는 비어 있는 것이 정상이다.
    def sampled_only(t):
        return t.startswith(("EX2_", "P2_", "PP2_")) or "_E2_" in t or "_E3_" in t

    must = [t for t in TM["tpl-g2-exam2.hwpx"]
            if not sampled_only(t)
            and t not in ("EXAM_TOTAL_RATIO", "PERF_TOTAL_RATIO", "POINTS_SUM",
                          "ESSAY_TOTAL_RATIO", "PERF_ESSAY_RATIO", "M1_MONTH")]
    empty = [t for t in must if not V.token_value(t, data, M, composed)]
    assert not empty, f"골격 값이 흘러오지 않는 토큰: {empty}"

    free = [t for t in TM["tpl-g1-free.hwpx"] if t.startswith("FPP1_")]
    empty_free = [t for t in free if not V.token_value(t, data, M, composed)]
    assert not empty_free, f"자유학기 골격이 흘러오지 않는 토큰: {empty_free}"
check("골격 key 로 모든 토큰에 값이 흘러온다", t_skeleton_paths)


print()
if FAIL:
    print(f"실패 {len(FAIL)}건: " + ", ".join(FAIL)); raise SystemExit(1)
print("전부 통과")
