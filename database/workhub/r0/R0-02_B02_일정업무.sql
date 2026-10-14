-- ============================================================================
-- R0-02  B02 일정·개인 업무 + 앱 호환 함수 7개
--
-- 현재 앱(apps/workhub)이 부르는 public.workhub_* 7개를 같은 이름·인자·반환 형태로 만든다.
-- 함수는 SECURITY DEFINER + 빈 search_path 이고 안에서 workhub schema 만 다룬다.
-- 그래서 Supabase 대시보드의 API 노출 schema 설정을 바꾸지 않아도 된다.
--
-- ▣ 선행: R0-01. 같은 트랜잭션이라 실패하면 아무것도 남지 않는다.
-- ▣ 앱 계약: docs/workhub/28-connection-audit-handoff.md 6.1절,
--   apps/workhub/src/connection/validation.ts · tasks/validation.ts 의 응답 검사.
-- ============================================================================
BEGIN;

DO $$
BEGIN
  IF to_regclass('workhub.audit_events') IS NULL OR to_regprocedure('workhub_private.member_actor(text,boolean)') IS NULL THEN
    RAISE EXCEPTION 'R0 중단: R0-01(B01)을 먼저 실행해 주세요.';
  END IF;
  IF to_regclass('workhub.events') IS NOT NULL OR to_regclass('workhub.tasks') IS NOT NULL THEN
    RAISE EXCEPTION 'R0 중단: B02 표가 이미 있습니다.';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
             WHERE n.nspname = 'public' AND p.proname LIKE 'workhub\_%') THEN
    RAISE EXCEPTION 'R0 중단: public.workhub_* 함수가 이미 있습니다.';
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 1. 관련 대상(audience) — 일정의 '누구에게 해당하는가'
-- ----------------------------------------------------------------------------
CREATE TABLE workhub.audience_sets (
  id                       text NOT NULL DEFAULT gen_random_uuid()::text,
  school_id                text NOT NULL,
  include_all              boolean NOT NULL DEFAULT false,
  label                    text,
  created_by_membership_id text NOT NULL,
  created_at               timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT audience_sets_pkey PRIMARY KEY (id),
  CONSTRAINT audience_sets_school_id_id_key UNIQUE (school_id, id),
  CONSTRAINT audience_sets_school_id_fkey FOREIGN KEY (school_id) REFERENCES workhub.schools(id),
  CONSTRAINT audience_sets_school_id_created_by_membership_id_fkey FOREIGN KEY (school_id, created_by_membership_id) REFERENCES workhub.memberships(school_id, id)
);
CREATE TABLE workhub.audience_groups (
  id              text NOT NULL DEFAULT gen_random_uuid()::text,
  school_id       text NOT NULL,
  audience_set_id text NOT NULL,
  group_no        smallint NOT NULL,
  CONSTRAINT audience_groups_pkey PRIMARY KEY (id),
  CONSTRAINT audience_groups_school_id_id_key UNIQUE (school_id, id),
  CONSTRAINT audience_groups_audience_set_id_group_no_key UNIQUE (audience_set_id, group_no),
  CONSTRAINT audience_groups_school_id_audience_set_id_fkey FOREIGN KEY (school_id, audience_set_id) REFERENCES workhub.audience_sets(school_id, id),
  CONSTRAINT audience_groups_group_no_check CHECK (group_no > 0)
);
CREATE TABLE workhub.audience_conditions (
  school_id text NOT NULL,
  group_id  text NOT NULL,
  dimension text NOT NULL,
  ref_value text NOT NULL,
  CONSTRAINT audience_conditions_pkey PRIMARY KEY (group_id, dimension, ref_value),
  CONSTRAINT audience_conditions_school_id_group_id_fkey FOREIGN KEY (school_id, group_id) REFERENCES workhub.audience_groups(school_id, id),
  CONSTRAINT audience_conditions_dimension_check CHECK (dimension IN ('department','subject','grade','academic_class','duty','role','course_group','employment_type')),
  CONSTRAINT audience_conditions_ref_value_check CHECK (length(ref_value) BETWEEN 1 AND 200)
);
CREATE TABLE workhub.audience_members (
  school_id       text NOT NULL,
  audience_set_id text NOT NULL,
  membership_id   text NOT NULL,
  mode            text NOT NULL,
  CONSTRAINT audience_members_pkey PRIMARY KEY (audience_set_id, membership_id),
  CONSTRAINT audience_members_school_id_audience_set_id_fkey FOREIGN KEY (school_id, audience_set_id) REFERENCES workhub.audience_sets(school_id, id),
  CONSTRAINT audience_members_school_id_membership_id_fkey FOREIGN KEY (school_id, membership_id) REFERENCES workhub.memberships(school_id, id),
  CONSTRAINT audience_members_mode_check CHECK (mode IN ('include','exclude'))
);
-- 대상 묶음은 저장 뒤 고치지 않는다. 일정이 바뀌면 새 묶음을 만든다(과거 판의 대상이 바뀌지 않게).
CREATE TRIGGER audience_sets_immutable BEFORE UPDATE OR DELETE ON workhub.audience_sets FOR EACH ROW EXECUTE FUNCTION workhub_private.forbid_change();
CREATE TRIGGER audience_groups_immutable BEFORE UPDATE OR DELETE ON workhub.audience_groups FOR EACH ROW EXECUTE FUNCTION workhub_private.forbid_change();
CREATE TRIGGER audience_conditions_immutable BEFORE UPDATE OR DELETE ON workhub.audience_conditions FOR EACH ROW EXECUTE FUNCTION workhub_private.forbid_change();
CREATE TRIGGER audience_members_immutable BEFORE UPDATE OR DELETE ON workhub.audience_members FOR EACH ROW EXECUTE FUNCTION workhub_private.forbid_change();

