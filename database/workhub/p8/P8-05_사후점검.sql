-- ============================================================================
-- P8-05  정책 보강(P8) 사후 점검 (읽기 전용 — 아무것도 바꾸지 않는다. 언제 실행해도 된다)
--
-- ▣ 무엇을 보나: 적용한 P8 파일(P8-01~04)마다 그 파일이 만든 · 바꾼 것이 제자리에 있는지, 권한이 닫혀 있는지, 켜기 상태가 어떤지.
--   적용하지 않은 파일의 행은 info("미적용")로 나온다 — 파일은 P8-01 → 02 → 03 → 04 순서로 하나씩 적용해도 된다.
--   함수 본문 · 제약 정의의 정확한 지문 대조는 INT-03(통합 사후 점검)이 한다. 이 파일은 사람이 읽기 쉬운 요약이다.
-- ▣ 읽는 법: status 에 FAIL 이 없어야 한다. P8-05-10 은 켜기 상태(info) — 켜기는 PR #60 배포 뒤 P8-06 으로만.
-- ============================================================================
WITH done AS (SELECT CASE WHEN to_regclass('workhub_private.p8_installs') IS NULL THEN ''
                          ELSE COALESCE((xpath('/row/v/text()', query_to_xml('SELECT string_agg(batch || ''@'' || release, '','' ORDER BY batch) AS v FROM workhub_private.p8_installs',
                                                                             false, true, '')))[1]::text, '') END AS v),
has AS (SELECT b, (',' || (SELECT v FROM done) || ',') LIKE ('%,' || b || '@2026-10-16.1,%') AS ok
          FROM unnest(ARRAY['P8-01','P8-02','P8-03','P8-04']) b),
api_exec AS (SELECT p.oid, n.nspname, p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
              WHERE (has_function_privilege('anon', p.oid, 'EXECUTE') OR has_function_privilege('authenticated', p.oid, 'EXECUTE')
                     OR has_function_privilege('service_role', p.oid, 'EXECUTE'))
                AND ((n.nspname = 'workhub_private' AND (p.proname LIKE 'p8\_%' OR p.proname IN ('p1_save_configuration','p7_plan_eval','p7_record_guard',
                       'p7_resources','p7_tr_preview','p7_tr_list','p7_tr_mutate','p5_current_assignment','p5_course_visible','p5_catalog','p5_roster_import')))))
SELECT 'P8-05-01' AS no, '적용 기록(판 2026-10-16.1, 순서대로)' AS item,
       CASE WHEN NOT (SELECT ok FROM has WHERE b = 'P8-01') AND EXISTS (SELECT 1 FROM has WHERE ok) THEN 'FAIL'
            WHEN NOT EXISTS (SELECT 1 FROM has WHERE ok) THEN 'info' ELSE 'ok' END AS status,
       COALESCE(NULLIF(replace((SELECT v FROM done), ',', ' · '), ''), '미적용') AS value
UNION ALL
SELECT 'P8-05-02', 'P8-01 새 학년도 시작 연도 검사(P1 학교 관리 · P7 업무 전환)',
       CASE WHEN NOT (SELECT ok FROM has WHERE b = 'P8-01') THEN 'info'
            WHEN (SELECT prosrc FROM pg_proc WHERE oid = 'workhub_private.p1_save_configuration(workhub_private.actor_context,jsonb)'::regprocedure) LIKE '%P8-01 · Q4%'
             AND (SELECT prosrc FROM pg_proc WHERE oid = 'workhub_private.p7_plan_eval(workhub_private.actor_context,jsonb)'::regprocedure) LIKE '%P8-01 · Q4%'
            THEN 'ok' ELSE 'FAIL' END,
       CASE WHEN (SELECT ok FROM has WHERE b = 'P8-01') THEN '두 경로 모두 시작일 연도 = 학년도 숫자' ELSE '미적용' END
