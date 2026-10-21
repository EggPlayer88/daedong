-- 운영자가 승인 기록을 확인하고 직접 채운 뒤 별도로 실행한다. 키/활성화/legacy 연결은 만들지 않는다.
BEGIN;
SET LOCAL ROLE service_role;
SELECT public.workhub_ai_school_policy_register(
  '<승인한 현재 학교 관리자 Auth UID>'::uuid,
  '<그 관리자의 현재 학교 membership ID>'::text,
  '<정책 승인 근거: 날짜 및 결정 기록>'::text
);
COMMIT;
