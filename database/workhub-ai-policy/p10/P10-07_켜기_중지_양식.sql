-- 정책·키·연결 및 배포 확인 뒤 운영자가 별도로 실행한다. 기본 false(중지).
-- true는 공통 유료 호출을 허용한다. assistant 모듈 자체는 기존 활성화 절차와 별도이다.
-- 관측 초과로 overage_blocked가 설정되면 true를 거부한다. 이 양식으로 차단을 지우지 않는다.
BEGIN;
SET LOCAL ROLE service_role;
SELECT public.workhub_ai_school_control(
  '<승인한 현재 학교 관리자 Auth UID>'::uuid,
  '<그 관리자의 현재 학교 membership ID>'::text,
  false,
  '<켜기 또는 중지 승인 근거>'::text
);
COMMIT;