UNION ALL
SELECT 'P8-05-03', 'P8-02 협업 알림: 출처 CHECK 에 cooperation · 협업 이력 트리거 1개(켜지 않으면 알림 0)',
       CASE WHEN NOT (SELECT ok FROM has WHERE b = 'P8-02') THEN 'info'
            WHEN (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid = 'workhub.notifications'::regclass AND conname = 'notifications_source_check')
                   LIKE '%''cooperation''::text%'
             AND (SELECT count(*) FROM pg_trigger WHERE tgname = 'p8_coop_notice' AND tgrelid = 'workhub.cooperation_history'::regclass AND tgenabled = 'O') = 1
            THEN 'ok' ELSE 'FAIL' END,
       CASE WHEN (SELECT ok FROM has WHERE b = 'P8-02')
            THEN '협업 출처 알림 ' || (SELECT count(*) FROM workhub.notifications WHERE source_module = 'cooperation') || '건' ELSE '미적용' END
UNION ALL
SELECT 'P8-05-04', 'P8-03 업무 인계 관리자 확인: 상태 · 이력 CHECK 넓힘',
       CASE WHEN NOT (SELECT ok FROM has WHERE b = 'P8-03') THEN 'info'
            WHEN (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid = 'workhub.transition_records'::regclass AND conname = 'transition_records_shape_check') LIKE '%awaiting_admin%'
             AND (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid = 'workhub.transition_records'::regclass AND conname = 'transition_records_version_check') LIKE '%awaiting_admin%'
             AND (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid = 'workhub.transition_history'::regclass AND conname = 'transition_history_action_check') LIKE '%admin_confirm%'
            THEN 'ok' ELSE 'FAIL' END,
       CASE WHEN (SELECT ok FROM has WHERE b = 'P8-03')
            THEN '확인 대기 ' || (SELECT count(*) FROM workhub.transition_records WHERE state = 'awaiting_admin') || '건' ELSE '미적용' END
UNION ALL
SELECT 'P8-05-05', 'P8-03 공식 담당 인계 기록은 모두 관리자 확인 흐름(확인 없이 pending 이 된 기록 없음)',
       CASE WHEN NOT (SELECT ok FROM has WHERE b = 'P8-03') THEN 'info'
            WHEN NOT EXISTS (SELECT 1 FROM workhub.transition_records t
                              WHERE EXISTS (SELECT 1 FROM workhub.transition_items i WHERE i.record_id = t.id AND i.kind = 'duty')
                                AND (NOT EXISTS (SELECT 1 FROM workhub.transition_history h WHERE h.record_id = t.id AND h.version = 1 AND h.action = 'apply')
                                     OR (t.version >= 2 AND NOT EXISTS (SELECT 1 FROM workhub.transition_history h WHERE h.record_id = t.id AND h.version = 2
                                                                         AND h.action IN ('admin_confirm','admin_reject','cancel')))
                                     OR (t.state = 'accepted' AND NOT EXISTS (SELECT 1 FROM workhub.transition_history h WHERE h.record_id = t.id
                                                                               AND h.action = 'admin_confirm'))))
            THEN 'ok' ELSE 'FAIL' END, ''
UNION ALL
SELECT 'P8-05-06', 'P8-04 수업 관계: 새 표 3개 RLS · 트리거 5개 · 공개 함수 3개',
       CASE WHEN NOT (SELECT ok FROM has WHERE b = 'P8-04') THEN 'info'
            WHEN (SELECT count(*) FROM pg_class WHERE oid IN (to_regclass('workhub.teaching_relation_ends'), to_regclass('workhub.teaching_relation_previews'),
                                                              to_regclass('workhub.teaching_relation_commits')) AND relrowsecurity) = 3
             AND (SELECT count(*) FROM pg_trigger WHERE tgname IN ('p8_rel_record_guard','p8_rel_adopt_guard','p8_rel_import_guard','p8_rel_membership_guard')
                    AND tgenabled = 'O') = 5
             AND (SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname LIKE 'workhub\_teaching\_relation%') = 3
            THEN 'ok' ELSE 'FAIL' END,
       CASE WHEN (SELECT ok FROM has WHERE b = 'P8-04')
            THEN (xpath('/row/v/text()', query_to_xml($q$SELECT '종료 사건 ' || (SELECT count(*) FROM workhub.teaching_relation_ends) || '건 · 확정 '
                                                         || (SELECT count(*) FROM workhub.teaching_relation_commits) || '건' AS v$q$, false, true, '')))[1]::text
            ELSE '미적용' END
