-- 개인 업무 저장 SQL 제안. 선행: 기존 001~007 및 workhub 001 제안.
-- Claude Web 확정·계란님 실행 전까지 운영 DB 적용 금지. 기존 회원·인증·기반 SQL은 변경하지 않는다.
BEGIN;

CREATE TABLE public.workhub_personal_tasks (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  school_id text NOT NULL REFERENCES public.workhub_schools(id),
  owner_member_id text NOT NULL,
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 120),
  notes text NOT NULL DEFAULT '' CHECK (length(notes)<=2000),
  due_date date,
  status text NOT NULL DEFAULT 'todo' CHECK (status IN ('todo','doing','waiting','done','cancelled')),
  version integer NOT NULL DEFAULT 1 CHECK (version>0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (school_id,owner_member_id) REFERENCES public.workhub_memberships(school_id,id),
  UNIQUE (school_id,owner_member_id,id)
);
CREATE INDEX workhub_personal_tasks_owner ON public.workhub_personal_tasks(school_id,owner_member_id,due_date,id);

CREATE TABLE public.workhub_task_receipts (
  school_id text NOT NULL,
  member_id text NOT NULL,
  request_key text NOT NULL CHECK (length(request_key) BETWEEN 1 AND 200),
  payload jsonb NOT NULL,
  task_id text NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (school_id,member_id,request_key),
  FOREIGN KEY (school_id,member_id,task_id) REFERENCES public.workhub_personal_tasks(school_id,owner_member_id,id)
);
CREATE TABLE public.workhub_task_audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_id text NOT NULL,
  actor_member_id text NOT NULL,
  task_id text NOT NULL,
  task_version integer NOT NULL CHECK (task_version>0),
  operation text NOT NULL CHECK (operation IN ('create','update','status')),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (school_id,actor_member_id,task_id) REFERENCES public.workhub_personal_tasks(school_id,owner_member_id,id),
  UNIQUE (task_id,task_version)
);

