-- 나이스 급식·학사일정·공개 학급 시간표. 기존 SQL·권한·시간표는 수정하지 않는다.
-- 운영 적용은 사용자 검토 후. N1-03 연결 등록 전에는 활성 학교가 없다.
BEGIN;
DO $$ BEGIN
 IF to_regprocedure('public.workhub_calendar_save(text,jsonb)') IS NULL OR to_regprocedure('workhub_private.p2_exact(jsonb,text[])') IS NULL THEN RAISE EXCEPTION 'N1: R0·P2 설치를 먼저 확인하세요'; END IF;
END $$;
CREATE SCHEMA neis_private;
REVOKE ALL ON SCHEMA neis_private FROM PUBLIC,anon,authenticated,service_role;

CREATE TABLE neis_private.connections(
 school_id text PRIMARY KEY REFERENCES workhub.schools(id),
 office_code text NOT NULL CHECK(office_code ~ '^[A-Z][0-9]{2}$'),
 school_code text NOT NULL CHECK(school_code ~ '^[0-9]{7}$'),
 school_name text NOT NULL, active boolean NOT NULL DEFAULT false,
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE neis_private.datasets(
 school_id text NOT NULL REFERENCES neis_private.connections(school_id),
 kind text NOT NULL CHECK(kind IN ('meals','schedule','timetable','classes')),
 school_year integer NOT NULL CHECK(school_year BETWEEN 2020 AND 2100),
 from_date date NOT NULL, to_date date NOT NULL CHECK(to_date>=from_date),
 version integer NOT NULL DEFAULT 0, items jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(items)='array'),
 previous_items jsonb, checked_at timestamptz, attempted_at timestamptz, error_code text,
 lease_id uuid, lease_until timestamptz,
 PRIMARY KEY(school_id,kind,school_year,from_date,to_date)
);
CREATE TABLE neis_private.schedule_sources(
 id text PRIMARY KEY DEFAULT gen_random_uuid()::text, school_id text NOT NULL REFERENCES neis_private.connections(school_id),
 school_year integer NOT NULL, identity text NOT NULL, data jsonb NOT NULL,
 version integer NOT NULL DEFAULT 1, present boolean NOT NULL DEFAULT true,
 event_id text REFERENCES workhub.events(id), baseline jsonb, dismissed_hash text, superseded_by text,
 UNIQUE(school_id,school_year,identity), UNIQUE(school_id,event_id)
);
CREATE TABLE neis_private.receipts(
 school_id text NOT NULL, member_id text NOT NULL, request_key text NOT NULL, command jsonb NOT NULL,
 result jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(school_id,member_id,request_key)
);
ALTER TABLE neis_private.connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE neis_private.datasets ENABLE ROW LEVEL SECURITY;
ALTER TABLE neis_private.schedule_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE neis_private.receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA neis_private FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION neis_private.check_range(k text,y integer,a date,b date) RETURNS void
LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF k IS NULL OR k NOT IN ('meals','schedule','timetable','classes') OR y IS NULL OR y NOT BETWEEN 2020 AND 2100
 OR a IS NULL OR b IS NULL OR a>b OR
 (k='meals' AND b-a>=62) OR (k='timetable' AND b-a>=14) OR
 (k IN ('schedule','classes') AND (a<>make_date(y,3,1) OR b<>make_date(y+1,3,1)-1))
 THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
END $$;

CREATE FUNCTION neis_private.can_manage(c workhub_private.actor_context) RETURNS boolean
LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT workhub_private.member_has_perm(c,'calendar.shared_manage')
$$;

