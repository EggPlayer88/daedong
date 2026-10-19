-- ============================================================================
-- R1-82  제거 전 점검 (읽기 전용 — DROP·DELETE 없음)
--
-- ▣ R1 은 "되돌림(DROP) 파일"을 두지 않는다. 문제가 생기면 R1-80(중지)으로 멈추고 자료를 보존한다.
--   R0-90 과 달리 R1 이 쓰이기 시작하면 교사가 올린 제출·파일이 생기고, 그것을 지우는 것은 되돌릴 수 없기 때문이다.
-- ▣ 정말 R1 을 걷어내야 할 때: 이 파일로 지금 남아 있는 자료·의존을 확인해 결과를 알려 주시면,
--   그 결과를 근거로 별도 승인용 제거 SQL 을 따로 작성한다(자료 내보내기 → 확인 → 제거 순서).
-- ▣ 읽는 법: count 가 0 이 아닌 '자료' 행은 지우면 사라지는 기록이다. '의존' 행은 R1 밖에서 R1 을 참조하는 객체로,
--   하나라도 있으면 제거 SQL 이 그것부터 다뤄야 한다.
-- ============================================================================
SELECT '자료' AS kind, x.t AS item,
       (xpath('/row/n/text()', query_to_xml(format('SELECT count(*) AS n FROM %s', x.t), false, true, '')))[1]::text::bigint AS count, x.note
  FROM (VALUES ('workhub.collections', '수합 요청'), ('workhub.collection_units', '제출 단위'), ('workhub.unit_drafts', '임시저장'),
               ('workhub.submission_versions', '제출판(교사가 낸 기록)'), ('workhub.submission_reviews', '검토 결과'),
               ('workhub.submission_withdrawals', '철회 기록'), ('workhub.file_objects', '파일 기록'),
               ('workhub.file_access_grants', '내려받기 허가 기록'), ('workhub.deletion_ledger', '정리 원장'),
               ('workhub.policy_versions', '정책판'), ('workhub_private.r1_switch_log', '중지·재개 기록')) x(t, note)
 WHERE to_regclass(x.t) IS NOT NULL
UNION ALL
SELECT '자료', 'storage.objects(workhub-collection-files)', count(*), 'Storage 실물 — 지우면 복구 불가. 제거 전에 내려받아 보관'
  FROM storage.objects WHERE bucket_id = 'workhub-collection-files'
UNION ALL
SELECT '자료', 'workhub.audit_events(R1 작업)', count(*), 'R0 감사 기록 안의 R1 행(지우지 않는다 — 감사 기록은 남김)'
  FROM workhub.audit_events WHERE operation LIKE 'collection.%' OR operation LIKE 'file.%'
UNION ALL
SELECT '의존', d.classid::regclass::text || ' ' || COALESCE(
         (SELECT n.nspname || '.' || c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE d.classid = 'pg_class'::regclass AND c.oid = d.objid),
         (SELECT p.oid::regprocedure::text FROM pg_proc p WHERE d.classid = 'pg_proc'::regclass AND p.oid = d.objid),
         (SELECT pol.polrelid::regclass::text || ' 정책 ' || pol.polname FROM pg_policy pol WHERE d.classid = 'pg_policy'::regclass AND pol.oid = d.objid),
         (SELECT '뷰 ' || r.ev_class::regclass::text FROM pg_rewrite r WHERE d.classid = 'pg_rewrite'::regclass AND r.oid = d.objid),
         d.objid::text), 1,
       '→ ' || d.refobjid::regclass::text
  FROM pg_depend d
 WHERE d.refclassid = 'pg_class'::regclass AND d.deptype = 'n'
   AND d.refobjid IN (SELECT c.oid FROM pg_class c WHERE c.relnamespace IN ('workhub'::regnamespace, 'workhub_private'::regnamespace)
                        AND c.relname IN ('collections','collection_units','unit_drafts','submission_versions','submission_reviews','submission_withdrawals',
                                          'file_objects','file_access_grants','deletion_ledger','policy_versions','file_verification_jobs'))
   AND NOT EXISTS (SELECT 1 FROM pg_class c WHERE d.classid = 'pg_class'::regclass AND c.oid = d.objid
                     AND c.relnamespace IN ('workhub'::regnamespace, 'workhub_private'::regnamespace, 'workhub_storage'::regnamespace))
   AND NOT EXISTS (SELECT 1 FROM pg_proc p WHERE d.classid = 'pg_proc'::regclass AND p.oid = d.objid
                     AND (p.pronamespace IN ('workhub'::regnamespace, 'workhub_private'::regnamespace, 'workhub_storage'::regnamespace)
                          OR p.proname LIKE 'workhub\_collection\_%' OR p.proname LIKE 'workhub\_file\_%'))
   AND NOT EXISTS (SELECT 1 FROM pg_constraint co WHERE d.classid = 'pg_constraint'::regclass AND co.oid = d.objid
                     AND co.connamespace IN ('workhub'::regnamespace, 'workhub_private'::regnamespace))
   AND NOT EXISTS (SELECT 1 FROM pg_type t WHERE d.classid = 'pg_type'::regclass AND t.oid = d.objid
                     AND t.typnamespace IN ('workhub'::regnamespace, 'workhub_private'::regnamespace))
   AND NOT EXISTS (SELECT 1 FROM pg_rewrite r JOIN pg_class c ON c.oid = r.ev_class WHERE d.classid = 'pg_rewrite'::regclass AND r.oid = d.objid
                     AND c.relnamespace IN ('workhub'::regnamespace, 'workhub_private'::regnamespace))
   AND NOT EXISTS (SELECT 1 FROM pg_trigger tg JOIN pg_class c ON c.oid = tg.tgrelid WHERE d.classid = 'pg_trigger'::regclass AND tg.oid = d.objid
                     AND c.relnamespace IN ('workhub'::regnamespace, 'workhub_private'::regnamespace))
   AND NOT EXISTS (SELECT 1 FROM pg_attrdef ad JOIN pg_class c ON c.oid = ad.adrelid WHERE d.classid = 'pg_attrdef'::regclass AND ad.oid = d.objid
                     AND c.relnamespace IN ('workhub'::regnamespace, 'workhub_private'::regnamespace))
ORDER BY 1 DESC, 2;