-- ----------------------------------------------------------------------------
-- 2. 일정과 일정 판
-- ----------------------------------------------------------------------------
CREATE TABLE workhub.events (
  id                             text NOT NULL DEFAULT gen_random_uuid()::text,
  scope                          text NOT NULL,
  school_id                      text,
  scope_key                      text GENERATED ALWAYS AS (
                                   CASE scope WHEN 'school' THEN 's:' || school_id ELSE 'a:' || author_account_id END) STORED,
  kind                           text NOT NULL,
  visibility                     text NOT NULL,
  official_state                 text,
  status                         text NOT NULL DEFAULT 'active',
  title                          text NOT NULL,
  description                    text,
  location                       text,
  category                       text NOT NULL DEFAULT 'other',
  all_day                        boolean NOT NULL DEFAULT true,
  start_date                     date NOT NULL,
  end_date                       date NOT NULL,
  starts_at                      timestamptz,
  ends_at                        timestamptz,
  audience_set_id                text,
  duty_id                        text,
  department_id                  text,
  responsible_membership_id      text,
  affects_instruction            boolean NOT NULL DEFAULT false,
  author_account_id              text NOT NULL,
  author_membership_id           text,
  source_record_id               text,
  current_revision_no            integer NOT NULL DEFAULT 1,
  cancelled_at                   timestamptz,
  cancel_reason                  text,
  deleted_at                     timestamptz,
  deleted_by_account_id          text,
  created_at                     timestamptz NOT NULL DEFAULT now(),
  updated_at                     timestamptz NOT NULL DEFAULT now(),
  version                        integer NOT NULL DEFAULT 1,
  official_effective_revision_no integer,
  CONSTRAINT events_pkey PRIMARY KEY (id),
  CONSTRAINT events_school_id_id_key UNIQUE (school_id, id),
  CONSTRAINT events_scope_key_id_key UNIQUE (scope_key, id),
  CONSTRAINT events_school_id_fkey FOREIGN KEY (school_id) REFERENCES workhub.schools(id),
  CONSTRAINT events_author_account_id_fkey FOREIGN KEY (author_account_id) REFERENCES workhub.accounts(id),
  CONSTRAINT events_deleted_by_account_id_fkey FOREIGN KEY (deleted_by_account_id) REFERENCES workhub.accounts(id),
  -- 작성 소속은 같은 학교·같은 계정이어야 한다(옛 2열 FK 를 3열로 강화)
  CONSTRAINT events_author_membership_fkey FOREIGN KEY (school_id, author_membership_id, author_account_id) REFERENCES workhub.memberships(school_id, id, account_id),
  CONSTRAINT events_school_id_responsible_membership_id_fkey FOREIGN KEY (school_id, responsible_membership_id) REFERENCES workhub.memberships(school_id, id),
  CONSTRAINT events_school_id_audience_set_id_fkey FOREIGN KEY (school_id, audience_set_id) REFERENCES workhub.audience_sets(school_id, id),
  CONSTRAINT events_school_id_department_id_fkey FOREIGN KEY (school_id, department_id) REFERENCES workhub.departments(school_id, id),
  CONSTRAINT events_category_check CHECK (category IN ('school_event','holiday','discretionary_holiday','vacation','exam','deadline','instruction_adjust','meeting','training','trip','class_related','personal','other')),
  CONSTRAINT events_check CHECK ((scope = 'school') = (school_id IS NOT NULL)),
  CONSTRAINT events_check1 CHECK (scope = 'school' OR kind = 'personal'),
  CONSTRAINT events_check2 CHECK (school_id IS NOT NULL OR num_nonnulls(audience_set_id, duty_id, department_id, responsible_membership_id, author_membership_id, source_record_id) = 0),
  CONSTRAINT events_check3 CHECK (scope = 'account_private' OR author_membership_id IS NOT NULL),
  CONSTRAINT events_check4 CHECK ((kind = 'personal') = (visibility = 'private')),
  CONSTRAINT events_check5 CHECK (kind <> 'personal' OR responsible_membership_id IS NULL),
  CONSTRAINT events_check6 CHECK ((kind = 'official') = (official_state IS NOT NULL)),
  CONSTRAINT events_check7 CHECK (kind = 'official' OR affects_instruction = false),
  CONSTRAINT events_check8 CHECK (visibility <> 'audience' OR audience_set_id IS NOT NULL),
  CONSTRAINT events_check9 CHECK (end_date >= start_date),
  CONSTRAINT events_check10 CHECK (all_day = (starts_at IS NULL) AND all_day = (ends_at IS NULL)),
  CONSTRAINT events_check11 CHECK (starts_at IS NULL OR ends_at > starts_at),
  CONSTRAINT events_check12 CHECK ((status = 'cancelled') = (cancelled_at IS NOT NULL)),
  CONSTRAINT events_check13 CHECK ((deleted_at IS NULL) = (deleted_by_account_id IS NULL)),
  CONSTRAINT events_description_check CHECK (length(description) <= 10000),
  CONSTRAINT events_kind_check CHECK (kind IN ('official','shared','personal')),
  CONSTRAINT events_location_check CHECK (length(location) <= 200),
  CONSTRAINT events_official_state_check CHECK (official_state IN ('draft','confirmed')),
  CONSTRAINT events_scope_check CHECK (scope IN ('school','account_private')),
  CONSTRAINT events_status_check CHECK (status IN ('draft','active','cancelled')),
  CONSTRAINT events_title_check CHECK (length(btrim(title)) BETWEEN 1 AND 200 AND btrim(title, E' \t\n\r') <> ''),
  CONSTRAINT events_visibility_check CHECK (visibility IN ('school','audience','private')),
  CONSTRAINT events_version_check CHECK (version > 0 AND current_revision_no > 0),
  CONSTRAINT events_official_pointer_check CHECK (official_effective_revision_no IS NULL OR kind = 'official'),
  -- F5 보류: 업무분장(duties)·원본 가져오기(source_records)는 해당 배치에서 만든다. 그 전에는 값을 받지 않는다.
  CONSTRAINT events_duty_pending CHECK (duty_id IS NULL),
  CONSTRAINT events_source_record_pending CHECK (source_record_id IS NULL)
);
CREATE INDEX events_school_range ON workhub.events (school_id, start_date, end_date, id);
CREATE INDEX events_school_end ON workhub.events (school_id, end_date, start_date) WHERE deleted_at IS NULL;
CREATE INDEX events_author_end ON workhub.events (author_account_id, end_date, start_date) WHERE deleted_at IS NULL;
CREATE INDEX events_official ON workhub.events (school_id, start_date) WHERE kind = 'official' AND deleted_at IS NULL;
CREATE INDEX events_responsible ON workhub.events (school_id, responsible_membership_id, start_date, id) WHERE responsible_membership_id IS NOT NULL;
CREATE TRIGGER events_identity BEFORE UPDATE ON workhub.events
  FOR EACH ROW EXECUTE FUNCTION workhub_private.forbid_identity_change('id','scope','school_id','author_account_id','author_membership_id','created_at');

CREATE TABLE workhub.event_revisions (
  event_id              text NOT NULL,
  revision_no           integer NOT NULL,
  scope_key             text NOT NULL,
  school_id             text,
  event_version         integer NOT NULL,
  snapshot              jsonb NOT NULL,
  change_kind           text NOT NULL,
  change_reason         text,
  changed_by_account_id text,
  changed_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT event_revisions_pkey PRIMARY KEY (event_id, revision_no),
  CONSTRAINT event_revisions_event_id_event_version_key UNIQUE (event_id, event_version),
  CONSTRAINT event_revisions_scope_key_event_id_revision_no_key UNIQUE (scope_key, event_id, revision_no),
  CONSTRAINT event_revisions_school_id_event_id_revision_no_key UNIQUE (school_id, event_id, revision_no),
  CONSTRAINT event_revisions_scope_key_event_id_fkey FOREIGN KEY (scope_key, event_id) REFERENCES workhub.events(scope_key, id),
  CONSTRAINT event_revisions_school_id_fkey FOREIGN KEY (school_id) REFERENCES workhub.schools(id),
  CONSTRAINT event_revisions_changed_by_account_id_fkey FOREIGN KEY (changed_by_account_id) REFERENCES workhub.accounts(id),
  CONSTRAINT event_revisions_change_kind_check CHECK (change_kind IN ('create','update','cancel','restore','delete','official_confirm','official_withdraw','import_apply')),
  CONSTRAINT event_revisions_change_reason_check CHECK (length(change_reason) <= 500),
  CONSTRAINT event_revisions_check CHECK ((school_id IS NOT NULL AND scope_key = 's:' || school_id) OR (school_id IS NULL AND scope_key LIKE 'a:%')),
  CONSTRAINT event_revisions_revision_no_check CHECK (revision_no > 0),
  CONSTRAINT event_revisions_snapshot_check CHECK (jsonb_typeof(snapshot) = 'object')
);
CREATE TRIGGER event_revisions_immutable BEFORE UPDATE OR DELETE ON workhub.event_revisions
  FOR EACH ROW EXECUTE FUNCTION workhub_private.forbid_change();
-- 공식 효력판 포인터: 같은 일정의 판만 가리킨다(일정과 판이 서로 참조하므로 판 표 뒤에 붙인다)
ALTER TABLE workhub.events ADD CONSTRAINT events_official_effective_revision_fkey
  FOREIGN KEY (scope_key, id, official_effective_revision_no) REFERENCES workhub.event_revisions(scope_key, event_id, revision_no)
  DEFERRABLE INITIALLY DEFERRED;

