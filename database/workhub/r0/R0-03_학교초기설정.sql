-- =====================================================================
-- R0-03 학교 초기 설정 (첫 학교 · 첫 관리자 · 학년도 · 학기)
--   실행: Supabase SQL Editor (역할 postgres). R0-01, R0-02 다음.
--   한 번만 실행된다. 이미 학교·계정이 있으면 아무것도 쓰지 않고 멈춘다.
--   기존 public 자료는 읽기만 한다 (public.users 행을 바꾸지 않는다).
-- =====================================================================

-- ---------------------------------------------------------------------
-- [1단계] 읽기 전용 — 첫 관리자 회원 id 찾기
--   결과의 id 를 아래 admin_user_id 칸에 그대로 붙여 넣는다.
--   name_ok 가 true 여야 한다 (이름 1~50자).
-- ---------------------------------------------------------------------
SELECT u.id, u.name, u.email, u.role, u.is_active,
       (au.id IS NOT NULL)                         AS auth_linked,
       length(btrim(u.name)) BETWEEN 1 AND 50      AS name_ok
  FROM public.users u
  LEFT JOIN auth.users au ON au.id::text = u.id
 WHERE u.role = 'superadmin'
 ORDER BY u.created_at NULLS LAST, u.id;

-- ---------------------------------------------------------------------
-- [2단계] 초기 설정 — <...> 칸을 모두 채운 뒤 실행
--   날짜는 학교 공식 학사일정에서 확인해 적는다(추정하지 않는다). 모두 "마지막 날 포함" (내부 저장은 다음날 0시 종료).
--   칸이 하나라도 <...> 로 남아 있으면 실행이 거부되고 아무것도 쓰이지 않는다.
--   admin_roles 를 빼면 calendar_manager + school_admin 둘 다 준다.
-- ---------------------------------------------------------------------
SELECT workhub_private.bootstrap_first_school($json$
{
  "admin_user_id":  "<1단계 결과의 superadmin id>",
  "approval_ref":   "<승인 근거: 실제 승인일 + 승인자 + R0 초기설정>",
  "school_code":    "<학교 코드 소문자·숫자·하이픈 예: daedong-ms>",
  "school_name":    "<정식 학교 이름>",
  "school_level":   "<middle | elementary | high>",
  "grade_count":    "<학년 수 예: 3>",
  "timezone":       "Asia/Seoul",
  "school_year":    "<학년도 4자리>",
  "year_first_day": "<학년도 첫날 YYYY-MM-DD — 학사일정에서 확인>",
  "year_last_day":  "<학년도 마지막 날 YYYY-MM-DD — 학사일정에서 확인>",
  "terms": [
    {"term_no": 1, "label": "1학기", "first_day": "<YYYY-MM-DD>", "last_day": "<YYYY-MM-DD>"},
    {"term_no": 2, "label": "2학기", "first_day": "<YYYY-MM-DD>", "last_day": "<YYYY-MM-DD>"}
  ]
}
$json$::jsonb);

-- ---------------------------------------------------------------------
-- [3단계] 읽기 전용 — 결과 확인 (모든 행 ok = true 여야 한다)
-- ---------------------------------------------------------------------
SELECT 'S-1 학교 1개, 활성' AS check_name,
       (SELECT count(*) = 1 AND bool_and(status = 'active') FROM workhub.schools) AS ok
UNION ALL
SELECT 'S-2 계정 1개, 승인됨, Auth 연결',
       (SELECT count(*) = 1 AND bool_and(legacy_approval_state = 'approved' AND auth_user_id::text = legacy_user_id)
          FROM workhub.accounts)
UNION ALL
SELECT 'S-3 현재 소속 1개',
       (SELECT count(*) = 1 FROM workhub.memberships WHERE status = 'active')
UNION ALL
SELECT 'S-4 관리자 역할 부여됨',
       (SELECT count(*) >= 1 FROM workhub.membership_roles WHERE revoked_at IS NULL)
UNION ALL
SELECT 'S-5 학년도 1개, 학기 1~4개',
       (SELECT count(*) = 1 FROM workhub.academic_years)
       AND (SELECT count(*) BETWEEN 1 AND 4 FROM workhub.terms)
UNION ALL
SELECT 'S-6 초기설정 서비스 권한 모두 회수됨',
       NOT EXISTS (SELECT 1 FROM workhub.service_principal_scopes WHERE revoked_at IS NULL)
UNION ALL
SELECT 'S-7 감사 기록 남음',
       (SELECT count(*) >= 8 FROM workhub.audit_events)
UNION ALL
SELECT 'S-8 public.users 그대로 (superadmin 승인 상태 유지)',
       (SELECT bool_and(u.is_active) FROM public.users u JOIN workhub.accounts a ON a.legacy_user_id = u.id);
