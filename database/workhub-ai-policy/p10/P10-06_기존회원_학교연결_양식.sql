-- 기존 평가계획 승인 회원을 학교 하나에 명시 연결한다. 명단 추정·auth 생성·소속 생성·역할 승격 없음.
-- 빈칸을 바꾸지 않으면 UUID 변환에서 중단되어 아무것도 변경하지 않는다.
BEGIN;
SET LOCAL ROLE service_role;
SELECT public.workhub_ai_school_link_legacy(
  '<승인한 현재 학교 관리자 Auth UID>'::uuid,
  '<그 관리자의 현재 학교 membership ID>'::text,
  ARRAY['<연결을 승인한 기존 회원 Auth UID>']::uuid[],
  '<명단 확인과 학교 연결 승인 근거>'::text
);
COMMIT;