-- ----------------------------------------------------------------------------
-- 3. 업무(할 일)
-- ----------------------------------------------------------------------------
CREATE TABLE workhub.tasks (
  id                        text NOT NULL DEFAULT gen_random_uuid()::text,
  scope                     text NOT NULL,
  school_id                 text,
  owner_account_id          text NOT NULL,
  title                     text NOT NULL,
  note                      text,
  status                    text NOT NULL DEFAULT 'todo',
  due_on                    date,
  due_at                    timestamptz,
  source_type               text NOT NULL DEFAULT 'direct',
  source_id                 text,
  source_role               text,
  completion_rule           text NOT NULL DEFAULT 'manual',
  completed_by_ref          text,
  assigned_by_membership_id text,
  assignment_batch_id       text,
  academic_year_id          text,
  pinned                    boolean NOT NULL DEFAULT false,
  sort_key                  integer NOT NULL DEFAULT 0,
  done_at                   timestamptz,
  cancelled_at              timestamptz,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  version                   integer NOT NULL DEFAULT 1,
  CONSTRAINT tasks_pkey PRIMARY KEY (id),
  CONSTRAINT tasks_school_id_id_key UNIQUE (school_id, id),
  CONSTRAINT tasks_school_id_fkey FOREIGN KEY (school_id) REFERENCES workhub.schools(id),
  CONSTRAINT tasks_owner_account_id_fkey FOREIGN KEY (owner_account_id) REFERENCES workhub.accounts(id),
  CONSTRAINT tasks_school_id_academic_year_id_fkey FOREIGN KEY (school_id, academic_year_id) REFERENCES workhub.academic_years(school_id, id),
  CONSTRAINT tasks_school_id_assigned_by_membership_id_fkey FOREIGN KEY (school_id, assigned_by_membership_id) REFERENCES workhub.memberships(school_id, id),
  CONSTRAINT tasks_check CHECK ((scope = 'school') = (school_id IS NOT NULL)),
  CONSTRAINT tasks_check1 CHECK (scope = 'school' OR source_type IN ('direct','ai')),
  CONSTRAINT tasks_check2 CHECK (school_id IS NOT NULL OR num_nonnulls(assigned_by_membership_id, academic_year_id) = 0),
  CONSTRAINT tasks_check3 CHECK ((source_type IN ('direct','ai')) = (source_id IS NULL)),
  CONSTRAINT tasks_check4 CHECK ((source_id IS NULL) = (source_role IS NULL)),
  CONSTRAINT tasks_check5 CHECK (source_role <> 'responsible' OR source_type = 'event'),
  CONSTRAINT tasks_check6 CHECK (completion_rule = 'manual' OR source_type NOT IN ('direct','ai')),
  CONSTRAINT tasks_check7 CHECK (source_type NOT IN ('collection_unit','correction_request','timetable_change','notice_ack','handover') OR completion_rule = 'source_event'),
  CONSTRAINT tasks_check8 CHECK (completion_rule = 'manual' OR status <> 'done' OR completed_by_ref IS NOT NULL),
  CONSTRAINT tasks_check9 CHECK (source_type NOT IN ('direct','ai') OR (assigned_by_membership_id IS NULL AND assignment_batch_id IS NULL)),
  CONSTRAINT tasks_check10 CHECK ((status = 'done') = (done_at IS NOT NULL)),
  CONSTRAINT tasks_check11 CHECK (due_at IS NULL OR due_on IS NULL),
  CONSTRAINT tasks_completion_rule_check CHECK (completion_rule IN ('manual','source_event')),
  CONSTRAINT tasks_note_check CHECK (length(note) <= 5000),
  CONSTRAINT tasks_scope_check CHECK (scope IN ('school','account_private')),
  CONSTRAINT tasks_source_role_check CHECK (source_role IN ('responsible','linked')),
  CONSTRAINT tasks_source_type_check CHECK (source_type IN ('direct','ai','event','collection_unit','correction_request','duty','cooperation','handover','timetable_change','notice_ack')),
  CONSTRAINT tasks_status_check CHECK (status IN ('todo','doing','waiting','done','cancelled')),
  CONSTRAINT tasks_title_check CHECK (length(btrim(title)) BETWEEN 1 AND 200),
  CONSTRAINT tasks_version_check CHECK (version > 0),
  CONSTRAINT tasks_cancelled_check CHECK ((status = 'cancelled') = (cancelled_at IS NOT NULL)),
  -- F5 보류: 원본 연결 업무(일정·수합·인계 등)는 원본 판정기(resolver)가 생기는 배치에서 연다.
  -- 그 전에는 직접 만든 업무만 받는다.
  CONSTRAINT tasks_source_pending CHECK (source_type = 'direct' AND completion_rule = 'manual')
);
CREATE INDEX tasks_owner_open ON workhub.tasks (owner_account_id, school_id, status, due_on, id) WHERE status IN ('todo','doing','waiting');
CREATE INDEX tasks_owner_all ON workhub.tasks (school_id, owner_account_id, id);
CREATE INDEX tasks_assigned_by ON workhub.tasks (assigned_by_membership_id) WHERE assigned_by_membership_id IS NOT NULL;
CREATE INDEX tasks_source ON workhub.tasks (source_type, source_id) WHERE source_id IS NOT NULL;
CREATE UNIQUE INDEX tasks_one_responsible ON workhub.tasks (source_id) WHERE source_role = 'responsible' AND status <> 'cancelled';
CREATE UNIQUE INDEX tasks_source_dedupe ON workhub.tasks (owner_account_id, source_type, source_id) WHERE source_id IS NOT NULL;
CREATE TRIGGER tasks_identity BEFORE UPDATE ON workhub.tasks
  FOR EACH ROW EXECUTE FUNCTION workhub_private.forbid_identity_change('id','scope','school_id','owner_account_id','source_type','source_id','created_at');

ALTER TABLE workhub.audience_sets ENABLE ROW LEVEL SECURITY;
ALTER TABLE workhub.audience_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE workhub.audience_conditions ENABLE ROW LEVEL SECURITY;
ALTER TABLE workhub.audience_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE workhub.events ENABLE ROW LEVEL SECURITY;
ALTER TABLE workhub.event_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE workhub.tasks ENABLE ROW LEVEL SECURITY;

-- ----------------------------------------------------------------------------
-- 4. 내부 판정·변환 함수
-- ----------------------------------------------------------------------------
-- 앱(JavaScript trim)과 같은 공백 목록. 길이 한도는 유니코드 코드포인트(length)로 잰다.
CREATE FUNCTION workhub_private.js_trim(p_text text) RETURNS text
LANGUAGE sql IMMUTABLE STRICT SET search_path = '' AS $$
  SELECT btrim(p_text, U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF')
$$;

CREATE FUNCTION workhub_private.string_array(p jsonb, p_max integer) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT p IS NOT NULL AND jsonb_typeof(p) = 'array' AND jsonb_array_length(p) <= p_max
     AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p) v
                     WHERE jsonb_typeof(v) <> 'string' OR length(v #>> '{}') NOT BETWEEN 1 AND 200)
$$;

-- 요청 의도의 결정적 지문(jsonb 는 키 순서를 정규화한다)
CREATE FUNCTION workhub_private.request_sha256(p jsonb) RETURNS text
LANGUAGE sql IMMUTABLE STRICT SET search_path = '' AS $$
  SELECT encode(sha256(convert_to(p::text, 'UTF8')), 'hex')
$$;

-- 교사의 부서·학년·교과 관계. 통합 설계에서는 승인된 담당(assignments)에서 온다.
-- R0 에는 담당 표를 만들지 않으므로 빈 목록이다(조건형 관련 대상은 저장만 되고 아무와도 맞지 않는다).
CREATE FUNCTION workhub_private.member_relations(p_school_id text, p_membership_id text) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT jsonb_build_object('departmentIds', '[]'::jsonb, 'gradeIds', '[]'::jsonb, 'subjectIds', '[]'::jsonb)
$$;

-- 저장된 관련 대상 → 앱 형식
CREATE FUNCTION workhub_private.audience_json(p_school_id text, p_set_id text) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT jsonb_build_object(
    'all', COALESCE((SELECT a.include_all FROM workhub.audience_sets a WHERE a.school_id = p_school_id AND a.id = p_set_id), false),
    'groups', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'departmentIds', COALESCE((SELECT jsonb_agg(c.ref_value ORDER BY c.ref_value) FROM workhub.audience_conditions c WHERE c.group_id = g.id AND c.dimension = 'department'), '[]'::jsonb),
        'gradeIds',      COALESCE((SELECT jsonb_agg(c.ref_value ORDER BY c.ref_value) FROM workhub.audience_conditions c WHERE c.group_id = g.id AND c.dimension = 'grade'), '[]'::jsonb),
        'subjectIds',    COALESCE((SELECT jsonb_agg(c.ref_value ORDER BY c.ref_value) FROM workhub.audience_conditions c WHERE c.group_id = g.id AND c.dimension = 'subject'), '[]'::jsonb))
        ORDER BY g.group_no) FROM workhub.audience_groups g WHERE g.school_id = p_school_id AND g.audience_set_id = p_set_id), '[]'::jsonb),
    'includeMemberIds', COALESCE((SELECT jsonb_agg(m.membership_id ORDER BY m.membership_id) FROM workhub.audience_members m
                                   WHERE m.school_id = p_school_id AND m.audience_set_id = p_set_id AND m.mode = 'include'), '[]'::jsonb),
    'excludeMemberIds', COALESCE((SELECT jsonb_agg(m.membership_id ORDER BY m.membership_id) FROM workhub.audience_members m
                                   WHERE m.school_id = p_school_id AND m.audience_set_id = p_set_id AND m.mode = 'exclude'), '[]'::jsonb))
