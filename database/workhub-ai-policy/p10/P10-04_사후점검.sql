-- 읽기 전용. 정상은 ok, 운영자가 확인할 상태는 info. 적용된 기존 SQL 지문은 새 통합 점검에서 별도 확인한다.
SELECT 'P10-AI-1' AS no,'신규 세 배치' AS item,CASE WHEN count(*)=3 THEN 'ok' ELSE 'FAIL' END AS status,count(*)::text AS value
FROM workhub_private.p10_ai_installs WHERE release='2026-10-21.1' AND batch IN('P10-AI-01','P10-AI-02','P10-AI-03')
UNION ALL
SELECT 'P10-AI-2','비밀·원장 표 RLS 및 API 직접권한 없음',
 CASE WHEN count(*)=8 AND bool_and(c.relrowsecurity) AND NOT bool_or(has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE')
  OR has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE') OR has_table_privilege('service_role',c.oid,'SELECT,INSERT,UPDATE,DELETE')) THEN 'ok' ELSE 'FAIL' END,count(*)::text
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE (n.nspname='workhub' AND c.relname IN('ai_school_policies','ai_school_controls','ai_credentials','ai_legacy_school_links','ai_gateway_requests','ai_gateway_closed_keys','ai_admin_requests')) OR (n.nspname='workhub_private' AND c.relname='p10_ai_installs')
UNION ALL
SELECT 'P10-AI-3','서버 gateway 5개는 service_role만',CASE WHEN count(*)=5 AND bool_and(has_function_privilege('service_role',p.oid,'EXECUTE'))
 AND NOT bool_or(has_function_privilege('anon',p.oid,'EXECUTE') OR has_function_privilege('authenticated',p.oid,'EXECUTE')) THEN 'ok' ELSE 'FAIL' END,count(*)::text
FROM pg_proc p WHERE pronamespace='public'::regnamespace AND proname LIKE 'workhub_ai_gateway_%'
UNION ALL
SELECT 'P10-AI-4','구 준비·시작 우회 차단',CASE WHEN NOT has_function_privilege('service_role','public.workhub_ai_prepare(uuid,text,jsonb,text)','EXECUTE')
 AND NOT has_function_privilege('service_role','public.workhub_ai_start(uuid,text,text,text)','EXECUTE') THEN 'ok' ELSE 'FAIL' END,''
UNION ALL
SELECT 'P10-AI-5','불변 원장·키·접수증 트리거',CASE WHEN count(*)=5 AND bool_and(tgenabled='O') THEN 'ok' ELSE 'FAIL' END,count(*)::text
FROM pg_trigger WHERE NOT tgisinternal AND tgname IN('ai_gateway_requests_guard','ai_gateway_closed_keys_immutable','ai_credentials_immutable','ai_admin_requests_immutable','ai_gateway_p6_bridge')
UNION ALL
SELECT 'P10-AI-6','알려진 P6 비용과 공통 원장 일치',CASE WHEN count(*)=0 THEN 'ok' ELSE 'FAIL' END,count(*)::text
FROM workhub.ai_gateway_requests g JOIN workhub.assistant_requests a ON a.id=g.assistant_request_id WHERE g.actual_micro_usd IS NOT NULL AND a.started_at IS NOT NULL AND g.actual_micro_usd IS DISTINCT FROM a.actual_micro_usd
UNION ALL
SELECT 'P10-AI-7','입력초과 관측은 정산 없이 학교 중지',CASE WHEN count(*)=0 THEN 'ok' ELSE 'FAIL' END,count(*)::text
FROM workhub.ai_gateway_requests g LEFT JOIN workhub.ai_school_controls c ON c.school_id=g.school_id WHERE g.observed_usage IS NOT NULL AND (g.actual_micro_usd IS NOT NULL OR c.overage_blocked IS DISTINCT FROM true)
UNION ALL
SELECT 'P10-AI-8','정책·키·학교 연결·켜짐 상태','info',jsonb_build_object('policies',(SELECT count(*) FROM workhub.ai_school_policies),'credentials',(SELECT count(*) FROM workhub.ai_credentials),'legacyLinks',(SELECT count(*) FROM workhub.ai_legacy_school_links WHERE revoked_at IS NULL),'enabled',(SELECT count(*) FROM workhub.ai_school_controls WHERE enabled),'blocked',(SELECT count(*) FROM workhub.ai_school_controls WHERE overage_blocked))::text;
