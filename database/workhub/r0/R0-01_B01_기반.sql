-- ============================================================================
-- R0-01  B01 기반 — 학교·계정·소속·역할·학년도·학기·서비스 주체·접수·감사·outbox
--
-- 업무실(workhub) 통합 설계의 첫 배치 중 R0(기존 계정의 일정·업무 최소 왕복)에
-- 필요한 부분만 만든다. 설계 근거: docs/workhub/database-integrated/ (PR #28),
-- 처분 근거: R0_설계결정.md 의 F5·F6·F8 절과 제약 처분표.
--
-- ▣ 지키는 것 (F8)
--   - 기존 public 표·함수·트리거·정책·권한을 한 줄도 바꾸지 않는다. 새 객체만 만든다.
--   - 기존 회원은 Auth UID 로만 연결한다(이메일·이름 추정 연결 없음). 이 파일은 회원을
--     연결하지 않는다. 첫 관리자 연결은 R0-03 에서 한다.
--   - 승인된 superadmin 에게만 연다. 공개 범위를 넓히는 설정값을 두지 않는다
--     (넓히려면 새 SQL 배치가 필요하다 = 계란님 승인 사항).
--
-- ▣ 실행: Supabase SQL Editor 에 전체를 붙여 넣고 Run. 한 트랜잭션이라 중간에 실패하면
--   아무것도 남지 않는다. 마지막 SELECT 의 status 가 모두 ok 여야 한다.
-- ▣ 선행: 기존 migrations 001~007. 되돌림: R0-90_되돌림.sql
-- ============================================================================
BEGIN;

-- ----------------------------------------------------------------------------
-- 0. 선행 확인 — 하나라도 어긋나면 아무것도 만들지 않고 멈춘다
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  IF current_setting('server_version_num')::int < 150000 THEN
    RAISE EXCEPTION 'R0 중단: PostgreSQL 15 이상이 필요합니다 (현재 %)', current_setting('server_version');
  END IF;
  IF to_regnamespace('workhub') IS NOT NULL OR to_regnamespace('workhub_private') IS NOT NULL THEN
    RAISE EXCEPTION 'R0 중단: workhub 또는 workhub_private schema 가 이미 있습니다. 이미 실행했는지 확인해 주세요.';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
             WHERE n.nspname = 'public' AND p.proname LIKE 'workhub\_%') THEN
    RAISE EXCEPTION 'R0 중단: public.workhub_* 함수가 이미 있습니다. 구 제안본(001·004)이 실행됐는지 먼저 확인해 주세요.';
  END IF;
  IF to_regclass('public.users') IS NULL OR to_regclass('auth.users') IS NULL
     OR to_regprocedure('public.is_approved()') IS NULL OR to_regprocedure('public.get_my_role()') IS NULL
     OR to_regprocedure('auth.uid()') IS NULL THEN
    RAISE EXCEPTION 'R0 중단: 기존 회원 구조(public.users, is_approved, get_my_role, auth.uid)를 찾지 못했습니다.';
  END IF;
  IF to_regnamespace('extensions') IS NULL THEN
    RAISE EXCEPTION 'R0 중단: extensions schema 가 없습니다 (Supabase 기본 schema).';
  END IF;
END $$;

-- 기간 중첩 금지(EXCLUDE)에 text '=' 를 쓰려면 btree_gist 가 필요하다.
-- 이미 있으면 그대로 쓴다. 되돌림에서도 지우지 않는다(다른 곳에서 쓸 수 있다).
CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA extensions;

CREATE SCHEMA workhub;          -- 업무 표. API 에 노출하지 않는다
CREATE SCHEMA workhub_private;  -- 내부 판정·기록 함수. 어떤 역할에도 권한을 주지 않는다
REVOKE ALL ON SCHEMA workhub, workhub_private FROM PUBLIC;
COMMENT ON SCHEMA workhub IS '업무실 통합 설계 R0. 표는 RLS 를 켜고 직접 권한을 주지 않는다. 앱은 public.workhub_* 호환 함수만 부른다.';
COMMENT ON SCHEMA workhub_private IS '업무실 내부 함수. Data API 에 노출하지 않고 EXECUTE 를 주지 않는다.';

-- ----------------------------------------------------------------------------
-- 1. 공통 트리거 함수
-- ----------------------------------------------------------------------------
-- 기록형 표(감사·접수·판)는 INSERT 뒤 고치지 않는다.
CREATE FUNCTION workhub_private.forbid_change() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  RAISE EXCEPTION 'IMMUTABLE_ROW' USING DETAIL = format('%s.%s 는 기록 뒤 %s 할 수 없습니다.', TG_TABLE_SCHEMA, TG_TABLE_NAME, TG_OP);
END $$;

-- 생성 뒤 바뀌면 안 되는 식별 열(학교·계정·소유자 등). 인자로 열 이름을 받는다.
CREATE FUNCTION workhub_private.forbid_identity_change() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE col text; o jsonb := to_jsonb(OLD); n jsonb := to_jsonb(NEW);
BEGIN
  FOREACH col IN ARRAY TG_ARGV LOOP
    IF o -> col IS DISTINCT FROM n -> col THEN
      RAISE EXCEPTION 'IMMUTABLE_IDENTITY' USING DETAIL = format('%s.%s 의 %s 는 바꿀 수 없습니다.', TG_TABLE_SCHEMA, TG_TABLE_NAME, col);
    END IF;
  END LOOP;
  RETURN NEW;
END $$;

-- ----------------------------------------------------------------------------
-- 2. 학교
-- ----------------------------------------------------------------------------
CREATE TABLE workhub.schools (
  id                 text NOT NULL DEFAULT gen_random_uuid()::text,
  code               text NOT NULL,
  neis_code          text,
  name               text NOT NULL,
  school_level       text NOT NULL,
  grade_count        smallint NOT NULL,
  region_code        text,
  timezone           text NOT NULL DEFAULT 'Asia/Seoul',
  status             text NOT NULL DEFAULT 'preparing',
  support_state      text NOT NULL DEFAULT 'designed',
  directory_listed   boolean NOT NULL DEFAULT false,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  version            integer NOT NULL DEFAULT 1,
  permission_version bigint NOT NULL DEFAULT 1,
  CONSTRAINT schools_pkey PRIMARY KEY (id),
  CONSTRAINT schools_code_key UNIQUE (code),
  CONSTRAINT schools_neis_code_key UNIQUE (neis_code),
  CONSTRAINT schools_code_check CHECK (code ~ '^[A-Za-z0-9_-]{2,40}$'),
  CONSTRAINT schools_name_check CHECK (length(btrim(name)) BETWEEN 1 AND 100),
  CONSTRAINT schools_school_level_check CHECK (school_level IN ('elementary','middle','high','special','other')),
  CONSTRAINT schools_grade_count_check CHECK (grade_count BETWEEN 1 AND 6),
  CONSTRAINT schools_status_check CHECK (status IN ('preparing','active','suspended','closed')),
  CONSTRAINT schools_support_state_check CHECK (support_state IN ('designed','synthetic','pilot','field_verified')),
  CONSTRAINT schools_version_check CHECK (version > 0),
  CONSTRAINT schools_permission_version_check CHECK (permission_version > 0),
  -- 추가: 잘못된 시간대 이름은 '오늘' 계산을 깨뜨린다. pg_timezone_names 에 있는 이름만.
  CONSTRAINT schools_timezone_check CHECK (timezone ~ '^[A-Za-z_]+(/[A-Za-z0-9_+-]+)*$')
);
CREATE INDEX schools_directory ON workhub.schools (status, directory_listed, id);
CREATE TRIGGER schools_identity BEFORE UPDATE ON workhub.schools
  FOR EACH ROW EXECUTE FUNCTION workhub_private.forbid_identity_change('id','code');

