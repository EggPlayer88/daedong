-- ============================================================================
-- P6-04  Claude 비서 켜기 · 이용 설정 새 판 — 학교 1곳. 별도 승인 뒤에만.
--
-- ▣ 언제: PR #48(앱 · 서버 API) 병합·배포 뒤, 서버 환경 변수(ANTHROPIC_API_KEY · SUPABASE_SERVICE_ROLE_KEY)가 들어간 것을
--   확인하고, 학교가 모델 · 가격 · 한도를 승인했을 때. P6-01·02 적용과 같은 날 실행하지 않는다.
-- ▣ 아래 $json$ 의 <...> 칸을 모두 채워야 실행된다. 칸이 남아 있으면 아무것도 쓰지 않고 멈춘다. 예시값을 넣어 두지 않았다.
--   approver_user_id   : 승인한 학교 관리자(school_admin)의 회원 id(Auth UID). 대상 학교 = 그 사람이 지금 관리자인 학교 1곳.
--   approval_ref       : 승인 근거 1~200자 (날짜·회의·결정 내용)
--   verification_ref   : 배포 확인 근거 1~200자 (서버 API 배포 · 키 설정을 누가 언제 확인했는지. 키 값은 적지 않는다)
--   allowed_members    : 쓸 수 있는 사람. all_members(업무실 사용자 모두 — 지금은 superadmin 공개 대상) · school_admin(학교 관리자만)
--   model              : 모델 ID (예시를 두지 않는다. 승인된 이름 그대로)
--   price_table_ref    : 가격 근거 1~200자 (가격표 주소·확인 날짜)
--   input_price_micro_usd_per_mtok  : 입력 100만 토큰당 가격, micro USD 정수 (1 USD = 1,000,000)
--   output_price_micro_usd_per_mtok : 출력 100만 토큰당 가격, micro USD 정수
--   max_input_tokens   : 한 번 요청의 입력 토큰 예약 기준(정수). 예약액 계산에 쓴다(실제 입력이 더 크면 실사용으로 정산된다 — 실행안내 6절)
--   max_output_tokens  : 한 번 답의 최대 출력 토큰(정수). 서버가 모델에 max_tokens 로 보낸다
--   member_daily_micro_usd · member_monthly_micro_usd : 한 사람의 하루 · 한 달 한도(micro USD 정수)
--   school_daily_micro_usd · school_monthly_micro_usd : 학교 전체의 하루 · 한 달 한도(micro USD 정수)
--   숫자 칸은 따옴표 없이 정수로 적는다(예: "max_output_tokens": 0 자리에 승인된 수).
-- ▣ 1회 예약액 = ceil((입력 상한 × 입력 가격 + 출력 상한 × 출력 가격) / 1,000,000). 이 값이 사람 하루 한도보다 크면 멈춘다.
--   한도 순서: 예약액 ≤ 사람 하루 ≤ 사람 한 달 ≤ 학교 한 달, 사람 하루 ≤ 학교 하루 ≤ 학교 한 달.
-- ▣ 쓰는 것: 처음이면 module_activations 의 assistant 1행 + 설정 1판 + 감사 1건. 이미 켜져 있으면 설정 새 판 1행 + 감사 1건
--   (예산 · 모델 · 가격을 바꿀 때. 그 뒤 새 요청부터 새 판. 이미 예약한 요청은 예약 당시 판으로 정산). 설정 판은 고칠 수 없다.
-- ▣ 메뉴 공개 범위는 바꾸지 않는다(앱 modules.js 는 계란님 승인 사항). 중지·재개는 P2-80/81(모듈 assistant).
-- ============================================================================
DO $do$
DECLARE
  p jsonb := $json$
{
  "approver_user_id": "<승인한 관리자 회원 id>",
  "approval_ref": "<승인 근거>",
  "verification_ref": "<배포·키 설정 확인 근거>",
  "allowed_members": "<all_members · school_admin 중 하나>",
  "model": "<승인된 모델 ID>",
  "price_table_ref": "<가격표 근거>",
  "input_price_micro_usd_per_mtok": "<정수>",
  "output_price_micro_usd_per_mtok": "<정수>",
  "max_input_tokens": "<정수>",
  "max_output_tokens": "<정수>",
  "member_daily_micro_usd": "<정수>",
  "member_monthly_micro_usd": "<정수>",
  "school_daily_micro_usd": "<정수>",
  "school_monthly_micro_usd": "<정수>"
}
$json$::jsonb;
  a workhub.accounts; m workhub.memberships; s workhub.schools; v_n integer; k text; v_ver integer; v_reserve numeric; v_first boolean;
