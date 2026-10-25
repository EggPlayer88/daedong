-- MP1-02 읽기 전용 사후 점검. 01~06 ok, 07 info(허용 상태).
WITH expected(kind,key,attrs) AS (
 SELECT x->>0,x->>1,x->2 FROM jsonb_array_elements($mp1$[["column","workhub.messaging_pilot_grants.active",{"api":"","type":"boolean","default":"false","notNull":true,"identity":"","position":5,"generated":""}],["column","workhub.messaging_pilot_grants.approval_ref",{"api":"","type":"text","default":"","notNull":true,"identity":"","position":8,"generated":""}],["column","workhub.messaging_pilot_grants.approved_by_membership_id",{"api":"","type":"text","default":"","notNull":true,"identity":"","position":7,"generated":""}],["column","workhub.messaging_pilot_grants.auth_user_id",{"api":"","type":"uuid","default":"","notNull":true,"identity":"","position":2,"generated":""}],["column","workhub.messaging_pilot_grants.expires_at",{"api":"","type":"timestamp with time zone","default":"","notNull":true,"identity":"","position":6,"generated":""}],["column","workhub.messaging_pilot_grants.membership_id",{"api":"","type":"text","default":"","notNull":true,"identity":"","position":4,"generated":""}],["column","workhub.messaging_pilot_grants.revision",{"api":"","type":"integer","default":"1","notNull":true,"identity":"","position":9,"generated":""}],["column","workhub.messaging_pilot_grants.school_id",{"api":"","type":"text","default":"","notNull":true,"identity":"","position":3,"generated":""}],["column","workhub.messaging_pilot_grants.singleton",{"api":"","type":"boolean","default":"true","notNull":true,"identity":"","position":1,"generated":""}],["column","workhub.messaging_pilot_grants.updated_at",{"api":"","type":"timestamp with time zone","default":"now()","notNull":true,"identity":"","position":10,"generated":""}],["column","workhub_private.mp1_installs.batch",{"api":"","type":"text","default":"","notNull":true,"identity":"","position":1,"generated":""}],["column","workhub_private.mp1_installs.installed_at",{"api":"","type":"timestamp with time zone","default":"now()","notNull":true,"identity":"","position":2,"generated":""}],["constraint","workhub.messaging_pilot_grants.messaging_pilot_grants_approval_ref_check",{"def":"48aeb19318dac4fb3e19cd9d2c4abfe0"}],["constraint","workhub.messaging_pilot_grants.messaging_pilot_grants_auth_user_id_fkey",{"def":"5dfa121d9db9eae66de63a0d11788f4f"}],["constraint","workhub.messaging_pilot_grants.messaging_pilot_grants_pkey",{"def":"7511e9a8e50c073e1d6eff73afcc0f24"}],["constraint","workhub.messaging_pilot_grants.messaging_pilot_grants_revision_check",{"def":"27243795341cf9da4287f90413a06c79"}],["constraint","workhub.messaging_pilot_grants.messaging_pilot_grants_school_id_approved_by_membership_id_fkey",{"def":"c3c633b5f15d8a165d631a1e608b6f8e"}],["constraint","workhub.messaging_pilot_grants.messaging_pilot_grants_school_id_membership_id_fkey",{"def":"5ecc686c401cd1fa9882643789a10c87"}],["constraint","workhub.messaging_pilot_grants.messaging_pilot_grants_singleton_check",{"def":"ae6f6dfbe38290d5bfa8f3e96d1aff91"}],["constraint","workhub_private.mp1_installs.mp1_installs_batch_check",{"def":"e5708b1883eecd32f7bf8d50bbc15947"}],["constraint","workhub_private.mp1_installs.mp1_installs_pkey",{"def":"5eb69cfd4e109f955660d3e01ab61c1a"}],["function","public.workhub_inbox_list(p_member_id text, p_unread_only boolean, p_cursor text)",{"eff":"authenticated","body":"e756b9f9020c66d07130002578e902ae","exec":"authenticated","lang":"plpgsql","config":"search_path=\"\"","result":"jsonb","secdef":true}],["function","public.workhub_message_file_access(p_member_id text, p_thread_id text, p_message_id text, p_file_id text)",{"eff":"authenticated","body":"be6e985b3f972dcbdf7808b3d24dd56a","exec":"authenticated","lang":"plpgsql","config":"search_path=\"\"","result":"jsonb","secdef":true}],["function","public.workhub_message_file_complete(p_member_id text, p_file_id text, p_request_key text)",{"eff":"authenticated","body":"77a2aaacbb7a05f138a08e30a986ccad","exec":"authenticated","lang":"plpgsql","config":"search_path=\"\"","result":"jsonb","secdef":true}],["function","public.workhub_message_file_prepare(p_member_id text, p_file jsonb, p_request_key text, p_replay_only boolean)",{"eff":"authenticated","body":"c3cd859219c058c69ac16e9b807b2268","exec":"authenticated","lang":"plpgsql","config":"search_path=\"\"","result":"jsonb","secdef":true}],["function","public.workhub_message_file_readiness(p_member_id text)",{"eff":"authenticated","body":"907222a37cbc705c6f831107af766eac","exec":"authenticated","lang":"plpgsql","config":"search_path=\"\"","result":"jsonb","secdef":true}],["function","public.workhub_message_file_status(p_member_id text, p_file_id text)",{"eff":"authenticated","body":"b1a8409eded30c7c9b0b3ffd713177dc","exec":"authenticated","lang":"plpgsql","config":"search_path=\"\"","result":"jsonb","secdef":true}],["function","public.workhub_message_get(p_member_id text, p_thread_id text, p_before_cursor text)",{"eff":"authenticated","body":"4ea48f33326e646e1703d71f22fce76e","exec":"authenticated","lang":"plpgsql","config":"search_path=\"\"","result":"jsonb","secdef":true}],["function","public.workhub_message_mutate(p_member_id text, p_command jsonb, p_request_key text, p_replay_only boolean)",{"eff":"authenticated","body":"981b19759a63c67d9ad75631550fb428","exec":"authenticated","lang":"plpgsql","config":"search_path=\"\"","result":"jsonb","secdef":true}],["function","public.workhub_message_recipients(p_member_id text, p_query text, p_cursor text)",{"eff":"authenticated","body":"11fb9249b59a9cf343739fd961a45e21","exec":"authenticated","lang":"plpgsql","config":"search_path=\"\"","result":"jsonb","secdef":true}],["function","public.workhub_message_threads(p_member_id text, p_query text, p_unread_only boolean, p_cursor text)",{"eff":"authenticated","body":"90aa1e1c336600c3c2be53135dc3ac64","exec":"authenticated","lang":"plpgsql","config":"search_path=\"\"","result":"jsonb","secdef":true}],["function","public.workhub_messaging_pilot_access()",{"eff":"authenticated","body":"9e04d78438f74659a8a9523c7004d733","exec":"authenticated","lang":"plpgsql","config":"search_path=\"\"","result":"jsonb","secdef":true}],["function","public.workhub_messaging_pilot_context()",{"eff":"authenticated","body":"c177754d27a2623e2d3688e899874b78","exec":"authenticated","lang":"plpgsql","config":"search_path=\"\"","result":"jsonb","secdef":true}],["function","public.workhub_messaging_readiness(p_member_id text)",{"eff":"authenticated","body":"dd8a5f697b4f8a830b6a14528fed8259","exec":"authenticated","lang":"plpgsql","config":"search_path=\"\"","result":"jsonb","secdef":true}],["function","workhub_private.mp1_actor(p_member_id text, p_lock boolean)",{"eff":"","body":"69b65d1bc0db969eca3113e5d6cea079","exec":"","lang":"plpgsql","config":"search_path=\"\"","result":"workhub_private.actor_context","secdef":true}],["function","workhub_private.mp1_allowed(p_school text, p_member text)",{"eff":"","body":"4098026f8c9f98464ab713e33870050e","exec":"","lang":"sql","config":"search_path=\"\"","result":"boolean","secdef":true}],["function","workhub_private.p3_reachable(p_school text, p_membership text)",{"eff":"","body":"33dfff16c5ab8d1cd11fee4df9a3638d","exec":"","lang":"sql","config":"search_path=\"\"","result":"boolean","secdef":true}],["function","workhub_private.p3_service_member(p_actor uuid, p_member text)",{"eff":"","body":"4b5660bbe0165aaa463d6e84c44be78f","exec":"","lang":"plpgsql","config":"search_path=\"\"","result":"workhub_private.actor_context","secdef":true}],["function","workhub_storage.message_insertable(p_name text)",{"eff":"authenticated","body":"066cf1d0500c6e85dfd15590d648fb71","exec":"authenticated","lang":"plpgsql","config":"search_path=\"\"","result":"boolean","secdef":true}],["function","workhub_storage.message_readable(p_name text, p_object uuid)",{"eff":"authenticated","body":"54c3908bf500d24886df80e3c730cbdf","exec":"authenticated","lang":"plpgsql","config":"search_path=\"\"","result":"boolean","secdef":true}],["index","workhub.messaging_pilot_grants.messaging_pilot_grants_pkey",{"ready":true,"valid":true,"definition":"CREATE UNIQUE INDEX messaging_pilot_grants_pkey ON workhub.messaging_pilot_grants USING btree (singleton)"}],["index","workhub_private.mp1_installs.mp1_installs_pkey",{"ready":true,"valid":true,"definition":"CREATE UNIQUE INDEX mp1_installs_pkey ON workhub_private.mp1_installs USING btree (batch)"}],["table","workhub.messaging_pilot_grants",{"api":"","rls":true,"kind":"r","owner":"postgres","forceRls":false,"persistence":"p"}],["table","workhub_private.mp1_installs",{"api":"","rls":true,"kind":"r","owner":"postgres","forceRls":false,"persistence":"p"}]]$mp1$::jsonb) x
), actual(kind,key,attrs,owner) AS (SELECT 'function' AS kind, n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' AS key,
         jsonb_build_object('result', pg_get_function_result(p.oid), 'lang', l.lanname, 'secdef', p.prosecdef,
           'config', COALESCE(array_to_string(p.proconfig, ' '), ''),
           'exec', COALESCE((SELECT string_agg(g, ' ' ORDER BY g) FROM (SELECT DISTINCT CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE r.rolname END AS g
                      FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a LEFT JOIN pg_roles r ON r.oid = a.grantee
                     WHERE a.privilege_type = 'EXECUTE' AND (a.grantee = 0 OR r.rolname IN ('anon','authenticated','service_role'))) x), ''),
           'eff', COALESCE((SELECT string_agg(r.rolname, ' ' ORDER BY r.rolname) FROM pg_roles r
                     WHERE r.rolname IN ('anon','authenticated','service_role') AND has_function_privilege(r.oid, p.oid, 'EXECUTE')), ''),
           'body', md5(replace(p.prosrc, chr(13), ''))) AS attrs,
         (SELECT rolname FROM pg_roles WHERE oid = p.proowner)::text AS owner
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace JOIN pg_language l ON l.oid = p.prolang
   WHERE n.nspname IN ('workhub','workhub_private','workhub_storage') OR (n.nspname = 'public' AND p.proname LIKE 'workhub\_%')
  UNION ALL
  SELECT 'trigger', c.relnamespace::regnamespace::text || '.' || c.relname || '.' || t.tgname,
         jsonb_build_object('def', md5(pg_get_triggerdef(t.oid)), 'enabled', t.tgenabled::text), NULL
    FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_proc f ON f.oid = t.tgfoid
   WHERE NOT t.tgisinternal AND (c.relnamespace::regnamespace::text IN ('workhub','workhub_private','workhub_storage')
                                 OR f.pronamespace::regnamespace::text IN ('workhub','workhub_private','workhub_storage'))
  UNION ALL
  SELECT 'constraint', c.relnamespace::regnamespace::text || '.' || c.relname || '.' || k.conname,
         jsonb_build_object('def', md5(pg_get_constraintdef(k.oid))), NULL
    FROM pg_constraint k JOIN pg_class c ON c.oid = k.conrelid
   WHERE c.relnamespace::regnamespace::text IN ('workhub','workhub_private','workhub_storage')
  UNION ALL
  SELECT 'policy', schemaname || '.' || tablename || '.' || policyname,
         jsonb_build_object('def', md5(concat_ws('|', permissive, roles::text, cmd, qual, with_check))), NULL
    FROM pg_policies WHERE policyname LIKE 'workhub%' OR schemaname IN ('workhub','workhub_private','workhub_storage')
 UNION ALL
 SELECT 'table',n.nspname||'.'||c.relname,
  jsonb_build_object('kind',c.relkind,'persistence',c.relpersistence,'rls',c.relrowsecurity,'forceRls',c.relforcerowsecurity,
    'owner',pg_get_userbyid(c.relowner),
    'api',coalesce((SELECT string_agg(r.role||':'||p.privilege,' ' ORDER BY r.role,p.privilege)
      FROM unnest(ARRAY['anon','authenticated','service_role']) r(role)
      CROSS JOIN unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p(privilege)
      WHERE has_table_privilege(r.role,c.oid,p.privilege)),'')),NULL
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname IN ('workhub','workhub_private','workhub_storage') AND c.relkind IN ('r','p','v','m')
 UNION ALL
 SELECT 'column',n.nspname||'.'||c.relname||'.'||a.attname,
  jsonb_build_object('position',a.attnum,'type',format_type(a.atttypid,a.atttypmod),'notNull',a.attnotnull,
   'identity',a.attidentity,'generated',a.attgenerated,'default',coalesce(pg_get_expr(d.adbin,d.adrelid),''),
   'api',coalesce((SELECT string_agg(r.role||':'||p.privilege,' ' ORDER BY r.role,p.privilege)
    FROM unnest(ARRAY['anon','authenticated','service_role']) r(role)
    CROSS JOIN unnest(ARRAY['SELECT','INSERT','UPDATE','REFERENCES']) p(privilege)
    WHERE has_column_privilege(r.role,c.oid,a.attnum,p.privilege)),'')),NULL
 FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
 LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
 WHERE n.nspname IN ('workhub','workhub_private','workhub_storage') AND c.relkind IN ('r','p','v','m') AND a.attnum>0 AND NOT a.attisdropped
 UNION ALL
 SELECT 'index',n.nspname||'.'||t.relname||'.'||c.relname,
  jsonb_build_object('definition',pg_get_indexdef(c.oid),'valid',i.indisvalid,'ready',i.indisready),NULL
 FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid JOIN pg_class t ON t.oid=i.indrelid JOIN pg_namespace n ON n.oid=t.relnamespace
 WHERE n.nspname IN ('workhub','workhub_private','workhub_storage')
 UNION ALL
 SELECT 'schema',n.nspname,
  jsonb_build_object('owner',pg_get_userbyid(n.nspowner),'api',coalesce((SELECT string_agg(r.role||':'||p.privilege,' ' ORDER BY r.role,p.privilege)
    FROM unnest(ARRAY['anon','authenticated','service_role']) r(role) CROSS JOIN unnest(ARRAY['USAGE','CREATE']) p(privilege)
    WHERE has_schema_privilege(r.role,n.oid,p.privilege)),'')),NULL
 FROM pg_namespace n WHERE n.nspname IN ('workhub','workhub_private','workhub_storage')
 UNION ALL
 SELECT 'enum',n.nspname||'.'||t.typname,
  jsonb_build_object('values',(SELECT jsonb_agg(e.enumlabel ORDER BY e.enumsortorder) FROM pg_enum e WHERE e.enumtypid=t.oid)),NULL
 FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname IN ('workhub','workhub_private','workhub_storage') AND t.typtype='e'
), differences AS (
 SELECT e.kind,e.key FROM expected e LEFT JOIN actual a USING(kind,key)
 WHERE a.attrs IS DISTINCT FROM e.attrs
), groups(no,kind,item) AS (VALUES ('01','function','메신저 한정 함수 19개 원문·실효 권한'),
 ('02','table','표·RLS·소유자·실효 권한'),('03','column','열·기본값·실효 권한'),
 ('04','constraint','허용 인원·소속·학교 제약'),('05','index','인덱스'))
SELECT 'MP1-02-'||g.no AS no,g.item,
 CASE WHEN EXISTS(SELECT 1 FROM differences d WHERE d.kind=g.kind) THEN 'FAIL' ELSE 'ok' END AS status,
 coalesce((SELECT string_agg(d.key,', ' ORDER BY d.key) FROM differences d WHERE d.kind=g.kind),'') AS value
FROM groups g
UNION ALL SELECT 'MP1-02-06','함수 소유자 postgres',CASE WHEN EXISTS(
 SELECT 1 FROM expected e LEFT JOIN actual a USING(kind,key) WHERE e.kind='function' AND a.owner IS DISTINCT FROM 'postgres') THEN 'FAIL' ELSE 'ok' END,''
UNION ALL SELECT 'MP1-02-07','시험 계정 허용 상태','info',
 jsonb_build_object('registered',count(*),'active',count(*) FILTER(WHERE active AND expires_at>clock_timestamp()))::text
 FROM workhub.messaging_pilot_grants
ORDER BY no;