CREATE FUNCTION public.workhub_neis_status(p_member_id text,p_kind text,p_year integer,p_from date,p_to date) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c workhub_private.actor_context; cfg neis_private.connections; d neis_private.datasets; rows jsonb; manage boolean;
BEGIN
 c:=workhub_private.member_actor(p_member_id,false);
 PERFORM neis_private.check_range(p_kind,p_year,p_from,p_to);
 manage:=neis_private.can_manage(c);
 SELECT * INTO cfg FROM neis_private.connections WHERE school_id=c.school_id;
 SELECT * INTO d FROM neis_private.datasets WHERE school_id=c.school_id AND kind=p_kind AND school_year=p_year AND from_date=p_from AND to_date=p_to;
 rows:=COALESCE(d.items,'[]'::jsonb);
 IF p_kind='schedule' THEN
  IF manage THEN
   SELECT COALESCE(jsonb_agg(jsonb_build_object('id',s.id,'version',s.version,'data',s.data,'present',s.present,
    'eventId',s.event_id,'baseline',s.baseline,'dismissed',COALESCE(s.dismissed_hash=s.data->>'contentHash',false),'supersededBy',s.superseded_by,
    'current',CASE WHEN e.id IS NOT NULL AND workhub_private.event_readable(e,c) THEN workhub_private.event_dto(e,c.school_timezone) ELSE NULL END)
    ORDER BY s.data->>'date',s.data->>'title',s.id),'[]'::jsonb) INTO rows
   FROM neis_private.schedule_sources s LEFT JOIN workhub.events e ON e.id=s.event_id AND e.school_id=c.school_id
   WHERE s.school_id=c.school_id AND s.school_year=p_year AND s.superseded_by IS NULL;
  ELSE rows:='[]'::jsonb; END IF;
 END IF;
 RETURN jsonb_build_object('contract','neis.v1','schoolId',c.school_id,'memberId',p_member_id,'today',c.school_today,
  'kind',p_kind,'year',p_year,'from',p_from,'to',p_to,'configured',COALESCE(cfg.active,false),'canManage',manage,
  'source',CASE WHEN cfg.school_id IS NOT NULL THEN jsonb_build_object('officeCode',cfg.office_code,'schoolCode',cfg.school_code,'schoolName',cfg.school_name) ELSE NULL END,
  'version',COALESCE(d.version,0),'fetchedAt',d.checked_at,'errorCode',d.error_code,'rows',CASE WHEN COALESCE(cfg.active,false) THEN rows ELSE '[]'::jsonb END);
END $$;

-- 서버만 실행: 인증된 관리자 조회 또는 CRON_SECRET 확인 뒤 요청한다. 스냅샷 쓰기는 실제 일정 쓰기가 아니다.
CREATE FUNCTION public.workhub_neis_refresh_targets() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT COALESCE(jsonb_agg(jsonb_build_object('schoolId',c.school_id,'officeCode',c.office_code,'schoolCode',c.school_code,'schoolName',c.school_name)),'[]'::jsonb)
 FROM neis_private.connections c JOIN workhub.schools s ON s.id=c.school_id WHERE c.active AND s.status='active'
$$;

CREATE FUNCTION public.workhub_neis_claim(p_school_id text,p_kind text,p_year integer,p_from date,p_to date) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE d neis_private.datasets; cfg neis_private.connections; token uuid:=gen_random_uuid();
BEGIN
 PERFORM neis_private.check_range(p_kind,p_year,p_from,p_to);
 SELECT * INTO cfg FROM neis_private.connections WHERE school_id=p_school_id AND active FOR SHARE;
 IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM workhub.schools WHERE id=p_school_id AND status='active') THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 INSERT INTO neis_private.datasets(school_id,kind,school_year,from_date,to_date) VALUES(p_school_id,p_kind,p_year,p_from,p_to) ON CONFLICT DO NOTHING;
 SELECT * INTO STRICT d FROM neis_private.datasets WHERE school_id=p_school_id AND kind=p_kind AND school_year=p_year AND from_date=p_from AND to_date=p_to FOR UPDATE;
 IF d.lease_until>clock_timestamp() OR d.attempted_at>clock_timestamp()-interval '30 minutes' THEN
  RETURN jsonb_build_object('leaseId',NULL,'reason',CASE WHEN d.lease_until>clock_timestamp() THEN 'refreshing' ELSE 'recent' END);
 END IF;
 UPDATE neis_private.datasets SET lease_id=token,lease_until=clock_timestamp()+interval '2 minutes',attempted_at=clock_timestamp()
 WHERE school_id=p_school_id AND kind=p_kind AND school_year=p_year AND from_date=p_from AND to_date=p_to;
 RETURN jsonb_build_object('leaseId',token,'reason','claimed','source',jsonb_build_object('officeCode',cfg.office_code,'schoolCode',cfg.school_code,'schoolName',cfg.school_name));