$$;

-- 앱 domain.ts matchesAudience 와 같은 규칙: 제외 > 전체/직접 포함 > 조건 묶음(묶음 안은 AND, 묶음끼리는 OR)
CREATE FUNCTION workhub_private.audience_matches(p_audience jsonb, p_membership_id text, p_relations jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE
    WHEN p_audience -> 'excludeMemberIds' ? p_membership_id THEN false
    WHEN p_audience -> 'all' = 'true'::jsonb OR p_audience -> 'includeMemberIds' ? p_membership_id THEN true
    ELSE EXISTS (
      SELECT 1 FROM jsonb_array_elements(p_audience -> 'groups') g
      WHERE jsonb_array_length(g -> 'departmentIds') + jsonb_array_length(g -> 'gradeIds') + jsonb_array_length(g -> 'subjectIds') > 0
        AND (jsonb_array_length(g -> 'departmentIds') = 0 OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(g -> 'departmentIds') v WHERE p_relations -> 'departmentIds' ? v))
        AND (jsonb_array_length(g -> 'gradeIds') = 0 OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(g -> 'gradeIds') v WHERE p_relations -> 'gradeIds' ? v))
        AND (jsonb_array_length(g -> 'subjectIds') = 0 OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(g -> 'subjectIds') v WHERE p_relations -> 'subjectIds' ? v)))
  END
$$;

