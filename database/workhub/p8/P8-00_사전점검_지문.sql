-- ============================================================================
-- P8-00  정책 보강(P8) 사전 점검 · 전후 지문 (읽기 전용 — 아무것도 만들거나 바꾸지 않는다)
--
-- ▣ 언제: (1) P8-01 실행 "전" 한 번, (2) 마지막으로 적용한 P8 파일과 P8-05(사후 점검) 뒤 한 번. 결과를 각각 저장해 둔다.
-- ▣ 읽는 법
--   kind = '점검'  지금 상태. 실행 전에는 status 가 모두 ok · info 여야 P8-01 로 넘어간다. FAIL 이면 멈추고 note 를 알려 주세요.
--   kind = '지문'  P8 이 건드리면 안 되는 것의 요약값. 실행 전 · 후 두 결과의 '지문' 행이 모두 같아야 한다.
-- ▣ 지문 범위 — public · auth · storage · workhub · workhub_private · workhub_storage 전체에서 P8 이 의도적으로 만들거나 바꾸는 것만 뺀 나머지
--   S1 열 · S2 제약 · S3 트리거 · S4 함수 본문 · 설정 · 권한 · S5 표 권한 · S6 RLS 정책 · D1 기존 표 전부의 행 수 · 행 해시.
--   P8 이 바꾸는 것(지문에서 빼고 P8-05 · INT-03 이 정확히 대조하는 것)
--     함수 11개: p1_save_configuration · p7_plan_eval (P8-01) / p7_record_guard · p7_resources · p7_tr_preview · p7_tr_list · p7_tr_mutate (P8-03)
--                p5_current_assignment · p5_course_visible · p5_catalog · p5_roster_import (P8-04)
--     제약 4개: notifications_source_check (P8-02) / transition_records_shape_check · _version_check · transition_history_action_check (P8-03)
--     새로 만드는 것: p8_* 함수 · 트리거, 공개 함수 workhub_teaching_relation*, 표 p8_installs · teaching_relation_ends · _previews · _commits
--   P8-01~04 는 기존 표에 행을 쓰지 않는다. 켜기(P8-06)는 module_activations 1행 + 감사 1건씩을 쓴다.
--   ※ 실제 운영 DB 에서 두 번 실행하는 사이에 교사가 쓰면 D1 이 달라질 수 있다 — 그때는 S1~S6(구조)만 반드시 같아야 한다.
-- ============================================================================
WITH
sch AS (SELECT oid, nspname FROM pg_namespace WHERE nspname IN ('public','auth','storage','workhub','workhub_private','workhub_storage')),
p8_tables(t) AS (VALUES ('workhub_private.p8_installs'),('workhub.teaching_relation_ends'),('workhub.teaching_relation_previews'),
  ('workhub.teaching_relation_commits')),
p8_changed_fn(n) AS (VALUES ('p1_save_configuration'),('p7_plan_eval'),('p7_record_guard'),('p7_resources'),('p7_tr_preview'),('p7_tr_list'),
  ('p7_tr_mutate'),('p5_current_assignment'),('p5_course_visible'),('p5_catalog'),('p5_roster_import')),
p8_changed_con(n) AS (VALUES ('notifications_source_check'),('transition_records_shape_check'),('transition_records_version_check'),
  ('transition_history_action_check')),
p8_rel AS (SELECT to_regclass(t) AS oid FROM p8_tables WHERE to_regclass(t) IS NOT NULL),
rels AS (SELECT c.oid, c.relname, n.nspname FROM pg_class c JOIN sch n ON n.oid = c.relnamespace
          WHERE c.relkind IN ('r','p','v','m') AND c.oid NOT IN (SELECT oid FROM p8_rel)),
fns AS (SELECT p.oid, p.proname, n.nspname FROM pg_proc p JOIN sch n ON n.oid = p.pronamespace
         WHERE NOT (p.proname LIKE 'p8\_%' OR (n.nspname = 'public' AND p.proname LIKE 'workhub\_teaching\_relation%')
                    OR (n.nspname = 'workhub_private' AND p.proname IN (SELECT n FROM p8_changed_fn)))),