-- ----------------------------------------------------------------------------
-- 3. 계정 — 기존 Auth UID 를 그대로 잇는 앱 계정. 새 로그인 계정을 만들지 않는다
-- ----------------------------------------------------------------------------
CREATE TABLE workhub.accounts (
  id                    text NOT NULL DEFAULT gen_random_uuid()::text,
  auth_user_id          uuid NOT NULL,
  legacy_user_id        text,
  legacy_link_method    text,
  legacy_linked_at      timestamptz,
  legacy_link_run_id    text,
  display_name          text NOT NULL,
  email                 text,
  status                text NOT NULL DEFAULT 'active',
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  version               integer NOT NULL DEFAULT 1,
  permission_version    bigint NOT NULL DEFAULT 1,
  legacy_approval_state text NOT NULL DEFAULT 'hold',
  CONSTRAINT accounts_pkey PRIMARY KEY (id),
  CONSTRAINT accounts_auth_user_id_key UNIQUE (auth_user_id),
  CONSTRAINT accounts_legacy_user_id_key UNIQUE (legacy_user_id),
  CONSTRAINT accounts_auth_user_id_fkey FOREIGN KEY (auth_user_id) REFERENCES auth.users(id) ON DELETE RESTRICT,
  CONSTRAINT accounts_check CHECK ((legacy_user_id IS NULL) = (legacy_link_method IS NULL)),
  CONSTRAINT accounts_check1 CHECK ((legacy_link_method IS NULL) = (legacy_linked_at IS NULL)),
  CONSTRAINT accounts_display_name_check CHECK (length(btrim(display_name)) BETWEEN 1 AND 50),
  CONSTRAINT accounts_legacy_link_method_check CHECK (legacy_link_method IN ('same_auth_user','admin_confirmed')),
  CONSTRAINT accounts_status_check CHECK (status IN ('active','suspended','closed')),
  CONSTRAINT accounts_version_check CHECK (version > 0),
  CONSTRAINT accounts_permission_version_check CHECK (permission_version > 0),
  CONSTRAINT accounts_legacy_approval_state_check CHECK (legacy_approval_state IN ('not_legacy','approved','hold')),
  -- 추가: 같은 Auth 주체 연결은 legacy ID 가 곧 Auth UID 다(기존 users.id = auth.users.id::text).
  CONSTRAINT accounts_same_auth_link CHECK (legacy_link_method IS DISTINCT FROM 'same_auth_user' OR legacy_user_id = auth_user_id::text),
  -- F5 보류: 이관 원장(migration_runs)은 교사 일괄 연결 배치에서 만든다.
  -- 그 배치가 이 CHECK 를 지우고 accounts_legacy_run_fk 를 붙인다. 그 전에는 값을 받지 않는다.
  CONSTRAINT accounts_legacy_run_pending CHECK (legacy_link_run_id IS NULL)
);
CREATE TRIGGER accounts_identity BEFORE UPDATE ON workhub.accounts
  FOR EACH ROW EXECUTE FUNCTION workhub_private.forbid_identity_change('id','auth_user_id','legacy_user_id','legacy_link_method','legacy_linked_at');

-- ----------------------------------------------------------------------------
-- 4. 서비스 주체 — 사람 아닌 실행(초기 설정·이관)을 기록할 실제 주체
--    DB 실행 역할 → 주체 연결은 서버 전용 허용 목록(db_identity_principals)으로만 한다.
-- ----------------------------------------------------------------------------
CREATE TABLE workhub.service_principals (
  id                     text NOT NULL,
  label                  text NOT NULL,
  allowed_actions        text[] NOT NULL,
  active                 boolean NOT NULL DEFAULT true,
  approval_ref           text NOT NULL,
  created_at             timestamptz NOT NULL DEFAULT now(),
  permission_version     bigint NOT NULL DEFAULT 1,
  approved_by_account_id text NOT NULL,
  approved_at            timestamptz NOT NULL,
  CONSTRAINT service_principals_pkey PRIMARY KEY (id),
  CONSTRAINT service_principals_id_check CHECK (id ~ '^svc_[a-z_]{2,40}$'),
  CONSTRAINT service_principals_allowed_actions_check CHECK (cardinality(allowed_actions) > 0),
  -- R0 의 서버 작업 목록. 새 작업 종류는 그 작업을 여는 배치가 이 CHECK 를 교체한다.
  CONSTRAINT service_principals_action_registry CHECK (allowed_actions <@ ARRAY['school.bootstrap']::text[]),
  CONSTRAINT service_principals_permission_version_check CHECK (permission_version > 0),
  CONSTRAINT service_principals_approval_ref_check CHECK (length(btrim(approval_ref)) BETWEEN 1 AND 200),
  CONSTRAINT service_principals_approved_by_fkey FOREIGN KEY (approved_by_account_id) REFERENCES workhub.accounts(id)
);
CREATE TRIGGER service_principals_identity BEFORE UPDATE ON workhub.service_principals
  FOR EACH ROW EXECUTE FUNCTION workhub_private.forbid_identity_change('id','approved_by_account_id','approved_at','approval_ref');

CREATE TABLE workhub.service_principal_scopes (
  id                     text NOT NULL DEFAULT gen_random_uuid()::text,
  service_principal_id   text NOT NULL,
  scope_type             text NOT NULL,
  school_id              text,
  scope_key              text NOT NULL GENERATED ALWAYS AS (
                           CASE scope_type WHEN 'school' THEN 's:' || school_id WHEN 'common' THEN 'c' ELSE 'svc' END) STORED,
  valid_from             timestamptz NOT NULL,
  valid_to               timestamptz,
  approved_by_account_id text NOT NULL,
  approval_ref           text NOT NULL,
  approved_at            timestamptz NOT NULL,
  revoked_at             timestamptz,
  version                integer NOT NULL DEFAULT 1,
  CONSTRAINT service_principal_scopes_pkey PRIMARY KEY (id),
  CONSTRAINT service_principal_scopes_scope_key_id_key UNIQUE (scope_key, id),
  CONSTRAINT service_principal_scopes_scope_type_check CHECK (scope_type IN ('school','common','service')),
  CONSTRAINT service_principal_scopes_school_check CHECK ((scope_type = 'school') = (school_id IS NOT NULL)),
  CONSTRAINT service_principal_scopes_period_check CHECK (valid_to IS NULL OR valid_from < valid_to),
  CONSTRAINT service_principal_scopes_version_check CHECK (version > 0),
  CONSTRAINT service_principal_scopes_principal_fkey FOREIGN KEY (service_principal_id) REFERENCES workhub.service_principals(id),
  CONSTRAINT service_principal_scopes_school_fkey FOREIGN KEY (school_id) REFERENCES workhub.schools(id),
  CONSTRAINT service_principal_scopes_approved_by_fkey FOREIGN KEY (approved_by_account_id) REFERENCES workhub.accounts(id),
  CONSTRAINT service_principal_scopes_no_overlap EXCLUDE USING gist (
    service_principal_id WITH =, scope_key WITH =, tstzrange(valid_from, valid_to, '[)') WITH &&) WHERE (revoked_at IS NULL)
);
CREATE INDEX service_principal_scopes_lookup ON workhub.service_principal_scopes (service_principal_id, scope_key, valid_from, valid_to) WHERE revoked_at IS NULL;
CREATE TRIGGER service_principal_scopes_identity BEFORE UPDATE ON workhub.service_principal_scopes
  FOR EACH ROW EXECUTE FUNCTION workhub_private.forbid_identity_change('id','service_principal_id','scope_type','school_id','valid_from','approved_by_account_id','approval_ref','approved_at');

-- 서버 전용 허용 목록: 실제 DB 접속 역할(session_user) → 서비스 주체.
-- 공개 함수 인자·클라이언트 설정값(GUC)·작업자 이름으로는 주체를 고를 수 없다.
CREATE TABLE workhub_private.db_identity_principals (
  db_role              name NOT NULL,
  service_principal_id text NOT NULL,
  approval_ref         text NOT NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT db_identity_principals_pkey PRIMARY KEY (db_role, service_principal_id),
  CONSTRAINT db_identity_principals_principal_fkey FOREIGN KEY (service_principal_id) REFERENCES workhub.service_principals(id),
  -- 브라우저 요청이 거치는 역할은 서비스 주체가 될 수 없다.
  CONSTRAINT db_identity_principals_not_api_role CHECK (db_role NOT IN ('anon','authenticated','authenticator','service_role'))
);

-- ----------------------------------------------------------------------------
-- 5. 부서·역할
-- ----------------------------------------------------------------------------
CREATE TABLE workhub.departments (
  id          text NOT NULL DEFAULT gen_random_uuid()::text,
  school_id   text NOT NULL,
  name        text NOT NULL,
  kind        text NOT NULL DEFAULT 'department',
  sort_order  smallint NOT NULL DEFAULT 0,
  active_from date NOT NULL,
  active_to   date,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  version     integer NOT NULL DEFAULT 1,
  CONSTRAINT departments_pkey PRIMARY KEY (id),
  CONSTRAINT departments_school_id_id_key UNIQUE (school_id, id),
  CONSTRAINT departments_school_id_fkey FOREIGN KEY (school_id) REFERENCES workhub.schools(id),
  CONSTRAINT departments_check CHECK (active_to IS NULL OR active_to > active_from),
  CONSTRAINT departments_kind_check CHECK (kind IN ('department','grade_office','administration','committee','other')),
  CONSTRAINT departments_name_check CHECK (length(btrim(name)) BETWEEN 1 AND 50),
  CONSTRAINT departments_version_check CHECK (version > 0)
);
CREATE UNIQUE INDEX departments_name_active ON workhub.departments (school_id, name) WHERE active_to IS NULL;
CREATE TRIGGER departments_identity BEFORE UPDATE ON workhub.departments
  FOR EACH ROW EXECUTE FUNCTION workhub_private.forbid_identity_change('id','school_id');

