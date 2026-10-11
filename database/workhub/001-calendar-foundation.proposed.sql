-- 적용 전 SQL 제안: Claude Web 확정·계란님 실행 전까지 운영 DB에 적용하지 않는다.
-- 기존 auth.users/public.users/가입 트리거와 migrations 원본을 변경하지 않는다.
-- 순수 추가 구조. 첫 공개 범위는 승인된 기존 superadmin만이며 기본값을 완화하지 않는다.
BEGIN;

CREATE TABLE public.workhub_settings (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  rollout_mode text NOT NULL DEFAULT 'superadmin' CHECK (rollout_mode IN ('superadmin','members'))
);
INSERT INTO public.workhub_settings(singleton) VALUES (true);

CREATE TABLE public.workhub_schools (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 100),
  relation_labels jsonb NOT NULL DEFAULT '{"departmentIds":[],"gradeIds":[],"subjectIds":[]}'::jsonb
);
CREATE TABLE public.workhub_memberships (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  school_id text NOT NULL REFERENCES public.workhub_schools(id),
  user_id text NOT NULL REFERENCES public.users(id),
  role text NOT NULL DEFAULT 'teacher' CHECK (role IN ('teacher','calendar_manager')),
  active boolean NOT NULL DEFAULT false,
  valid_from date NOT NULL,
  valid_through date NOT NULL,
  department_ids text[] NOT NULL DEFAULT '{}',
  grade_ids text[] NOT NULL DEFAULT '{}',
  subject_ids text[] NOT NULL DEFAULT '{}',
  CHECK (valid_from <= valid_through),
  UNIQUE (school_id, user_id, valid_from),
  UNIQUE (school_id, id)
);
CREATE INDEX workhub_memberships_user ON public.workhub_memberships(user_id, school_id);
CREATE FUNCTION public.workhub_membership_no_overlap() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF TG_OP='UPDATE' AND (NEW.id IS DISTINCT FROM OLD.id OR NEW.school_id IS DISTINCT FROM OLD.school_id OR NEW.user_id IS DISTINCT FROM OLD.user_id)
  THEN RAISE EXCEPTION 'IMMUTABLE_MEMBERSHIP_IDENTITY'; END IF;
  IF NEW.active THEN
    -- 같은 학교·계정의 소속 변경끼리만 직렬화한다. 기존 users나 다른 소속 행을 잠그지 않는다.
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(NEW.school_id || chr(31) || NEW.user_id,0));
    IF EXISTS (SELECT 1 FROM public.workhub_memberships m
      WHERE m.school_id=NEW.school_id AND m.user_id=NEW.user_id AND m.id<>NEW.id AND m.active
        AND NEW.valid_from<=m.valid_through AND m.valid_from<=NEW.valid_through)
    THEN RAISE EXCEPTION 'OVERLAPPING_MEMBERSHIP'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER workhub_membership_no_overlap BEFORE INSERT OR UPDATE ON public.workhub_memberships
FOR EACH ROW EXECUTE FUNCTION public.workhub_membership_no_overlap();

CREATE TABLE public.workhub_calendar_events (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  school_id text NOT NULL REFERENCES public.workhub_schools(id),
  author_member_id text NOT NULL,
  draft jsonb NOT NULL CHECK (jsonb_typeof(draft) = 'object'),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (school_id, author_member_id) REFERENCES public.workhub_memberships(school_id, id)
);
CREATE INDEX workhub_calendar_school ON public.workhub_calendar_events(school_id, ((draft->>'startDate')));
CREATE TABLE public.workhub_calendar_receipts (
  school_id text NOT NULL,
  member_id text NOT NULL,
  request_key text NOT NULL CHECK (length(request_key) BETWEEN 1 AND 200),
  payload jsonb NOT NULL,
  event_id text NOT NULL REFERENCES public.workhub_calendar_events(id),
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (school_id, member_id, request_key),
  FOREIGN KEY (school_id, member_id) REFERENCES public.workhub_memberships(school_id, id)
);
CREATE TABLE public.workhub_calendar_audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id text NOT NULL REFERENCES public.workhub_schools(id),
  event_id text NOT NULL REFERENCES public.workhub_calendar_events(id),
  actor_member_id text NOT NULL,
  event_version integer NOT NULL,
  operation text NOT NULL CHECK (operation IN ('create','update')),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (school_id, actor_member_id) REFERENCES public.workhub_memberships(school_id, id)
);

