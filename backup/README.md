# backup/ — v1 데이터 백업 및 판정 기록

| 파일 | 원본 | 내용 | 처리 |
|------|------|------|------|
| v1_departments.csv | v1 public.departments | 부서 6개 | **실제 부서 명단.** 구 `010_seed.sql` 로 옮겨 적었으나 그 시드는 **미실행 상태로 접혔다** (`migrations/archive/010_seed.sql`, 2026-08-26). 부서 모듈 착수 시 새 번호로 재설계 — 이 CSV 가 여전히 원본이다 |
| v1_tasks_duty_catalog.csv | v1 public.tasks | 업무 종류 5건 | **샘플로 판정 → 폐기** (2026-08-16, 계란). 근거: 5건 동일 시각 생성, 수정 이력 없음, 일반론적 내용. Phase 3 인수인계 양식 참고용으로만 보존 |
| v1_timetable_schema.sql | 아래 3개 CSV 재구성 | timetables / timetable_changes 실측 DDL | **Phase 2 `011_timetable_domain.sql` 의 정본 재료.** ⚠ 지금 실행하는 파일 아님 |
| v1_timetable_columns.csv | information_schema.columns | 두 테이블 컬럼 36개 (타입/NULL/기본값) | 실측 원본 |
| v1_timetable_indexes.csv | pg_indexes | 인덱스 7개 (부분 유니크 `idx_one_active_timetable` 포함) | 실측 원본 |
| v1_timetable_constraints.csv | pg_constraint | PK/FK/CHECK 8개 | 실측 원본 |
| v1_timetables_data.csv | v1 public.timetables | 4행 = 1학기 활성본 1 + 2학기 초안 3 (7/12, 7/13, **7/29 최신**) | Phase 2 에서 최신 초안의 `data` JSONB 재주입 시 솔버 재실행 불필요 |

## 시간표 백업 (A0, 2026-08-16 — 000 초기화 직전 실측)

- 채집 시점: `000_reset_v1_project.sql` 의 `[C] DROP SCHEMA public CASCADE` **직전**.
  이 시점을 놓치면 v1 DB 스키마는 영구 소멸한다 (v1 GitHub repo 는 **코드**만 보존하지
  컬럼 타입·기본값·인덱스·제약을 보존하지 않음).
- **정본은 `v1_timetable_schema.sql`.** SCHEMA.md 15~16절의 요약(`effective_date` 등)은
  실측과 다르므로 신뢰하지 말 것 (2026-08-16 교정 완료).
- 실측으로 드러난 v1 구조의 핵심:
  - PK 가 **UUID** (v2 P2 의 TEXT PK 와 다름 — 격리 도메인이라 010 에서도 uuid 유지)
  - 버전 워크플로우: `effective_from`/`effective_until` + `parent_id` 자기참조 +
    `status(active|superseded|rolled_back|draft)` + `is_active` 부분 유니크 인덱스(전체 1개만)
  - `timetable_changes` 는 변경 요청 승인 워크플로우 (type 4종 × status 6종 + partner_status)
- RLS 정책은 백업하지 않음 — v2 에서 P4 3패턴 + `has_extra_permission('timetable_manage')`
  로 새로 설계한다.
- `timetable_changes` **데이터**는 1학기 운영 기록이라 D3 에 따라 백업하지 않음.

## 주의

- v1 의 `tasks` 테이블은 "업무 종류 카탈로그"이며, **v2 의 tasks(개인 할 일, 002)와 이름만 같고 전혀 다른 테이블**이다. 혼동 금지.
- v1 계정 데이터는 이관하지 않음 — D17 (첫 로그인 + email 기준 승격) 로 대체.
- v1 tasks 의 jsonb 필드(steps/cautions/required_docs)를 마크다운으로 평탄화하는 규칙(절차=번호 목록, 유의사항·필요서류=글머리 목록, dept/area/type/period/priority=첫 줄 메타)은 부활 시 그대로 적용하면 됨.