END $$;

CREATE FUNCTION public.workhub_neis_finish(p_school_id text,p_kind text,p_year integer,p_from date,p_to date,p_lease_id uuid,p_items jsonb,p_error text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE d neis_private.datasets; r jsonb; row_id text;
BEGIN
 PERFORM neis_private.check_range(p_kind,p_year,p_from,p_to);
 PERFORM 1 FROM neis_private.connections WHERE school_id=p_school_id AND active FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 SELECT * INTO STRICT d FROM neis_private.datasets WHERE school_id=p_school_id AND kind=p_kind AND school_year=p_year AND from_date=p_from AND to_date=p_to FOR UPDATE;
 IF p_lease_id IS NULL OR d.lease_id IS DISTINCT FROM p_lease_id OR d.lease_until<clock_timestamp() THEN RAISE EXCEPTION 'CONFLICT'; END IF;
 IF p_error IS NOT NULL THEN
  IF p_error NOT IN ('KEY_MISSING','UPSTREAM_UNAVAILABLE','PROVIDER_REJECTED','INVALID_RESPONSE','UPSTREAM_CHANGED','AMBIGUOUS_SOURCE','INCOMPLETE_RESPONSE') THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  UPDATE neis_private.datasets SET error_code=p_error,lease_id=NULL,lease_until=NULL WHERE school_id=p_school_id AND kind=p_kind AND school_year=p_year AND from_date=p_from AND to_date=p_to;
  RETURN jsonb_build_object('status','kept','version',d.version);
 END IF;
 IF p_items IS NULL OR jsonb_typeof(p_items)<>'array' OR jsonb_array_length(p_items)>20000 OR octet_length(p_items::text)>12000000
 OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_items) x WHERE jsonb_typeof(x)<>'object' OR COALESCE(x->>'identity','')!~'^[a-f0-9]{64}$' OR COALESCE(x->>'contentHash','')!~'^[a-f0-9]{64}$')
 OR (SELECT count(*)<>count(DISTINCT x->>'identity') FROM jsonb_array_elements(p_items) x) THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
 IF p_kind='schedule' THEN
  FOR r IN SELECT value FROM jsonb_array_elements(p_items) LOOP
   IF NOT r ?& ARRAY['date','title','content','grades','dayKind','course','session','loadedOn'] OR (r->>'date') IS NULL OR (r->>'date')::date NOT BETWEEN p_from AND p_to
    OR jsonb_typeof(r->'title') IS DISTINCT FROM 'string' OR length(r->>'title') NOT BETWEEN 1 AND 200
    OR jsonb_typeof(r->'grades') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
   INSERT INTO neis_private.schedule_sources(school_id,school_year,identity,data) VALUES(p_school_id,p_year,r->>'identity',r)
   ON CONFLICT(school_id,school_year,identity) DO UPDATE
    SET data=EXCLUDED.data,present=true,superseded_by=NULL,
     dismissed_hash=CASE WHEN neis_private.schedule_sources.present THEN neis_private.schedule_sources.dismissed_hash ELSE NULL END,version=neis_private.schedule_sources.version+CASE
     WHEN neis_private.schedule_sources.data->>'contentHash' IS DISTINCT FROM EXCLUDED.data->>'contentHash' OR NOT neis_private.schedule_sources.present OR neis_private.schedule_sources.superseded_by IS NOT NULL THEN 1 ELSE 0 END;
  END LOOP;
  -- 누락은 확인 대상으로 남긴다. 기존 일정 삭제·취소는 하지 않는다.
  UPDATE neis_private.schedule_sources s SET present=false,dismissed_hash=NULL,version=version+1
   WHERE s.school_id=p_school_id AND s.school_year=p_year AND s.present AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_items) x WHERE x->>'identity'=s.identity);
 END IF;
 UPDATE neis_private.datasets SET previous_items=CASE WHEN items IS DISTINCT FROM p_items THEN items ELSE previous_items END,items=p_items,version=version+1,checked_at=clock_timestamp(),error_code=NULL,lease_id=NULL,lease_until=NULL
 WHERE school_id=p_school_id AND kind=p_kind AND school_year=p_year AND from_date=p_from AND to_date=p_to RETURNING * INTO d;
 RETURN jsonb_build_object('status','updated','version',d.version,'count',jsonb_array_length(p_items));