UNION ALL
SELECT 'P8-05-07', 'P8-04 종료된 관계 뒤에 남은 기록 없음(종료일 뒤 날짜의 관찰 · 상담 · 평가)',
       -- 표 · 함수가 P8-04 적용 전에는 없으므로 문자열 질의로 읽는다(미적용이면 실행하지 않음)
       CASE WHEN NOT (SELECT ok FROM has WHERE b = 'P8-04') THEN 'info'
            WHEN (xpath('/row/v/text()', query_to_xml($q$SELECT count(*) AS v FROM (
                     SELECT 1 FROM workhub.teaching_records r JOIN workhub.teaching_record_revisions v ON v.id = r.current_revision_id
                       JOIN workhub.course_memberships m ON m.id = r.course_membership_id JOIN workhub.course_assignments a ON a.id = r.assignment_id
                      WHERE r.state = 'active' AND (v.occurred_on >= workhub_private.p8_eff_to('course_membership', m.id, m.valid_from, m.valid_to)
                                                    OR v.occurred_on >= workhub_private.p8_eff_to('assignment', a.id, a.valid_from, a.valid_to))
                     UNION ALL
                     SELECT 1 FROM workhub.assessments x JOIN workhub.assessment_revisions v ON v.id = x.current_revision_id
                       JOIN workhub.course_memberships m ON m.id = x.course_membership_id JOIN workhub.course_assignments a ON a.id = x.assignment_id
                      WHERE x.state = 'active' AND (v.occurred_on >= workhub_private.p8_eff_to('course_membership', m.id, m.valid_from, m.valid_to)
                                                    OR v.occurred_on >= workhub_private.p8_eff_to('assignment', a.id, a.valid_from, a.valid_to))) z$q$,
                                                       false, true, '')))[1]::text = '0'
            THEN 'ok' ELSE 'FAIL' END, ''
UNION ALL
SELECT 'P8-05-08', 'P8 내부 함수 · 바꾼 함수는 API 역할이 실행할 수 없음',
       CASE WHEN NOT EXISTS (SELECT 1 FROM has WHERE ok) THEN 'info' WHEN NOT EXISTS (SELECT 1 FROM api_exec) THEN 'ok' ELSE 'FAIL' END,
       COALESCE((SELECT string_agg(proname, ', ') FROM api_exec), '')
UNION ALL
SELECT 'P8-05-09', 'P8-04 공개 함수 3개는 authenticated 만(anon · service_role 불가)',
       CASE WHEN NOT (SELECT ok FROM has WHERE b = 'P8-04') THEN 'info'
            WHEN (SELECT bool_and(has_function_privilege('authenticated', p.oid, 'EXECUTE') AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
                                 AND NOT has_function_privilege('service_role', p.oid, 'EXECUTE'))
                    FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname LIKE 'workhub\_teaching\_relation%') THEN 'ok' ELSE 'FAIL' END, ''
UNION ALL
SELECT 'P8-05-10', '켜기 상태(info) — 켜기는 PR #60 배포 뒤 P8-06 으로만', 'info',
       COALESCE((SELECT string_agg(s.code || ':' || a.module || '=' || a.state, ', ' ORDER BY s.code, a.module)
                   FROM workhub.module_activations a JOIN workhub.schools s ON s.id = a.school_id
                  WHERE a.module IN ('cooperation_notices','duty_admin_review','teaching_relations')), '(활성화 없음)')
ORDER BY 1;
