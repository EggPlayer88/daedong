-- 공급자 청구를 확인한 관리자만 실행한다. 답변을 복구하거나 유료 호출을 재시도하지 않는다.
-- 이번 승인 상한(입력100000·출력8000) 안에서만 정산. observed_usage가 있는 초과관측은 별도승인/증분 대상.
BEGIN;
SET LOCAL ROLE service_role;
SELECT public.workhub_ai_school_resolve(
  '<확인한 현재 학교 관리자 Auth UID>'::uuid,
  '<그 관리자의 현재 학교 membership ID>'::text,
  '<확인할 공통 원장 request ID>'::text,
  '<청구 확인 입력 토큰 정수>'::integer,
  '<청구 확인 출력 토큰 정수>'::integer,
  '<공급자 콘솔 등 청구 확인 근거>'::text
);
COMMIT;