data AS (SELECT r.nspname || '.' || r.relname AS t,
                (xpath('/row/v/text()', query_to_xml(format(
                   'SELECT count(*) || '':'' || md5(COALESCE(string_agg(x::text, chr(10) ORDER BY x::text), '''')) AS v FROM %I.%I x', r.nspname, r.relname),
                   false, true, '')))[1]::text AS v
           FROM rels r JOIN pg_class c ON c.oid = r.oid WHERE c.relkind IN ('r','p')),
installs(stage, tbl, batches, release) AS (VALUES
  ('P1', 'workhub_private.p1_installs', ARRAY['P1-01','P1-02'], '2026-10-16.1'),
  ('P2', 'workhub_private.p2_installs', ARRAY['P2-01','P2-02'], '2026-10-16.1'),
  ('P3', 'workhub_private.p3_installs', ARRAY['P3-01','P3-02'], '2026-10-16.1'),
  ('P5', 'workhub_private.p5_installs', ARRAY['P5-01','P5-02'], '2026-10-16.1'),
  ('P7', 'workhub_private.p7_installs', ARRAY['P7-01','P7-02'], '2026-10-16.1')),
inst AS (SELECT stage, to_regclass(tbl) IS NOT NULL
                AND (xpath('/row/v/text()', query_to_xml(format('SELECT count(*) AS v FROM %s WHERE batch = ANY (%L) AND release = %L', tbl, batches, release),
                                                         false, true, '')))[1]::text::int = cardinality(batches) AS ok
           FROM installs),
p8 AS (SELECT CASE WHEN to_regclass('workhub_private.p8_installs') IS NULL THEN ''
                   ELSE (xpath('/row/v/text()', query_to_xml('SELECT string_agg(batch, '','' ORDER BY batch) AS v FROM workhub_private.p8_installs', false, true, '')))[1]::text
              END AS done),
orig(batch, sig, body) AS (VALUES
  ('P8-01', 'workhub_private.p1_save_configuration(workhub_private.actor_context,jsonb)', '72fe77d4163a001db8ab874c681704e6'),
  ('P8-01', 'workhub_private.p7_plan_eval(workhub_private.actor_context,jsonb)', 'a36997815f0ed519be5b1adbf4fc66e1'),
  ('P8-03', 'workhub_private.p7_record_guard()', 'b3eb3cc35c1fada8393783d6a34c9f92'),
  ('P8-03', 'workhub_private.p7_resources(text,text,text,date,text)', '820fcc0a26e83ce2e7128e62bf7f45ac'),
  ('P8-03', 'workhub_private.p7_tr_preview(workhub_private.actor_context,jsonb)', '2df8d66d0b780204e7f3ba19da08e410'),
  ('P8-03', 'workhub_private.p7_tr_list(workhub_private.actor_context,text)', 'cc5d471a7281c60dfbc23350315653da'),
  ('P8-03', 'workhub_private.p7_tr_mutate(workhub_private.actor_context,jsonb,text)', 'a116760b4751729d358168dac5ce41e2'),
  ('P8-04', 'workhub_private.p5_current_assignment(workhub_private.actor_context,text)', 'b63862e27ab0f96ad3dbefc40f955a0b'),
  ('P8-04', 'workhub_private.p5_course_visible(workhub_private.actor_context,text)', '35e2b05d42be699a268271208ac76a6a'),
  ('P8-04', 'workhub_private.p5_catalog(workhub_private.actor_context)', '860a344da1281d56f0db538f71d3205e'),
  ('P8-04', 'workhub_private.p5_roster_import(workhub_private.actor_context,jsonb,text)', '27a2adb5c5d7b78f23249d78fe02d1ca'))
SELECT '점검' AS kind, 'C1 P1 · P2 · P3 · P5 · P7(2026-10-16.1) 적용' AS part,
       CASE WHEN bool_and(ok) THEN 'ok' ELSE 'FAIL' END AS status, NULL::text AS fingerprint, NULL::bigint AS items,
       COALESCE('없음: ' || string_agg(stage, ' · ') FILTER (WHERE NOT ok), 'P8-01 은 P1 · P7, P8-02 는 P2 · P3, P8-03 은 P7, P8-04 는 P5 를 바꾼다') AS note
  FROM inst
UNION ALL
SELECT '점검', 'C2 P8 적용 단계', 'info', NULL, NULL, CASE WHEN (SELECT done FROM p8) = '' THEN '미적용(P8-01 전)' ELSE (SELECT done FROM p8) END
UNION ALL
SELECT '점검', 'C3 바꿀 함수 11개가 원본 판(아직 적용하지 않은 P8 파일 몫만)',
       CASE WHEN count(*) FILTER (WHERE NOT position(o.batch IN (SELECT done FROM p8)) > 0
                                   AND (SELECT md5(replace(prosrc, chr(13), '')) FROM pg_proc WHERE oid = to_regprocedure(o.sig)) IS DISTINCT FROM o.body) = 0
            THEN 'ok' ELSE 'FAIL' END, NULL, count(*),
       COALESCE('원본과 다름: ' || string_agg(split_part(o.sig, '(', 1), ', ') FILTER (WHERE NOT position(o.batch IN (SELECT done FROM p8)) > 0
                AND (SELECT md5(replace(prosrc, chr(13), '')) FROM pg_proc WHERE oid = to_regprocedure(o.sig)) IS DISTINCT FROM o.body),
                'FAIL 이면 누가 고쳤는지 먼저 확인(해당 P8 파일이 멈춘다)')
  FROM orig o
UNION ALL
SELECT '점검', 'C4 공식 담당이 든 인계 기록 없음(P8-03 전)',
       CASE WHEN position('P8-03' IN (SELECT done FROM p8)) > 0 OR to_regclass('workhub.transition_items') IS NULL THEN 'ok'
            WHEN (xpath('/row/v/text()', query_to_xml('SELECT count(*) AS v FROM workhub.transition_items WHERE kind = ''duty''', false, true, '')))[1]::text = '0'
            THEN 'ok' ELSE 'FAIL' END, NULL, NULL, 'FAIL 이면 P8-03 이 멈춘다 — 관리자 확인 없이 만든 기록의 처리 방법을 먼저 정한다(P8-03 머리말)'
UNION ALL
SELECT '점검', 'C5 같은 이름 표 · 함수 없음(아직 적용하지 않은 P8 파일 몫)',
       CASE WHEN (SELECT done FROM p8) = 'P8-01,P8-02,P8-03,P8-04' OR (
              (to_regclass('workhub_private.p8_installs') IS NOT NULL OR NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname LIKE 'p8\_%'))
              AND (position('P8-04' IN (SELECT done FROM p8)) > 0 OR (to_regclass('workhub.teaching_relation_ends') IS NULL
                   AND NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname LIKE 'workhub\_teaching\_relation%' OR proname LIKE 'p8\_rel%' OR proname = 'p8_eff_to'))))
            THEN 'ok' ELSE 'FAIL' END, NULL, NULL, 'FAIL 이면 누가 만든 표 · 함수인지 먼저 확인(해당 P8 파일이 멈춘다)'