CREATE TABLE workhub.role_catalog (
  role_code      text NOT NULL,
  label          text NOT NULL,
  description    text NOT NULL,
  grantable_by   text NOT NULL,
  allowed_scopes text[] NOT NULL DEFAULT '{school}',
  CONSTRAINT role_catalog_pkey PRIMARY KEY (role_code),
  CONSTRAINT role_catalog_role_code_check CHECK (role_code ~ '^[a-z_]{3,40}$'),
  CONSTRAINT role_catalog_grantable_by_check CHECK (grantable_by IN ('school_admin','operator')),
  CONSTRAINT role_catalog_allowed_scopes_check CHECK (allowed_scopes <@ ARRAY['school','department','grade'] AND cardinality(allowed_scopes) > 0)
);
CREATE TABLE workhub.role_permissions (
  role_code  text NOT NULL,
  permission text NOT NULL,
  CONSTRAINT role_permissions_pkey PRIMARY KEY (role_code, permission),
  CONSTRAINT role_permissions_role_code_fkey FOREIGN KEY (role_code) REFERENCES workhub.role_catalog(role_code),
  CONSTRAINT role_permissions_permission_check CHECK (permission ~ '^[a-z_]+\.[a-z_]+$')
);
-- R0 에 필요한 두 역할만 넣는다. 나머지 역할은 해당 기능 배치에서 추가한다.
INSERT INTO workhub.role_catalog (role_code, label, description, grantable_by, allowed_scopes) VALUES
  ('school_admin',     '학교 관리자',   '소속 승인·역할 부여·학년도 관리', 'operator',     '{school}'),
  ('calendar_manager', '공유 일정 관리', '공개된 공유 일정 수정 (개인 일정 제외)', 'school_admin', '{school}');
INSERT INTO workhub.role_permissions (role_code, permission) VALUES
  ('school_admin', 'membership.approve'), ('school_admin', 'role.grant'), ('school_admin', 'year.manage'),
  ('calendar_manager', 'calendar.shared_manage');

-- ----------------------------------------------------------------------------
-- 6. 소속 — 학교별 기간. [valid_from, valid_to) 시작 포함·종료 제외
-- ----------------------------------------------------------------------------
CREATE TABLE workhub.memberships (
  id                       text NOT NULL DEFAULT gen_random_uuid()::text,
  school_id                text NOT NULL,
  account_id               text NOT NULL,
  status                   text NOT NULL DEFAULT 'pending',
  employment_type          text,
  valid_from               date,
  valid_to                 date,
  requested_at             timestamptz NOT NULL DEFAULT now(),
  request_note             text,
  join_code_id             text,
  decided_by_membership_id text,
  decided_at               timestamptz,
  decision_note            text,
  left_reason              text,
  permission_version       bigint NOT NULL DEFAULT 1,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  version                  integer NOT NULL DEFAULT 1,
  CONSTRAINT memberships_pkey PRIMARY KEY (id),
  CONSTRAINT memberships_school_id_id_key UNIQUE (school_id, id),
  CONSTRAINT memberships_school_id_id_account_id_key UNIQUE (school_id, id, account_id),
  CONSTRAINT memberships_school_id_fkey FOREIGN KEY (school_id) REFERENCES workhub.schools(id),
  CONSTRAINT memberships_account_id_fkey FOREIGN KEY (account_id) REFERENCES workhub.accounts(id),
  CONSTRAINT memberships_decider_fk FOREIGN KEY (school_id, decided_by_membership_id) REFERENCES workhub.memberships(school_id, id),
  CONSTRAINT memberships_check CHECK (status IN ('pending','rejected') OR valid_from IS NOT NULL),
  CONSTRAINT memberships_check1 CHECK (status <> 'left' OR valid_to IS NOT NULL),
  CONSTRAINT memberships_check2 CHECK (valid_to IS NULL OR valid_from IS NULL OR valid_to > valid_from),
  CONSTRAINT memberships_check3 CHECK ((status = 'pending') = (decided_at IS NULL)),
  CONSTRAINT memberships_check4 CHECK (status <> 'left' OR left_reason IS NOT NULL),
  CONSTRAINT memberships_employment_type_check CHECK (employment_type IN ('teacher','contract_teacher','lecturer','staff','other')),
  CONSTRAINT memberships_left_reason_check CHECK (left_reason IN ('transfer','retire','contract_end','removed','other')),
  CONSTRAINT memberships_request_note_check CHECK (length(request_note) <= 500),
  CONSTRAINT memberships_status_check CHECK (status IN ('pending','active','suspended','left','rejected')),
  CONSTRAINT memberships_version_check CHECK (version > 0),
  CONSTRAINT memberships_permission_version_check CHECK (permission_version > 0),
  CONSTRAINT memberships_no_overlap EXCLUDE USING gist (
    school_id WITH =, account_id WITH =, daterange(valid_from, valid_to, '[)') WITH &&)
    WHERE (status IN ('active','suspended','left')),
  -- F5 보류: 가입 코드(school_join_codes)는 신규 가입 배치에서 만든다. 그 전에는 값을 받지 않는다.
  CONSTRAINT memberships_join_code_pending CHECK (join_code_id IS NULL)
);
CREATE UNIQUE INDEX memberships_one_pending ON workhub.memberships (school_id, account_id) WHERE status = 'pending';
CREATE INDEX memberships_account ON workhub.memberships (account_id, status, school_id);
CREATE INDEX memberships_school_status ON workhub.memberships (school_id, status, valid_from, valid_to);
CREATE TRIGGER memberships_identity BEFORE UPDATE ON workhub.memberships
  FOR EACH ROW EXECUTE FUNCTION workhub_private.forbid_identity_change('id','school_id','account_id');

-- 같은 계정이 자기 소속을 승인하지 못한다(결정자 소속의 계정 ≠ 대상 계정).
CREATE FUNCTION workhub_private.membership_not_self_decided() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NEW.decided_by_membership_id IS NOT NULL AND EXISTS (
       SELECT 1 FROM workhub.memberships d
       WHERE d.school_id = NEW.school_id AND d.id = NEW.decided_by_membership_id AND d.account_id = NEW.account_id) THEN
    RAISE EXCEPTION 'SELF_DECISION' USING DETAIL = '자기 소속을 스스로 승인할 수 없습니다.';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER memberships_not_self_decided BEFORE INSERT OR UPDATE OF decided_by_membership_id, account_id ON workhub.memberships
  FOR EACH ROW EXECUTE FUNCTION workhub_private.membership_not_self_decided();

CREATE TABLE workhub.membership_roles (
  id                       text NOT NULL DEFAULT gen_random_uuid()::text,
  school_id                text NOT NULL,
  membership_id            text NOT NULL,
  role_code                text NOT NULL,
  scope_type               text NOT NULL DEFAULT 'school',
  scope_department_id      text,
  scope_grade              smallint,
  valid_from               date NOT NULL,
  valid_to                 date,
  granted_by_membership_id text,
  granted_at               timestamptz NOT NULL DEFAULT now(),
  revoked_at               timestamptz,
  revoke_reason            text,
  CONSTRAINT membership_roles_pkey PRIMARY KEY (id),
  CONSTRAINT membership_roles_school_id_id_key UNIQUE (school_id, id),
  CONSTRAINT membership_roles_school_id_membership_id_fkey FOREIGN KEY (school_id, membership_id) REFERENCES workhub.memberships(school_id, id),
  CONSTRAINT membership_roles_school_id_granted_by_membership_id_fkey FOREIGN KEY (school_id, granted_by_membership_id) REFERENCES workhub.memberships(school_id, id),
  CONSTRAINT membership_roles_role_code_fkey FOREIGN KEY (role_code) REFERENCES workhub.role_catalog(role_code),
  CONSTRAINT membership_roles_department_fk FOREIGN KEY (school_id, scope_department_id) REFERENCES workhub.departments(school_id, id),
  CONSTRAINT membership_roles_check CHECK (valid_to IS NULL OR valid_to > valid_from),
  CONSTRAINT membership_roles_check1 CHECK (CASE scope_type
    WHEN 'school' THEN scope_department_id IS NULL AND scope_grade IS NULL
    WHEN 'department' THEN scope_department_id IS NOT NULL AND scope_grade IS NULL
    WHEN 'grade' THEN scope_grade IS NOT NULL AND scope_department_id IS NULL END),
  CONSTRAINT membership_roles_check2 CHECK (granted_by_membership_id IS DISTINCT FROM membership_id),
  CONSTRAINT membership_roles_scope_grade_check CHECK (scope_grade BETWEEN 1 AND 6),
  CONSTRAINT membership_roles_scope_type_check CHECK (scope_type IN ('school','department','grade')),
  CONSTRAINT membership_roles_revoke_check CHECK ((revoked_at IS NULL) = (revoke_reason IS NULL)),
  CONSTRAINT membership_roles_no_overlap EXCLUDE USING gist (
    membership_id WITH =, role_code WITH =, scope_type WITH =, COALESCE(scope_department_id, '') WITH =,
    COALESCE(scope_grade::integer, 0) WITH =, daterange(valid_from, valid_to, '[)') WITH &&) WHERE (revoked_at IS NULL)
);
CREATE INDEX membership_roles_lookup ON workhub.membership_roles (school_id, membership_id, valid_from, valid_to) WHERE revoked_at IS NULL;
CREATE TRIGGER membership_roles_identity BEFORE UPDATE ON workhub.membership_roles
  FOR EACH ROW EXECUTE FUNCTION workhub_private.forbid_identity_change('id','school_id','membership_id','role_code','scope_type','scope_department_id','scope_grade','valid_from','granted_by_membership_id','granted_at');

