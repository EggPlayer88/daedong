# backup/ — v1 데이터 백업 및 판정 기록

| 파일 | 원본 | 내용 | 처리 |
|------|------|------|------|
| v1_departments.csv | v1 public.departments | 부서 6개 | **실제 부서 명단 → 009_seed.sql 로 이관 완료** |
| v1_tasks_duty_catalog.csv | v1 public.tasks | 업무 종류 5건 | **샘플로 판정 → 폐기** (2026-08-16, 계란). 근거: 5건 동일 시각 생성, 수정 이력 없음, 일반론적 내용. Phase 3 인수인계 양식 참고용으로만 보존 |

## 주의

- v1 의 `tasks` 테이블은 "업무 종류 카탈로그"이며, **v2 의 tasks(개인 할 일, 002)와 이름만 같고 전혀 다른 테이블**이다. 혼동 금지.
- v1 계정 데이터는 이관하지 않음 — D17 (첫 로그인 + email 기준 승격) 로 대체.
- v1 tasks 의 jsonb 필드(steps/cautions/required_docs)를 마크다운으로 평탄화하는 규칙(절차=번호 목록, 유의사항·필요서류=글머리 목록, dept/area/type/period/priority=첫 줄 메타)은 부활 시 그대로 적용하면 됨.
