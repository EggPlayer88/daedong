-- ============================================================================
-- P3-02  메신저 · 업무 알림 · 메시지 HWPX 첨부 — 공개 함수 13개 · 전용 버킷 · Storage 정책 2개 · 권한 (비활성 설치)
--
-- ▣ 하는 일
--   authenticated(앱): workhub_messaging_readiness · workhub_message_recipients · workhub_message_threads · workhub_message_get
--                      workhub_inbox_list · workhub_message_mutate
--                      workhub_message_file_readiness · workhub_message_file_prepare · workhub_message_file_complete
--                      workhub_message_file_status · workhub_message_file_access
--   service_role 만(서버 확인 API /api/messages/check-hwpx): workhub_message_file_basic_claim · workhub_message_file_basic_finish
--   비공개 버킷 workhub-message-files(30MiB) 와 그 버킷에만 걸리는 INSERT·SELECT 정책 2개. UPDATE·DELETE 정책은 만들지 않는다.
-- ▣ 하지 않는 일
--   - 어느 학교도 켜지 않는다(P3-04 · P3-05). 이 파일만으로는 메시지·첨부 모두 준비 안 됨이다.
--   - 수합 버킷·R1/R1S 함수·정책을 바꾸지 않는다. 알림을 만드는 쪽은 이번 배치에 없다(뒤 배치가 p3_notify 를 부른다).
-- ▣ 실행: SQL Editor 에 전체를 붙여 넣고 Run. 한 트랜잭션. 마지막 결과의 status 가 모두 ok 여야 한다.
-- ▣ 선행: P3-01 (판 2026-10-16.1)
-- ============================================================================
BEGIN;

DO $$
DECLARE v_owner oid;
BEGIN
  IF to_regclass('workhub_private.p3_installs') IS NULL THEN
    RAISE EXCEPTION 'P3 중단: P3-01(2026-10-16.1)을 먼저 실행해 주세요.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM workhub_private.p3_installs WHERE batch = 'P3-01' AND release = '2026-10-16.1') THEN
    RAISE EXCEPTION 'P3 중단: P3-01(2026-10-16.1)을 먼저 실행해 주세요.';
  END IF;
  IF EXISTS (SELECT 1 FROM workhub_private.p3_installs WHERE batch = 'P3-02') THEN
    RAISE EXCEPTION 'P3 중단: P3-02 가 이미 적용되었습니다(다시 실행하지 않습니다).';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname LIKE 'workhub\_messag%' OR proname = 'workhub_inbox_list')
     OR to_regprocedure('workhub_storage.message_insertable(text)') IS NOT NULL
     OR to_regprocedure('workhub_storage.message_readable(text,uuid)') IS NOT NULL THEN
    RAISE EXCEPTION 'P3 중단: 같은 이름의 공개 함수가 이미 있습니다. 누가 만들었는지 먼저 확인해 주세요.';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'storage.objects'::regclass) THEN
    RAISE EXCEPTION 'P3 중단: storage.objects 의 RLS 가 꺼져 있습니다. Storage 설정을 먼저 확인해 주세요.';
  END IF;
  IF EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'workhub-message-files' OR name = 'workhub-message-files')
     OR EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = 'storage.objects'::regclass AND polname LIKE 'workhub\_message%') THEN
    RAISE EXCEPTION 'P3 중단: workhub-message-files 버킷 또는 workhub_message 이름의 Storage 정책이 이미 있습니다.';
  END IF;
  -- 정책 생성 가능 여부는 실제로 만들어 보고 되돌려 판단한다(R1-03 과 같은 방법 · 2026-10-15 운영 적용에서 확인).
  SELECT relowner INTO v_owner FROM pg_class WHERE oid = 'storage.objects'::regclass;
  BEGIN
    CREATE POLICY workhub_p3_probe ON storage.objects AS RESTRICTIVE FOR SELECT TO authenticated USING (false);
    RAISE EXCEPTION USING ERRCODE = 'P3PRB', MESSAGE = 'P3-02 정책 생성 시험(되돌림)';
  EXCEPTION
    WHEN SQLSTATE 'P3PRB' THEN NULL;
    WHEN insufficient_privilege THEN
      RAISE EXCEPTION 'P3 중단: 현재 역할(%)이 storage.objects 에 정책을 만들 수 없습니다(%).', current_user, SQLERRM;
  END;
  IF NOT (has_table_privilege(current_user, 'storage.objects', 'SELECT')
          AND ((SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user) OR pg_has_role(current_user, v_owner, 'USAGE'))) THEN
    RAISE EXCEPTION 'P3 중단: 현재 역할(%)이 storage.objects 를 RLS 없이 읽을 수 없습니다.', current_user;
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 1. 공통 내부 함수
-- ----------------------------------------------------------------------------
-- 같은 (학교, 소속, 종류, 요청 번호) 의 동시 실행을 한 줄로 세운다(응답 유실 뒤 재전송이 겹쳐도 한 번만 반영).
CREATE FUNCTION workhub_private.p3_lock(p_ctx workhub_private.actor_context, p_kind text, p_key text) RETURNS void
LANGUAGE sql SET search_path = '' AS $$
  SELECT pg_advisory_xact_lock(hashtextextended('p3' || chr(31) || p_ctx.school_id || chr(31) || p_ctx.membership_id
                                                || chr(31) || p_kind || chr(31) || p_key, 0))
$$;