UNION ALL
SELECT '점검', 'C6 켜진 P8 모듈', 'info', NULL,
       (SELECT count(*) FROM workhub.module_activations WHERE module IN ('cooperation_notices','duty_admin_review','teaching_relations')),
       COALESCE((SELECT string_agg(module || ':' || state, ', ' ORDER BY module) FROM workhub.module_activations
                  WHERE module IN ('cooperation_notices','duty_admin_review','teaching_relations')), '(없음 — 켜기는 P8-06, PR #60 배포 뒤)')
UNION ALL
SELECT '지문', 'S1 열', 'ok',
       md5(COALESCE((SELECT string_agg(r.nspname || '.' || r.relname || '.' || a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull
                     || ':' || COALESCE(pg_get_expr(d.adbin, d.adrelid), ''), chr(10) ORDER BY r.nspname, r.relname, a.attnum)
                     FROM rels r JOIN pg_attribute a ON a.attrelid = r.oid AND a.attnum > 0 AND NOT a.attisdropped
                     LEFT JOIN pg_attrdef d ON d.adrelid = r.oid AND d.adnum = a.attnum), '')),
       (SELECT count(*) FROM rels), '실행 전 · 후 같아야 한다'
UNION ALL
SELECT '지문', 'S2 제약(P8 이 넓히는 4개 제외)', 'ok',
       md5(COALESCE((SELECT string_agg(r.nspname || '.' || r.relname || '.' || k.conname || ':' || pg_get_constraintdef(k.oid), chr(10) ORDER BY r.nspname, r.relname, k.conname)
                     FROM rels r JOIN pg_constraint k ON k.conrelid = r.oid WHERE k.conname NOT IN (SELECT n FROM p8_changed_con)), '')),
       NULL, '실행 전 · 후 같아야 한다'