CREATE FUNCTION public.workhub_today() RETURNS date
LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT (statement_timestamp() AT TIME ZONE 'Asia/Seoul')::date
$$;
CREATE FUNCTION public.workhub_gate() RETURNS boolean
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.users u CROSS JOIN public.workhub_settings s
    WHERE u.id = auth.uid()::text AND u.is_active IS TRUE
      AND (s.rollout_mode = 'members' OR u.role = 'superadmin')
  )
$$;
CREATE FUNCTION public.workhub_school_read(p_school text) RETURNS boolean
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
  SELECT public.workhub_gate() AND EXISTS (
    SELECT 1 FROM public.workhub_memberships m WHERE m.school_id = p_school
      AND m.user_id = auth.uid()::text AND m.active
      AND public.workhub_today() BETWEEN m.valid_from AND m.valid_through
  )
$$;
CREATE FUNCTION public.workhub_member(p_member text) RETURNS public.workhub_memberships
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE m public.workhub_memberships;
BEGIN
  IF NOT public.workhub_gate() THEN RAISE EXCEPTION 'FORBIDDEN' USING DETAIL = '승인된 공개 대상만 연결할 수 있습니다.'; END IF;
  SELECT * INTO m FROM public.workhub_memberships
    WHERE id = p_member AND user_id = auth.uid()::text AND active
      AND public.workhub_today() BETWEEN valid_from AND valid_through;
  IF NOT FOUND THEN RAISE EXCEPTION 'INACTIVE_MEMBERSHIP' USING DETAIL = '현재 이용 가능한 학교 소속이 아닙니다.'; END IF;
  RETURN m;
END $$;
CREATE FUNCTION public.workhub_audience_matches(a jsonb, m public.workhub_memberships) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE
    WHEN COALESCE(a->'excludeMemberIds','[]'::jsonb) ? m.id THEN false
    WHEN a->'all' = 'true'::jsonb OR COALESCE(a->'includeMemberIds','[]'::jsonb) ? m.id THEN true
    ELSE EXISTS (
      SELECT 1 FROM jsonb_array_elements(COALESCE(a->'groups','[]'::jsonb)) g
      WHERE (jsonb_array_length(g->'departmentIds') + jsonb_array_length(g->'gradeIds') + jsonb_array_length(g->'subjectIds')) > 0
        AND (g->'departmentIds' = '[]'::jsonb OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(g->'departmentIds') v WHERE v = ANY(m.department_ids)))
        AND (g->'gradeIds' = '[]'::jsonb OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(g->'gradeIds') v WHERE v = ANY(m.grade_ids)))
        AND (g->'subjectIds' = '[]'::jsonb OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(g->'subjectIds') v WHERE v = ANY(m.subject_ids)))
    )
  END
$$;
CREATE FUNCTION public.workhub_member_reads(e public.workhub_calendar_events, m public.workhub_memberships) RETURNS boolean
LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT e.school_id = m.school_id AND m.active
    AND public.workhub_today() BETWEEN m.valid_from AND m.valid_through
    AND (e.author_member_id = m.id OR e.draft->>'visibility' = 'school'
      OR (e.draft->>'visibility' = 'audience' AND public.workhub_audience_matches(e.draft->'audience',m)))
$$;
CREATE FUNCTION public.workhub_visible_event(p_event text) RETURNS boolean
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
  SELECT public.workhub_gate() AND EXISTS (
    SELECT 1 FROM public.workhub_calendar_events e JOIN public.workhub_memberships m ON m.school_id = e.school_id
    WHERE e.id = p_event AND m.user_id = auth.uid()::text AND public.workhub_member_reads(e,m)
  )
