-- 복제 전용. SB-01 원문은 보존하고 시계 UPDATE의 WHERE만 보강한다.
-- Claude 전달본은 2026-10-29 사용자 적용 완료, 읽기 전용 함수 조회로 반영 확인.
-- 이 설치본은 동일 변경에 정확한 시그니처·원문 지문 검사를 추가했다.
-- 현재 시험에 재실행할 필요 없음. 시계·접수 기록·예산을 초기화하지 않는다.
BEGIN;
DO $$
DECLARE source text; original text; patched text; target regprocedure;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM sandbox_private.environment WHERE singleton
   AND project_ref='vfnemvoszjglfblsrzoh' AND run_id='daedong-year-20261028') THEN
  RAISE EXCEPTION 'SANDBOX_ONLY';
 END IF;
 target:=to_regprocedure('public.workhub_sandbox_clock_control(text,integer,text,timestamp with time zone)');
 IF target IS NULL THEN RAISE EXCEPTION 'SANDBOX_CLOCK_FUNCTION_MISSING'; END IF;
 SELECT replace(pg_get_functiondef(target),E'\r\n',E'\n') INTO source;
 original:=replace(source,'SET revision=revision+1 WHERE singleton RETURNING','SET revision=revision+1 RETURNING');
 IF md5(original)<>'9260cd8a170b0c55705977173c7062d7' THEN
  RAISE EXCEPTION 'SANDBOX_CLOCK_SOURCE_CHANGED';
 END IF;
 patched:=replace(original,'SET revision=revision+1 RETURNING','SET revision=revision+1 WHERE singleton RETURNING');
 IF patched=original THEN RAISE EXCEPTION 'SANDBOX_CLOCK_PATCH_MISSING'; END IF;
 IF source=patched THEN RAISE NOTICE 'SB-03 already applied'; RETURN; END IF;
 EXECUTE patched;
END $$;
COMMIT;