-- 앱이 받는 일정 형식(CalendarEvent)
CREATE FUNCTION workhub_private.event_dto(e workhub.events, p_timezone text) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT jsonb_build_object(
    'id', e.id, 'schoolId', e.school_id, 'authorMemberId', e.author_membership_id,
    'title', e.title, 'description', COALESCE(e.description, ''), 'location', COALESCE(e.location, ''),
    'startDate', to_char(e.start_date, 'YYYY-MM-DD'), 'endDate', to_char(e.end_date, 'YYYY-MM-DD'),
    'allDay', e.all_day,
    'startTime', CASE WHEN e.all_day THEN '' ELSE to_char(e.starts_at AT TIME ZONE p_timezone, 'HH24:MI') END,
    'endTime',   CASE WHEN e.all_day THEN '' ELSE to_char(e.ends_at AT TIME ZONE p_timezone, 'HH24:MI') END,
    'visibility', e.visibility,
    'audience', workhub_private.audience_json(e.school_id, e.audience_set_id),
    'version', e.version,
    'updatedAt', to_char(e.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
$$;

-- 현재 소속으로 이 일정을 읽을 수 있는가 (앱 domain.ts canRead 와 같은 규칙 + 삭제·학교 경계)
-- 작성자 판정은 계정 기준: 같은 학교에 다시 소속된 본인은 과거 본인 일정을 읽는다(01 문서 3절).
CREATE FUNCTION workhub_private.event_readable(e workhub.events, p_ctx workhub_private.actor_context) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT p_ctx.actor_kind = 'member' AND e.scope = 'school' AND e.school_id = p_ctx.school_id AND e.deleted_at IS NULL
     AND (e.author_account_id = p_ctx.account_id
          OR (e.visibility = 'school')
          OR (e.visibility = 'audience' AND workhub_private.audience_matches(
                workhub_private.audience_json(e.school_id, e.audience_set_id), p_ctx.membership_id,
                workhub_private.member_relations(p_ctx.school_id, p_ctx.membership_id))))
$$;

-- 앱 저장 입력(EventDraft) 검사·정규화. 앱이 모르는 추가 키는 무시하고 저장하지 않는다.
CREATE FUNCTION workhub_private.normalize_event_draft(d jsonb, p_ctx workhub_private.actor_context) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE k text; g jsonb; a jsonb; sd date; ed date; has_group boolean := false; groups jsonb := '[]'::jsonb;
        inc jsonb; exc jsonb; v_title text;
BEGIN
  IF d IS NULL OR jsonb_typeof(d) <> 'object' THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  FOREACH k IN ARRAY ARRAY['title','description','location','startDate','endDate','startTime','endTime','visibility'] LOOP
    IF jsonb_typeof(d -> k) IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  END LOOP;
  v_title := workhub_private.js_trim(d ->> 'title');
  IF jsonb_typeof(d -> 'allDay') IS DISTINCT FROM 'boolean'
     OR length(v_title) NOT BETWEEN 1 AND 100
     OR length(d ->> 'description') > 2000 OR length(d ->> 'location') > 100
     OR d ->> 'visibility' NOT IN ('school','audience','private')
     OR d ->> 'startDate' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' OR d ->> 'endDate' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN
    RAISE EXCEPTION 'INVALID_INPUT';
  END IF;
  BEGIN
    sd := (d ->> 'startDate')::date; ed := (d ->> 'endDate')::date;
  EXCEPTION WHEN others THEN RAISE EXCEPTION 'INVALID_INPUT';
  END;
  IF to_char(sd, 'YYYY-MM-DD') <> d ->> 'startDate' OR to_char(ed, 'YYYY-MM-DD') <> d ->> 'endDate' OR sd > ed THEN
    RAISE EXCEPTION 'INVALID_INPUT';
  END IF;
  IF d -> 'allDay' = 'false'::jsonb AND (
       d ->> 'startTime' !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' OR d ->> 'endTime' !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
       OR (sd = ed AND d ->> 'startTime' >= d ->> 'endTime')) THEN
    RAISE EXCEPTION 'INVALID_INPUT';
  END IF;
  a := d -> 'audience';
  IF jsonb_typeof(a) IS DISTINCT FROM 'object' OR jsonb_typeof(a -> 'all') IS DISTINCT FROM 'boolean'
     OR jsonb_typeof(a -> 'groups') IS DISTINCT FROM 'array' OR jsonb_array_length(a -> 'groups') > 50
     OR NOT workhub_private.string_array(a -> 'includeMemberIds', 1000) OR NOT workhub_private.string_array(a -> 'excludeMemberIds', 1000) THEN
    RAISE EXCEPTION 'INVALID_INPUT';
  END IF;
  FOR g IN SELECT value FROM jsonb_array_elements(a -> 'groups') WITH ORDINALITY ORDER BY ordinality LOOP
    IF jsonb_typeof(g) <> 'object' THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
    FOREACH k IN ARRAY ARRAY['departmentIds','gradeIds','subjectIds'] LOOP
      IF NOT workhub_private.string_array(g -> k, 100) THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
      IF jsonb_array_length(g -> k) > 0 THEN has_group := true; END IF;
    END LOOP;
    -- 같은 값 중복은 하나로, 순서는 정렬해 저장한다(저장 뒤 다시 읽을 때와 지문이 같도록).
    groups := groups || jsonb_build_array(jsonb_build_object(
      'departmentIds', COALESCE((SELECT jsonb_agg(DISTINCT v ORDER BY v) FROM jsonb_array_elements_text(g -> 'departmentIds') v), '[]'::jsonb),
      'gradeIds',      COALESCE((SELECT jsonb_agg(DISTINCT v ORDER BY v) FROM jsonb_array_elements_text(g -> 'gradeIds') v), '[]'::jsonb),
      'subjectIds',    COALESCE((SELECT jsonb_agg(DISTINCT v ORDER BY v) FROM jsonb_array_elements_text(g -> 'subjectIds') v), '[]'::jsonb)));
  END LOOP;
  inc := COALESCE((SELECT jsonb_agg(DISTINCT v ORDER BY v) FROM jsonb_array_elements_text(a -> 'includeMemberIds') v), '[]'::jsonb);
  exc := COALESCE((SELECT jsonb_agg(DISTINCT v ORDER BY v) FROM jsonb_array_elements_text(a -> 'excludeMemberIds') v), '[]'::jsonb);
  IF EXISTS (SELECT 1 FROM jsonb_array_elements_text(inc) v WHERE exc ? v) THEN
    RAISE EXCEPTION 'INVALID_INPUT' USING DETAIL = '같은 교사를 포함과 제외에 함께 둘 수 없습니다.';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements_text(inc || exc) v
             WHERE NOT EXISTS (SELECT 1 FROM workhub.memberships m WHERE m.school_id = p_ctx.school_id AND m.id = v)) THEN
    RAISE EXCEPTION 'INVALID_INPUT' USING DETAIL = '다른 학교의 교사를 관련 대상에 포함할 수 없습니다.';
  END IF;
  IF a -> 'all' = 'false'::jsonb AND NOT has_group AND jsonb_array_length(inc) = 0 AND d ->> 'visibility' <> 'private' THEN
    RAISE EXCEPTION 'INVALID_INPUT' USING DETAIL = '관련 대상을 선택해 주세요.';
  END IF;
  RETURN jsonb_build_object(
    'title', v_title,
    'description', workhub_private.js_trim(d ->> 'description'),
    'location', workhub_private.js_trim(d ->> 'location'),
    'startDate', d ->> 'startDate', 'endDate', d ->> 'endDate', 'allDay', d -> 'allDay',
    'startTime', CASE WHEN d -> 'allDay' = 'true'::jsonb THEN '' ELSE d ->> 'startTime' END,
    'endTime',   CASE WHEN d -> 'allDay' = 'true'::jsonb THEN '' ELSE d ->> 'endTime' END,
    'visibility', d ->> 'visibility',
    'audience', jsonb_build_object('all', a -> 'all', 'groups', groups, 'includeMemberIds', inc, 'excludeMemberIds', exc));
END $$;

-- 정규화된 관련 대상을 새 묶음으로 저장
CREATE FUNCTION workhub_private.store_audience(p_ctx workhub_private.actor_context, p_audience jsonb) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_set text; v_group text; g jsonb; n integer := 0; dim record;
BEGIN
  INSERT INTO workhub.audience_sets (school_id, include_all, created_by_membership_id)
  VALUES (p_ctx.school_id, (p_audience ->> 'all')::boolean, p_ctx.membership_id)
  RETURNING id INTO v_set;
  FOR g IN SELECT value FROM jsonb_array_elements(p_audience -> 'groups') WITH ORDINALITY ORDER BY ordinality LOOP
    n := n + 1;
    INSERT INTO workhub.audience_groups (school_id, audience_set_id, group_no) VALUES (p_ctx.school_id, v_set, n) RETURNING id INTO v_group;
    FOR dim IN SELECT * FROM (VALUES ('department','departmentIds'), ('grade','gradeIds'), ('subject','subjectIds')) AS x(dimension, field) LOOP
      INSERT INTO workhub.audience_conditions (school_id, group_id, dimension, ref_value)
      SELECT p_ctx.school_id, v_group, dim.dimension, v FROM jsonb_array_elements_text(g -> dim.field) v;
    END LOOP;
  END LOOP;
  INSERT INTO workhub.audience_members (school_id, audience_set_id, membership_id, mode)
  SELECT p_ctx.school_id, v_set, v, 'include' FROM jsonb_array_elements_text(p_audience -> 'includeMemberIds') v
  UNION ALL
  SELECT p_ctx.school_id, v_set, v, 'exclude' FROM jsonb_array_elements_text(p_audience -> 'excludeMemberIds') v;
  RETURN v_set;
END $$;

-- 앱이 받는 업무 형식(PersonalTask). ownerMemberId 는 요청한 현재 소속이다(소유는 계정+학교).
CREATE FUNCTION workhub_private.task_dto(t workhub.tasks, p_member_id text) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT jsonb_build_object('id', t.id, 'schoolId', t.school_id, 'ownerMemberId', p_member_id,
    'title', t.title, 'notes', COALESCE(t.note, ''), 'dueDate', COALESCE(to_char(t.due_on, 'YYYY-MM-DD'), ''),
    'status', t.status, 'version', t.version)
$$;

-- 앱 업무 입력(TaskInput) 검사·정규화 — tasks/validation.ts normalizeTaskInput 과 같은 규칙
CREATE FUNCTION workhub_private.normalize_task_input(p jsonb) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE k text; due date; v_title text;
BEGIN
  IF p IS NULL OR jsonb_typeof(p) <> 'object'
     OR EXISTS (SELECT 1 FROM jsonb_object_keys(p) key WHERE key NOT IN ('title','notes','dueDate')) THEN
    RAISE EXCEPTION 'INVALID_INPUT';
  END IF;
  FOREACH k IN ARRAY ARRAY['title','notes','dueDate'] LOOP
    IF jsonb_typeof(p -> k) IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  END LOOP;
  v_title := workhub_private.js_trim(p ->> 'title');
  IF length(p ->> 'title') > 120 OR length(v_title) = 0 OR length(p ->> 'notes') > 2000 THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  IF p ->> 'dueDate' <> '' THEN
    IF p ->> 'dueDate' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' OR p ->> 'dueDate' LIKE '0000-%' THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
    BEGIN due := (p ->> 'dueDate')::date;
    EXCEPTION WHEN others THEN RAISE EXCEPTION 'INVALID_INPUT';
    END;
    IF to_char(due, 'YYYY-MM-DD') <> p ->> 'dueDate' THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  END IF;
  RETURN jsonb_build_object('title', v_title, 'notes', workhub_private.js_trim(p ->> 'notes'), 'dueDate', p ->> 'dueDate');
END $$;

-- 쓰기 명령의 공통 앞부분: 현재 권한 잠금 → 같은 키 직렬화 → 접수증 조회
-- 반환: 기존 접수증(있으면). 같은 키 다른 입력이면 IDEMPOTENCY_CONFLICT.
CREATE FUNCTION workhub_private.claim_receipt(p_ctx workhub_private.actor_context, p_operation text, p_idem_key text, p_sha text)
RETURNS workhub.idempotency_receipts
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE r workhub.idempotency_receipts;
BEGIN
  IF p_idem_key IS NULL OR length(p_idem_key) NOT BETWEEN 8 AND 200 OR length(workhub_private.js_trim(p_idem_key)) = 0 THEN
    RAISE EXCEPTION 'INVALID_INPUT' USING DETAIL = '저장 요청 번호를 확인해 주세요.';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('workhub.receipt:a:' || p_ctx.account_id || chr(31) || p_ctx.scope_key || chr(31) || p_operation || chr(31) || p_idem_key, 0));
  SELECT * INTO r FROM workhub.idempotency_receipts
   WHERE actor_key = 'a:' || p_ctx.account_id AND scope_key = p_ctx.scope_key AND operation = p_operation AND idem_key = p_idem_key;
  IF FOUND AND r.request_sha256 <> p_sha THEN
    RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT';
  END IF;
  RETURN r;
END $$;

