-- ============================================================================
-- T1-02  R0 증분 — 학기의 "현재 시간표 기준판" 칸을 실제 기준판에 연결 (별도 승인 항목)
--
-- ▣ 무엇을 바꾸나(이 파일이 하는 일은 이것 하나다)
--   R0-01 이 만든 workhub.terms 의 제약 terms_timetable_basis_pending  CHECK (current_timetable_basis_id IS NULL) 를 지우고,
--   같은 학교 · 같은 학기의 기준판만 가리키는 복합 FK terms_timetable_basis_fkey 를 붙인다.
--     FOREIGN KEY (school_id, current_timetable_basis_id, id) → workhub.timetable_basis_revisions (school_id, id, term_id)
--   R0 제약 처분표(r0/R0_제약처분표.md · terms)가 "시간표 배치가 이 CHECK 를 지우고 이 복합 FK 를 붙인다"고 예약해 둔 자리다.
-- ▣ 출처 구분(2026-10-18 정책 5)
--   이 파일 = R0 출처 제약 1개만. 알림 출처 제약(notifications_source_check)은 R0 가 아니라 P3 에서 만들고 P8-02 가 cooperation 을
--   넣은 제약이다. 시간표 알림은 T2 에서 쓰므로 그 교체는 T2 의 별도 파일에서 한다(기존 값 전부 + timetable). 이 파일은 손대지 않는다.
-- ▣ 확정본 R0-01 · INT-03 파일은 고치지 않는다. INT-03(통합 사후 점검)은 이 제약의 정의 해시를 R0 원본 값으로 고정하고 있으므로
--   T1-02 적용 뒤에는 그 한 행이 달라진다 — 이 차이는 T1-04(사후 점검)가 "T1-02 가 의도한 변경"으로 확인한다(T1_실행안내.md 4절).
-- ▣ 데이터: 기존 학기 행은 바꾸지 않는다(모든 행의 칸이 NULL 이어야 진행 — 아니면 멈춘다). 행의 판(version)도 올리지 않는다.
-- ▣ 이후 효과: 기준판이 하나라도 있는 학기는 학교 관리(P1 · P8-01)의 "학기 빼기"로 지울 수 없다(FK 가 막는다 — 수업(P5)이 있는 학기와 같다).
-- ▣ 전제: T1-01(2026-10-18.1). 한 트랜잭션. 이미 적용됐으면 멈춘다.
-- ============================================================================
BEGIN;

DO $$
BEGIN
  -- 표가 없을 때 아래 질의를 계획하지 않도록 따로 본다(PL/pgSQL 은 IF 식 전체를 한 번에 준비한다)
  IF to_regclass('workhub_private.t1_installs') IS NULL THEN RAISE EXCEPTION 'T1 중단: T1-01(2026-10-18.1)을 먼저 적용해 주세요.'; END IF;
  IF NOT EXISTS (SELECT 1 FROM workhub_private.t1_installs WHERE batch = 'T1-01' AND release = '2026-10-18.1') THEN
    RAISE EXCEPTION 'T1 중단: T1-01(2026-10-18.1)을 먼저 적용해 주세요.';
  END IF;
  IF EXISTS (SELECT 1 FROM workhub_private.t1_installs WHERE batch = 'T1-02') THEN
    RAISE EXCEPTION 'T1 중단: T1-02 가 이미 적용되었습니다(다시 실행하지 않습니다).';
  END IF;
  -- 바꿀 제약이 R0 원본 그대로인가
  IF (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid = 'workhub.terms'::regclass AND conname = 'terms_timetable_basis_pending')
       IS DISTINCT FROM 'CHECK ((current_timetable_basis_id IS NULL))' THEN
    RAISE EXCEPTION 'T1 중단: workhub.terms 의 terms_timetable_basis_pending 이 R0 원본(CHECK current_timetable_basis_id IS NULL)이 아닙니다. 누가 바꿨는지 먼저 확인해 주세요.';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'workhub.terms'::regclass AND conname = 'terms_timetable_basis_fkey') THEN
    RAISE EXCEPTION 'T1 중단: terms_timetable_basis_fkey 가 이미 있습니다. 누가 만들었는지 먼저 확인해 주세요.';
  END IF;
  IF EXISTS (SELECT 1 FROM workhub.terms WHERE current_timetable_basis_id IS NOT NULL) THEN
    RAISE EXCEPTION 'T1 중단: 기준판 칸이 채워진 학기가 있습니다(R0 CHECK 가 막았어야 함). 누가 바꿨는지 먼저 확인해 주세요.';
  END IF;
END $$;

ALTER TABLE workhub.terms DROP CONSTRAINT terms_timetable_basis_pending;
ALTER TABLE workhub.terms ADD CONSTRAINT terms_timetable_basis_fkey
  FOREIGN KEY (school_id, current_timetable_basis_id, id) REFERENCES workhub.timetable_basis_revisions (school_id, id, term_id);
COMMENT ON CONSTRAINT terms_timetable_basis_fkey ON workhub.terms IS
  'T1-02(2026-10-18): R0 terms_timetable_basis_pending 을 대신한다. 같은 학교 · 같은 학기의 기준판만 가리킨다.';

INSERT INTO workhub_private.t1_installs (batch, release) VALUES ('T1-02', '2026-10-18.1');
COMMIT;

-- 검증 — 모든 행의 status 가 ok 여야 한다
SELECT 'T1-02-1' AS no, 'R0 CHECK(terms_timetable_basis_pending) 없음' AS item,
       CASE WHEN NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'workhub.terms'::regclass AND conname = 'terms_timetable_basis_pending')
            THEN 'ok' ELSE 'FAIL' END AS status, '' AS value
UNION ALL
SELECT 'T1-02-2', '복합 FK(학교 · 기준판 · 학기) → timetable_basis_revisions(school_id, id, term_id)',
       CASE WHEN (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid = 'workhub.terms'::regclass AND conname = 'terms_timetable_basis_fkey')
                 = 'FOREIGN KEY (school_id, current_timetable_basis_id, id) REFERENCES workhub.timetable_basis_revisions(school_id, id, term_id)'
            THEN 'ok' ELSE 'FAIL' END, ''
UNION ALL
SELECT 'T1-02-3', '기존 학기 행 그대로(기준판 칸 모두 비어 있음)',
       CASE WHEN NOT EXISTS (SELECT 1 FROM workhub.terms WHERE current_timetable_basis_id IS NOT NULL) THEN 'ok' ELSE 'FAIL' END,
       (SELECT count(*)::text FROM workhub.terms)
UNION ALL
SELECT 'T1-02-4', '적용 기록 T1-02', CASE WHEN workhub_private.t1_installed('T1-02') THEN 'ok' ELSE 'FAIL' END, ''
ORDER BY 1;
