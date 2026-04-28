-- ═══════════════════════════════════════════════════════════════════
-- Phase 1 시드 데이터: 가상 시간표 + 학사 캘린더 샘플
-- ═══════════════════════════════════════════════════════════════════
-- 주의: 이 시드는 시뮬레이션/개발용입니다.
--       실제 운영 시작 시 timetables 테이블의 active row를
--       제대로 만든 시간표로 교체하면 됩니다.
-- ═══════════════════════════════════════════════════════════════════

-- ─── 1. 가상 시간표 시드 ───
-- 9학급 × 5요일 × 6교시 = 270 슬롯
-- 학급별로 conflict-aware 한 회전 패턴으로 채움
-- (실제 솔버 결과 대신 일단 페이지가 렌더링되도록 하는 용도)

DO $$
DECLARE
  v_data JSONB := '{}'::jsonb;
  v_class_data JSONB;
  v_slot_data JSONB;
  v_classes TEXT[] := ARRAY['c1','c2','c3','c4','c5','c6','c7','c8','c9'];
  v_days TEXT[] := ARRAY['월','화','수','목','금'];
  v_class TEXT;
  v_day TEXT;
  v_class_idx INT;
  v_day_idx INT;
  v_period INT;
  v_subj_idx INT;
  -- 주요 6과목 + 그에 대응되는 교사 (시드용 단순 매핑)
  v_subjects TEXT[] := ARRAY['s1','s5','s14','s8','s2','s9'];   -- 국어/수학/영어/과학/사회/체육
  v_teachers TEXT[] := ARRAY['t2','t7','t20','t12','t4','t14']; -- 각 과목 대응 교사 (편의상)
BEGIN
  FOR v_class_idx IN 1..array_length(v_classes, 1) LOOP
    v_class := v_classes[v_class_idx];
    v_class_data := '{}'::jsonb;

    FOR v_day_idx IN 1..array_length(v_days, 1) LOOP
      v_day := v_days[v_day_idx];

      FOR v_period IN 1..6 LOOP
        -- 회전 패턴: 학급/요일/교시에 따라 다른 과목 배치 (충돌 회피용)
        v_subj_idx := ((v_period - 1) + (v_class_idx - 1) + (v_day_idx - 1) * 2) % 6 + 1;

        v_slot_data := jsonb_build_object(
          'sid', v_subjects[v_subj_idx],
          'tid', v_teachers[v_subj_idx]
        );

        v_class_data := v_class_data || jsonb_build_object(
          v_day || '-' || v_period::text,
          v_slot_data
        );
      END LOOP;
    END LOOP;

    -- 목요일 7교시 = 창체 (담임 자동 배정 — 시드에서는 생략)
    v_class_data := v_class_data || jsonb_build_object(
      '목-7',
      jsonb_build_object('type', 'special', 'name', '창체')
    );

    v_data := v_data || jsonb_build_object(v_class, v_class_data);
  END LOOP;

  -- timetables 에 active row 1개 INSERT
  INSERT INTO timetables (
    name, effective_from, effective_until, status, is_active, data
  ) VALUES (
    '2026학년도 1학기 (시드)',
    '2026-03-02',
    '2026-08-15',
    'active',
    true,
    v_data
  )
  ON CONFLICT DO NOTHING;
END $$;


-- ─── 2. 학사 캘린더 샘플 (다음 1개월치) ───
-- 오늘이 4월 28일 가정. 5월 한 달치 샘플 데이터.

INSERT INTO school_calendar (date, type, note) VALUES
  ('2026-05-01', 'holiday',  '근로자의 날'),
  ('2026-05-05', 'holiday',  '어린이날'),
  ('2026-05-25', 'holiday',  '석가탄신일 대체')
ON CONFLICT (date) DO NOTHING;

INSERT INTO school_calendar (date, type, note, affected_classes) VALUES
  ('2026-05-13', 'event', '체육대회 (전교)', NULL),
  ('2026-05-20', 'event', '3학년 진로 체험', ARRAY['c7','c8','c9'])
ON CONFLICT (date) DO NOTHING;

-- 1학기 중간고사 (3일간, 전 학년)
INSERT INTO school_calendar (date, type, note) VALUES
  ('2026-05-27', 'exam', '1학기 중간고사 1일차'),
  ('2026-05-28', 'exam', '1학기 중간고사 2일차'),
  ('2026-05-29', 'exam', '1학기 중간고사 3일차')
ON CONFLICT (date) DO NOTHING;