$$;
CREATE FUNCTION public.workhub_event_json(e public.workhub_calendar_events) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT e.draft || jsonb_build_object('id',e.id,'schoolId',e.school_id,'authorMemberId',e.author_member_id,'version',e.version,'updatedAt',e.updated_at)
$$;
CREATE FUNCTION public.workhub_string_array(a jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
BEGIN
  IF a IS NULL OR jsonb_typeof(a) <> 'array' THEN RETURN false; END IF;
  RETURN NOT EXISTS (SELECT 1 FROM jsonb_array_elements(a) v WHERE jsonb_typeof(v) <> 'string');
END $$;
CREATE FUNCTION public.workhub_validate_draft(d jsonb, p_school text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE k text; g jsonb; a jsonb; sd date; ed date; has_group boolean := false;
BEGIN
  IF d IS NULL OR jsonb_typeof(d) <> 'object' OR octet_length(d::text) > 262144 THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  FOREACH k IN ARRAY ARRAY['title','description','location','startDate','endDate','startTime','endTime','visibility'] LOOP
    IF jsonb_typeof(d->k) IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  END LOOP;
  IF jsonb_typeof(d->'allDay') IS DISTINCT FROM 'boolean'
    OR length(btrim(d->>'title')) NOT BETWEEN 1 AND 100
    OR length(d->>'description') > 2000 OR length(d->>'location') > 100
    OR d->>'visibility' NOT IN ('school','audience','private')
    OR d->>'startDate' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    OR d->>'endDate' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
  THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  BEGIN sd := (d->>'startDate')::date; ed := (d->>'endDate')::date;
  EXCEPTION WHEN datetime_field_overflow OR invalid_datetime_format THEN RAISE EXCEPTION 'INVALID_INPUT'; END;
  IF sd > ed THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  IF d->'allDay' = 'false'::jsonb AND (
    d->>'startTime' !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
    OR d->>'endTime' !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
    OR (sd = ed AND d->>'startTime' >= d->>'endTime')
  ) THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  a := d->'audience';
  IF jsonb_typeof(a) IS DISTINCT FROM 'object' OR jsonb_typeof(a->'all') IS DISTINCT FROM 'boolean'
    OR jsonb_typeof(a->'groups') IS DISTINCT FROM 'array'
    OR NOT public.workhub_string_array(a->'includeMemberIds') OR NOT public.workhub_string_array(a->'excludeMemberIds')
  THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  IF jsonb_array_length(a->'groups') > 50 OR jsonb_array_length(a->'includeMemberIds') > 1000 OR jsonb_array_length(a->'excludeMemberIds') > 1000 THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  FOR g IN SELECT value FROM jsonb_array_elements(a->'groups') LOOP
    IF jsonb_typeof(g) <> 'object' THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
    FOREACH k IN ARRAY ARRAY['departmentIds','gradeIds','subjectIds'] LOOP
      IF NOT public.workhub_string_array(g->k) THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
      IF jsonb_array_length(g->k) > 100 THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
      IF jsonb_array_length(g->k) > 0 THEN has_group := true; END IF;
    END LOOP;
  END LOOP;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements_text((a->'includeMemberIds') || (a->'excludeMemberIds')) v
    WHERE NOT EXISTS (SELECT 1 FROM public.workhub_memberships m WHERE m.school_id = p_school AND m.id = v)
  ) THEN RAISE EXCEPTION 'INVALID_INPUT' USING DETAIL = '다른 학교의 교사를 대상에 포함할 수 없습니다.'; END IF;
  IF a->'all' = 'false'::jsonb AND NOT has_group AND a->'includeMemberIds' = '[]'::jsonb AND d->>'visibility' <> 'private'
  THEN RAISE EXCEPTION 'INVALID_INPUT' USING DETAIL = '관련 대상을 선택해 주세요.'; END IF;
  RETURN jsonb_build_object('title',btrim(d->>'title'),'description',btrim(d->>'description'),'location',btrim(d->>'location'),
    'startDate',d->>'startDate','endDate',d->>'endDate','allDay',d->'allDay',
    'startTime',CASE WHEN d->'allDay' = 'true'::jsonb THEN '' ELSE d->>'startTime' END,
    'endTime',CASE WHEN d->'allDay' = 'true'::jsonb THEN '' ELSE d->>'endTime' END,
    'visibility',d->>'visibility','audience',a);
END $$;

CREATE FUNCTION public.workhub_context() RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE result jsonb;
BEGIN
  IF NOT public.workhub_gate() THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  SELECT jsonb_build_object(
    'basisDate', public.workhub_today()::text,
    'schools', COALESCE((SELECT jsonb_agg(jsonb_build_object('id',s.id,'name',s.name) ORDER BY s.name,s.id) FROM public.workhub_schools s WHERE public.workhub_school_read(s.id)), '[]'::jsonb),
    'memberships', COALESCE((SELECT jsonb_agg(jsonb_build_object('id',m.id,'schoolId',m.school_id,'userId',m.user_id,'name',u.name,'role',m.role,'active',(m.active AND u.is_active IS TRUE),'validFrom',m.valid_from::text,'validThrough',m.valid_through::text,'departmentIds',m.department_ids,'gradeIds',m.grade_ids,'subjectIds',m.subject_ids) ORDER BY m.id) FROM public.workhub_memberships m JOIN public.users u ON u.id=m.user_id WHERE public.workhub_school_read(m.school_id)), '[]'::jsonb),
    'schoolLabels', COALESCE((SELECT jsonb_object_agg(s.id,s.relation_labels) FROM public.workhub_schools s WHERE public.workhub_school_read(s.id)), '{}'::jsonb)
  ) INTO result;
  RETURN result;
END $$;
CREATE FUNCTION public.workhub_calendar_list(p_member_id text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE m public.workhub_memberships;
BEGIN
  m := public.workhub_member(p_member_id);
  RETURN COALESCE((SELECT jsonb_agg(public.workhub_event_json(e) ORDER BY e.draft->>'startDate',e.draft->>'startTime',e.id) FROM public.workhub_calendar_events e WHERE public.workhub_member_reads(e,m)), '[]'::jsonb);
END $$;
CREATE FUNCTION public.workhub_calendar_get(p_member_id text, p_event_id text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE m public.workhub_memberships; e public.workhub_calendar_events;
BEGIN
  m := public.workhub_member(p_member_id);
  SELECT * INTO e FROM public.workhub_calendar_events WHERE id=p_event_id;
  IF NOT FOUND OR NOT public.workhub_member_reads(e,m) THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  RETURN public.workhub_event_json(e);
END $$;
CREATE FUNCTION public.workhub_calendar_save(p_member_id text, p_command jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE m public.workhub_memberships; e public.workhub_calendar_events; r public.workhub_calendar_receipts; d jsonb; payload jsonb; v_request_key text; result jsonb; target_id text;
BEGIN
  -- 회원 승인 해제·소속 종료와 동일한 소속의 동시 저장을 직렬화한다.
  PERFORM 1 FROM public.users WHERE id=auth.uid()::text FOR SHARE;
  PERFORM 1 FROM public.workhub_memberships WHERE id=p_member_id AND user_id=auth.uid()::text FOR UPDATE;
  m := public.workhub_member(p_member_id);
  IF octet_length(p_command::text) > 262144 OR jsonb_typeof(p_command) IS DISTINCT FROM 'object' OR jsonb_typeof(p_command->'idempotencyKey') IS DISTINCT FROM 'string'
    THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  v_request_key := p_command->>'idempotencyKey';
  IF length(btrim(v_request_key)) NOT BETWEEN 1 AND 200 OR length(v_request_key)>200 THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  target_id := p_command->>'id';
  IF p_command ? 'id' AND (jsonb_typeof(p_command->'id') IS DISTINCT FROM 'string' OR length(target_id)=0
    OR jsonb_typeof(p_command->'expectedVersion') IS DISTINCT FROM 'number'
    OR (p_command->>'expectedVersion') !~ '^[1-9][0-9]*$')
    THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  d := public.workhub_validate_draft(p_command->'draft',m.school_id);
  payload := jsonb_build_object('id',target_id,'expectedVersion',p_command->'expectedVersion','draft',d);
  SELECT * INTO r FROM public.workhub_calendar_receipts WHERE school_id=m.school_id AND member_id=m.id AND workhub_calendar_receipts.request_key=v_request_key;
  IF FOUND THEN
    IF r.payload <> payload THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT'; END IF;
    PERFORM public.workhub_calendar_get(m.id,r.event_id);
    RETURN r.result;
  END IF;
  IF target_id IS NOT NULL THEN
    SELECT * INTO e FROM public.workhub_calendar_events WHERE id=target_id FOR UPDATE;
    IF NOT FOUND OR NOT public.workhub_member_reads(e,m) THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
    IF e.author_member_id <> m.id AND (m.role <> 'calendar_manager' OR e.draft->>'visibility' = 'private')
      THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
    IF to_jsonb(e.version) <> p_command->'expectedVersion'
      THEN RAISE EXCEPTION 'CONFLICT' USING DETAIL = public.workhub_event_json(e)::text; END IF;
    IF e.author_member_id <> m.id AND d->>'visibility' = 'private' THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
    UPDATE public.workhub_calendar_events SET draft=d,version=version+1,updated_at=clock_timestamp() WHERE id=e.id RETURNING * INTO e;
  ELSE
    INSERT INTO public.workhub_calendar_events(school_id,author_member_id,draft) VALUES(m.school_id,m.id,d) RETURNING * INTO e;
  END IF;
  result := public.workhub_event_json(e);
  INSERT INTO public.workhub_calendar_audit(school_id,event_id,actor_member_id,event_version,operation)
    VALUES(m.school_id,e.id,m.id,e.version,CASE WHEN target_id IS NULL THEN 'create' ELSE 'update' END);
  INSERT INTO public.workhub_calendar_receipts(school_id,member_id,request_key,payload,event_id,result)
    VALUES(m.school_id,m.id,v_request_key,payload,e.id,result);
  RETURN result;
END $$;

-- 직접 쓰기는 허용하지 않는다. 조회도 현재 승인·학교 소속·private 검사를 통과해야 한다.
ALTER TABLE public.workhub_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workhub_schools ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workhub_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workhub_calendar_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workhub_calendar_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workhub_calendar_audit ENABLE ROW LEVEL SECURITY;
CREATE POLICY workhub_schools_read ON public.workhub_schools FOR SELECT TO authenticated USING (public.workhub_school_read(id));
CREATE POLICY workhub_memberships_read ON public.workhub_memberships FOR SELECT TO authenticated USING (public.workhub_school_read(school_id));
CREATE POLICY workhub_events_read ON public.workhub_calendar_events FOR SELECT TO authenticated USING (public.workhub_visible_event(id));
REVOKE ALL ON public.workhub_settings,public.workhub_schools,public.workhub_memberships,public.workhub_calendar_events,public.workhub_calendar_receipts,public.workhub_calendar_audit FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.workhub_schools,public.workhub_memberships,public.workhub_calendar_events TO authenticated;
DO $$
DECLARE f record;
BEGIN
  FOR f IN SELECT p.oid::regprocedure AS signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname LIKE 'workhub_%'
  LOOP EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',f.signature); END LOOP;
END $$;
GRANT EXECUTE ON FUNCTION public.workhub_school_read(text),public.workhub_visible_event(text),public.workhub_context(),public.workhub_calendar_list(text),public.workhub_calendar_get(text,text),public.workhub_calendar_save(text,jsonb) TO authenticated;
COMMIT;
