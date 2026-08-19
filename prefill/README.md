# prefill/ — 2025-2 작년 데이터 팩 (전 학년 35블록: 1학년 12 + 2학년 12 + 3학년 11)

파서 v2 산출 (2026-08-18). 교과·학년 선택 시 시스템 프롬프트에 주입할 "작년 데이터".

## 스키마 (파일당)
- subject/grade/source/curriculum_note
- monthly_plan[]: {month, units, standards, eval_elements} — 옛 양식 원문 (예체능은 기간 병합 행)
- min_achievement_plan, eval_purpose[3]
- exam: {count, ratio, rounds[{composition_2class(작년 선택+서논 배점 — 3분류 분배는 대화에서),
  essay_ratio, period_last_year(작년 시험기간 — 올해 학사일정으로 교체 필요)}]
- perf_ratio, perf_areas[]: {name, points_last_year, points_normalized(100점 규약), period}
- perf_essay_ratio
- perf_plans[]: {name, raw[](셀 좌표+전문 — AI 가 대화에서 구조화), absent_points}
- achievement_levels._note: 3학년=소스 없음(AI 초안+검토), 2학년=2022 DB levels 재료
- _match_report(정규화 내역) / _warnings(분리 미완 등) / _info

## 사용 규칙 (chat 주입 시)
1. 요약 제시 → "작년과 같나요?" → 다른 것만 질문 (무질문 통과)
2. 2학년 standards 는 2015 원문 — 복사 금지, 2022 재선정본(별도 매칭 파일) 사용
3. 시험 시기·시수는 작년 값 무시, 올해 상수(학사일정·고정표) 사용
4. _warnings 있는 교과: 해당 부분은 "작년 자료 분리 미완" 안내 후 교사에게 확인


## 1학년 자유학기 스키마 (*_1.json, type: free_semester)
- monthly_plan / eval_purpose / min_achievement_plan: 공통과 동일 (월 표기 "12, 1월" 등 가변)
- achievement_levels_last_year: {A: [진술...], ...} — 작년 실물 진술. LV_{X}_{1~4} 칸 재료로
  **작년 원문 우선 계승** (2022 코드라 재선정 불필요. DB 생성은 작년에 없을 때만)
- activities[]: {name, task, standards, levels{A~E}, methods1, methods2} — FPP 블록 재료.
  점수·배점·미응시 필드 없음 (자유학기)
- 사용: 1학년 선택 시 주입 → 작년 활동 요약 제시 → 유지/변경/신규 → FPP 채움
