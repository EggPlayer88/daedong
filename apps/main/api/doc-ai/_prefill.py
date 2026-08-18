#!/usr/bin/env python3
"""작년(2025-2) 데이터 팩 조회 — 서버가 확인 카드에 띄울 안내를 만들 때만 쓴다.

대화에 작년 값을 주입하는 일은 chat.js 가 한다. 이 파일은 그 반대편,
**교사가 확정한 값이 작년 자료의 불확실한 부분을 그대로 물려받았는지** 를 본다.

지금 보는 것 하나:
  · 작년 서·논술형 칸에 % 표기가 없던 교과(실측: 2학년 기술가정)에서 교사가
    작년 합계를 그대로 쓴 경우 → "작년 값 확인 필요" 를 띄운다.
    숫자는 있는데 단위가 없으니 68% 인지 68점인지 원본만으로는 알 수 없다.
"""
import json
import re
from pathlib import Path

NUM_RE = re.compile(r"-?\d+(?:\.\d+)?")


def _num(v, default=0.0) -> float:
    if isinstance(v, (int, float)) and not isinstance(v, bool):
        return float(v)
    m = NUM_RE.search(str(v or ""))
    return float(m.group()) if m else default


def load_index(dirpath: Path) -> dict:
    """subject|grade → 데이터. **파일명이 아니라 파일 안의 subject/grade** 를 믿는다."""
    index = {}
    if not dirpath.is_dir():
        return index
    for f in sorted(dirpath.glob("*.json")):
        try:
            d = json.loads(f.read_text(encoding="utf-8"))
        except (ValueError, OSError):
            continue  # 깨진 파일 하나가 전체를 막지 않게 한다
        subject = str(d.get("subject") or "").strip()
        try:
            grade = int(d.get("grade"))
        except (TypeError, ValueError):
            continue
        if not subject:
            continue
        key = f"{subject}|{grade}"
        prev = index.get(key)
        if prev is None or len(d) > len(prev):
            index[key] = d
    return index


def find(plan: dict, index: dict) -> dict | None:
    subject = str(plan.get("subject") or "").strip()
    grade = _num(plan.get("grade"), -1)
    if not subject or grade != int(grade):
        return None
    return index.get(f"{subject}|{int(grade)}")


def check(plan: dict, index: dict) -> list:
    """확인 카드에 띄울 안내. 규정 위반이 아니므로 생성을 막지 않는다."""
    pre = find(plan, index)
    if not pre:
        return []
    ed = pre.get("essay_detail")
    if not isinstance(ed, dict):
        return []

    cells = list(ed.get("exam_cells") or []) + list(ed.get("perf_cells") or [])
    total_cell = ed.get("total_cell_last_year") or ""
    if not cells or any("%" in str(x) for x in cells + [total_cell]):
        return []  # 표기가 온전하면 확인할 것이 없다

    last = _num(ed.get("computed_sum"), 0)
    if last <= 0:
        return []

    exam = plan.get("exam") if isinstance(plan.get("exam"), dict) else {}
    rounds = exam.get("rounds") if isinstance(exam.get("rounds"), list) else []
    count = int(_num(exam.get("count"), 0))
    areas = plan.get("perf_areas") if isinstance(plan.get("perf_areas"), list) else []
    now = sum(_num(r.get("essay_ratio"), 0) for r in rounds[:count] if isinstance(r, dict))
    now += sum(_num(a.get("essay_ratio"), 0) for a in areas if isinstance(a, dict))

    if abs(now - last) > 0.05:
        return []  # 교사가 작년 값을 고쳤다면 확인할 것이 없다

    joined = ", ".join(str(x) for x in cells)
    return [
        f"작년 값 확인 필요 — 서·논술형 합계 {last:g}% 는 작년 계획서에서 가져온 값인데, "
        f"원본 칸에 % 표기가 없습니다 ({joined}). 단위가 맞는지 확인해 주세요."
    ]