-- 역할 기간은 소속 기간 안이어야 하고, 역할이 허용하는 범위만 쓴다.
CREATE FUNCTION workhub_private.membership_role_within() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE m workhub.memberships; scopes text[];
BEGIN
  SELECT * INTO m FROM workhub.memberships WHERE school_id = NEW.school_id AND id = NEW.membership_id;
  IF m.valid_from IS NULL OR NEW.valid_from < m.valid_from
     OR (m.valid_to IS NOT NULL AND (NEW.valid_to IS NULL OR NEW.valid_to > m.valid_to)) THEN
    RAISE EXCEPTION 'ROLE_OUTSIDE_MEMBERSHIP' USING DETAIL = '역할 기간은 소속 기간 안이어야 합니다.';
  END IF;
  SELECT allowed_scopes INTO scopes FROM workhub.role_catalog WHERE role_code = NEW.role_code;
  IF NOT (NEW.scope_type = ANY (scopes)) THEN
    RAISE EXCEPTION 'ROLE_SCOPE_NOT_ALLOWED' USING DETAIL = '이 역할은 해당 범위로 줄 수 없습니다.';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER membership_roles_within BEFORE INSERT OR UPDATE ON workhub.membership_roles
  FOR EACH ROW EXECUTE FUNCTION workhub_private.membership_role_within();

-- ----------------------------------------------------------------------------
-- 7. 학년도·학기 (F5: 일정·업무보다 먼저 만든다)
-- ----------------------------------------------------------------------------
CREATE TABLE workhub.academic_years (
  id          text NOT NULL DEFAULT gen_random_uuid()::text,
  school_id   text NOT NULL,
  school_year smallint NOT NULL,
  starts_on   date NOT NULL,
  ends_on     date NOT NULL,
  state       text NOT NULL DEFAULT 'planning',
  closed_at   timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  version     integer NOT NULL DEFAULT 1,
  CONSTRAINT academic_years_pkey PRIMARY KEY (id),
  CONSTRAINT academic_years_school_id_id_key UNIQUE (school_id, id),
  CONSTRAINT academic_years_school_id_school_year_key UNIQUE (school_id, school_year),
  CONSTRAINT academic_years_school_id_fkey FOREIGN KEY (school_id) REFERENCES workhub.schools(id),
  CONSTRAINT academic_years_check CHECK (ends_on > starts_on),
  CONSTRAINT academic_years_school_year_check CHECK (school_year BETWEEN 2020 AND 2100),
  CONSTRAINT academic_years_state_check CHECK (state IN ('planning','current','closed')),
  CONSTRAINT academic_years_version_check CHECK (version > 0),
  CONSTRAINT academic_years_no_overlap EXCLUDE USING gist (school_id WITH =, daterange(starts_on, ends_on, '[)') WITH &&)
);
CREATE UNIQUE INDEX academic_years_one_current ON workhub.academic_years (school_id) WHERE state = 'current';
CREATE TRIGGER academic_years_identity BEFORE UPDATE ON workhub.academic_years
  FOR EACH ROW EXECUTE FUNCTION workhub_private.forbid_identity_change('id','school_id','school_year');

CREATE TABLE workhub.terms (
  id                         text NOT NULL DEFAULT gen_random_uuid()::text,
  school_id                  text NOT NULL,
  academic_year_id           text NOT NULL,
  term_no                    smallint NOT NULL,
  label                      text NOT NULL,
  starts_on                  date NOT NULL,
  ends_on                    date NOT NULL,
  state                      text NOT NULL DEFAULT 'planning',
  created_at                 timestamptz NOT NULL DEFAULT now(),
  updated_at                 timestamptz NOT NULL DEFAULT now(),
  version                    integer NOT NULL DEFAULT 1,
  current_timetable_basis_id text,
  CONSTRAINT terms_pkey PRIMARY KEY (id),
  CONSTRAINT terms_school_id_id_key UNIQUE (school_id, id),
  CONSTRAINT terms_academic_year_id_term_no_key UNIQUE (academic_year_id, term_no),
  CONSTRAINT terms_school_id_academic_year_id_fkey FOREIGN KEY (school_id, academic_year_id) REFERENCES workhub.academic_years(school_id, id),
  CONSTRAINT terms_check CHECK (ends_on > starts_on),
  CONSTRAINT terms_state_check CHECK (state IN ('planning','current','closed')),
  CONSTRAINT terms_term_no_check CHECK (term_no BETWEEN 1 AND 4),
  CONSTRAINT terms_label_check CHECK (length(btrim(label)) BETWEEN 1 AND 30),
  CONSTRAINT terms_version_check CHECK (version > 0),
  CONSTRAINT terms_no_overlap EXCLUDE USING gist (school_id WITH =, daterange(starts_on, ends_on, '[)') WITH &&),
  -- F5 보류: 시간표 기준판(timetable_basis_revisions)은 시간표 재개 배치에서 만든다.
  -- 그 배치가 이 CHECK 를 지우고 terms→timetable_basis_revisions 복합 FK 를 붙인다.
  CONSTRAINT terms_timetable_basis_pending CHECK (current_timetable_basis_id IS NULL)
);
CREATE UNIQUE INDEX terms_one_current ON workhub.terms (school_id) WHERE state = 'current';
CREATE TRIGGER terms_identity BEFORE UPDATE ON workhub.terms
  FOR EACH ROW EXECUTE FUNCTION workhub_private.forbid_identity_change('id','school_id','academic_year_id','term_no');

-- 학기는 학년도 기간 안에 있어야 한다.
CREATE FUNCTION workhub_private.term_within_year() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM workhub.academic_years y
                 WHERE y.school_id = NEW.school_id AND y.id = NEW.academic_year_id
                   AND NEW.starts_on >= y.starts_on AND NEW.ends_on <= y.ends_on) THEN
    RAISE EXCEPTION 'TERM_OUTSIDE_YEAR' USING DETAIL = '학기는 학년도 기간 안이어야 합니다.';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER terms_within_year BEFORE INSERT OR UPDATE ON workhub.terms
  FOR EACH ROW EXECUTE FUNCTION workhub_private.term_within_year();