UNION ALL
SELECT '지문', 'S3 트리거(P8 새 트리거 제외)', 'ok',
       md5(COALESCE((SELECT string_agg(r.nspname || '.' || r.relname || '.' || g.tgname || ':' || pg_get_triggerdef(g.oid), chr(10) ORDER BY r.nspname, r.relname, g.tgname)
                     FROM rels r JOIN pg_trigger g ON g.tgrelid = r.oid AND NOT g.tgisinternal WHERE g.tgname NOT LIKE 'p8\_%'), '')),
       NULL, '실행 전 · 후 같아야 한다'
UNION ALL
SELECT '지문', 'S4 함수(P8 새 함수 · 바꾸는 11개 제외)', 'ok',
       md5(COALESCE((SELECT string_agg(f.nspname || '.' || f.proname || '(' || pg_get_function_identity_arguments(p.oid) || '):'
                     || md5(replace(p.prosrc, chr(13), '')) || ':' || p.prosecdef || ':' || COALESCE(array_to_string(p.proconfig, ','), '')
                     || ':' || COALESCE(array_to_string(p.proacl, ','), ''), chr(10) ORDER BY f.nspname, f.proname, pg_get_function_identity_arguments(p.oid))
                     FROM fns f JOIN pg_proc p ON p.oid = f.oid), '')),
       (SELECT count(*) FROM fns), '실행 전 · 후 같아야 한다'
UNION ALL
SELECT '지문', 'S5 표 권한', 'ok',
       md5(COALESCE((SELECT string_agg(r.nspname || '.' || r.relname || ':' || COALESCE(array_to_string(c.relacl, ','), '') || ':' || c.relrowsecurity, chr(10) ORDER BY r.nspname, r.relname)
                     FROM rels r JOIN pg_class c ON c.oid = r.oid), '')),
       NULL, '실행 전 · 후 같아야 한다'
UNION ALL
SELECT '지문', 'S6 RLS 정책', 'ok',
       md5(COALESCE((SELECT string_agg(r.nspname || '.' || r.relname || '.' || pol.polname || ':' || pol.polcmd::text || ':' || COALESCE(pg_get_expr(pol.polqual, pol.polrelid), '')
                     || ':' || COALESCE(pg_get_expr(pol.polwithcheck, pol.polrelid), ''), chr(10) ORDER BY r.nspname, r.relname, pol.polname)
                     FROM rels r JOIN pg_policy pol ON pol.polrelid = r.oid), '')),
       NULL, '실행 전 · 후 같아야 한다'
UNION ALL
SELECT '지문', 'D1 기존 표 행 수 · 행 해시', 'ok',
       md5(COALESCE((SELECT string_agg(t || '=' || v, chr(10) ORDER BY t) FROM data), '')),
       (SELECT count(*) FROM data), '실행 전 · 후 같아야 한다(그사이 사용이 있었다면 달라질 수 있음 — 위 머리말)'
ORDER BY 1 DESC, 2;