END $$;

CREATE FUNCTION neis_private.source_draft(r jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT jsonb_build_object('title',r->>'title','description',concat_ws(E'\n',NULLIF(r->>'content',''),
 '대상 학년: '||COALESCE((SELECT string_agg(v,'·') FROM jsonb_array_elements_text(r->'grades') v),'미지정'),
 '나이스 구분: '||COALESCE(r->>'dayKind','')),
 'location','','startDate',r->>'date','endDate',r->>'date','allDay',true,'startTime','','endTime','',
 'visibility','school','audience',jsonb_build_object('all',true,'groups','[]'::jsonb,'includeMemberIds','[]'::jsonb,'excludeMemberIds','[]'::jsonb))
$$;

CREATE FUNCTION public.workhub_neis_apply(p_member_id text,p_selections jsonb,p_request_key text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c workhub_private.actor_context; receipt neis_private.receipts; selected jsonb; s neis_private.schedule_sources;
 previous neis_private.schedule_sources; e workhub.events; incoming jsonb; current_draft jsonb; merged jsonb; base jsonb;
 result jsonb:='[]'; saved jsonb; field text; conflict boolean; target text; expected integer; decision text;
BEGIN
 c:=workhub_private.member_actor(p_member_id,true);
 PERFORM workhub_private.lock_member_roles(c);
 IF NOT workhub_private.member_has_perm(c,'calendar.shared_manage') THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 IF p_request_key IS NULL OR length(p_request_key) NOT BETWEEN 8 AND 150 OR p_request_key ~ '[[:cntrl:]]' OR p_selections IS NULL OR jsonb_typeof(p_selections)<>'array'
 OR jsonb_array_length(p_selections) NOT BETWEEN 1 AND 50 OR octet_length(p_selections::text)>100000 THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
 -- 학교 연결 행은 모든 반영을 같은 순서로 잠가 중복 접수·원본 연결 경쟁을 직렬화한다.
 PERFORM 1 FROM neis_private.connections WHERE school_id=c.school_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 SELECT * INTO receipt FROM neis_private.receipts WHERE school_id=c.school_id AND member_id=p_member_id AND request_key=p_request_key;
 IF FOUND THEN
  IF receipt.command<>p_selections THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT'; END IF;
  IF receipt.result->>'contract'='neis.closed.v1' THEN RAISE EXCEPTION 'CONFLICT'; END IF;
  -- 원 접수증에도 현재 원본 열람권한을 다시 확인한다.
  FOR selected IN SELECT value FROM jsonb_array_elements(receipt.result->'items') LOOP
   IF selected ? 'event' THEN
    SELECT * INTO e FROM workhub.events WHERE id=selected->'event'->>'id' AND school_id=c.school_id;
    IF NOT FOUND OR NOT workhub_private.event_readable(e,c) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
   END IF;
  END LOOP;
  RETURN receipt.result;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM neis_private.connections WHERE school_id=c.school_id AND active) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 IF (SELECT count(*)<>count(DISTINCT x->>'id') FROM jsonb_array_elements(p_selections) x) THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
 FOR selected IN SELECT value FROM jsonb_array_elements(p_selections) ORDER BY value->>'id' LOOP
  IF NOT workhub_private.p2_exact(selected,ARRAY['id','version','decision','eventId','eventVersion','replaces','overwrite'])
   OR COALESCE(selected->>'decision','') NOT IN ('apply','ignore') OR jsonb_typeof(selected->'overwrite') IS DISTINCT FROM 'boolean'
   OR jsonb_typeof(selected->'id') IS DISTINCT FROM 'string'
   OR jsonb_typeof(selected->'eventId') NOT IN ('string','null') OR jsonb_typeof(selected->'replaces') NOT IN ('string','null')
   OR NOT (selected->'eventVersion'='null'::jsonb OR (jsonb_typeof(selected->'eventVersion')='number' AND selected->>'eventVersion' ~ '^[1-9][0-9]{0,8}$'))
   OR jsonb_typeof(selected->'version') IS DISTINCT FROM 'number' OR COALESCE(selected->>'version','')!~'^[1-9][0-9]{0,8}$' THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  SELECT * INTO s FROM neis_private.schedule_sources WHERE id=selected->>'id' AND school_id=c.school_id FOR UPDATE;
  IF NOT FOUND OR s.version<>(selected->>'version')::integer OR s.superseded_by IS NOT NULL THEN RAISE EXCEPTION 'CONFLICT'; END IF;
  decision:=selected->>'decision';
  IF decision='ignore' THEN
   UPDATE neis_private.schedule_sources SET dismissed_hash=data->>'contentHash',version=version+1 WHERE id=s.id;
   result:=result||jsonb_build_array(jsonb_build_object('sourceId',s.id,'decision','ignored')); CONTINUE;
  END IF;
  IF NOT s.present THEN RAISE EXCEPTION 'CONFLICT'; END IF;
  target:=NULLIF(selected->>'eventId',''); expected:=NULLIF(selected->>'eventVersion','')::integer;
  base:=s.baseline;
  IF selected->>'replaces' IS NOT NULL THEN
   IF s.event_id IS NOT NULL THEN RAISE EXCEPTION 'CONFLICT'; END IF;
   SELECT * INTO previous FROM neis_private.schedule_sources WHERE id=selected->>'replaces' AND school_id=c.school_id FOR UPDATE;
   IF NOT FOUND OR previous.present OR previous.superseded_by IS NOT NULL OR previous.event_id IS NULL OR previous.event_id IS DISTINCT FROM target THEN RAISE EXCEPTION 'CONFLICT'; END IF;
   base:=previous.baseline;
  ELSIF s.event_id IS NOT NULL AND s.event_id IS DISTINCT FROM target THEN RAISE EXCEPTION 'CONFLICT';
  END IF;
  incoming:=neis_private.source_draft(s.data); merged:=incoming;
  IF target IS NULL AND EXISTS(SELECT 1 FROM workhub.events q WHERE q.school_id=c.school_id AND q.start_date=(s.data->>'date')::date AND q.title=s.data->>'title' AND workhub_private.event_readable(q,c)) THEN RAISE EXCEPTION 'CONFLICT'; END IF;
  IF target IS NOT NULL THEN
   SELECT * INTO e FROM workhub.events WHERE id=target AND school_id=c.school_id FOR UPDATE;
   IF NOT FOUND OR NOT workhub_private.event_readable(e,c) OR e.visibility='private' AND e.author_account_id<>c.account_id THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
   IF expected IS NULL OR e.version<>expected THEN RAISE EXCEPTION 'CONFLICT'; END IF;
   IF EXISTS(SELECT 1 FROM neis_private.schedule_sources WHERE school_id=c.school_id AND event_id=target AND id<>s.id AND id IS DISTINCT FROM selected->>'replaces') THEN RAISE EXCEPTION 'CONFLICT'; END IF;
   current_draft:=workhub_private.event_dto(e,c.school_timezone)-ARRAY['id','schoolId','authorMemberId','version','updatedAt'];
   merged:=current_draft;
   FOREACH field IN ARRAY ARRAY['title','description','startDate','endDate'] LOOP
    conflict:=current_draft->field IS DISTINCT FROM incoming->field AND (base IS NULL OR (current_draft->field IS DISTINCT FROM base->field AND incoming->field IS DISTINCT FROM base->field));
    IF conflict AND NOT (selected->>'overwrite')::boolean THEN RAISE EXCEPTION 'CONFLICT'; END IF;
    IF base IS NULL OR current_draft->field=base->field OR conflict THEN
     merged:=jsonb_set(merged,ARRAY[field],incoming->field);
    END IF;
   END LOOP;
  ELSIF expected IS NOT NULL THEN RAISE EXCEPTION 'INVALID_INPUT';
  END IF;
  saved:=public.workhub_calendar_save(p_member_id,jsonb_build_object('draft',merged,'id',target,'expectedVersion',expected,'idempotencyKey','neis:'||p_request_key||':'||s.id));
  IF selected->>'replaces' IS NOT NULL THEN
   UPDATE neis_private.schedule_sources SET event_id=NULL,superseded_by=s.id,version=version+1 WHERE id=previous.id;
  END IF;
  UPDATE neis_private.schedule_sources SET event_id=saved->>'id',baseline=incoming,dismissed_hash=NULL,version=version+1 WHERE id=s.id;
  result:=result||jsonb_build_array(jsonb_build_object('sourceId',s.id,'decision','applied','event',saved));
 END LOOP;
 result:=jsonb_build_object('contract','neis.receipt.v1','schoolId',c.school_id,'memberId',p_member_id,'requestKey',p_request_key,'items',result,'recordedAt',clock_timestamp());
 INSERT INTO neis_private.receipts(school_id,member_id,request_key,command,result) VALUES(c.school_id,p_member_id,p_request_key,p_selections,result);
 RETURN result;
END $$;

-- 결과 미상 요청을 명시적으로 닫는다. 같은 학교 잠금 아래 원 반영과 둘 중 하나만 확정된다.
CREATE FUNCTION public.workhub_neis_close(p_member_id text,p_selections jsonb,p_request_key text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c workhub_private.actor_context; r neis_private.receipts; result jsonb;
BEGIN
 c:=workhub_private.member_actor(p_member_id,true);
 PERFORM workhub_private.lock_member_roles(c);
 IF NOT workhub_private.member_has_perm(c,'calendar.shared_manage') THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 IF p_request_key IS NULL OR length(p_request_key) NOT BETWEEN 8 AND 150 OR p_request_key ~ '[[:cntrl:]]'
 OR p_selections IS NULL OR jsonb_typeof(p_selections)<>'array' OR jsonb_array_length(p_selections) NOT BETWEEN 1 AND 50 OR octet_length(p_selections::text)>100000 THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
 PERFORM 1 FROM neis_private.connections WHERE school_id=c.school_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 SELECT * INTO r FROM neis_private.receipts WHERE school_id=c.school_id AND member_id=p_member_id AND request_key=p_request_key;
 IF FOUND THEN
  IF r.command<>p_selections THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT'; END IF;
  IF r.result->>'contract'='neis.closed.v1' THEN RETURN r.result; END IF;
  result:=public.workhub_neis_apply(p_member_id,p_selections,p_request_key);
  RETURN jsonb_build_object('contract','neis.closed.v1','schoolId',c.school_id,'memberId',p_member_id,'requestKey',p_request_key,'outcome','applied','receipt',result);
 END IF;
 result:=jsonb_build_object('contract','neis.closed.v1','schoolId',c.school_id,'memberId',p_member_id,'requestKey',p_request_key,'outcome','closed','receipt',NULL);
 INSERT INTO neis_private.receipts(school_id,member_id,request_key,command,result) VALUES(c.school_id,p_member_id,p_request_key,p_selections,result);
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.workhub_neis_close(text,jsonb,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.workhub_neis_close(text,jsonb,text) TO authenticated;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA neis_private FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.workhub_neis_status(text,text,integer,date,date),public.workhub_neis_apply(text,jsonb,text),
 public.workhub_neis_refresh_targets(),public.workhub_neis_claim(text,text,integer,date,date),public.workhub_neis_finish(text,text,integer,date,date,uuid,jsonb,text)
 FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.workhub_neis_status(text,text,integer,date,date),public.workhub_neis_apply(text,jsonb,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.workhub_neis_refresh_targets(),public.workhub_neis_claim(text,text,integer,date,date),public.workhub_neis_finish(text,text,integer,date,date,uuid,jsonb,text) TO service_role;
COMMIT;
SELECT 'N1-01' AS no,'ok' AS status,'나이스 연동 설치 완료 · 학교 연결은 아직 비활성' AS detail;