-- JS trim과 같은 공백 목록. 길이 한도는 Unicode 코드포인트이며 원본 길이를 먼저 검사한다.
CREATE FUNCTION public.workhub_task_trim(p_text text) RETURNS text
LANGUAGE sql IMMUTABLE STRICT SET search_path = '' AS $$
  SELECT btrim(p_text,U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF')
$$;
CREATE FUNCTION public.workhub_task_json(t public.workhub_personal_tasks) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT jsonb_build_object('id',t.id,'schoolId',t.school_id,'ownerMemberId',t.owner_member_id,
    'title',t.title,'notes',t.notes,'dueDate',COALESCE(to_char(t.due_date,'YYYY-MM-DD'),''),
    'status',t.status,'version',t.version)
$$;
CREATE FUNCTION public.workhub_task_visible(p_task_id text) RETURNS boolean
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
  SELECT public.workhub_gate() AND EXISTS (
    SELECT 1 FROM public.workhub_personal_tasks t
    JOIN public.workhub_memberships m ON m.id=t.owner_member_id AND m.school_id=t.school_id
    WHERE t.id=p_task_id AND m.user_id=auth.uid()::text AND m.active
      AND public.workhub_today() BETWEEN m.valid_from AND m.valid_through
  )
$$;
CREATE FUNCTION public.workhub_task_input(p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE k text; due date; trimmed_title text;
BEGIN
  IF p_input IS NULL OR jsonb_typeof(p_input)<>'object' THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_object_keys(p_input) key WHERE key NOT IN ('title','notes','dueDate'))
    THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  FOREACH k IN ARRAY ARRAY['title','notes','dueDate'] LOOP
    IF jsonb_typeof(p_input->k) IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  END LOOP;
  trimmed_title := public.workhub_task_trim(p_input->>'title');
  IF length(p_input->>'title')>120 OR length(trimmed_title)=0 OR length(p_input->>'notes')>2000
    THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  IF p_input->>'dueDate'<>'' THEN
    IF p_input->>'dueDate' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
    BEGIN due := (p_input->>'dueDate')::date;
    EXCEPTION WHEN datetime_field_overflow OR invalid_datetime_format THEN RAISE EXCEPTION 'INVALID_INPUT'; END;
    IF to_char(due,'YYYY-MM-DD')<>p_input->>'dueDate' THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  END IF;
  RETURN jsonb_build_object('title',trimmed_title,'notes',public.workhub_task_trim(p_input->>'notes'),'dueDate',p_input->>'dueDate');
END $$;

CREATE FUNCTION public.workhub_task_list(p_member_id text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE m public.workhub_memberships;
BEGIN
  m := public.workhub_member(p_member_id);
  RETURN COALESCE((SELECT jsonb_agg(public.workhub_task_json(t)
    ORDER BY (t.status IN ('done','cancelled')),t.due_date NULLS LAST,t.title,t.id)
    FROM public.workhub_personal_tasks t WHERE t.school_id=m.school_id AND t.owner_member_id=m.id),'[]'::jsonb);
END $$;
CREATE FUNCTION public.workhub_task_get(p_member_id text,p_task_id text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE m public.workhub_memberships; t public.workhub_personal_tasks;
BEGIN
  m := public.workhub_member(p_member_id);
  SELECT * INTO t FROM public.workhub_personal_tasks WHERE id=p_task_id AND school_id=m.school_id AND owner_member_id=m.id;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  RETURN public.workhub_task_json(t);
END $$;
CREATE FUNCTION public.workhub_task_mutate(p_member_id text,p_command jsonb,p_request_key text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE m public.workhub_memberships; t public.workhub_personal_tasks; r public.workhub_task_receipts;
  input jsonb; payload jsonb; result jsonb; command_kind text; target_id text; allowed_keys text[];
BEGIN
  -- 기반 일정과 같은 순서: 회원 승인 → 본인 소속 → 본인 업무. 잠금 뒤 최신 권한을 다시 읽는다.
  PERFORM 1 FROM public.users WHERE id=auth.uid()::text FOR SHARE;
  PERFORM 1 FROM public.workhub_memberships WHERE id=p_member_id AND user_id=auth.uid()::text FOR UPDATE;
  m := public.workhub_member(p_member_id);
  IF p_request_key IS NULL OR length(p_request_key)>200 OR length(public.workhub_task_trim(p_request_key))=0
    OR p_command IS NULL OR jsonb_typeof(p_command)<>'object' OR octet_length(p_command::text)>262144
    OR jsonb_typeof(p_command->'kind') IS DISTINCT FROM 'string'
  THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  command_kind := p_command->>'kind';
  IF command_kind NOT IN ('create','update','status') THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  allowed_keys := CASE command_kind WHEN 'create' THEN ARRAY['kind','input']
    WHEN 'update' THEN ARRAY['kind','taskId','input','expectedVersion']
    ELSE ARRAY['kind','taskId','status','expectedVersion'] END;
  IF EXISTS (SELECT 1 FROM jsonb_object_keys(p_command) key WHERE NOT (key=ANY(allowed_keys)))
    THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  IF command_kind<>'create' THEN
    target_id := p_command->>'taskId';
    IF jsonb_typeof(p_command->'taskId') IS DISTINCT FROM 'string'
      OR length(target_id) NOT BETWEEN 1 AND 200
      OR jsonb_typeof(p_command->'expectedVersion') IS DISTINCT FROM 'number'
      OR (p_command->>'expectedVersion') !~ '^[1-9][0-9]*$'
    THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  END IF;
  IF command_kind IN ('create','update') THEN
    input := public.workhub_task_input(p_command->'input');
    payload := jsonb_build_object('kind',command_kind,'input',input);
  ELSE
    IF jsonb_typeof(p_command->'status') IS DISTINCT FROM 'string'
      OR p_command->>'status' NOT IN ('todo','doing','waiting','done','cancelled')
    THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
    payload := jsonb_build_object('kind',command_kind,'status',p_command->>'status');
  END IF;
  IF command_kind<>'create' THEN
    payload := payload || jsonb_build_object('taskId',target_id,'expectedVersion',p_command->'expectedVersion');
  END IF;

  SELECT * INTO r FROM public.workhub_task_receipts
    WHERE school_id=m.school_id AND member_id=m.id AND request_key=p_request_key;
  IF FOUND THEN
    IF r.payload<>payload THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT'; END IF;
    PERFORM public.workhub_task_get(m.id,r.task_id);
    RETURN r.result;
  END IF;
  IF command_kind='create' THEN
    INSERT INTO public.workhub_personal_tasks(school_id,owner_member_id,title,notes,due_date)
      VALUES(m.school_id,m.id,input->>'title',input->>'notes',NULLIF(input->>'dueDate','')::date)
      RETURNING * INTO t;
  ELSE
    -- 권한이 없는 업무 행에는 잠금도 걸지 않는다. 관리자 역할은 개인 자료 접근 근거가 아니다.
    SELECT * INTO t FROM public.workhub_personal_tasks
      WHERE id=target_id AND school_id=m.school_id AND owner_member_id=m.id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
    IF to_jsonb(t.version)<>p_command->'expectedVersion'
      THEN RAISE EXCEPTION 'CONFLICT' USING DETAIL=public.workhub_task_json(t)::text; END IF;
    IF command_kind='update' THEN
      UPDATE public.workhub_personal_tasks SET title=input->>'title',notes=input->>'notes',
        due_date=NULLIF(input->>'dueDate','')::date,version=version+1,updated_at=clock_timestamp()
        WHERE id=t.id RETURNING * INTO t;
    ELSE
      UPDATE public.workhub_personal_tasks SET status=p_command->>'status',version=version+1,updated_at=clock_timestamp()
        WHERE id=t.id RETURNING * INTO t;
    END IF;
  END IF;
  result := public.workhub_task_json(t);
  INSERT INTO public.workhub_task_audit(school_id,actor_member_id,task_id,task_version,operation)
    VALUES(m.school_id,m.id,t.id,t.version,command_kind);
  INSERT INTO public.workhub_task_receipts(school_id,member_id,request_key,payload,task_id,result)
    VALUES(m.school_id,m.id,p_request_key,payload,t.id,result);
  RETURN result;
END $$;

ALTER TABLE public.workhub_personal_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workhub_task_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workhub_task_audit ENABLE ROW LEVEL SECURITY;
CREATE POLICY workhub_tasks_read_own ON public.workhub_personal_tasks FOR SELECT TO authenticated
  USING (public.workhub_task_visible(id));
REVOKE ALL ON public.workhub_personal_tasks,public.workhub_task_receipts,public.workhub_task_audit FROM PUBLIC,anon,authenticated;
REVOKE ALL ON SEQUENCE public.workhub_task_audit_id_seq FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.workhub_personal_tasks TO authenticated;
-- 신규 함수만 대상으로 한다. 기존 foundation 함수의 GRANT/계약을 건드리지 않는다.
REVOKE ALL ON FUNCTION public.workhub_task_trim(text),public.workhub_task_json(public.workhub_personal_tasks),
  public.workhub_task_visible(text),public.workhub_task_input(jsonb),public.workhub_task_list(text),
  public.workhub_task_get(text,text),public.workhub_task_mutate(text,jsonb,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.workhub_task_visible(text),public.workhub_task_list(text),
  public.workhub_task_get(text,text),public.workhub_task_mutate(text,jsonb,text) TO authenticated;
COMMIT;