BEGIN
  IF p::text LIKE '%"<%' THEN RAISE EXCEPTION 'P6-04 중단: 입력 칸(<...>)을 모두 채워 주세요. 아무것도 쓰지 않았습니다.'; END IF;
  IF to_regprocedure('workhub_private.p6_installed()') IS NULL THEN
    RAISE EXCEPTION 'P6-04 중단: P6-01·02(2026-10-16.1)가 적용되어 있지 않습니다.';
  END IF;
  IF NOT workhub_private.p6_installed() THEN
    RAISE EXCEPTION 'P6-04 중단: P6-01·02(2026-10-16.1)가 적용되어 있지 않습니다.';
  END IF;
  IF NOT workhub_private.p2_exact(p, ARRAY['approver_user_id','approval_ref','verification_ref','allowed_members','model','price_table_ref',
       'input_price_micro_usd_per_mtok','output_price_micro_usd_per_mtok','max_input_tokens','max_output_tokens',
       'member_daily_micro_usd','member_monthly_micro_usd','school_daily_micro_usd','school_monthly_micro_usd']) THEN
    RAISE EXCEPTION 'P6-04 중단: 칸 이름이 양식과 다릅니다(지우거나 더한 칸이 있음).';
  END IF;
  FOREACH k IN ARRAY ARRAY['approval_ref','verification_ref','price_table_ref'] LOOP
    IF jsonb_typeof(p -> k) IS DISTINCT FROM 'string' OR length(btrim(p ->> k)) NOT BETWEEN 1 AND 200 THEN
      RAISE EXCEPTION 'P6-04 중단: % 는 1~200자입니다.', k;
    END IF;
  END LOOP;
  IF jsonb_typeof(p -> 'allowed_members') IS DISTINCT FROM 'string' OR p ->> 'allowed_members' NOT IN ('all_members','school_admin') THEN
    RAISE EXCEPTION 'P6-04 중단: allowed_members 는 all_members · school_admin 중 하나입니다.';
  END IF;
  IF jsonb_typeof(p -> 'model') IS DISTINCT FROM 'string' OR p ->> 'model' !~ '^[A-Za-z0-9_.-]{1,150}$' THEN
    RAISE EXCEPTION 'P6-04 중단: model 은 영문·숫자·_.- 1~150자입니다.';
  END IF;
  FOREACH k IN ARRAY ARRAY['input_price_micro_usd_per_mtok','output_price_micro_usd_per_mtok','max_input_tokens','max_output_tokens',
                           'member_daily_micro_usd','member_monthly_micro_usd','school_daily_micro_usd','school_monthly_micro_usd'] LOOP
    IF NOT workhub_private.p6_int(p -> k, 1) OR (k LIKE 'max\_%' AND (p ->> k)::numeric > 2147483647) THEN
      RAISE EXCEPTION 'P6-04 중단: % 는 1 이상의 정수입니다(따옴표 없이).', k;
    END IF;
  END LOOP;
  v_reserve := ceil(((p ->> 'max_input_tokens')::numeric * (p ->> 'input_price_micro_usd_per_mtok')::numeric
                   + (p ->> 'max_output_tokens')::numeric * (p ->> 'output_price_micro_usd_per_mtok')::numeric) / 1000000);
  IF NOT (v_reserve <= (p ->> 'member_daily_micro_usd')::numeric
          AND (p ->> 'member_daily_micro_usd')::numeric <= (p ->> 'member_monthly_micro_usd')::numeric
          AND (p ->> 'member_daily_micro_usd')::numeric <= (p ->> 'school_daily_micro_usd')::numeric
          AND (p ->> 'member_monthly_micro_usd')::numeric <= (p ->> 'school_monthly_micro_usd')::numeric
          AND (p ->> 'school_daily_micro_usd')::numeric <= (p ->> 'school_monthly_micro_usd')::numeric) THEN
    RAISE EXCEPTION 'P6-04 중단: 한도 순서가 맞지 않습니다(1회 예약액 % micro USD). 머리말의 한도 순서를 확인해 주세요.', v_reserve;
  END IF;
  SELECT * INTO a FROM workhub.accounts WHERE auth_user_id::text = p ->> 'approver_user_id' AND status = 'active' AND legacy_approval_state = 'approved';
  IF NOT FOUND THEN RAISE EXCEPTION 'P6-04 중단: 승인자 계정이 없거나 활성·승인 상태가 아닙니다.'; END IF;
  SELECT count(DISTINCT m2.school_id) INTO v_n
    FROM workhub.memberships m2 JOIN workhub.membership_roles r ON r.membership_id = m2.id AND r.school_id = m2.school_id
    JOIN workhub.schools s2 ON s2.id = m2.school_id
   WHERE m2.account_id = a.id AND m2.status = 'active' AND r.role_code = 'school_admin' AND r.revoked_at IS NULL AND r.scope_type = 'school'
     AND workhub_private.today_in(s2.timezone) <@ daterange(m2.valid_from, m2.valid_to, '[)')
     AND workhub_private.today_in(s2.timezone) <@ daterange(r.valid_from, r.valid_to, '[)');
  IF v_n = 0 THEN RAISE EXCEPTION 'P6-04 중단: 승인자가 지금 학교 관리자(school_admin)인 활성 학교가 없습니다.'; END IF;
  IF v_n > 1 THEN RAISE EXCEPTION 'P6-04 중단: 승인자가 여러 학교의 관리자입니다. 학교를 하나로 정할 수 없습니다.'; END IF;
  SELECT m2.* INTO m
    FROM workhub.memberships m2 JOIN workhub.membership_roles r ON r.membership_id = m2.id AND r.school_id = m2.school_id
    JOIN workhub.schools s2 ON s2.id = m2.school_id
   WHERE m2.account_id = a.id AND m2.status = 'active' AND r.role_code = 'school_admin' AND r.revoked_at IS NULL AND r.scope_type = 'school'
     AND workhub_private.today_in(s2.timezone) <@ daterange(m2.valid_from, m2.valid_to, '[)')
     AND workhub_private.today_in(s2.timezone) <@ daterange(r.valid_from, r.valid_to, '[)')
   LIMIT 1;
  SELECT * INTO s FROM workhub.schools WHERE id = m.school_id AND status = 'active';
  IF NOT FOUND THEN RAISE EXCEPTION 'P6-04 중단: 대상 학교가 활성 상태가 아닙니다.'; END IF;
  -- 같은 학교에 동시에 두 번 실행해도 판이 겹치지 않게
  PERFORM workhub_private.p6_lock('policy' || chr(31) || s.id);
  v_first := NOT EXISTS (SELECT 1 FROM workhub.module_activations WHERE school_id = s.id AND module = 'assistant');
  IF v_first AND EXISTS (SELECT 1 FROM workhub.assistant_policies WHERE school_id = s.id) THEN
    RAISE EXCEPTION 'P6-04 중단: 활성화 행 없이 설정 판만 있습니다. 누가 만들었는지 먼저 확인해 주세요. 아무것도 쓰지 않았습니다.';
  END IF;
  SELECT COALESCE(max(version), 0) + 1 INTO v_ver FROM workhub.assistant_policies WHERE school_id = s.id;
  INSERT INTO workhub.assistant_policies (school_id, version, approved_by_membership_id, approval_ref, verification_ref, allowed_members, model,
      price_table_ref, input_price_micro_usd_per_mtok, output_price_micro_usd_per_mtok, max_input_tokens, max_output_tokens, reserve_micro_usd,
      member_daily_micro_usd, member_monthly_micro_usd, school_daily_micro_usd, school_monthly_micro_usd)
  VALUES (s.id, v_ver, m.id, btrim(p ->> 'approval_ref'), btrim(p ->> 'verification_ref'), p ->> 'allowed_members', p ->> 'model',
      btrim(p ->> 'price_table_ref'), (p ->> 'input_price_micro_usd_per_mtok')::bigint, (p ->> 'output_price_micro_usd_per_mtok')::bigint,
      (p ->> 'max_input_tokens')::integer, (p ->> 'max_output_tokens')::integer, v_reserve::bigint,
      (p ->> 'member_daily_micro_usd')::bigint, (p ->> 'member_monthly_micro_usd')::bigint,
      (p ->> 'school_daily_micro_usd')::bigint, (p ->> 'school_monthly_micro_usd')::bigint);
  IF v_first THEN
    INSERT INTO workhub.module_activations (school_id, module, state, approved_by_membership_id, approval_ref)
    VALUES (s.id, 'assistant', 'active', m.id, btrim(p ->> 'approval_ref'));
  END IF;
  INSERT INTO workhub.audit_events (school_id, actor_account_id, actor_membership_id, operation, resource_type, resource_id,
      resource_version, sensitivity, details, scope_key)
  VALUES (s.id, a.id, m.id, CASE WHEN v_first THEN 'module.activate' ELSE 'assistant.policy' END, 'module_activation', s.id || ':assistant',
      v_ver, 'school',
      jsonb_build_object('module', 'assistant', 'policyVersion', v_ver, 'approval_ref', left(btrim(p ->> 'approval_ref'), 200),
                         'verification_ref', left(btrim(p ->> 'verification_ref'), 200), 'by', session_user,
                         'allowed_members', p ->> 'allowed_members', 'model', p ->> 'model', 'reserveMicroUsd', v_reserve), 's:' || s.id);
  RAISE NOTICE 'P6-04: % 학교 비서 설정 %판(1회 예약 % micro USD)%.', s.code, v_ver, v_reserve, CASE WHEN v_first THEN ' · 켬' ELSE '' END;
END $do$;

-- 확인(읽기 전용): ready 여야 한다(중지 중이면 disabled — 재개는 P2-81)
SELECT s.code, workhub_private.p6_reason(s.id) AS assistant, (workhub_private.p6_policy(s.id)).version AS policy_version,
       (workhub_private.p6_policy(s.id)).allowed_members, (workhub_private.p6_policy(s.id)).model, (workhub_private.p6_policy(s.id)).reserve_micro_usd
  FROM workhub.schools s ORDER BY s.code;