-- ----------------------------------------------------------------------------
-- 8. 접수증(멱등)·감사·outbox (F5: B03 에서 B01 로 당김)
-- ----------------------------------------------------------------------------
CREATE TABLE workhub.idempotency_receipts (
  actor_account_id           text,
  scope_key                  text NOT NULL,
  operation                  text NOT NULL,
  idem_key                   text NOT NULL,
  request_sha256             text NOT NULL,
  resource_type              text,
  resource_id                text,
  resource_version           integer,
  result                     jsonb NOT NULL,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  expires_at                 timestamptz,
  actor_service_principal_id text,
  actor_key                  text NOT NULL GENERATED ALWAYS AS (
                               CASE WHEN actor_account_id IS NOT NULL THEN 'a:' || actor_account_id
                                    ELSE 's:' || actor_service_principal_id END) STORED,
  -- F6: 옛 PK(actor_account_id,…)·actor NOT NULL 을 아래 PK 와 XOR CHECK 로 대체
  CONSTRAINT idempotency_receipts_pkey PRIMARY KEY (actor_key, scope_key, operation, idem_key),
  CONSTRAINT idempotency_receipts_actor_xor CHECK (num_nonnulls(actor_account_id, actor_service_principal_id) = 1),
  CONSTRAINT idempotency_receipts_actor_account_id_fkey FOREIGN KEY (actor_account_id) REFERENCES workhub.accounts(id),
  CONSTRAINT idempotency_receipts_actor_service_principal_fkey FOREIGN KEY (actor_service_principal_id) REFERENCES workhub.service_principals(id),
  CONSTRAINT idempotency_receipts_idem_key_check CHECK (length(idem_key) BETWEEN 8 AND 200),
  CONSTRAINT idempotency_receipts_request_sha256_check CHECK (request_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT idempotency_receipts_scope_key_check CHECK (scope_key ~ '^(s:.+|a:.+|c|svc)$'),
  CONSTRAINT idempotency_receipts_operation_check CHECK (operation ~ '^[a-z_]+\.[a-z_]+$')
);
-- result 에는 ID·판·시각만 둔다(본문·명단·서명 URL 금지). CHECK 는 하위 질의를 못 쓰므로 트리거로 키를 고정한다.
CREATE FUNCTION workhub_private.receipt_result_shape() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF jsonb_typeof(NEW.result) <> 'object'
     OR EXISTS (SELECT 1 FROM jsonb_object_keys(NEW.result) k WHERE k NOT IN ('resource_type','resource_id','resource_version','recorded_at')) THEN
    RAISE EXCEPTION 'RECEIPT_RESULT_SHAPE' USING DETAIL = '접수증 결과에는 ID·판·시각만 둡니다.';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER idempotency_receipts_result_shape BEFORE INSERT ON workhub.idempotency_receipts
  FOR EACH ROW EXECUTE FUNCTION workhub_private.receipt_result_shape();
CREATE TRIGGER idempotency_receipts_immutable BEFORE UPDATE ON workhub.idempotency_receipts
  FOR EACH ROW EXECUTE FUNCTION workhub_private.forbid_change();
CREATE INDEX idempotency_expiry ON workhub.idempotency_receipts (expires_at) WHERE expires_at IS NOT NULL;

CREATE TABLE workhub.audit_events (
  id                         bigint GENERATED ALWAYS AS IDENTITY,
  school_id                  text,
  actor_account_id           text,
  actor_membership_id        text,
  actor_service_principal_id text,
  support_session_id         text,
  operation                  text NOT NULL,
  resource_type              text NOT NULL,
  resource_id                text,
  resource_version           integer,
  sensitivity                text NOT NULL,
  correlation_id             text,
  idem_key                   text,
  details                    jsonb NOT NULL DEFAULT '{}',
  occurred_at                timestamptz NOT NULL DEFAULT now(),
  scope_key                  text NOT NULL,
  job_id                     text,
  worker_id                  text,
  CONSTRAINT audit_events_pkey PRIMARY KEY (id),
  CONSTRAINT audit_events_school_id_fkey FOREIGN KEY (school_id) REFERENCES workhub.schools(id),
  CONSTRAINT audit_events_actor_account_id_fkey FOREIGN KEY (actor_account_id) REFERENCES workhub.accounts(id),
  CONSTRAINT audit_events_actor_service_principal_id_fkey FOREIGN KEY (actor_service_principal_id) REFERENCES workhub.service_principals(id),
  -- 소속 행위자는 같은 학교·같은 계정이어야 한다(옛 2열 FK 를 3열로 강화)
  CONSTRAINT audit_events_actor_membership_fkey FOREIGN KEY (school_id, actor_membership_id, actor_account_id)
    REFERENCES workhub.memberships(school_id, id, account_id),
  -- F6: 옛 audit_events_check(<=1)를 정확히 하나(XOR)로 대체
  CONSTRAINT audit_events_actor_xor CHECK (num_nonnulls(actor_account_id, actor_service_principal_id) = 1),
  CONSTRAINT audit_events_check1 CHECK (school_id IS NOT NULL OR actor_membership_id IS NULL),
  CONSTRAINT audit_events_membership_needs_account CHECK (actor_membership_id IS NULL OR actor_account_id IS NOT NULL),
  CONSTRAINT audit_events_check2 CHECK (sensitivity <> 'school' OR resource_type <> ALL (ARRAY['observation','counselling_record','record_draft','record_sentence','evidence_link','conversation','message','memory','ai_run','tool_proposal','tool_run'])),
  CONSTRAINT audit_events_sensitivity_check CHECK (sensitivity IN ('school','owner_only','operator_only')),
  CONSTRAINT audit_events_scope_key_check CHECK (
    (school_id IS NOT NULL AND scope_key = 's:' || school_id) OR (school_id IS NULL AND scope_key ~ '^(a:.+|c|svc)$')),
  CONSTRAINT audit_events_operation_check CHECK (operation ~ '^[a-z_]+\.[a-z_]+$'),
  CONSTRAINT audit_events_details_check CHECK (jsonb_typeof(details) = 'object' AND octet_length(details::text) <= 4096),
  -- F5 보류: 지원 세션(support_sessions)·작업(jobs)은 B03 이후 배치에서 만든다. 그 전에는 값을 받지 않는다.
  -- 상속 제약 유지(지원 세션 표가 생기면 그대로 쓰인다)
  CONSTRAINT audit_events_support_actor CHECK (support_session_id IS NULL OR (actor_account_id IS NOT NULL AND actor_membership_id IS NULL AND actor_service_principal_id IS NULL)),
  CONSTRAINT audit_events_support_school CHECK (school_id IS NOT NULL OR support_session_id IS NULL),
  CONSTRAINT audit_events_support_pending CHECK (support_session_id IS NULL),
  CONSTRAINT audit_events_job_pending CHECK (job_id IS NULL AND worker_id IS NULL)
);
CREATE INDEX audit_resource ON workhub.audit_events (resource_type, resource_id);
CREATE INDEX audit_school_time ON workhub.audit_events (school_id, occurred_at DESC);
CREATE INDEX audit_scope_time ON workhub.audit_events (scope_key, occurred_at, id);
CREATE TRIGGER audit_events_immutable BEFORE UPDATE OR DELETE ON workhub.audit_events
  FOR EACH ROW EXECUTE FUNCTION workhub_private.forbid_change();

CREATE TABLE workhub.outbox (
  id                bigint GENERATED ALWAYS AS IDENTITY,
  school_id         text,
  topic             text NOT NULL,
  aggregate_type    text NOT NULL,
  aggregate_id      text NOT NULL,
  aggregate_version integer,
  payload           jsonb NOT NULL DEFAULT '{}',
  dedupe_key        text NOT NULL,
  correlation_id    text,
  state             text NOT NULL DEFAULT 'pending',
  attempts          integer NOT NULL DEFAULT 0,
  max_attempts      integer NOT NULL DEFAULT 3,
  next_attempt_at   timestamptz NOT NULL DEFAULT now(),
  lease_owner       text,
  lease_expires_at  timestamptz,
  last_error_code   text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  processed_at      timestamptz,
  scope_key         text NOT NULL,
  lease_token       bigint NOT NULL DEFAULT 0,
  CONSTRAINT outbox_pkey PRIMARY KEY (id),
  CONSTRAINT outbox_dedupe_key_key UNIQUE (dedupe_key),
  CONSTRAINT outbox_school_id_fkey FOREIGN KEY (school_id) REFERENCES workhub.schools(id),
  CONSTRAINT outbox_check CHECK ((state = 'processing') = (lease_expires_at IS NOT NULL)),
  CONSTRAINT outbox_check1 CHECK (state <> 'dead' OR attempts >= max_attempts OR last_error_code IS NOT NULL),
  CONSTRAINT outbox_max_attempts_check CHECK (max_attempts BETWEEN 1 AND 10),
  CONSTRAINT outbox_state_check CHECK (state IN ('pending','processing','done','failed','dead')),
  CONSTRAINT outbox_lease_token_check CHECK (lease_token >= 0),
  CONSTRAINT outbox_scope_key_check CHECK (
    (school_id IS NOT NULL AND scope_key = 's:' || school_id) OR (school_id IS NULL AND scope_key ~ '^(a:.+|c|svc)$')),
  -- payload 는 ID·판·종류만. 본문·명단을 담지 않는다.
  CONSTRAINT outbox_payload_check CHECK (jsonb_typeof(payload) = 'object' AND octet_length(payload::text) <= 1024)
);
CREATE INDEX outbox_pending ON workhub.outbox (state, next_attempt_at, id) WHERE state IN ('pending','failed');
CREATE INDEX outbox_processing ON workhub.outbox (lease_expires_at) WHERE state = 'processing';
CREATE TRIGGER outbox_identity BEFORE UPDATE ON workhub.outbox
  FOR EACH ROW EXECUTE FUNCTION workhub_private.forbid_identity_change('id','school_id','topic','aggregate_type','aggregate_id','aggregate_version','payload','dedupe_key','scope_key','created_at');

-- ----------------------------------------------------------------------------
-- 9. 주체 해석·감사·outbox 기록 (공통 write_audit(context))
--    context 는 아래 두 해석기만 만든다. 호출자가 actor ID 를 넘길 수 없다.
-- ----------------------------------------------------------------------------
CREATE TYPE workhub_private.actor_context AS (
  actor_kind           text,     -- 'member' | 'service'
  account_id           text,
  membership_id        text,
  service_principal_id text,
  school_id            text,
  scope_key            text,
  auth_user_id         uuid,
  school_today         date,
  school_timezone      text
);

-- 학교 시간대 기준 오늘
CREATE FUNCTION workhub_private.today_in(p_timezone text) RETURNS date
LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT (statement_timestamp() AT TIME ZONE p_timezone)::date
$$;

-- 서비스 주체 해석: 사람 JWT 가 없는 서버 실행에서만. session_user 를 허용 목록으로 주체에 잇고,
-- 주체 활성 + 작업 허용 + 해당 scope 의 현재 승인(미회수·기간 안)을 모두 확인한다.
CREATE FUNCTION workhub_private.resolve_service_actor(p_action text, p_scope_key text) RETURNS workhub_private.actor_context
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE ctx workhub_private.actor_context; v_principal text;
BEGIN
  IF auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'FORBIDDEN' USING DETAIL = '로그인한 사용자 요청은 서비스 주체로 실행할 수 없습니다.';
  END IF;
  SELECT p.id INTO v_principal
    FROM workhub_private.db_identity_principals i
    JOIN workhub.service_principals p ON p.id = i.service_principal_id
   WHERE i.db_role = session_user AND p.active AND p_action = ANY (p.allowed_actions)
   ORDER BY p.id
   FOR SHARE OF p;
  IF v_principal IS NULL THEN
    RAISE EXCEPTION 'FORBIDDEN' USING DETAIL = format('실행 역할 %s 에 허용된 서비스 주체가 없습니다(%s).', session_user, p_action);
  END IF;
  PERFORM 1 FROM workhub.service_principal_scopes s
   WHERE s.service_principal_id = v_principal AND s.scope_key = p_scope_key AND s.revoked_at IS NULL
     AND s.valid_from <= clock_timestamp() AND (s.valid_to IS NULL OR clock_timestamp() < s.valid_to)
   FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'FORBIDDEN' USING DETAIL = format('서비스 주체 %s 에 %s 범위 승인이 없습니다.', v_principal, p_scope_key);
  END IF;
  ctx.actor_kind := 'service';
  ctx.service_principal_id := v_principal;
  ctx.scope_key := p_scope_key;
  IF p_scope_key LIKE 's:%' THEN ctx.school_id := substr(p_scope_key, 3); END IF;
  RETURN ctx;
END $$;

-- 기존 승인 gate (F8): 로그인 + public.users 승인(is_approved) + superadmin.
-- 기존 함수(is_approved·get_my_role)를 그대로 부르고, 쓰기 경로에서는 회원 행을 FOR SHARE 로 잡아
-- 동시에 일어나는 승인 해제·역할 변경과 직렬화한다. 회원 행을 바꾸지 않는다.
CREATE FUNCTION workhub_private.legacy_gate(p_lock boolean) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'FORBIDDEN' USING DETAIL = '로그인이 필요합니다.'; END IF;
  IF p_lock THEN PERFORM 1 FROM public.users WHERE id = v_uid::text FOR SHARE; END IF;
  IF NOT (public.is_approved() AND public.get_my_role() IS NOT DISTINCT FROM 'superadmin') THEN
    RAISE EXCEPTION 'FORBIDDEN' USING DETAIL = '승인된 공개 대상만 업무실을 쓸 수 있습니다.';
  END IF;
  RETURN v_uid;
END $$;

-- 로그인 주체의 앱 계정. 없으면 NULL(아직 연결 전). 있는데 정지·보류면 거부.
CREATE FUNCTION workhub_private.caller_account(p_uid uuid, p_lock boolean) RETURNS workhub.accounts
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE a workhub.accounts;
BEGIN
  IF p_lock THEN
    SELECT * INTO a FROM workhub.accounts WHERE auth_user_id = p_uid FOR SHARE;
  ELSE
    SELECT * INTO a FROM workhub.accounts WHERE auth_user_id = p_uid;
  END IF;
  IF NOT FOUND THEN RETURN NULL; END IF;
  -- 병행 단계: 신축 표식(approved)과 현재 legacy 승인(legacy_gate)을 함께 본다.
  IF a.status <> 'active' OR a.legacy_approval_state <> 'approved' THEN
    RAISE EXCEPTION 'FORBIDDEN' USING DETAIL = '계정이 정지되었거나 연결 확인 중입니다.';
  END IF;
  RETURN a;
END $$;

-- 업무 요청의 사람 주체 해석: p_member_id 는 요청 맥락일 뿐, 실제 주체는 JWT 다.
-- 계정·학교·소속의 현재 상태와 기간을 모두 확인한다. 잠금 순서: users → accounts → schools → memberships.
CREATE FUNCTION workhub_private.member_actor(p_member_id text, p_lock boolean) RETURNS workhub_private.actor_context
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_uid uuid; a workhub.accounts; s workhub.schools; m workhub.memberships; ctx workhub_private.actor_context;
BEGIN
  v_uid := workhub_private.legacy_gate(p_lock);
  a := workhub_private.caller_account(v_uid, p_lock);
  IF a.id IS NULL OR p_member_id IS NULL THEN
    RAISE EXCEPTION 'INACTIVE_MEMBERSHIP' USING DETAIL = '현재 이용 가능한 학교 소속이 아닙니다.';
  END IF;
  SELECT * INTO m FROM workhub.memberships WHERE id = p_member_id AND account_id = a.id;
  IF FOUND THEN
    IF p_lock THEN
      SELECT * INTO s FROM workhub.schools WHERE id = m.school_id FOR SHARE;
      SELECT * INTO m FROM workhub.memberships WHERE id = p_member_id AND account_id = a.id FOR SHARE;
    ELSE
      SELECT * INTO s FROM workhub.schools WHERE id = m.school_id;
    END IF;
  END IF;
  IF m.id IS NULL OR s.id IS NULL OR s.status <> 'active' OR m.status <> 'active'
     OR NOT (workhub_private.today_in(s.timezone) <@ daterange(m.valid_from, m.valid_to, '[)')) THEN
    RAISE EXCEPTION 'INACTIVE_MEMBERSHIP' USING DETAIL = '현재 이용 가능한 학교 소속이 아닙니다.';
  END IF;
  ctx.actor_kind := 'member';
  ctx.account_id := a.id;
  ctx.membership_id := m.id;
  ctx.school_id := s.id;
  ctx.scope_key := 's:' || s.id;
  ctx.auth_user_id := v_uid;
  ctx.school_today := workhub_private.today_in(s.timezone);
  ctx.school_timezone := s.timezone;
  RETURN ctx;
END $$;

-- 소속의 현재 권한(역할 기간·미회수 포함). 학년·부서 범위 역할은 학교 전체 권한으로 보지 않는다.
CREATE FUNCTION workhub_private.member_has_perm(p_ctx workhub_private.actor_context, p_permission text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT p_ctx.actor_kind = 'member' AND EXISTS (
    SELECT 1 FROM workhub.membership_roles r
    JOIN workhub.role_permissions rp ON rp.role_code = r.role_code
    WHERE r.school_id = p_ctx.school_id AND r.membership_id = p_ctx.membership_id
      AND r.revoked_at IS NULL AND r.scope_type = 'school' AND rp.permission = p_permission
      AND p_ctx.school_today <@ daterange(r.valid_from, r.valid_to, '[)'))
$$;

-- 공통 감사 기록. 실패하면 호출한 명령 전체가 롤백된다(예외를 삼키지 않는다).
CREATE FUNCTION workhub_private.write_audit(
  p_ctx workhub_private.actor_context, p_operation text, p_resource_type text, p_resource_id text,
  p_resource_version integer, p_sensitivity text, p_idem_key text, p_details jsonb) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_id bigint;
BEGIN
  IF p_ctx.actor_kind IS NULL OR p_ctx.scope_key IS NULL
     OR (p_ctx.actor_kind = 'member' AND (p_ctx.account_id IS NULL OR p_ctx.membership_id IS NULL OR p_ctx.service_principal_id IS NOT NULL))
     OR (p_ctx.actor_kind = 'service' AND (p_ctx.service_principal_id IS NULL OR p_ctx.account_id IS NOT NULL))
     OR p_ctx.actor_kind NOT IN ('member','service') THEN
    RAISE EXCEPTION 'AUDIT_CONTEXT_INVALID';
  END IF;
  INSERT INTO workhub.audit_events (school_id, actor_account_id, actor_membership_id, actor_service_principal_id,
      operation, resource_type, resource_id, resource_version, sensitivity, idem_key, details, scope_key)
  VALUES (p_ctx.school_id, p_ctx.account_id, p_ctx.membership_id, p_ctx.service_principal_id,
      p_operation, p_resource_type, p_resource_id, p_resource_version, p_sensitivity, p_idem_key,
      COALESCE(p_details, '{}'::jsonb), p_ctx.scope_key)
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

-- 같은 트랜잭션의 outbox 기록. 같은 사건 키는 한 번만 남는다.
CREATE FUNCTION workhub_private.emit_outbox(
  p_ctx workhub_private.actor_context, p_topic text, p_aggregate_type text, p_aggregate_id text,
  p_aggregate_version integer, p_payload jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  INSERT INTO workhub.outbox (school_id, scope_key, topic, aggregate_type, aggregate_id, aggregate_version, payload, dedupe_key)
  VALUES (p_ctx.school_id, p_ctx.scope_key, p_topic, p_aggregate_type, p_aggregate_id, p_aggregate_version,
          COALESCE(p_payload, '{}'::jsonb),
          p_topic || ':' || p_aggregate_type || ':' || p_aggregate_id || ':' || COALESCE(p_aggregate_version::text, '-'));
END $$;

-- ----------------------------------------------------------------------------
-- 10. 첫 학교 초기 설정 — R0-03 이 값을 채워 한 번 부른다. 앱·API 에서는 부를 수 없다.
--     기존 superadmin 을 Auth UID 로 연결하고, 초기 설정 서비스 주체로 모든 단계를 감사한다.
--     끝나면 주체의 범위 승인을 회수해 같은 권한으로 다시 실행하지 못하게 한다.
-- ----------------------------------------------------------------------------
CREATE FUNCTION workhub_private.bootstrap_first_school(p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_admin_uid text; v_approval text; v_code text; v_name text; v_level text; v_grades smallint; v_tz text;
  v_year smallint; v_year_from date; v_year_to date; v_member_from date; v_roles text[]; v_role text;
  v_user record; v_now timestamptz := clock_timestamp(); v_today date;
  a workhub.accounts; s workhub.schools; y workhub.academic_years; t workhub.terms; m workhub.memberships;
  r workhub.membership_roles; g_svc workhub.service_principal_scopes; g_school workhub.service_principal_scopes;
  ctx_svc workhub_private.actor_context; ctx_school workhub_private.actor_context;
  term jsonb; v_term_ids jsonb := '[]'::jsonb; v_role_ids jsonb := '[]'::jsonb;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('workhub.bootstrap_first_school', 0));
  IF auth.uid() IS NOT NULL THEN RAISE EXCEPTION 'BOOTSTRAP: 로그인 세션이 아닌 SQL Editor 에서 실행해 주세요.'; END IF;
  IF session_user NOT IN ('postgres', 'supabase_admin') THEN
    RAISE EXCEPTION 'BOOTSTRAP: DB 관리자 역할(postgres)에서만 실행합니다. 현재 %', session_user;
  END IF;

  -- 입력 확인: 자리표시자·빈 값·형식 오류가 하나라도 있으면 아무것도 쓰지 않는다.
  IF p IS NULL OR jsonb_typeof(p) <> 'object' OR p::text LIKE '%<%' THEN
    RAISE EXCEPTION 'BOOTSTRAP: 입력 칸(<...>)을 모두 채워 주세요.';
  END IF;
  v_admin_uid := p->>'admin_user_id';
  v_approval  := btrim(p->>'approval_ref');
  v_code      := p->>'school_code';
  v_name      := btrim(p->>'school_name');
  v_level     := p->>'school_level';
  v_tz        := COALESCE(p->>'timezone', 'Asia/Seoul');
  BEGIN
    v_grades    := (p->>'grade_count')::smallint;
    v_year      := (p->>'school_year')::smallint;
    v_year_from := (p->>'year_first_day')::date;
    v_year_to   := (p->>'year_last_day')::date + 1;   -- 마지막 날(포함) → 종료 제외
    v_member_from := COALESCE((p->>'admin_valid_from')::date, v_year_from);
  EXCEPTION WHEN others THEN
    RAISE EXCEPTION 'BOOTSTRAP: 학년·날짜 입력 형식을 확인해 주세요 (YYYY-MM-DD).';
  END;
  IF v_admin_uid IS NULL OR v_approval IS NULL OR v_approval = '' OR v_code IS NULL OR v_name IS NULL OR v_level IS NULL
     OR v_grades IS NULL OR v_year IS NULL OR v_year_from IS NULL OR v_year_to IS NULL
     OR jsonb_typeof(p->'terms') IS DISTINCT FROM 'array' OR jsonb_array_length(p->'terms') NOT BETWEEN 1 AND 4 THEN
    RAISE EXCEPTION 'BOOTSTRAP: 필수 입력이 비어 있습니다.';
  END IF;
  IF v_year_to <= v_year_from OR v_member_from < v_year_from OR v_member_from >= v_year_to THEN
    RAISE EXCEPTION 'BOOTSTRAP: 학년도 마지막 날이 첫날보다 앞이거나, 관리자 시작일이 학년도 밖입니다.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_timezone_names WHERE name = v_tz) THEN
    RAISE EXCEPTION 'BOOTSTRAP: 알 수 없는 시간대 %', v_tz;
  END IF;
  IF jsonb_typeof(p->'admin_roles') = 'array' THEN
    SELECT array_agg(x ORDER BY x) INTO v_roles FROM jsonb_array_elements_text(p->'admin_roles') x;
  ELSE
    v_roles := ARRAY['calendar_manager','school_admin'];
  END IF;
  v_today := workhub_private.today_in(v_tz);
  IF v_today < v_year_from OR v_today >= v_year_to OR v_member_from > v_today THEN
    RAISE EXCEPTION 'BOOTSTRAP: 오늘(%)이 학년도 기간 안이어야 하고, 관리자 시작일은 오늘 이전이어야 합니다.', v_today;
  END IF;

  -- 첫 학교 전용. 이미 학교나 계정이 있으면 덮어쓰지 않고 멈춘다.
  IF EXISTS (SELECT 1 FROM workhub.schools) OR EXISTS (SELECT 1 FROM workhub.accounts)
     OR EXISTS (SELECT 1 FROM workhub.service_principals) THEN
    RAISE EXCEPTION 'BOOTSTRAP: 이미 초기 설정이 되어 있습니다. 다시 실행하지 않습니다.';
  END IF;

  -- 기존 회원 확인: Auth UID 와 public.users 가 같은 사람이고, 승인된 superadmin 이어야 한다.
  -- 회원 행을 바꾸지 않는다(FOR SHARE 로 읽기만).
  SELECT u.id, u.name, u.email, u.role, u.is_active INTO v_user
    FROM public.users u JOIN auth.users au ON au.id::text = u.id
   WHERE u.id = v_admin_uid
   FOR SHARE OF u;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'BOOTSTRAP: 기존 회원(public.users + auth.users)에서 % 를 찾지 못했습니다. 회원을 새로 만들지 않습니다.', v_admin_uid;
  END IF;
  IF v_user.role IS DISTINCT FROM 'superadmin' OR v_user.is_active IS NOT TRUE THEN
    RAISE EXCEPTION 'BOOTSTRAP: 첫 관리자는 승인된 superadmin 이어야 합니다.';
  END IF;
  IF length(btrim(v_user.name)) NOT BETWEEN 1 AND 50 THEN
    RAISE EXCEPTION 'BOOTSTRAP: 첫 관리자 이름이 1~50자가 아닙니다. 회원 이름을 먼저 확인해 주세요.';
  END IF;

  -- ① 계정 연결 (같은 Auth 주체)
  INSERT INTO workhub.accounts (auth_user_id, legacy_user_id, legacy_link_method, legacy_linked_at,
                                display_name, email, legacy_approval_state)
  VALUES (v_user.id::uuid, v_user.id, 'same_auth_user', v_now, btrim(v_user.name), v_user.email, 'approved')
  RETURNING * INTO a;

  -- ② 초기 설정 서비스 주체 + 실행 역할 허용 목록 + 서비스 범위 승인 (승인자 = 방금 연결한 관리자 계정)
  INSERT INTO workhub.service_principals (id, label, allowed_actions, approval_ref, approved_by_account_id, approved_at)
  VALUES ('svc_bootstrap', '첫 학교 초기 설정', ARRAY['school.bootstrap'], v_approval, a.id, v_now);
  INSERT INTO workhub_private.db_identity_principals (db_role, service_principal_id, approval_ref)
  VALUES (session_user, 'svc_bootstrap', v_approval);
  INSERT INTO workhub.service_principal_scopes (service_principal_id, scope_type, valid_from, valid_to,
                                               approved_by_account_id, approval_ref, approved_at)
  VALUES ('svc_bootstrap', 'service', v_now, v_now + interval '1 hour', a.id, v_approval, v_now)
  RETURNING * INTO g_svc;

  ctx_svc := workhub_private.resolve_service_actor('school.bootstrap', 'svc');
  PERFORM workhub_private.write_audit(ctx_svc, 'account.link_legacy', 'account', a.id, a.version, 'operator_only', NULL,
    jsonb_build_object('method', 'same_auth_user'));
  PERFORM workhub_private.write_audit(ctx_svc, 'service.principal_create', 'service_principal', 'svc_bootstrap', NULL, 'operator_only', NULL, '{}');
  PERFORM workhub_private.write_audit(ctx_svc, 'service.scope_grant', 'service_principal_scope', g_svc.id, g_svc.version, 'operator_only', NULL,
    jsonb_build_object('scope_key', 'svc'));

  -- ③ 학교 (준비 상태로 만든 뒤 마지막에 활성화)
  INSERT INTO workhub.schools (code, name, school_level, grade_count, timezone)
  VALUES (v_code, v_name, v_level, v_grades, v_tz)
  RETURNING * INTO s;
  INSERT INTO workhub.service_principal_scopes (service_principal_id, scope_type, school_id, valid_from, valid_to,
                                               approved_by_account_id, approval_ref, approved_at)
  VALUES ('svc_bootstrap', 'school', s.id, v_now, v_now + interval '1 hour', a.id, v_approval, v_now)
  RETURNING * INTO g_school;
  PERFORM workhub_private.write_audit(ctx_svc, 'service.scope_grant', 'service_principal_scope', g_school.id, g_school.version, 'operator_only', NULL,
    jsonb_build_object('scope_key', g_school.scope_key));
  ctx_school := workhub_private.resolve_service_actor('school.bootstrap', 's:' || s.id);
  PERFORM workhub_private.write_audit(ctx_school, 'school.create', 'school', s.id, s.version, 'school', NULL, '{}');

  -- ④ 학년도·학기 (입력은 마지막 날 포함 → 저장은 종료 제외)
  INSERT INTO workhub.academic_years (school_id, school_year, starts_on, ends_on, state)
  VALUES (s.id, v_year, v_year_from, v_year_to,
          CASE WHEN v_today >= v_year_from AND v_today < v_year_to THEN 'current' ELSE 'planning' END)
  RETURNING * INTO y;
  PERFORM workhub_private.write_audit(ctx_school, 'year.create', 'academic_year', y.id, y.version, 'school', NULL, '{}');
  FOR term IN SELECT value FROM jsonb_array_elements(p->'terms') LOOP
    BEGIN
      INSERT INTO workhub.terms (school_id, academic_year_id, term_no, label, starts_on, ends_on, state)
      VALUES (s.id, y.id, (term->>'term_no')::smallint, term->>'label', (term->>'first_day')::date, (term->>'last_day')::date + 1,
              CASE WHEN v_today >= (term->>'first_day')::date AND v_today <= (term->>'last_day')::date THEN 'current' ELSE 'planning' END)
      RETURNING * INTO t;
    EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow OR invalid_text_representation THEN
      RAISE EXCEPTION 'BOOTSTRAP: 학기 입력 형식을 확인해 주세요: %', term::text;
    END;
    PERFORM workhub_private.write_audit(ctx_school, 'term.create', 'term', t.id, t.version, 'school', NULL, '{}');
    v_term_ids := v_term_ids || to_jsonb(t.id);
  END LOOP;

  -- ⑤ 첫 관리자 소속·역할
  INSERT INTO workhub.memberships (school_id, account_id, status, employment_type, valid_from, decided_at, decision_note)
  VALUES (s.id, a.id, 'active', 'teacher', v_member_from, v_now, '첫 학교 초기 설정')
  RETURNING * INTO m;
  PERFORM workhub_private.write_audit(ctx_school, 'membership.create', 'membership', m.id, m.version, 'school', NULL, '{}');
  FOREACH v_role IN ARRAY v_roles LOOP
    INSERT INTO workhub.membership_roles (school_id, membership_id, role_code, valid_from)
    VALUES (s.id, m.id, v_role, v_member_from)
    RETURNING * INTO r;
    PERFORM workhub_private.write_audit(ctx_school, 'role.grant', 'membership_role', r.id, NULL, 'school', NULL,
      jsonb_build_object('role_code', v_role));
    v_role_ids := v_role_ids || to_jsonb(r.id);
  END LOOP;

  -- ⑥ 활성화
  UPDATE workhub.schools SET status = 'active', version = version + 1, permission_version = permission_version + 1,
         updated_at = v_now WHERE id = s.id RETURNING * INTO s;
  PERFORM workhub_private.write_audit(ctx_school, 'school.activate', 'school', s.id, s.version, 'school', NULL, '{}');
  PERFORM workhub_private.emit_outbox(ctx_school, 'school.activated', 'school', s.id, s.version, jsonb_build_object('school_id', s.id));

  -- ⑦ 초기 설정 범위 승인 회수 — 이후에는 새 승인 없이 이 주체로 실행할 수 없다.
  UPDATE workhub.service_principal_scopes SET revoked_at = clock_timestamp(), version = version + 1
   WHERE service_principal_id = 'svc_bootstrap' AND revoked_at IS NULL;
  PERFORM workhub_private.write_audit(ctx_svc, 'service.scope_revoke', 'service_principal', 'svc_bootstrap', NULL, 'operator_only', NULL,
    jsonb_build_object('reason', 'bootstrap_finished'));

  RETURN jsonb_build_object('school_id', s.id, 'school_status', s.status, 'account_id', a.id, 'membership_id', m.id,
    'academic_year_id', y.id, 'term_ids', v_term_ids, 'role_ids', v_role_ids, 'today', v_today);
END $$;

-- ----------------------------------------------------------------------------
-- 11. 권한: 표는 RLS 를 켜고 정책을 두지 않는다(브라우저 직접 읽기·쓰기 0).
--     내부 함수는 아무에게도 EXECUTE 를 주지 않는다.
-- ----------------------------------------------------------------------------
DO $$
DECLARE t record;
BEGIN
  FOR t IN SELECT c.oid::regclass AS rel FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE n.nspname IN ('workhub','workhub_private') AND c.relkind = 'r' LOOP
    EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', t.rel);
  END LOOP;
END $$;
REVOKE ALL ON ALL TABLES IN SCHEMA workhub, workhub_private FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA workhub, workhub_private FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA workhub, workhub_private FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TYPE workhub_private.actor_context FROM PUBLIC;

-- ----------------------------------------------------------------------------
-- 12. 검증 — 모든 행의 status 가 ok 여야 한다 (아래 결과가 SQL Editor 에 표시된다)
-- ----------------------------------------------------------------------------
COMMIT;

WITH expected(tbl) AS (VALUES ('schools'),('accounts'),('service_principals'),('service_principal_scopes'),('departments'),
  ('role_catalog'),('role_permissions'),('memberships'),('membership_roles'),('academic_years'),('terms'),
  ('idempotency_receipts'),('audit_events'),('outbox'))
SELECT 'B01-1' AS no, 'workhub 표 14개 + RLS 켜짐' AS item,
       CASE WHEN count(*) FILTER (WHERE c.relrowsecurity) = 14 THEN 'ok' ELSE 'FAIL' END AS status,
       count(*) FILTER (WHERE c.relrowsecurity)::text AS value
FROM expected e LEFT JOIN pg_class c ON c.oid = to_regclass('workhub.' || e.tbl)
UNION ALL
SELECT 'B01-2', 'anon·authenticated 의 workhub 표 권한 0',
       CASE WHEN count(*) = 0 THEN 'ok' ELSE 'FAIL' END, count(*)::text
FROM information_schema.role_table_grants WHERE table_schema IN ('workhub','workhub_private') AND grantee IN ('PUBLIC','anon','authenticated','service_role')
UNION ALL
SELECT 'B01-3', 'workhub schema USAGE 를 가진 API 역할 0',
       CASE WHEN bool_or(has_schema_privilege(r, 'workhub', 'USAGE') OR has_schema_privilege(r, 'workhub_private', 'USAGE')) THEN 'FAIL' ELSE 'ok' END, ''
FROM unnest(ARRAY['anon','authenticated','service_role']) r
UNION ALL
SELECT 'B01-4', '내부 함수 EXECUTE 를 가진 API 역할 0',
       CASE WHEN count(*) = 0 THEN 'ok' ELSE 'FAIL' END, count(*)::text
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace, unnest(ARRAY['anon','authenticated','service_role']) r
WHERE n.nspname IN ('workhub','workhub_private') AND has_function_privilege(r, p.oid, 'EXECUTE')
UNION ALL
SELECT 'B01-5', '역할 2개·권한 4개 시드',
       CASE WHEN (SELECT count(*) FROM workhub.role_catalog) = 2 AND (SELECT count(*) FROM workhub.role_permissions) = 4 THEN 'ok' ELSE 'FAIL' END, ''
UNION ALL
SELECT 'B01-6', '아직 학교·계정 없음(초기 설정 전)',
       CASE WHEN (SELECT count(*) FROM workhub.schools) = 0 AND (SELECT count(*) FROM workhub.accounts) = 0 THEN 'ok' ELSE 'FAIL' END, ''
UNION ALL
SELECT 'B01-7', 'public.workhub_* 함수 아직 없음(B02 에서 만든다)',
       CASE WHEN count(*) = 0 THEN 'ok' ELSE 'FAIL' END, count(*)::text
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname LIKE 'workhub\_%'
ORDER BY 1;