-- ILIKE 용 검색어(%, _, \ 를 글자 그대로)
CREATE FUNCTION workhub_private.p3_like(p text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT '%' || replace(replace(replace(p, '\', '\\'), '%', '\%'), '_', '\_') || '%'
$$;

-- 앱 파일 이름 규칙(files/validation.ts fileExtension · messageAttachment): .hwpx · UTF-8 240바이트 · 앞뒤 공백·경로 문자·방향 제어 문자 없음
CREATE FUNCTION workhub_private.p3_file_name(p jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT p IS NOT NULL AND jsonb_typeof(p) = 'string'
     AND workhub_private.js_trim(p #>> '{}') = (p #>> '{}')
     AND octet_length(p #>> '{}') <= 240 AND length(p #>> '{}') >= 6
     AND (p #>> '{}') ~* '\.hwpx$'
     AND (p #>> '{}') !~ '[\x01-\x1f\x7f<>:"/\\|?*‪-‮⁦-⁩]'
     AND btrim(replace(left(p #>> '{}', -5), '.', '')) <> ''
     AND (p #>> '{}') !~* '^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)'
$$;

-- 서버 확인 API 의 사람 주체(R1S c_basic_member 와 같은 방법, R1S 가 없어도 동작하도록 이 배치에 따로 둔다)
--   service_role 이고 사람 JWT 가 실리지 않은 요청만. API 가 확인한 UID 로 이 트랜잭션 안에서만 요청 주체를 바꿔
--   기존 승인 gate·소속 확인(member_actor, 잠금 포함)을 그대로 통과해야 한다. 끝나면 원래 값으로 되돌린다.
CREATE FUNCTION workhub_private.p3_service_member(p_actor uuid, p_member text) RETURNS workhub_private.actor_context
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE ctx workhub_private.actor_context; v_claims text := current_setting('request.jwt.claims', true);
  v_sub text := current_setting('request.jwt.claim.sub', true);
BEGIN
  IF current_setting('role', true) IS DISTINCT FROM 'service_role' OR auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'FORBIDDEN' USING DETAIL = '서버 확인 API(service_role, 사람 JWT 없음)만 부를 수 있습니다.';
  END IF;
  IF p_actor IS NULL THEN RAISE EXCEPTION 'FORBIDDEN' USING DETAIL = '확인된 사용자 UID 가 없습니다.'; END IF;
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', p_actor::text, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', p_actor::text, true);
  IF auth.uid() IS DISTINCT FROM p_actor THEN RAISE EXCEPTION 'FORBIDDEN' USING DETAIL = '요청 주체를 확인하지 못했습니다.'; END IF;
  ctx := workhub_private.member_actor(p_member, true);
  PERFORM workhub_private.lock_member_roles(ctx);
  PERFORM set_config('request.jwt.claims', COALESCE(v_claims, ''), true);
  PERFORM set_config('request.jwt.claim.sub', COALESCE(v_sub, ''), true);
  IF auth.uid() IS NOT NULL THEN RAISE EXCEPTION 'FORBIDDEN' USING DETAIL = '요청 주체를 되돌리지 못했습니다.'; END IF;
  RETURN ctx;
END $$;

-- ----------------------------------------------------------------------------
-- 2. 조회
-- ----------------------------------------------------------------------------
CREATE FUNCTION workhub_private.p3_readiness(p_ctx workhub_private.actor_context) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_reason text := workhub_private.p3_messaging_reason(p_ctx.school_id); p workhub.messaging_policies;
BEGIN
  SELECT * INTO p FROM workhub.messaging_policies WHERE school_id = p_ctx.school_id;
  RETURN jsonb_build_object('available', v_reason = 'ready', 'reason', v_reason,
    'limits', CASE WHEN v_reason = 'ready' THEN jsonb_build_object('bodyCharacters', p.body_characters,
                     'titleCharacters', p.title_characters, 'recipients', p.recipients) ELSE NULL END,
    'attachments', CASE WHEN v_reason = 'ready' AND workhub_private.p3_files_reason(p_ctx.school_id) = 'ready'
                        THEN 'hwpx_basic_v1' ELSE 'not_configured' END);
END $$;

-- 받는 사람 검색: 본인(같은 계정의 다른 소속 포함) 제외 · 같은 학교 · 지금 받을 수 있는 사람. 이름·담당으로 찾는다. 50명씩.
CREATE FUNCTION workhub_private.p3_recipients(p_ctx workhub_private.actor_context, p_query text, p_cursor text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_q text; v_f text; cur jsonb; c_name text; c_id text; v_rows jsonb; v_n integer; v_last jsonb;
BEGIN
  IF workhub_private.p3_messaging_reason(p_ctx.school_id) <> 'ready' THEN RAISE EXCEPTION 'NOT_READY'; END IF;
  IF NOT workhub_private.p3_text(to_jsonb(p_query), 200, true) THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  v_q := workhub_private.js_trim(p_query);
  v_f := md5('recipients' || chr(31) || p_ctx.membership_id || chr(31) || v_q);
  cur := workhub_private.p3_cursor_in(p_cursor, v_f);
  IF cur IS NOT NULL THEN
    IF jsonb_typeof(cur -> 'n') IS DISTINCT FROM 'string' OR jsonb_typeof(cur -> 'i') IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
    c_name := cur ->> 'n'; c_id := cur ->> 'i';
  END IF;
  WITH c AS (
    SELECT m.id, a.display_name AS name
      FROM workhub.memberships m JOIN workhub.accounts a ON a.id = m.account_id
     WHERE m.school_id = p_ctx.school_id AND m.id <> p_ctx.membership_id AND m.account_id <> p_ctx.account_id
       AND workhub_private.p3_reachable(m.school_id, m.id)
       AND (v_q = '' OR a.display_name ILIKE workhub_private.p3_like(v_q)
            OR workhub_private.p3_department(m.school_id, m.id, p_ctx.school_today) ILIKE workhub_private.p3_like(v_q))
       AND (c_id IS NULL OR (a.display_name COLLATE "C", m.id COLLATE "C") > (c_name COLLATE "C", c_id COLLATE "C"))
     ORDER BY a.display_name COLLATE "C", m.id COLLATE "C" LIMIT 51)
  SELECT jsonb_agg(jsonb_build_object('n', c.name, 'i', c.id) ORDER BY c.name COLLATE "C", c.id COLLATE "C") INTO v_rows FROM c;
  v_n := COALESCE(jsonb_array_length(v_rows), 0);
  IF v_n > 50 THEN v_last := v_rows -> 49; END IF;
  RETURN jsonb_build_object(
    'items', COALESCE((SELECT jsonb_agg(workhub_private.p3_recipient(p_ctx.school_id, e.v ->> 'i', p_ctx.school_today) ORDER BY e.o)
                         FROM jsonb_array_elements(v_rows) WITH ORDINALITY e(v, o) WHERE e.o <= 50), '[]'::jsonb),
    'nextCursor', CASE WHEN v_last IS NULL THEN NULL
                       ELSE workhub_private.p3_cursor_out(jsonb_build_object('f', v_f, 'n', v_last ->> 'n', 'i', v_last ->> 'i')) END);
END $$;

-- 대화 목록: 내가 참여한 대화. 제목·다른 참여자 이름으로 서버 전체에서 찾는다. 최근 순 50개.
CREATE FUNCTION workhub_private.p3_threads(p_ctx workhub_private.actor_context, p_query text, p_unread boolean, p_cursor text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_q text; v_f text; cur jsonb; c_at timestamptz; c_id text; v_ids text[]; v_last workhub.message_threads;
BEGIN
  IF workhub_private.p3_messaging_reason(p_ctx.school_id) <> 'ready' THEN RAISE EXCEPTION 'NOT_READY'; END IF;
  IF NOT workhub_private.p3_text(to_jsonb(p_query), 200, true) OR p_unread IS NULL THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  v_q := workhub_private.js_trim(p_query);
  v_f := md5('threads' || chr(31) || p_ctx.membership_id || chr(31) || v_q || chr(31) || p_unread::text);
  cur := workhub_private.p3_cursor_in(p_cursor, v_f);
  IF cur IS NOT NULL THEN
    BEGIN
      c_at := (cur ->> 't')::timestamptz; c_id := cur ->> 'i';
    EXCEPTION WHEN others THEN RAISE EXCEPTION 'INVALID_INPUT';
    END;
    IF c_at IS NULL OR c_id IS NULL THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  END IF;
  SELECT array_agg(x.id ORDER BY x.updated_at DESC, x.id COLLATE "C" DESC) INTO v_ids FROM (
    SELECT t.id, t.updated_at
      FROM workhub.message_threads t JOIN workhub.message_thread_members me ON me.thread_id = t.id AND me.membership_id = p_ctx.membership_id
     WHERE t.school_id = p_ctx.school_id
       AND (c_id IS NULL OR (t.updated_at, t.id COLLATE "C") < (c_at, c_id COLLATE "C"))
       AND (v_q = '' OR t.title ILIKE workhub_private.p3_like(v_q)
            OR EXISTS (SELECT 1 FROM workhub.message_thread_members o JOIN workhub.memberships m ON m.school_id = o.school_id AND m.id = o.membership_id
                         JOIN workhub.accounts a ON a.id = m.account_id
                        WHERE o.thread_id = t.id AND o.membership_id <> p_ctx.membership_id AND a.display_name ILIKE workhub_private.p3_like(v_q)))
       AND (NOT p_unread OR EXISTS (SELECT 1 FROM workhub.messages x WHERE x.thread_id = t.id AND x.sequence > me.read_sequence
                                      AND x.sequence <= t.latest_sequence AND x.sender_membership_id <> p_ctx.membership_id))
     ORDER BY t.updated_at DESC, t.id COLLATE "C" DESC LIMIT 51) x;
  IF COALESCE(array_length(v_ids, 1), 0) > 50 THEN
    SELECT * INTO v_last FROM workhub.message_threads WHERE id = v_ids[50];
  END IF;
  RETURN jsonb_build_object(
    'items', COALESCE((SELECT jsonb_agg(workhub_private.p3_thread_dto(t, p_ctx) ORDER BY u.o)
                         FROM unnest(v_ids[1:50]) WITH ORDINALITY u(id, o) JOIN workhub.message_threads t ON t.id = u.id), '[]'::jsonb),
    'nextCursor', CASE WHEN v_last.id IS NULL THEN NULL
                       ELSE workhub_private.p3_cursor_out(jsonb_build_object('f', v_f, 't', v_last.updated_at::text, 'i', v_last.id)) END);
END $$;

-- 메시지: 최신 50개를 순번 오름차순으로. nextCursor 는 그보다 이전 페이지. 열기만으로 읽음을 쓰지 않는다.
CREATE FUNCTION workhub_private.p3_get(p_ctx workhub_private.actor_context, p_thread text, p_cursor text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE t workhub.message_threads; v_f text; cur jsonb; c_seq integer; v_ids text[]; v_more boolean;
BEGIN
  IF workhub_private.p3_messaging_reason(p_ctx.school_id) <> 'ready' THEN RAISE EXCEPTION 'NOT_READY'; END IF;
  IF NOT workhub_private.p3_id(to_jsonb(p_thread)) THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  SELECT t0.* INTO t FROM workhub.message_threads t0
   WHERE t0.school_id = p_ctx.school_id AND t0.id = p_thread
     AND EXISTS (SELECT 1 FROM workhub.message_thread_members me WHERE me.thread_id = t0.id AND me.membership_id = p_ctx.membership_id);
  IF t.id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  v_f := md5('messages' || chr(31) || p_ctx.membership_id || chr(31) || t.id);
  cur := workhub_private.p3_cursor_in(p_cursor, v_f);
  IF cur IS NOT NULL THEN
    IF jsonb_typeof(cur -> 's') IS DISTINCT FROM 'number' OR NOT workhub_private.p2_int(cur -> 's', 2, 2147483647) THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
    c_seq := (cur ->> 's')::integer;
  END IF;
  SELECT array_agg(x.id ORDER BY x.sequence DESC) INTO v_ids FROM (
    SELECT id, sequence FROM workhub.messages
     WHERE thread_id = t.id AND sequence <= t.latest_sequence AND (c_seq IS NULL OR sequence < c_seq)
     ORDER BY sequence DESC LIMIT 51) x;
  v_more := COALESCE(array_length(v_ids, 1), 0) > 50;
  RETURN jsonb_build_object('thread', workhub_private.p3_thread_dto(t, p_ctx),
    'items', COALESCE((SELECT jsonb_agg(workhub_private.p3_message_dto(x) ORDER BY x.sequence)
                         FROM workhub.messages x WHERE x.id = ANY (v_ids[1:50])), '[]'::jsonb),
    'nextCursor', CASE WHEN NOT v_more THEN NULL
                       ELSE workhub_private.p3_cursor_out(jsonb_build_object('f', v_f, 's',
                              (SELECT sequence FROM workhub.messages WHERE id = v_ids[50]))) END);
END $$;

-- 업무 알림함: 내 소속 알림, 최근 순 50개
CREATE FUNCTION workhub_private.p3_inbox(p_ctx workhub_private.actor_context, p_unread boolean, p_cursor text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_f text; cur jsonb; c_at timestamptz; c_id text; v_ids text[]; v_last workhub.notifications;
BEGIN
  IF workhub_private.p3_messaging_reason(p_ctx.school_id) <> 'ready' THEN RAISE EXCEPTION 'NOT_READY'; END IF;
  IF p_unread IS NULL THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  v_f := md5('inbox' || chr(31) || p_ctx.membership_id || chr(31) || p_unread::text);
  cur := workhub_private.p3_cursor_in(p_cursor, v_f);
  IF cur IS NOT NULL THEN
    BEGIN
      c_at := (cur ->> 't')::timestamptz; c_id := cur ->> 'i';
    EXCEPTION WHEN others THEN RAISE EXCEPTION 'INVALID_INPUT';
    END;
    IF c_at IS NULL OR c_id IS NULL THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  END IF;
  SELECT array_agg(x.id ORDER BY x.created_at DESC, x.id COLLATE "C" DESC) INTO v_ids FROM (
    SELECT n.id, n.created_at FROM workhub.notifications n
     WHERE n.school_id = p_ctx.school_id AND n.owner_membership_id = p_ctx.membership_id
       AND (NOT p_unread OR n.read_at IS NULL)
       AND (c_id IS NULL OR (n.created_at, n.id COLLATE "C") < (c_at, c_id COLLATE "C"))
     ORDER BY n.created_at DESC, n.id COLLATE "C" DESC LIMIT 51) x;
  IF COALESCE(array_length(v_ids, 1), 0) > 50 THEN
    SELECT * INTO v_last FROM workhub.notifications WHERE id = v_ids[50];
  END IF;
  RETURN jsonb_build_object(
    'items', COALESCE((SELECT jsonb_agg(workhub_private.p3_notice_dto(n) ORDER BY u.o)
                         FROM unnest(v_ids[1:50]) WITH ORDINALITY u(id, o) JOIN workhub.notifications n ON n.id = u.id), '[]'::jsonb),
    'nextCursor', CASE WHEN v_last.id IS NULL THEN NULL
                       ELSE workhub_private.p3_cursor_out(jsonb_build_object('f', v_f, 't', v_last.created_at::text, 'i', v_last.id)) END);
END $$;

-- ----------------------------------------------------------------------------
-- 3. 보내기 · 읽음
-- ----------------------------------------------------------------------------
-- 첨부 확인·잠금: 보내는 사람 소유 · ready · 아직 어느 전송에도 붙지 않음 · 실물(object id·주인)이 그대로 · 지금 정책 크기 이내.
-- 언제나 대화보다 먼저 잠근다(파일 → 대화 순서로 교착을 피한다).
CREATE FUNCTION workhub_private.p3_take_files(p_ctx workhub_private.actor_context, p_ids text[]) RETURNS text[]
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE f workhub.message_files; o jsonb; fp workhub.message_file_policies; v_n integer := 0;
BEGIN
  IF COALESCE(array_length(p_ids, 1), 0) = 0 THEN RETURN ARRAY[]::text[]; END IF;
  IF workhub_private.p3_files_reason(p_ctx.school_id) <> 'ready' THEN RAISE EXCEPTION 'NOT_READY'; END IF;
  SELECT * INTO fp FROM workhub.message_file_policies WHERE school_id = p_ctx.school_id;
  IF array_length(p_ids, 1) > fp.max_files THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  FOR f IN SELECT * FROM workhub.message_files WHERE school_id = p_ctx.school_id AND id = ANY (p_ids) ORDER BY id COLLATE "C" FOR UPDATE LOOP
    IF f.owner_membership_id <> p_ctx.membership_id OR f.owner_account_id <> p_ctx.account_id THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
    IF f.state <> 'ready' OR f.attached_at IS NOT NULL OR f.actual_bytes > fp.max_file_bytes THEN RAISE EXCEPTION 'CONFLICT'; END IF;
    o := workhub_private.c_object_owner('workhub-message-files', f.storage_path);
    IF o IS NULL OR (o ->> 'id')::uuid IS DISTINCT FROM f.storage_object_id OR o ->> 'owner' IS DISTINCT FROM p_ctx.auth_user_id::text THEN
      RAISE EXCEPTION 'CONFLICT';
    END IF;
    v_n := v_n + 1;
  END LOOP;
  IF v_n <> array_length(p_ids, 1) THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  RETURN p_ids;
END $$;

-- 1:1 대화: 두 소속 조합으로 하나. 없으면 만들고(동시 생성은 유일 제약이 한 줄로 세운다), 있으면 잠근다.
CREATE FUNCTION workhub_private.p3_direct(p_ctx workhub_private.actor_context, p_other workhub.memberships) RETURNS workhub.message_threads
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE t workhub.message_threads; v_key text;
BEGIN
  v_key := CASE WHEN p_ctx.membership_id COLLATE "C" < p_other.id COLLATE "C" THEN p_ctx.membership_id || '|' || p_other.id
                ELSE p_other.id || '|' || p_ctx.membership_id END;
  INSERT INTO workhub.message_threads (school_id, kind, title, direct_key, created_by_membership_id, created_by_account_id)
  VALUES (p_ctx.school_id, 'direct', '', v_key, p_ctx.membership_id, p_ctx.account_id)
  ON CONFLICT ON CONSTRAINT message_threads_direct_key DO NOTHING
  RETURNING * INTO t;
  IF t.id IS NOT NULL THEN
    INSERT INTO workhub.message_thread_members (school_id, thread_id, membership_id, account_id)
    VALUES (p_ctx.school_id, t.id, p_ctx.membership_id, p_ctx.account_id), (p_ctx.school_id, t.id, p_other.id, p_other.account_id);
  ELSE
    SELECT * INTO t FROM workhub.message_threads WHERE school_id = p_ctx.school_id AND direct_key = v_key FOR UPDATE;
  END IF;
  RETURN t;
END $$;

-- 대화에 메시지 1개(불변 순번) + 첨부 연결 + 감사·outbox. 본문은 감사에 남기지 않는다.
CREATE FUNCTION workhub_private.p3_post(p_ctx workhub_private.actor_context, p_thread text, p_body text, p_files text[], p_key text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE t workhub.message_threads; x workhub.messages;
BEGIN
  UPDATE workhub.message_threads SET latest_sequence = latest_sequence + 1, updated_at = clock_timestamp()
   WHERE school_id = p_ctx.school_id AND id = p_thread RETURNING * INTO t;
  INSERT INTO workhub.messages (school_id, thread_id, sequence, sender_membership_id, sender_account_id, sender_name, body, request_key)
  VALUES (p_ctx.school_id, t.id, t.latest_sequence, p_ctx.membership_id, p_ctx.account_id,
          (SELECT a.display_name FROM workhub.accounts a WHERE a.id = p_ctx.account_id), p_body, p_key)
  RETURNING * INTO x;
  INSERT INTO workhub.message_attachments (school_id, message_id, file_id, position)
  SELECT p_ctx.school_id, x.id, u.f, u.o FROM unnest(p_files) WITH ORDINALITY u(f, o);
  PERFORM workhub_private.write_audit(p_ctx, 'message.send', 'message', x.id, NULL, 'owner_only', p_key,
    jsonb_build_object('thread_id', t.id, 'sequence', x.sequence, 'attachments', COALESCE(array_length(p_files, 1), 0)));
  PERFORM workhub_private.emit_outbox(p_ctx, 'message.sent', 'message', x.id, NULL, jsonb_build_object('thread_id', t.id, 'message_id', x.id));
  RETURN jsonb_build_object('threadId', t.id, 'messageId', x.id,
    'recipientMemberIds', (SELECT jsonb_agg(m.membership_id ORDER BY m.membership_id COLLATE "C") FROM workhub.message_thread_members m
                            WHERE m.thread_id = t.id AND m.membership_id <> p_ctx.membership_id),
    'sequence', x.sequence);
END $$;

-- 본문 입력: 문자열 · 기술 상한 50000(UTF-16) · 학교 정책 한도. 앱과 같이 앞뒤 공백을 걷어 저장한다.
CREATE FUNCTION workhub_private.p3_body(p jsonb, p_max integer) RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE v text;
BEGIN
  IF NOT workhub_private.p3_text(p, 50000, true) THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  v := workhub_private.js_trim(p #>> '{}');
  IF workhub_private.p3_len(v) > p_max THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  RETURN v;
END $$;

CREATE FUNCTION workhub_private.p3_file_ids(p jsonb) RETURNS text[]
LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
BEGIN
  IF p IS NULL OR jsonb_typeof(p) <> 'array' OR jsonb_array_length(p) > 20
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(p) e WHERE NOT workhub_private.p3_id(e))
     OR (SELECT count(DISTINCT e #>> '{}') FROM jsonb_array_elements(p) e) <> jsonb_array_length(p) THEN
    RAISE EXCEPTION 'INVALID_INPUT';
  END IF;
  RETURN ARRAY(SELECT e #>> '{}' FROM jsonb_array_elements(p) WITH ORDINALITY x(e, o) ORDER BY o);
END $$;

-- 명령 4종. 확정 거절은 예외로 → 부르는 쪽 하위 트랜잭션이 모든 변경을 되돌린다(일부만 보낸 뒤 실패로 답하지 않는다).
CREATE FUNCTION workhub_private.p3_apply(p_ctx workhub_private.actor_context, c jsonb, p_key text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE pol workhub.messaging_policies; v_kind text := c ->> 'kind'; v_mode text; v_title text; v_body text; v_files text[];
  v_ids text[]; v_want jsonb; m workhub.memberships; t workhub.message_threads; me workhub.message_thread_members;
  n workhub.notifications; v_del jsonb := '[]'::jsonb; v_n integer; v_through integer; v_others text[];
  v_now text := workhub_private.p3_ts(clock_timestamp());
BEGIN
  SELECT * INTO pol FROM workhub.messaging_policies WHERE school_id = p_ctx.school_id;
  IF v_kind = 'start' THEN
    IF NOT workhub_private.p2_exact(c, ARRAY['kind','mode','recipients','title','body','attachmentIds'])
       OR jsonb_typeof(c -> 'mode') IS DISTINCT FROM 'string' OR c ->> 'mode' NOT IN ('direct','group','individual')
       OR jsonb_typeof(c -> 'recipients') IS DISTINCT FROM 'array' OR jsonb_array_length(c -> 'recipients') NOT BETWEEN 1 AND 500
       OR EXISTS (SELECT 1 FROM jsonb_array_elements(c -> 'recipients') r
                   WHERE NOT workhub_private.p2_exact(r, ARRAY['memberId','expectedVersion']) OR NOT workhub_private.p3_id(r -> 'memberId')
                      OR NOT workhub_private.p2_int(r -> 'expectedVersion', 1, 2147483647))
       OR (SELECT count(DISTINCT r ->> 'memberId') FROM jsonb_array_elements(c -> 'recipients') r) <> jsonb_array_length(c -> 'recipients')
       OR EXISTS (SELECT 1 FROM jsonb_array_elements(c -> 'recipients') r WHERE r ->> 'memberId' = p_ctx.membership_id)
       OR NOT workhub_private.p3_text(c -> 'title', 1000, true) THEN
      RAISE EXCEPTION 'INVALID_INPUT';
    END IF;
    v_mode := c ->> 'mode'; v_n := jsonb_array_length(c -> 'recipients');
    IF (v_mode = 'direct' AND v_n <> 1) OR (v_mode = 'group' AND v_n < 2) OR v_n > pol.recipients THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
    v_title := CASE WHEN v_mode = 'group' THEN workhub_private.js_trim(c ->> 'title') ELSE '' END;
    IF v_mode = 'group' AND (v_title = '' OR workhub_private.p3_len(v_title) > pol.title_characters) THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
    v_body := workhub_private.p3_body(c -> 'body', pol.body_characters);
    v_files := workhub_private.p3_file_ids(c -> 'attachmentIds');
    IF v_body = '' AND cardinality(v_files) = 0 THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
    -- 받는 사람: 정렬된 소속 id 순서로 잠근다. 모르는 id·다른 학교 → NOT_FOUND, 같은 계정 → INVALID_INPUT,
    -- 화면이 본 판과 다르거나 지금 받을 수 없음 → CONFLICT. 한 명이라도 걸리면 아무에게도 보내지 않는다.
    v_ids := ARRAY(SELECT r ->> 'memberId' FROM jsonb_array_elements(c -> 'recipients') r ORDER BY r ->> 'memberId' COLLATE "C");
    v_want := (SELECT jsonb_object_agg(r ->> 'memberId', (r ->> 'expectedVersion')::integer) FROM jsonb_array_elements(c -> 'recipients') r);
    v_n := 0;
    FOR m IN SELECT * FROM workhub.memberships WHERE school_id = p_ctx.school_id AND id = ANY (v_ids) ORDER BY id COLLATE "C" FOR SHARE LOOP
      v_n := v_n + 1;
    END LOOP;
    IF v_n <> cardinality(v_ids) THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
    IF EXISTS (SELECT 1 FROM workhub.memberships WHERE school_id = p_ctx.school_id AND id = ANY (v_ids) AND account_id = p_ctx.account_id) THEN
      RAISE EXCEPTION 'INVALID_INPUT';
    END IF;
    IF EXISTS (SELECT 1 FROM workhub.memberships mm WHERE mm.school_id = p_ctx.school_id AND mm.id = ANY (v_ids)
                AND (mm.version <> (v_want ->> mm.id)::integer OR NOT workhub_private.p3_reachable(mm.school_id, mm.id))) THEN
      RAISE EXCEPTION 'CONFLICT';
    END IF;
    v_files := workhub_private.p3_take_files(p_ctx, v_files);
    IF v_mode = 'group' THEN
      INSERT INTO workhub.message_threads (school_id, kind, title, direct_key, created_by_membership_id, created_by_account_id)
      VALUES (p_ctx.school_id, 'group', v_title, NULL, p_ctx.membership_id, p_ctx.account_id) RETURNING * INTO t;
      INSERT INTO workhub.message_thread_members (school_id, thread_id, membership_id, account_id)
      SELECT p_ctx.school_id, t.id, p_ctx.membership_id, p_ctx.account_id
      UNION ALL
      SELECT p_ctx.school_id, t.id, mm.id, mm.account_id FROM workhub.memberships mm WHERE mm.school_id = p_ctx.school_id AND mm.id = ANY (v_ids);
      v_del := jsonb_build_array(workhub_private.p3_post(p_ctx, t.id, v_body, v_files, p_key));
    ELSE
      FOR m IN SELECT * FROM workhub.memberships WHERE school_id = p_ctx.school_id AND id = ANY (v_ids) ORDER BY id COLLATE "C" LOOP
        t := workhub_private.p3_direct(p_ctx, m);
        v_del := v_del || jsonb_build_array(workhub_private.p3_post(p_ctx, t.id, v_body, v_files, p_key));
      END LOOP;
    END IF;
    UPDATE workhub.message_files SET attached_at = clock_timestamp(), version = version + 1, updated_at = clock_timestamp()
     WHERE school_id = p_ctx.school_id AND id = ANY (v_files);
    RETURN jsonb_build_object('requestKey', p_key, 'kind', 'start', 'recordedAt', v_now, 'deliveries', v_del,
                              'threadId', NULL, 'throughSequence', NULL, 'noticeId', NULL, 'version', NULL);

  ELSIF v_kind = 'reply' THEN
    IF NOT workhub_private.p2_exact(c, ARRAY['kind','threadId','expectedVersion','recipientMemberIds','body','attachmentIds'])
       OR NOT workhub_private.p3_id(c -> 'threadId') OR NOT workhub_private.p2_int(c -> 'expectedVersion', 1, 2147483647)
       OR jsonb_typeof(c -> 'recipientMemberIds') IS DISTINCT FROM 'array' OR jsonb_array_length(c -> 'recipientMemberIds') NOT BETWEEN 1 AND 500
       OR EXISTS (SELECT 1 FROM jsonb_array_elements(c -> 'recipientMemberIds') e WHERE NOT workhub_private.p3_id(e) OR e #>> '{}' = p_ctx.membership_id)
       OR (SELECT count(DISTINCT e #>> '{}') FROM jsonb_array_elements(c -> 'recipientMemberIds') e) <> jsonb_array_length(c -> 'recipientMemberIds') THEN
      RAISE EXCEPTION 'INVALID_INPUT';
    END IF;
    v_body := workhub_private.p3_body(c -> 'body', pol.body_characters);
    v_files := workhub_private.p3_file_ids(c -> 'attachmentIds');
    IF v_body = '' AND cardinality(v_files) = 0 THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
    IF NOT EXISTS (SELECT 1 FROM workhub.message_threads t0 JOIN workhub.message_thread_members me0 ON me0.thread_id = t0.id
                    WHERE t0.school_id = p_ctx.school_id AND t0.id = c ->> 'threadId' AND me0.membership_id = p_ctx.membership_id) THEN
      RAISE EXCEPTION 'NOT_FOUND';
    END IF;
    v_files := workhub_private.p3_take_files(p_ctx, v_files);
    SELECT * INTO t FROM workhub.message_threads WHERE school_id = p_ctx.school_id AND id = c ->> 'threadId' FOR UPDATE;
    -- 화면에서 확인한 참여자·판이 지금과 모두 같고, 다른 참여자가 모두 지금 받을 수 있을 때만
    v_others := ARRAY(SELECT membership_id FROM workhub.message_thread_members WHERE thread_id = t.id AND membership_id <> p_ctx.membership_id
                       ORDER BY membership_id COLLATE "C");
    IF t.version <> (c ->> 'expectedVersion')::integer
       OR v_others <> ARRAY(SELECT e #>> '{}' FROM jsonb_array_elements(c -> 'recipientMemberIds') e ORDER BY e #>> '{}' COLLATE "C")
       OR EXISTS (SELECT 1 FROM unnest(v_others) o WHERE NOT workhub_private.p3_reachable(t.school_id, o)) THEN
      RAISE EXCEPTION 'CONFLICT';
    END IF;
    v_del := jsonb_build_array(workhub_private.p3_post(p_ctx, t.id, v_body, v_files, p_key));
    UPDATE workhub.message_files SET attached_at = clock_timestamp(), version = version + 1, updated_at = clock_timestamp()
     WHERE school_id = p_ctx.school_id AND id = ANY (v_files);
    RETURN jsonb_build_object('requestKey', p_key, 'kind', 'reply', 'recordedAt', v_now, 'deliveries', v_del,
                              'threadId', t.id, 'throughSequence', NULL, 'noticeId', NULL, 'version', NULL);

  ELSIF v_kind = 'read_thread' THEN
    IF NOT workhub_private.p2_exact(c, ARRAY['kind','threadId','throughSequence']) OR NOT workhub_private.p3_id(c -> 'threadId')
       OR NOT workhub_private.p2_int(c -> 'throughSequence', 0, 2147483647) THEN
      RAISE EXCEPTION 'INVALID_INPUT';
    END IF;
    SELECT tm.* INTO me FROM workhub.message_thread_members tm JOIN workhub.message_threads t0 ON t0.id = tm.thread_id
     WHERE t0.school_id = p_ctx.school_id AND t0.id = c ->> 'threadId' AND tm.membership_id = p_ctx.membership_id FOR UPDATE OF tm;
    IF me.thread_id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
    v_through := (c ->> 'throughSequence')::integer;
    IF v_through > (SELECT latest_sequence FROM workhub.message_threads WHERE id = me.thread_id) THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
    -- 단조 증가: 이전 창의 낮은 순번으로 내려가지 않는다(요청 순번은 접수증에 그대로 남긴다)
    IF v_through > me.read_sequence THEN
      UPDATE workhub.message_thread_members SET read_sequence = v_through, read_updated_at = clock_timestamp()
       WHERE thread_id = me.thread_id AND membership_id = me.membership_id;
    END IF;
    RETURN jsonb_build_object('requestKey', p_key, 'kind', 'read_thread', 'recordedAt', v_now, 'deliveries', '[]'::jsonb,
                              'threadId', me.thread_id, 'throughSequence', v_through, 'noticeId', NULL, 'version', NULL);

  ELSIF v_kind = 'read_notice' THEN
    IF NOT workhub_private.p2_exact(c, ARRAY['kind','noticeId','expectedVersion']) OR NOT workhub_private.p3_id(c -> 'noticeId')
       OR NOT workhub_private.p2_int(c -> 'expectedVersion', 1, 2147483647) THEN
      RAISE EXCEPTION 'INVALID_INPUT';
    END IF;
    SELECT * INTO n FROM workhub.notifications
     WHERE school_id = p_ctx.school_id AND id = c ->> 'noticeId' AND owner_membership_id = p_ctx.membership_id FOR UPDATE;
    IF n.id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
    IF n.read_at IS NULL THEN
      IF n.version <> (c ->> 'expectedVersion')::integer THEN RAISE EXCEPTION 'CONFLICT'; END IF;
      UPDATE workhub.notifications SET read_at = clock_timestamp(), version = version + 1 WHERE id = n.id RETURNING * INTO n;
    ELSIF n.version < (c ->> 'expectedVersion')::integer THEN
      RAISE EXCEPTION 'CONFLICT';
    END IF;
    -- 알림 읽음은 원본(제출·검토·업무 완료)을 바꾸지 않는다
    RETURN jsonb_build_object('requestKey', p_key, 'kind', 'read_notice', 'recordedAt', v_now, 'deliveries', '[]'::jsonb,
                              'threadId', NULL, 'throughSequence', NULL, 'noticeId', n.id, 'version', n.version);
  END IF;
  RAISE EXCEPTION 'INVALID_INPUT';
END $$;

-- ----------------------------------------------------------------------------
-- 4. 첨부 파일
-- ----------------------------------------------------------------------------
CREATE FUNCTION workhub_private.p3_file_readiness(p_ctx workhub_private.actor_context) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_reason text := workhub_private.p3_files_reason(p_ctx.school_id);
BEGIN
  RETURN jsonb_build_object('available', v_reason = 'ready', 'reason', v_reason,
    'policy', CASE WHEN v_reason = 'ready' THEN workhub_private.p3_file_policy(p_ctx.school_id) ELSE NULL END);
END $$;

CREATE FUNCTION workhub_private.p3_intent(f workhub.message_files) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT jsonb_build_object('fileId', f.id, 'bucket', 'workhub-message-files', 'path', f.storage_path,
                            'expiresAt', workhub_private.p3_ts(f.upload_expires_at), 'state', f.state)
$$;

-- 업로드 예약: 같은 번호·같은 신고값이면 같은 예약. 다른 신고값 → IDEMPOTENCY_CONFLICT. replay_only 는 기존 예약만 찾는다.
CREATE FUNCTION workhub_private.p3_prepare(p_ctx workhub_private.actor_context, p_file jsonb, p_key text, p_replay boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_hash text; q workhub.message_file_requests; f workhub.message_files; fp workhub.message_file_policies; v_id text := gen_random_uuid()::text;
BEGIN
  IF NOT workhub_private.p3_key(p_key) OR p_replay IS NULL
     OR NOT workhub_private.p2_exact(p_file, ARRAY['name','claimedBytes','claimedSha256']) OR NOT workhub_private.p3_file_name(p_file -> 'name')
     OR NOT workhub_private.p2_int(p_file -> 'claimedBytes', 1, 31457280)
     OR jsonb_typeof(p_file -> 'claimedSha256') IS DISTINCT FROM 'string' OR p_file ->> 'claimedSha256' !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'INVALID_INPUT';
  END IF;
  v_hash := workhub_private.p2_sha(p_file);
  PERFORM workhub_private.p3_lock(p_ctx, 'prepare', p_key);
  SELECT * INTO q FROM workhub.message_file_requests
   WHERE school_id = p_ctx.school_id AND membership_id = p_ctx.membership_id AND action = 'prepare' AND request_key = p_key;
  IF q.file_id IS NOT NULL THEN
    IF q.payload_hash <> v_hash THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT'; END IF;
    SELECT * INTO f FROM workhub.message_files WHERE school_id = p_ctx.school_id AND id = q.file_id;
    -- 거절·기한 만료로 끝난 예약은 예약 응답(state 3종)으로 표현할 수 없다 → CONFLICT. 상태는 status 로 본다.
    IF workhub_private.p3_file_status(f) ->> 'state' = 'rejected' THEN RAISE EXCEPTION 'CONFLICT'; END IF;
    RETURN workhub_private.p3_intent(f);
  END IF;
  IF p_replay THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF workhub_private.p3_files_reason(p_ctx.school_id) <> 'ready' THEN RAISE EXCEPTION 'NOT_READY'; END IF;
  SELECT * INTO fp FROM workhub.message_file_policies WHERE school_id = p_ctx.school_id;
  IF (p_file ->> 'claimedBytes')::bigint > fp.max_file_bytes THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  INSERT INTO workhub.message_files (id, school_id, owner_membership_id, owner_account_id, name, claimed_bytes, claimed_sha256, storage_path, upload_expires_at)
  VALUES (v_id, p_ctx.school_id, p_ctx.membership_id, p_ctx.account_id, p_file ->> 'name', (p_file ->> 'claimedBytes')::bigint, p_file ->> 'claimedSha256',
          p_ctx.school_id || '/' || p_ctx.membership_id || '/' || v_id || '/original.hwpx', clock_timestamp() + interval '30 minutes')
  RETURNING * INTO f;
  INSERT INTO workhub.message_file_requests (school_id, membership_id, account_id, action, request_key, payload_hash, file_id)
  VALUES (p_ctx.school_id, p_ctx.membership_id, p_ctx.account_id, 'prepare', p_key, v_hash, f.id);
  PERFORM workhub_private.write_audit(p_ctx, 'message_file.prepare', 'message_file', f.id, f.version, 'owner_only', p_key, '{}'::jsonb);
  RETURN workhub_private.p3_intent(f);
END $$;

-- 업로드 확인: 매번 다시 본다. 실물이 없으면 awaiting_upload(성공으로 고정하지 않음), 있으면 object id 를 고정하고 pending_basic.
CREATE FUNCTION workhub_private.p3_complete(p_ctx workhub_private.actor_context, p_file text, p_key text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE q workhub.message_file_requests; f workhub.message_files; o jsonb; v_size text;
BEGIN
  IF NOT workhub_private.p3_key(p_key) OR NOT workhub_private.p3_id(to_jsonb(p_file)) THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  PERFORM workhub_private.p3_lock(p_ctx, 'complete', p_key);
  SELECT * INTO q FROM workhub.message_file_requests
   WHERE school_id = p_ctx.school_id AND membership_id = p_ctx.membership_id AND action = 'complete' AND request_key = p_key;
  IF q.file_id IS NOT NULL AND q.file_id <> p_file THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT'; END IF;
  SELECT * INTO f FROM workhub.message_files WHERE school_id = p_ctx.school_id AND id = p_file FOR UPDATE;
  IF f.id IS NULL OR f.owner_membership_id <> p_ctx.membership_id OR f.owner_account_id <> p_ctx.account_id THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF q.file_id IS NULL THEN
    INSERT INTO workhub.message_file_requests (school_id, membership_id, account_id, action, request_key, payload_hash, file_id)
    VALUES (p_ctx.school_id, p_ctx.membership_id, p_ctx.account_id, 'complete', p_key, workhub_private.p2_sha(jsonb_build_object('fileId', f.id)), f.id);
  END IF;
  IF f.state <> 'awaiting_upload' THEN RETURN workhub_private.p3_file_status(f); END IF;
  o := workhub_private.c_object_owner('workhub-message-files', f.storage_path);
  IF o IS NULL THEN
    IF f.upload_expires_at <= clock_timestamp() THEN
      UPDATE workhub.message_files SET state = 'rejected', reject_code = 'upload_expired', version = version + 1, updated_at = clock_timestamp()
       WHERE id = f.id RETURNING * INTO f;
      PERFORM workhub_private.write_audit(p_ctx, 'message_file.reject', 'message_file', f.id, f.version, 'owner_only', p_key,
        jsonb_build_object('reason', f.reject_code));
    END IF;
    RETURN workhub_private.p3_file_status(f);
  END IF;
  IF workhub_private.p3_files_reason(p_ctx.school_id) <> 'ready' THEN RAISE EXCEPTION 'NOT_READY'; END IF;
  -- 실물 주인이 예약한 사람이 아니거나, Storage 가 기록한 크기가 신고값과 다르면 실물 자체가 다르다 → 거절로 고정
  SELECT s.metadata ->> 'size' INTO v_size FROM storage.objects s WHERE s.id = (o ->> 'id')::uuid;
  IF o ->> 'owner' IS DISTINCT FROM p_ctx.auth_user_id::text OR (v_size ~ '^[0-9]{1,18}$' AND v_size::bigint <> f.claimed_bytes) THEN
    UPDATE workhub.message_files SET state = 'rejected', storage_object_id = (o ->> 'id')::uuid,
           reject_code = CASE WHEN o ->> 'owner' IS DISTINCT FROM p_ctx.auth_user_id::text THEN 'object_owner_mismatch' ELSE 'object_size_mismatch' END,
           version = version + 1, updated_at = clock_timestamp()
     WHERE id = f.id RETURNING * INTO f;
  ELSE
    UPDATE workhub.message_files SET state = 'pending_basic', storage_object_id = (o ->> 'id')::uuid, version = version + 1, updated_at = clock_timestamp()
     WHERE id = f.id RETURNING * INTO f;
  END IF;
  PERFORM workhub_private.write_audit(p_ctx, 'message_file.complete', 'message_file', f.id, f.version, 'owner_only', p_key,
    jsonb_build_object('state', f.state, 'reason', f.reject_code));
  RETURN workhub_private.p3_file_status(f);
END $$;

CREATE FUNCTION workhub_private.p3_status(p_ctx workhub_private.actor_context, p_file text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE f workhub.message_files;
BEGIN
  IF NOT workhub_private.p3_id(to_jsonb(p_file)) THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  SELECT * INTO f FROM workhub.message_files WHERE school_id = p_ctx.school_id AND id = p_file;
  IF f.id IS NULL OR f.owner_membership_id <> p_ctx.membership_id OR f.owner_account_id <> p_ctx.account_id THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  RETURN workhub_private.p3_file_status(f);
END $$;

-- 내려받기 위치: 내가 참여한 대화의 그 메시지에 실제로 붙은 ready 파일만. URL 을 만들지 않는다(앱이 SDK 로 받는다).
CREATE FUNCTION workhub_private.p3_access(p_ctx workhub_private.actor_context, p_thread text, p_message text, p_file text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE f workhub.message_files; o jsonb;
BEGIN
  IF NOT workhub_private.p3_id(to_jsonb(p_thread)) OR NOT workhub_private.p3_id(to_jsonb(p_message)) OR NOT workhub_private.p3_id(to_jsonb(p_file)) THEN
    RAISE EXCEPTION 'INVALID_INPUT';
  END IF;
  IF workhub_private.p3_files_reason(p_ctx.school_id) <> 'ready' THEN RAISE EXCEPTION 'NOT_READY'; END IF;
  SELECT fl.* INTO f FROM workhub.message_files fl
    JOIN workhub.message_attachments ma ON ma.file_id = fl.id
    JOIN workhub.messages x ON x.id = ma.message_id
    JOIN workhub.message_thread_members me ON me.thread_id = x.thread_id AND me.membership_id = p_ctx.membership_id
   WHERE fl.school_id = p_ctx.school_id AND fl.id = p_file AND x.id = p_message AND x.thread_id = p_thread AND x.school_id = p_ctx.school_id;
  IF f.id IS NULL OR f.state <> 'ready' THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  o := workhub_private.c_object_owner('workhub-message-files', f.storage_path);
  IF o IS NULL OR (o ->> 'id')::uuid IS DISTINCT FROM f.storage_object_id THEN RAISE EXCEPTION 'CONFLICT'; END IF;
  RETURN jsonb_build_object('threadId', p_thread, 'messageId', p_message, 'file', workhub_private.p3_attachment(f),
    'bucket', 'workhub-message-files', 'path', f.storage_path, 'ownerMemberId', f.owner_membership_id, 'storageObjectId', f.storage_object_id::text);
END $$;

-- 서버 확인 API 의 요청 번호 = 공개 complete 의 요청 번호. 그 번호가 이 파일에 묶여 있어야 한다.
CREATE FUNCTION workhub_private.p3_bound_file(p_ctx workhub_private.actor_context, p_file text, p_key text) RETURNS workhub.message_files
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE q workhub.message_file_requests; f workhub.message_files;
BEGIN
  IF NOT workhub_private.p3_key(p_key) OR NOT workhub_private.p3_id(to_jsonb(p_file)) THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  SELECT * INTO q FROM workhub.message_file_requests
   WHERE school_id = p_ctx.school_id AND membership_id = p_ctx.membership_id AND action = 'complete' AND request_key = p_key;
  IF q.file_id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF q.file_id <> p_file THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT'; END IF;
  SELECT * INTO f FROM workhub.message_files WHERE school_id = p_ctx.school_id AND id = p_file FOR UPDATE;
  IF f.id IS NULL OR f.owner_membership_id <> p_ctx.membership_id OR f.owner_account_id <> p_ctx.account_id THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  RETURN f;
END $$;

CREATE FUNCTION workhub_private.p3_close(p_ctx workhub_private.actor_context, f workhub.message_files, p_key text, p_reason text)
RETURNS workhub.message_files
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  UPDATE workhub.message_files SET state = 'rejected', reject_code = p_reason, version = version + 1, updated_at = clock_timestamp()
   WHERE id = f.id RETURNING * INTO f;
  UPDATE workhub.message_file_leases SET state = 'expired', closed_at = clock_timestamp() WHERE file_id = f.id AND state = 'issued';
  PERFORM workhub_private.write_audit(p_ctx, 'message_file.basic_check', 'message_file', f.id, f.version, 'owner_only', p_key,
    jsonb_build_object('outcome', 'rejected', 'reason', p_reason));
  RETURN f;
END $$;

-- 기본 확인 인수(claim) — data 는 FileStatus(pending_basic·ready·rejected) · {checking, leaseToken:null} · 새 임대 중 하나
CREATE FUNCTION workhub_private.p3_claim(p_ctx workhub_private.actor_context, p_file text, p_key text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE f workhub.message_files; l workhub.message_file_leases; o jsonb; v_size text; v_token text; fp workhub.message_file_policies;
BEGIN
  f := workhub_private.p3_bound_file(p_ctx, p_file, p_key);
  IF f.state IN ('ready','rejected') THEN RETURN workhub_private.p3_file_status(f); END IF;
  IF f.state = 'awaiting_upload' THEN RAISE EXCEPTION 'CONFLICT'; END IF;
  IF workhub_private.p3_files_reason(p_ctx.school_id) <> 'ready' THEN RAISE EXCEPTION 'NOT_READY'; END IF;
  SELECT * INTO l FROM workhub.message_file_leases WHERE file_id = f.id AND state = 'issued' FOR UPDATE;
  IF l.id IS NOT NULL AND l.expires_at > clock_timestamp() THEN
    RETURN jsonb_build_object('fileId', f.id, 'state', 'checking', 'leaseToken', NULL);
  END IF;
  IF l.id IS NOT NULL THEN
    UPDATE workhub.message_file_leases SET state = 'expired', closed_at = clock_timestamp() WHERE id = l.id;
  END IF;
  -- 실물 정체성: complete 때 고정한 object id · 올린 사람이 그대로여야 한다(덮어쓰기·삭제 감지)
  o := workhub_private.c_object_owner('workhub-message-files', f.storage_path);
  IF o IS NULL OR (o ->> 'id')::uuid IS DISTINCT FROM f.storage_object_id OR o ->> 'owner' IS DISTINCT FROM p_ctx.auth_user_id::text THEN
    RETURN workhub_private.p3_file_status(workhub_private.p3_close(p_ctx, f, p_key, CASE WHEN o IS NULL THEN 'object_missing' ELSE 'object_changed' END));
  END IF;
  SELECT s.metadata ->> 'size' INTO v_size FROM storage.objects s WHERE s.id = f.storage_object_id;
  IF v_size ~ '^[0-9]{1,18}$' AND v_size::bigint <> f.claimed_bytes THEN
    RETURN workhub_private.p3_file_status(workhub_private.p3_close(p_ctx, f, p_key, 'object_size_mismatch'));
  END IF;
  -- 반복 호출 상한(실물 내려받기 증폭 방지): 파일당 10분 6번, 계정당 10분 60번. 넘으면 임대 없이 확인 중 상태를 돌려준다.
  IF (SELECT count(*) FROM workhub.message_file_leases WHERE file_id = f.id AND issued_at > clock_timestamp() - interval '10 minutes') >= 6
     OR (SELECT count(*) FROM workhub.message_file_leases WHERE account_id = p_ctx.account_id AND issued_at > clock_timestamp() - interval '10 minutes') >= 60 THEN
    RETURN workhub_private.p3_file_status(f);
  END IF;
  SELECT * INTO fp FROM workhub.message_file_policies WHERE school_id = p_ctx.school_id;
  v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  INSERT INTO workhub.message_file_leases (school_id, file_id, account_id, membership_id, token_sha256, request_key, expires_at)
  VALUES (f.school_id, f.id, p_ctx.account_id, p_ctx.membership_id, encode(sha256(convert_to(v_token, 'UTF8')), 'hex'), p_key,
          clock_timestamp() + interval '90 seconds')
  RETURNING * INTO l;
  PERFORM workhub_private.write_audit(p_ctx, 'message_file.basic_claim', 'message_file', f.id, f.version, 'owner_only', p_key,
    jsonb_build_object('lease_id', l.id));
  RETURN jsonb_build_object('fileId', f.id, 'state', 'checking', 'leaseToken', v_token, 'leaseExpiresAt', workhub_private.p3_ts(l.expires_at),
    'bucket', 'workhub-message-files', 'path', f.storage_path, 'name', f.name, 'claimedBytes', f.claimed_bytes,
    'claimedSha256', f.claimed_sha256, 'maxFileBytes', least(fp.max_file_bytes, 31457280), 'storageObjectId', f.storage_object_id::text);
END $$;

-- 기본 확인 확정(finish) — 임대·실물·결과 모양을 모두 대조하고 ready/rejected 로 한 번만 확정한다.
--   p_result = {profile:'hwpx_basic_v1', accepted, actualBytes, actualSha256, reasonCode} (다섯 필드 정확히)
--   같은 임대·실물·결과의 재전송 → 같은 상태. 이미 끝난 파일에 다른 결과 → CONFLICT.
CREATE FUNCTION workhub_private.p3_finish(p_ctx workhub_private.actor_context, p_file text, p_key text, p_token text,
  p_object uuid, p_result jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE f workhub.message_files; l workhub.message_file_leases; o jsonb; fp workhub.message_file_policies; v_full text;
  v_ok boolean; v_bytes bigint; v_sha text; v_code text;
BEGIN
  IF p_token IS NULL OR p_token !~ '^[0-9a-f]{64}$' OR p_object IS NULL
     OR NOT workhub_private.p2_exact(p_result, ARRAY['profile','accepted','actualBytes','actualSha256','reasonCode'])
     OR octet_length(p_result::text) > 2048
     OR p_result -> 'profile' IS DISTINCT FROM '"hwpx_basic_v1"'::jsonb OR jsonb_typeof(p_result -> 'accepted') <> 'boolean'
     OR NOT (p_result -> 'actualBytes' = 'null'::jsonb OR workhub_private.p2_int(p_result -> 'actualBytes', 0, 999999999999))
     OR NOT (p_result -> 'actualSha256' = 'null'::jsonb OR (jsonb_typeof(p_result -> 'actualSha256') = 'string' AND p_result ->> 'actualSha256' ~ '^[0-9a-f]{64}$'))
     OR NOT (p_result -> 'reasonCode' = 'null'::jsonb OR (jsonb_typeof(p_result -> 'reasonCode') = 'string' AND p_result ->> 'reasonCode' IN
             ('FILE_SIZE_LIMIT','FILE_SIZE_MISMATCH','FILE_HASH_MISMATCH','FILE_SIGNATURE_MISMATCH','FILE_STRUCTURE_INVALID',
              'FILE_STRUCTURE_UNSUPPORTED','FILE_STRUCTURE_LIMIT','FILE_ENCRYPTED','FILE_HWPX_REQUIRED_PART'))) THEN
    RAISE EXCEPTION 'INVALID_INPUT';
  END IF;
  f := workhub_private.p3_bound_file(p_ctx, p_file, p_key);
  v_ok := (p_result ->> 'accepted')::boolean; v_bytes := (p_result ->> 'actualBytes')::bigint; v_sha := p_result ->> 'actualSha256';
  v_code := p_result ->> 'reasonCode';
  -- 결과의 앞뒤(API 확인 순서: 크기 상한 → 내려받기 → 크기 → 해시 → HWPX 구조)
  IF v_ok AND (v_code IS NOT NULL OR v_bytes IS DISTINCT FROM f.claimed_bytes OR v_sha IS DISTINCT FROM f.claimed_sha256) THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  IF NOT v_ok AND (v_code IS NULL
       OR (v_code = 'FILE_SIZE_LIMIT' AND (v_bytes IS NOT NULL OR v_sha IS NOT NULL))
       OR (v_code <> 'FILE_SIZE_LIMIT' AND (v_bytes IS NULL OR v_sha IS NULL))
       OR (v_code = 'FILE_SIZE_MISMATCH' AND v_bytes = f.claimed_bytes)
       OR (v_code = 'FILE_HASH_MISMATCH' AND (v_bytes <> f.claimed_bytes OR v_sha = f.claimed_sha256))
       OR (v_code NOT IN ('FILE_SIZE_LIMIT','FILE_SIZE_MISMATCH','FILE_HASH_MISMATCH') AND (v_bytes <> f.claimed_bytes OR v_sha <> f.claimed_sha256))) THEN
    RAISE EXCEPTION 'INVALID_INPUT';
  END IF;
  v_full := workhub_private.p2_sha(jsonb_build_object('leaseToken', p_token, 'storageObjectId', p_object::text, 'result', p_result));
  IF f.state IN ('ready','rejected') THEN
    IF f.result_sha256 IS NOT DISTINCT FROM v_full THEN RETURN workhub_private.p3_file_status(f); END IF;
    RAISE EXCEPTION 'CONFLICT';
  END IF;
  IF workhub_private.p3_files_reason(p_ctx.school_id) <> 'ready' THEN RAISE EXCEPTION 'NOT_READY'; END IF;
  SELECT * INTO l FROM workhub.message_file_leases
   WHERE file_id = f.id AND state = 'issued' AND token_sha256 = encode(sha256(convert_to(p_token, 'UTF8')), 'hex') FOR UPDATE;
  IF f.state <> 'pending_basic' OR l.id IS NULL OR l.expires_at <= clock_timestamp() OR l.account_id <> p_ctx.account_id THEN
    RAISE EXCEPTION 'CONFLICT';
  END IF;
  o := workhub_private.c_object_owner('workhub-message-files', f.storage_path);
  IF o IS NULL OR (o ->> 'id')::uuid IS DISTINCT FROM f.storage_object_id OR p_object IS DISTINCT FROM f.storage_object_id
     OR o ->> 'owner' IS DISTINCT FROM p_ctx.auth_user_id::text THEN
    RAISE EXCEPTION 'CONFLICT';
  END IF;
  SELECT * INTO fp FROM workhub.message_file_policies WHERE school_id = p_ctx.school_id;
  -- 확인하는 동안 정책이 줄었으면 ready 로 확정하지 않는다
  IF v_ok AND v_bytes > fp.max_file_bytes THEN RAISE EXCEPTION 'CONFLICT'; END IF;
  UPDATE workhub.message_files SET state = CASE WHEN v_ok THEN 'ready' ELSE 'rejected' END, actual_bytes = v_bytes, actual_sha256 = v_sha,
         reject_code = v_code, result_sha256 = v_full, version = version + 1, updated_at = clock_timestamp()
   WHERE id = f.id RETURNING * INTO f;
  UPDATE workhub.message_file_leases SET state = 'finished', closed_at = clock_timestamp() WHERE id = l.id;
  PERFORM workhub_private.write_audit(p_ctx, 'message_file.basic_check', 'message_file', f.id, f.version, 'owner_only', p_key,
    jsonb_build_object('outcome', f.state, 'reason', v_code, 'lease_id', l.id, 'malware_scan', false));
  RETURN workhub_private.p3_file_status(f);
END $$;

-- ----------------------------------------------------------------------------
-- 5. Storage 정책 판정(버킷 workhub-message-files 전용)
-- ----------------------------------------------------------------------------
-- 업로드: 이 JWT 가 소유한 만료 전 예약(awaiting_upload)의 정확한 경로만, 직접 업로드 요청일 때만, 첨부가 켜진 학교만.
CREATE FUNCTION workhub_storage.message_insertable(p_name text) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_uid uuid := auth.uid(); f workhub.message_files; ctx workhub_private.actor_context;
BEGIN
  IF v_uid IS NULL OR NOT workhub_private.p3_installed() OR workhub_private.c_storage_op() IS DISTINCT FROM 'object.upload' THEN RETURN false; END IF;
  SELECT * INTO f FROM workhub.message_files WHERE storage_path = p_name;
  IF f.id IS NULL OR f.state <> 'awaiting_upload' OR f.upload_expires_at <= clock_timestamp()
     OR NOT EXISTS (SELECT 1 FROM workhub.accounts a WHERE a.id = f.owner_account_id AND a.auth_user_id = v_uid)
     OR workhub_private.p3_files_reason(f.school_id) <> 'ready' THEN
    RETURN false;
  END IF;
  BEGIN
    ctx := workhub_private.member_actor(f.owner_membership_id, false);
  EXCEPTION WHEN raise_exception THEN RETURN false;
  END;
  RETURN ctx.account_id = f.owner_account_id;
END $$;

-- 읽기: (1) 업로드 요청 안의 올린 사람 되읽기 (2) 직접 내려받기 — ready 파일, 실물 id 가 고정값과 같고,
--       올린 사람 본인이거나 그 파일이 붙은 메시지의 대화 참여자이며, 그 소속이 지금 유효할 때만.
CREATE FUNCTION workhub_storage.message_readable(p_name text, p_object uuid) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_uid uuid := auth.uid(); f workhub.message_files; v_op text := workhub_private.c_storage_op(); v_m text; ctx workhub_private.actor_context;
BEGIN
  IF v_uid IS NULL OR NOT workhub_private.p3_installed() OR v_op IS NULL OR v_op NOT IN ('object.upload','object.get_authenticated') THEN RETURN false; END IF;
  SELECT * INTO f FROM workhub.message_files WHERE storage_path = p_name;
  IF f.id IS NULL THEN RETURN false; END IF;
  IF f.state = 'awaiting_upload' THEN RETURN workhub_storage.message_insertable(p_name); END IF;
  IF f.state <> 'ready' OR v_op <> 'object.get_authenticated' OR p_object IS DISTINCT FROM f.storage_object_id
     OR workhub_private.p3_files_reason(f.school_id) <> 'ready' THEN
    RETURN false;
  END IF;
  FOR v_m IN SELECT f.owner_membership_id WHERE EXISTS (SELECT 1 FROM workhub.accounts a WHERE a.id = f.owner_account_id AND a.auth_user_id = v_uid)
             UNION
             SELECT tm.membership_id FROM workhub.message_attachments ma JOIN workhub.messages x ON x.id = ma.message_id
               JOIN workhub.message_thread_members tm ON tm.thread_id = x.thread_id
               JOIN workhub.accounts a ON a.id = tm.account_id
              WHERE ma.file_id = f.id AND a.auth_user_id = v_uid LOOP
    BEGIN
      ctx := workhub_private.member_actor(v_m, false);
    EXCEPTION WHEN raise_exception THEN CONTINUE;
    END;
    IF ctx.school_id = f.school_id THEN RETURN true; END IF;
  END LOOP;
  RETURN false;
END $$;

-- ----------------------------------------------------------------------------
-- 6. 공개 함수 13개. 소속 gate 실패는 R0·R1 과 같이 예외(봉투 없음), 그 뒤 업무 오류는 봉투로(하위 트랜잭션 → 변경 전부 되돌림).
-- ----------------------------------------------------------------------------
CREATE FUNCTION public.workhub_messaging_readiness(p_member_id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE ctx workhub_private.actor_context;
BEGIN
  ctx := workhub_private.member_actor(p_member_id, false);
  RETURN workhub_private.p3_ok(ctx, workhub_private.p3_readiness(ctx));
END $$;

CREATE FUNCTION public.workhub_message_recipients(p_member_id text, p_query text, p_cursor text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE ctx workhub_private.actor_context;
BEGIN
  ctx := workhub_private.member_actor(p_member_id, false);
  BEGIN
    RETURN workhub_private.p3_ok(ctx, workhub_private.p3_recipients(ctx, p_query, p_cursor));
  EXCEPTION WHEN raise_exception THEN
    IF workhub_private.p3_business(SQLERRM) THEN RETURN workhub_private.p3_err(ctx, SQLERRM); END IF;
    RAISE;
  END;
END $$;

CREATE FUNCTION public.workhub_message_threads(p_member_id text, p_query text, p_unread_only boolean, p_cursor text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE ctx workhub_private.actor_context;
BEGIN
  ctx := workhub_private.member_actor(p_member_id, false);
  BEGIN
    RETURN workhub_private.p3_ok(ctx, workhub_private.p3_threads(ctx, p_query, p_unread_only, p_cursor));
  EXCEPTION WHEN raise_exception THEN
    IF workhub_private.p3_business(SQLERRM) THEN RETURN workhub_private.p3_err(ctx, SQLERRM); END IF;
    RAISE;
  END;
END $$;

CREATE FUNCTION public.workhub_message_get(p_member_id text, p_thread_id text, p_before_cursor text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE ctx workhub_private.actor_context;
BEGIN
  ctx := workhub_private.member_actor(p_member_id, false);
  BEGIN
    RETURN workhub_private.p3_ok(ctx, workhub_private.p3_get(ctx, p_thread_id, p_before_cursor));
  EXCEPTION WHEN raise_exception THEN
    IF workhub_private.p3_business(SQLERRM) THEN RETURN workhub_private.p3_err(ctx, SQLERRM); END IF;
    RAISE;
  END;
END $$;

CREATE FUNCTION public.workhub_inbox_list(p_member_id text, p_unread_only boolean, p_cursor text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE ctx workhub_private.actor_context;
BEGIN
  ctx := workhub_private.member_actor(p_member_id, false);
  BEGIN
    RETURN workhub_private.p3_ok(ctx, workhub_private.p3_inbox(ctx, p_unread_only, p_cursor));
  EXCEPTION WHEN raise_exception THEN
    IF workhub_private.p3_business(SQLERRM) THEN RETURN workhub_private.p3_err(ctx, SQLERRM); END IF;
    RAISE;
  END;
END $$;

-- 쓰기: 승인된 현재 사용자 확인 → 기존 원장 확인(같은 키·같은 내용은 처음 접수증, 다른 내용은 IDEMPOTENCY_CONFLICT)
--       → (replay_only 면 여기서 끝: 없으면 NOT_FOUND) → 준비 상태·입력·판 검증 → 원자 변경 + 원장 기록.
CREATE FUNCTION public.workhub_message_mutate(p_member_id text, p_command jsonb, p_request_key text, p_replay_only boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE ctx workhub_private.actor_context; v_hash text; r workhub.message_requests; v_data jsonb;
BEGIN
  ctx := workhub_private.member_actor(p_member_id, true);
  PERFORM workhub_private.lock_member_roles(ctx);
  IF NOT workhub_private.p3_installed() THEN RETURN workhub_private.p3_err(ctx, 'NOT_READY'); END IF;
  IF NOT workhub_private.p3_key(p_request_key) OR p_replay_only IS NULL OR p_command IS NULL OR jsonb_typeof(p_command) <> 'object'
     OR octet_length(p_command::text) > 400000 OR jsonb_typeof(p_command -> 'kind') IS DISTINCT FROM 'string'
     OR p_command ->> 'kind' NOT IN ('start','reply','read_thread','read_notice') THEN
    RETURN workhub_private.p3_err(ctx, 'INVALID_INPUT');
  END IF;
  v_hash := workhub_private.p2_sha(p_command);
  PERFORM workhub_private.p3_lock(ctx, 'mutate', p_request_key);
  SELECT * INTO r FROM workhub.message_requests WHERE school_id = ctx.school_id AND membership_id = ctx.membership_id AND request_key = p_request_key;
  IF r.request_key IS NOT NULL THEN
    IF r.payload_hash <> v_hash OR r.account_id <> ctx.account_id THEN RETURN workhub_private.p3_err(ctx, 'IDEMPOTENCY_CONFLICT'); END IF;
    RETURN workhub_private.p3_ok(ctx, r.response);
  END IF;
  IF p_replay_only THEN RETURN workhub_private.p3_err(ctx, 'NOT_FOUND'); END IF;
  IF workhub_private.p3_messaging_reason(ctx.school_id) <> 'ready' THEN RETURN workhub_private.p3_err(ctx, 'NOT_READY'); END IF;
  BEGIN
    v_data := workhub_private.p3_apply(ctx, p_command, p_request_key);
    INSERT INTO workhub.message_requests (school_id, membership_id, account_id, request_key, command_kind, payload_hash, response)
    VALUES (ctx.school_id, ctx.membership_id, ctx.account_id, p_request_key, p_command ->> 'kind', v_hash, v_data);
    RETURN workhub_private.p3_ok(ctx, v_data);
  EXCEPTION WHEN raise_exception THEN
    IF workhub_private.p3_business(SQLERRM) THEN RETURN workhub_private.p3_err(ctx, SQLERRM); END IF;
    RAISE;
  END;
END $$;

CREATE FUNCTION public.workhub_message_file_readiness(p_member_id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE ctx workhub_private.actor_context;
BEGIN
  ctx := workhub_private.member_actor(p_member_id, false);
  RETURN workhub_private.p3_ok(ctx, workhub_private.p3_file_readiness(ctx));
END $$;

CREATE FUNCTION public.workhub_message_file_prepare(p_member_id text, p_file jsonb, p_request_key text, p_replay_only boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE ctx workhub_private.actor_context;
BEGIN
  ctx := workhub_private.member_actor(p_member_id, true);
  PERFORM workhub_private.lock_member_roles(ctx);
  BEGIN
    RETURN workhub_private.p3_ok(ctx, workhub_private.p3_prepare(ctx, p_file, p_request_key, p_replay_only));
  EXCEPTION WHEN raise_exception THEN
    IF workhub_private.p3_business(SQLERRM) THEN RETURN workhub_private.p3_err(ctx, SQLERRM); END IF;
    RAISE;
  END;
END $$;

CREATE FUNCTION public.workhub_message_file_complete(p_member_id text, p_file_id text, p_request_key text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE ctx workhub_private.actor_context;
BEGIN
  ctx := workhub_private.member_actor(p_member_id, true);
  PERFORM workhub_private.lock_member_roles(ctx);
  BEGIN
    RETURN workhub_private.p3_ok(ctx, workhub_private.p3_complete(ctx, p_file_id, p_request_key));
  EXCEPTION WHEN raise_exception THEN
    IF workhub_private.p3_business(SQLERRM) THEN RETURN workhub_private.p3_err(ctx, SQLERRM); END IF;
    RAISE;
  END;
END $$;

CREATE FUNCTION public.workhub_message_file_status(p_member_id text, p_file_id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE ctx workhub_private.actor_context;
BEGIN
  ctx := workhub_private.member_actor(p_member_id, false);
  BEGIN
    RETURN workhub_private.p3_ok(ctx, workhub_private.p3_status(ctx, p_file_id));
  EXCEPTION WHEN raise_exception THEN
    IF workhub_private.p3_business(SQLERRM) THEN RETURN workhub_private.p3_err(ctx, SQLERRM); END IF;
    RAISE;
  END;
END $$;

CREATE FUNCTION public.workhub_message_file_access(p_member_id text, p_thread_id text, p_message_id text, p_file_id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE ctx workhub_private.actor_context;
BEGIN
  ctx := workhub_private.member_actor(p_member_id, false);
  BEGIN
    RETURN workhub_private.p3_ok(ctx, workhub_private.p3_access(ctx, p_thread_id, p_message_id, p_file_id));
  EXCEPTION WHEN raise_exception THEN
    IF workhub_private.p3_business(SQLERRM) THEN RETURN workhub_private.p3_err(ctx, SQLERRM); END IF;
    RAISE;
  END;
END $$;

CREATE FUNCTION public.workhub_message_file_basic_claim(p_actor_user_id uuid, p_member_id text, p_file_id text, p_request_key text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE ctx workhub_private.actor_context;
BEGIN
  ctx := workhub_private.p3_service_member(p_actor_user_id, p_member_id);
  IF NOT workhub_private.p3_installed() THEN RETURN workhub_private.p3_err(ctx, 'NOT_READY'); END IF;
  BEGIN
    RETURN workhub_private.p3_ok(ctx, workhub_private.p3_claim(ctx, p_file_id, p_request_key));
  EXCEPTION WHEN raise_exception THEN
    IF workhub_private.p3_business(SQLERRM) THEN RETURN workhub_private.p3_err(ctx, SQLERRM); END IF;
    RAISE;
  END;
END $$;

CREATE FUNCTION public.workhub_message_file_basic_finish(p_actor_user_id uuid, p_member_id text, p_file_id text, p_request_key text,
  p_lease_token text, p_storage_object_id uuid, p_result jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE ctx workhub_private.actor_context;
BEGIN
  ctx := workhub_private.p3_service_member(p_actor_user_id, p_member_id);
  IF NOT workhub_private.p3_installed() THEN RETURN workhub_private.p3_err(ctx, 'NOT_READY'); END IF;
  BEGIN
    RETURN workhub_private.p3_ok(ctx, workhub_private.p3_finish(ctx, p_file_id, p_request_key, p_lease_token, p_storage_object_id, p_result));
  EXCEPTION WHEN raise_exception THEN
    IF workhub_private.p3_business(SQLERRM) THEN RETURN workhub_private.p3_err(ctx, SQLERRM); END IF;
    RAISE;
  END;
END $$;

COMMENT ON FUNCTION public.workhub_messaging_readiness(text) IS '업무실 P3 메시지: 준비 상태·학교 정책 한도. 고정값 아님.';
COMMENT ON FUNCTION public.workhub_message_mutate(text, jsonb, text, boolean) IS '업무실 P3 메시지: start·reply·read_thread·read_notice(요청 번호 원장·한 트랜잭션).';
COMMENT ON FUNCTION public.workhub_message_file_basic_claim(uuid, text, text, text) IS '업무실 P3 서버 확인 API 전용(service_role): 메시지 첨부 기본 확인 임대.';
COMMENT ON FUNCTION public.workhub_message_file_basic_finish(uuid, text, text, text, text, uuid, jsonb) IS '업무실 P3 서버 확인 API 전용(service_role): 메시지 첨부 기본 확인 확정.';

-- ----------------------------------------------------------------------------
-- 7. 비공개 버킷 · Storage 정책 2개(이 버킷에만). UPDATE·DELETE 정책 없음 → 덮어쓰기·사용자 삭제 불가.
-- ----------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public) VALUES ('workhub-message-files', 'workhub-message-files', false);
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'storage' AND table_name = 'buckets' AND column_name = 'file_size_limit') THEN
    EXECUTE 'UPDATE storage.buckets SET file_size_limit = 31457280 WHERE id = ''workhub-message-files''';
  END IF;
END $$;
CREATE POLICY workhub_message_files_insert ON storage.objects AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'workhub-message-files' AND workhub_storage.message_insertable(name));
CREATE POLICY workhub_message_files_select ON storage.objects AS PERMISSIVE FOR SELECT TO authenticated
  USING (bucket_id = 'workhub-message-files' AND workhub_storage.message_readable(name, id));
INSERT INTO workhub_private.p3_storage_policies (policy_name, cmd, expr_md5)
SELECT pol.polname, pol.polcmd,
       md5(COALESCE(pg_get_expr(pol.polqual, pol.polrelid), '') || '|' || COALESCE(pg_get_expr(pol.polwithcheck, pol.polrelid), ''))
  FROM pg_policy pol WHERE pol.polrelid = 'storage.objects'::regclass AND pol.polname IN ('workhub_message_files_insert','workhub_message_files_select');

-- ----------------------------------------------------------------------------
-- 8. 권한 — 앱 함수 11개 authenticated, 서버 확인 함수 2개 service_role 만. 새 내부 함수는 API 역할에 0.
-- ----------------------------------------------------------------------------
DO $$
DECLARE f text;
BEGIN
  FOR f IN SELECT p.oid::regprocedure::text FROM pg_proc p
            WHERE (p.pronamespace = 'workhub_private'::regnamespace AND p.proname LIKE 'p3\_%')
               OR (p.pronamespace = 'public'::regnamespace AND (p.proname LIKE 'workhub\_messag%' OR p.proname = 'workhub_inbox_list'))
               OR (p.pronamespace = 'workhub_storage'::regnamespace AND p.proname LIKE 'message\_%') LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated, service_role', f);
  END LOOP;
END $$;
GRANT EXECUTE ON FUNCTION public.workhub_messaging_readiness(text), public.workhub_message_recipients(text, text, text),
  public.workhub_message_threads(text, text, boolean, text), public.workhub_message_get(text, text, text),
  public.workhub_inbox_list(text, boolean, text), public.workhub_message_mutate(text, jsonb, text, boolean),
  public.workhub_message_file_readiness(text), public.workhub_message_file_prepare(text, jsonb, text, boolean),
  public.workhub_message_file_complete(text, text, text), public.workhub_message_file_status(text, text),
  public.workhub_message_file_access(text, text, text, text)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.workhub_message_file_basic_claim(uuid, text, text, text),
  public.workhub_message_file_basic_finish(uuid, text, text, text, text, uuid, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION workhub_storage.message_insertable(text), workhub_storage.message_readable(text, uuid) TO authenticated;

INSERT INTO workhub_private.p3_installs (batch, release) VALUES ('P3-02', '2026-10-16.1');
COMMIT;

-- ----------------------------------------------------------------------------
-- 9. 검증 — 모든 행의 status 가 ok 여야 한다. P3-02-5 는 "준비 안 됨"이 정상이다(P3-04·05 전).
-- ----------------------------------------------------------------------------
WITH app(f) AS (VALUES ('public.workhub_messaging_readiness(text)'),('public.workhub_message_recipients(text,text,text)'),
  ('public.workhub_message_threads(text,text,boolean,text)'),('public.workhub_message_get(text,text,text)'),('public.workhub_inbox_list(text,boolean,text)'),
  ('public.workhub_message_mutate(text,jsonb,text,boolean)'),('public.workhub_message_file_readiness(text)'),
  ('public.workhub_message_file_prepare(text,jsonb,text,boolean)'),('public.workhub_message_file_complete(text,text,text)'),
  ('public.workhub_message_file_status(text,text)'),('public.workhub_message_file_access(text,text,text,text)')),
svc(f) AS (VALUES ('public.workhub_message_file_basic_claim(uuid,text,text,text)'),('public.workhub_message_file_basic_finish(uuid,text,text,text,text,uuid,jsonb)'))
SELECT 'P3-02-1' AS no, '앱 함수 11개: authenticated 만 실행(anon·service_role 불가), SECURITY DEFINER·search_path 고정' AS item,
       CASE WHEN count(*) = 11 AND bool_and(p.prosecdef AND p.proconfig @> ARRAY['search_path=""'] AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
                 AND NOT has_function_privilege('anon', p.oid, 'EXECUTE') AND NOT has_function_privilege('service_role', p.oid, 'EXECUTE')) THEN 'ok' ELSE 'FAIL' END AS status,
       count(*)::text AS value
FROM app JOIN pg_proc p ON p.oid = to_regprocedure(app.f)
UNION ALL
SELECT 'P3-02-2', '서버 확인 함수 2개: service_role 만 실행(authenticated·anon 불가)',
       CASE WHEN count(*) = 2 AND bool_and(p.prosecdef AND has_function_privilege('service_role', p.oid, 'EXECUTE')
                 AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE') AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')) THEN 'ok' ELSE 'FAIL' END,
       count(*)::text
FROM svc JOIN pg_proc p ON p.oid = to_regprocedure(svc.f)
UNION ALL
SELECT 'P3-02-3', '비공개 버킷 workhub-message-files · 정책 2개(INSERT·SELECT, 이 버킷 한정)',
       CASE WHEN EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'workhub-message-files' AND public IS FALSE)
             AND (SELECT count(*) FROM pg_policy WHERE polrelid = 'storage.objects'::regclass AND polname LIKE 'workhub\_message%') = 2
             AND (SELECT count(*) FROM workhub_private.p3_storage_policies) = 2 THEN 'ok' ELSE 'FAIL' END, ''
UNION ALL
SELECT 'P3-02-4', '내부 함수 EXECUTE 를 가진 API 역할 0', CASE WHEN count(*) = 0 THEN 'ok' ELSE 'FAIL' END, count(*)::text
FROM pg_proc p, unnest(ARRAY['anon','authenticated','service_role']) r
WHERE p.pronamespace = 'workhub_private'::regnamespace AND p.proname LIKE 'p3\_%' AND has_function_privilege(r, p.oid, 'EXECUTE')
UNION ALL
SELECT 'P3-02-5', '아직 어느 학교도 켜지 않음(메시지·첨부 활성화 0, 정책 0)',
       CASE WHEN (SELECT count(*) FROM workhub.module_activations WHERE module IN ('messaging','message_files')) = 0
             AND (SELECT count(*) FROM workhub.messaging_policies) = 0 AND (SELECT count(*) FROM workhub.message_file_policies) = 0 THEN 'ok' ELSE 'FAIL' END, ''
UNION ALL
SELECT 'P3-02-6', '적용 기록 P3-01·02', CASE WHEN workhub_private.p3_installed() THEN 'ok' ELSE 'FAIL' END, ''
ORDER BY 1;