CREATE FUNCTION workhub_private.store_receipt(p_ctx workhub_private.actor_context, p_operation text, p_idem_key text, p_sha text,
  p_resource_type text, p_resource_id text, p_resource_version integer) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  INSERT INTO workhub.idempotency_receipts (actor_account_id, scope_key, operation, idem_key, request_sha256,
      resource_type, resource_id, resource_version, result)
  VALUES (p_ctx.account_id, p_ctx.scope_key, p_operation, p_idem_key, p_sha, p_resource_type, p_resource_id, p_resource_version,
      jsonb_build_object('resource_type', p_resource_type, 'resource_id', p_resource_id, 'resource_version', p_resource_version,
                         'recorded_at', to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')));
END $$;

-- 쓰기 권한 잠금: 소속 역할 행을 잡아 역할 회수와 직렬화한다.
CREATE FUNCTION workhub_private.lock_member_roles(p_ctx workhub_private.actor_context) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM 1 FROM workhub.membership_roles WHERE school_id = p_ctx.school_id AND membership_id = p_ctx.membership_id ORDER BY id FOR SHARE;
END $$;

-- ----------------------------------------------------------------------------
-- 5. 앱 호환 함수 7개 (public). 오류는 앱이 아는 코드 문자열로 낸다.
--    FORBIDDEN · INACTIVE_MEMBERSHIP · NOT_FOUND · INVALID_INPUT · CONFLICT(현재 원본 포함) · IDEMPOTENCY_CONFLICT
-- ----------------------------------------------------------------------------
CREATE FUNCTION public.workhub_context() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_uid uuid; a workhub.accounts; v_basis date;
BEGIN
  v_uid := workhub_private.legacy_gate(false);
  a := workhub_private.caller_account(v_uid, false);
  -- 아직 연결되지 않은 승인 superadmin: 소속 없음으로 응답(앱은 '학교 연결 없음'으로 안내)
  IF a.id IS NULL THEN
    RETURN jsonb_build_object('basisDate', to_char((statement_timestamp() AT TIME ZONE 'Asia/Seoul')::date, 'YYYY-MM-DD'),
      'schools', '[]'::jsonb, 'memberships', '[]'::jsonb, 'schoolLabels', '{}'::jsonb);
  END IF;
  RETURN (
    WITH my_schools AS (
      SELECT s.* FROM workhub.schools s
      WHERE s.status = 'active' AND EXISTS (
        SELECT 1 FROM workhub.memberships m
        WHERE m.school_id = s.id AND m.account_id = a.id AND m.status = 'active'
          AND workhub_private.today_in(s.timezone) <@ daterange(m.valid_from, m.valid_to, '[)'))
    ), members AS (
      SELECT m.*, s.timezone, ac.display_name, ac.auth_user_id, ac.status AS account_status
      FROM workhub.memberships m JOIN my_schools s ON s.id = m.school_id JOIN workhub.accounts ac ON ac.id = m.account_id
      WHERE m.status IN ('active','suspended','left') AND m.valid_from IS NOT NULL
    )
    SELECT jsonb_build_object(
      -- 기준일: 학교 시간대의 오늘. 연결된 학교가 없을 때만 기본 시간대를 쓴다.
      'basisDate', to_char(COALESCE((SELECT min(workhub_private.today_in(timezone)) FROM my_schools),
                                    (statement_timestamp() AT TIME ZONE 'Asia/Seoul')::date), 'YYYY-MM-DD'),
      'schools', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name) ORDER BY s.name, s.id) FROM my_schools s), '[]'::jsonb),
      'memberships', COALESCE((SELECT jsonb_agg(
          jsonb_build_object('id', x.id, 'schoolId', x.school_id, 'userId', x.auth_user_id::text, 'name', x.display_name,
            'role', CASE WHEN workhub_private.member_has_perm(ROW('member', x.account_id, x.id, NULL, x.school_id, 's:' || x.school_id,
                                  x.auth_user_id, workhub_private.today_in(x.timezone), x.timezone)::workhub_private.actor_context,
                                  'calendar.shared_manage') THEN 'calendar_manager' ELSE 'teacher' END,
            'active', x.status = 'active' AND x.account_status = 'active',
            'validFrom', to_char(x.valid_from, 'YYYY-MM-DD'),
            -- 통합 설계의 종료 제외(valid_to)를 앱의 마지막 유효일(포함)로 바꾼다. 무기한은 9999-12-31.
            'validThrough', COALESCE(to_char(x.valid_to - 1, 'YYYY-MM-DD'), '9999-12-31'))
          || workhub_private.member_relations(x.school_id, x.id)
          ORDER BY x.school_id, x.id) FROM members x), '[]'::jsonb),
      'schoolLabels', COALESCE((SELECT jsonb_object_agg(s.id, jsonb_build_object(
          'departmentIds', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', d.id, 'name', d.name) ORDER BY d.sort_order, d.name, d.id)
                                     FROM workhub.departments d
                                     WHERE d.school_id = s.id AND workhub_private.today_in(s.timezone) <@ daterange(d.active_from, d.active_to, '[)')), '[]'::jsonb),
          'gradeIds', (SELECT jsonb_agg(jsonb_build_object('id', g::text, 'name', g::text || '학년') ORDER BY g) FROM generate_series(1, s.grade_count) g),
          'subjectIds', '[]'::jsonb)) FROM my_schools s), '{}'::jsonb))
  );
END $$;

CREATE FUNCTION public.workhub_calendar_list(p_member_id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE ctx workhub_private.actor_context;
BEGIN
  ctx := workhub_private.member_actor(p_member_id, false);
  RETURN COALESCE((
    SELECT jsonb_agg(workhub_private.event_dto(e, ctx.school_timezone)
                     ORDER BY e.start_date, (e.starts_at AT TIME ZONE ctx.school_timezone)::time NULLS FIRST, e.id)
    FROM workhub.events e
    WHERE e.school_id = ctx.school_id AND workhub_private.event_readable(e, ctx)), '[]'::jsonb);
END $$;

CREATE FUNCTION public.workhub_calendar_get(p_member_id text, p_event_id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE ctx workhub_private.actor_context; e workhub.events;
BEGIN
  ctx := workhub_private.member_actor(p_member_id, false);
  SELECT * INTO e FROM workhub.events WHERE id = p_event_id AND school_id = ctx.school_id;
  IF NOT FOUND OR NOT workhub_private.event_readable(e, ctx) THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  RETURN workhub_private.event_dto(e, ctx.school_timezone);
END $$;

CREATE FUNCTION public.workhub_calendar_save(p_member_id text, p_command jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  ctx workhub_private.actor_context; e workhub.events; r workhub.idempotency_receipts;
  d jsonb; v_key text; v_target text; v_expected jsonb; v_sha text; v_set text; v_manage boolean;
  v_starts timestamptz; v_ends timestamptz; v_kind text; v_op text;
BEGIN
  -- ① 현재 권한 잠금(회원 승인·계정·학교·소속·역할 순서)
  ctx := workhub_private.member_actor(p_member_id, true);
  PERFORM workhub_private.lock_member_roles(ctx);
  -- ② 입력 형식
  IF p_command IS NULL OR jsonb_typeof(p_command) <> 'object' OR octet_length(p_command::text) > 262144
     OR EXISTS (SELECT 1 FROM jsonb_object_keys(p_command) k WHERE k NOT IN ('draft','id','expectedVersion','idempotencyKey'))
     OR jsonb_typeof(p_command -> 'idempotencyKey') IS DISTINCT FROM 'string' THEN
    RAISE EXCEPTION 'INVALID_INPUT';
  END IF;
  v_key := p_command ->> 'idempotencyKey';
  IF p_command -> 'id' IS NOT NULL AND jsonb_typeof(p_command -> 'id') <> 'null' THEN
    v_target := p_command ->> 'id';
    v_expected := p_command -> 'expectedVersion';
    IF jsonb_typeof(p_command -> 'id') <> 'string' OR length(v_target) NOT BETWEEN 1 AND 200
       OR jsonb_typeof(v_expected) IS DISTINCT FROM 'number' OR v_expected::text !~ '^[1-9][0-9]{0,8}$' THEN
      RAISE EXCEPTION 'INVALID_INPUT';
    END IF;
  ELSIF p_command -> 'expectedVersion' IS NOT NULL AND jsonb_typeof(p_command -> 'expectedVersion') <> 'null' THEN
    RAISE EXCEPTION 'INVALID_INPUT';
  END IF;
  d := workhub_private.normalize_event_draft(p_command -> 'draft', ctx);
  v_op := 'calendar.save';
  v_sha := workhub_private.request_sha256(jsonb_build_object('id', v_target, 'expectedVersion', v_expected, 'draft', d));
  -- ③ 같은 요청 번호: 같은 입력이면 현재 권한으로 다시 읽어 돌려주고, 다르면 충돌
  r := workhub_private.claim_receipt(ctx, v_op, v_key, v_sha);
  IF r.idem_key IS NOT NULL THEN
    SELECT * INTO e FROM workhub.events WHERE id = r.resource_id AND school_id = ctx.school_id;
    IF NOT FOUND OR NOT workhub_private.event_readable(e, ctx) THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
    RETURN workhub_private.event_dto(e, ctx.school_timezone);
  END IF;
  -- ④ 원본 확인
  v_manage := workhub_private.member_has_perm(ctx, 'calendar.shared_manage');
  IF v_target IS NOT NULL THEN
    SELECT * INTO e FROM workhub.events WHERE id = v_target AND school_id = ctx.school_id FOR UPDATE;
    IF NOT FOUND OR NOT workhub_private.event_readable(e, ctx) THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
    IF e.author_account_id <> ctx.account_id AND (NOT v_manage OR e.visibility = 'private') THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
    IF to_jsonb(e.version) <> v_expected THEN
      RAISE EXCEPTION 'CONFLICT' USING DETAIL = workhub_private.event_dto(e, ctx.school_timezone)::text;
    END IF;
    IF e.author_account_id <> ctx.account_id AND d ->> 'visibility' = 'private' THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  END IF;
  -- ⑤ 저장
  v_kind := CASE WHEN d ->> 'visibility' = 'private' THEN 'personal' ELSE 'shared' END;
  IF (d ->> 'allDay')::boolean THEN
    v_starts := NULL; v_ends := NULL;
  ELSE
    v_starts := ((d ->> 'startDate') || ' ' || (d ->> 'startTime'))::timestamp AT TIME ZONE ctx.school_timezone;
    v_ends   := ((d ->> 'endDate')   || ' ' || (d ->> 'endTime'))::timestamp   AT TIME ZONE ctx.school_timezone;
  END IF;
  v_set := workhub_private.store_audience(ctx, d -> 'audience');
  IF v_target IS NULL THEN
    INSERT INTO workhub.events (scope, school_id, kind, visibility, title, description, location, all_day,
        start_date, end_date, starts_at, ends_at, audience_set_id, author_account_id, author_membership_id)
    VALUES ('school', ctx.school_id, v_kind, d ->> 'visibility', d ->> 'title', d ->> 'description', d ->> 'location',
        (d ->> 'allDay')::boolean, (d ->> 'startDate')::date, (d ->> 'endDate')::date, v_starts, v_ends, v_set,
        ctx.account_id, ctx.membership_id)
    RETURNING * INTO e;
  ELSE
    UPDATE workhub.events SET kind = v_kind, visibility = d ->> 'visibility', title = d ->> 'title',
        description = d ->> 'description', location = d ->> 'location', all_day = (d ->> 'allDay')::boolean,
        start_date = (d ->> 'startDate')::date, end_date = (d ->> 'endDate')::date, starts_at = v_starts, ends_at = v_ends,
        audience_set_id = v_set, current_revision_no = current_revision_no + 1, version = version + 1, updated_at = clock_timestamp()
    WHERE id = e.id RETURNING * INTO e;
  END IF;
  INSERT INTO workhub.event_revisions (event_id, revision_no, scope_key, school_id, event_version, snapshot, change_kind, changed_by_account_id)
  VALUES (e.id, e.current_revision_no, e.scope_key, e.school_id, e.version, d,
          CASE WHEN v_target IS NULL THEN 'create' ELSE 'update' END, ctx.account_id);
  -- ⑥ 접수증·감사·outbox (같은 트랜잭션)
  PERFORM workhub_private.store_receipt(ctx, v_op, v_key, v_sha, 'event', e.id, e.version);
  PERFORM workhub_private.write_audit(ctx, CASE WHEN v_target IS NULL THEN 'event.create' ELSE 'event.update' END, 'event', e.id, e.version,
    CASE WHEN e.visibility = 'private' THEN 'owner_only' ELSE 'school' END, v_key, '{}');
  PERFORM workhub_private.emit_outbox(ctx, 'event.saved', 'event', e.id, e.version, jsonb_build_object('event_id', e.id, 'version', e.version));
  RETURN workhub_private.event_dto(e, ctx.school_timezone);
END $$;

CREATE FUNCTION public.workhub_task_list(p_member_id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE ctx workhub_private.actor_context;
BEGIN
  ctx := workhub_private.member_actor(p_member_id, false);
  RETURN COALESCE((
    SELECT jsonb_agg(workhub_private.task_dto(t, ctx.membership_id)
                     ORDER BY (t.status IN ('done','cancelled')), t.due_on NULLS LAST, t.title, t.id)
    FROM workhub.tasks t
    WHERE t.scope = 'school' AND t.school_id = ctx.school_id AND t.owner_account_id = ctx.account_id), '[]'::jsonb);
END $$;

CREATE FUNCTION public.workhub_task_get(p_member_id text, p_task_id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE ctx workhub_private.actor_context; t workhub.tasks;
BEGIN
  ctx := workhub_private.member_actor(p_member_id, false);
  SELECT * INTO t FROM workhub.tasks
   WHERE id = p_task_id AND scope = 'school' AND school_id = ctx.school_id AND owner_account_id = ctx.account_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  RETURN workhub_private.task_dto(t, ctx.membership_id);
END $$;

CREATE FUNCTION public.workhub_task_mutate(p_member_id text, p_command jsonb, p_request_key text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  ctx workhub_private.actor_context; t workhub.tasks; r workhub.idempotency_receipts;
  v_kind text; v_target text; v_expected jsonb; v_input jsonb; v_status text; v_payload jsonb; v_sha text; v_allowed text[];
  v_year text;
BEGIN
  ctx := workhub_private.member_actor(p_member_id, true);
  PERFORM workhub_private.lock_member_roles(ctx);
  IF p_command IS NULL OR jsonb_typeof(p_command) <> 'object' OR octet_length(p_command::text) > 262144
     OR jsonb_typeof(p_command -> 'kind') IS DISTINCT FROM 'string' THEN
    RAISE EXCEPTION 'INVALID_INPUT';
  END IF;
  v_kind := p_command ->> 'kind';
  v_allowed := CASE v_kind WHEN 'create' THEN ARRAY['kind','input']
                           WHEN 'update' THEN ARRAY['kind','taskId','input','expectedVersion']
                           WHEN 'status' THEN ARRAY['kind','taskId','status','expectedVersion'] END;
  IF v_allowed IS NULL OR EXISTS (SELECT 1 FROM jsonb_object_keys(p_command) k WHERE NOT (k = ANY (v_allowed))) THEN
    RAISE EXCEPTION 'INVALID_INPUT';
  END IF;
  IF v_kind <> 'create' THEN
    v_target := p_command ->> 'taskId';
    v_expected := p_command -> 'expectedVersion';
    IF jsonb_typeof(p_command -> 'taskId') IS DISTINCT FROM 'string' OR length(v_target) NOT BETWEEN 1 AND 200
       OR jsonb_typeof(v_expected) IS DISTINCT FROM 'number' OR v_expected::text !~ '^[1-9][0-9]{0,8}$' THEN
      RAISE EXCEPTION 'INVALID_INPUT';
    END IF;
  END IF;
  IF v_kind IN ('create','update') THEN
    v_input := workhub_private.normalize_task_input(p_command -> 'input');
    v_payload := jsonb_build_object('kind', v_kind, 'input', v_input);
  ELSE
    IF jsonb_typeof(p_command -> 'status') IS DISTINCT FROM 'string'
       OR p_command ->> 'status' NOT IN ('todo','doing','waiting','done','cancelled') THEN
      RAISE EXCEPTION 'INVALID_INPUT';
    END IF;
    v_status := p_command ->> 'status';
    v_payload := jsonb_build_object('kind', v_kind, 'status', v_status);
  END IF;
  IF v_kind <> 'create' THEN
    v_payload := v_payload || jsonb_build_object('taskId', v_target, 'expectedVersion', v_expected);
  END IF;
  v_sha := workhub_private.request_sha256(v_payload);
  r := workhub_private.claim_receipt(ctx, 'task.mutate', p_request_key, v_sha);
  IF r.idem_key IS NOT NULL THEN
    SELECT * INTO t FROM workhub.tasks
     WHERE id = r.resource_id AND scope = 'school' AND school_id = ctx.school_id AND owner_account_id = ctx.account_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
    RETURN workhub_private.task_dto(t, ctx.membership_id);
  END IF;
  IF v_kind = 'create' THEN
    SELECT y.id INTO v_year FROM workhub.academic_years y
     WHERE y.school_id = ctx.school_id AND ctx.school_today <@ daterange(y.starts_on, y.ends_on, '[)');
    INSERT INTO workhub.tasks (scope, school_id, owner_account_id, title, note, due_on, academic_year_id)
    VALUES ('school', ctx.school_id, ctx.account_id, v_input ->> 'title', v_input ->> 'notes',
            NULLIF(v_input ->> 'dueDate', '')::date, v_year)
    RETURNING * INTO t;
  ELSE
    -- 본인 업무가 아니면 잠금도 걸지 않는다. 관리자 역할은 남의 개인 업무를 여는 근거가 아니다.
    SELECT * INTO t FROM workhub.tasks
     WHERE id = v_target AND scope = 'school' AND school_id = ctx.school_id AND owner_account_id = ctx.account_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
    IF to_jsonb(t.version) <> v_expected THEN
      RAISE EXCEPTION 'CONFLICT' USING DETAIL = workhub_private.task_dto(t, ctx.membership_id)::text;
    END IF;
    IF v_kind = 'update' THEN
      UPDATE workhub.tasks SET title = v_input ->> 'title', note = v_input ->> 'notes', due_on = NULLIF(v_input ->> 'dueDate', '')::date,
             version = version + 1, updated_at = clock_timestamp()
       WHERE id = t.id RETURNING * INTO t;
    ELSE
      UPDATE workhub.tasks SET status = v_status,
             done_at = CASE WHEN v_status = 'done' THEN COALESCE(done_at, clock_timestamp()) END,
             cancelled_at = CASE WHEN v_status = 'cancelled' THEN COALESCE(cancelled_at, clock_timestamp()) END,
             version = version + 1, updated_at = clock_timestamp()
       WHERE id = t.id RETURNING * INTO t;
    END IF;
  END IF;
  PERFORM workhub_private.store_receipt(ctx, 'task.mutate', p_request_key, v_sha, 'task', t.id, t.version);
  PERFORM workhub_private.write_audit(ctx, 'task.' || v_kind, 'task', t.id, t.version, 'owner_only', p_request_key, '{}');
  PERFORM workhub_private.emit_outbox(ctx, 'task.saved', 'task', t.id, t.version, jsonb_build_object('task_id', t.id, 'version', t.version));
  RETURN workhub_private.task_dto(t, ctx.membership_id);
END $$;

COMMENT ON FUNCTION public.workhub_context() IS '업무실 R0 호환: 로그인 superadmin 의 학교·소속·기준일. 실제 자료는 workhub schema.';
COMMENT ON FUNCTION public.workhub_calendar_list(text) IS '업무실 R0 호환: 현재 소속으로 읽을 수 있는 일정 목록.';
COMMENT ON FUNCTION public.workhub_calendar_get(text, text) IS '업무실 R0 호환: 일정 하나.';
COMMENT ON FUNCTION public.workhub_calendar_save(text, jsonb) IS '업무실 R0 호환: 일정 저장(요청 번호·기대 판·감사·outbox 한 트랜잭션).';
COMMENT ON FUNCTION public.workhub_task_list(text) IS '업무실 R0 호환: 본인 업무 목록.';
COMMENT ON FUNCTION public.workhub_task_get(text, text) IS '업무실 R0 호환: 본인 업무 하나.';
COMMENT ON FUNCTION public.workhub_task_mutate(text, jsonb, text) IS '업무실 R0 호환: 본인 업무 생성·수정·상태 변경.';

-- ----------------------------------------------------------------------------
-- 6. 권한 — 표·내부 함수는 0, 호환 함수 7개만 authenticated 에 연다(anon 회수)
-- ----------------------------------------------------------------------------
REVOKE ALL ON ALL TABLES IN SCHEMA workhub, workhub_private FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA workhub, workhub_private FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA workhub, workhub_private FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.workhub_context(), public.workhub_calendar_list(text), public.workhub_calendar_get(text, text),
  public.workhub_calendar_save(text, jsonb), public.workhub_task_list(text), public.workhub_task_get(text, text),
  public.workhub_task_mutate(text, jsonb, text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.workhub_context(), public.workhub_calendar_list(text), public.workhub_calendar_get(text, text),
  public.workhub_calendar_save(text, jsonb), public.workhub_task_list(text), public.workhub_task_get(text, text),
  public.workhub_task_mutate(text, jsonb, text) TO authenticated;

COMMIT;

-- ----------------------------------------------------------------------------
-- 7. 검증 — 모든 행의 status 가 ok 여야 한다
-- ----------------------------------------------------------------------------
WITH expected(name, args) AS (VALUES
  ('workhub_context', ''), ('workhub_calendar_list', 'p_member_id text'),
  ('workhub_calendar_get', 'p_member_id text, p_event_id text'), ('workhub_calendar_save', 'p_member_id text, p_command jsonb'),
  ('workhub_task_list', 'p_member_id text'), ('workhub_task_get', 'p_member_id text, p_task_id text'),
  ('workhub_task_mutate', 'p_member_id text, p_command jsonb, p_request_key text')),
fn AS (
  SELECT e.name, p.oid, pg_get_function_arguments(p.oid) AS args, e.args AS want, p.prosecdef, p.proconfig
  FROM expected e LEFT JOIN pg_proc p ON p.proname = e.name AND p.pronamespace = 'public'::regnamespace)
SELECT 'B02-1' AS no, '호환 함수 7개 · 인자 일치 · 오버로드 없음' AS item,
       CASE WHEN count(*) FILTER (WHERE args = want) = 7 AND count(*) = 7 THEN 'ok' ELSE 'FAIL' END AS status,
       count(*) FILTER (WHERE args = want)::text AS value
FROM fn
UNION ALL
SELECT 'B02-2', '7개 모두 SECURITY DEFINER + search_path 고정',
       CASE WHEN bool_and(prosecdef AND proconfig @> ARRAY['search_path=""']) THEN 'ok' ELSE 'FAIL' END, '' FROM fn
UNION ALL
SELECT 'B02-3', 'authenticated 만 실행 가능(anon·PUBLIC 불가)',
       CASE WHEN bool_and(has_function_privilege('authenticated', oid, 'EXECUTE') AND NOT has_function_privilege('anon', oid, 'EXECUTE')) THEN 'ok' ELSE 'FAIL' END, '' FROM fn
UNION ALL
SELECT 'B02-4', 'workhub 표 21개 모두 RLS 켜짐, API 역할 표 권한 0',
       CASE WHEN count(*) = 21 AND bool_and(c.relrowsecurity)
             AND NOT bool_or(has_table_privilege('authenticated', c.oid, 'SELECT,INSERT,UPDATE,DELETE')
                          OR has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE')) THEN 'ok' ELSE 'FAIL' END,
       count(*)::text
FROM pg_class c WHERE c.relnamespace = 'workhub'::regnamespace AND c.relkind = 'r'
UNION ALL
SELECT 'B02-5', '내부 함수 EXECUTE 를 가진 API 역할 0',
       CASE WHEN count(*) = 0 THEN 'ok' ELSE 'FAIL' END, count(*)::text
FROM pg_proc p, unnest(ARRAY['anon','authenticated','service_role']) r
WHERE p.pronamespace IN ('workhub'::regnamespace, 'workhub_private'::regnamespace) AND has_function_privilege(r, p.oid, 'EXECUTE')
ORDER BY 1;
