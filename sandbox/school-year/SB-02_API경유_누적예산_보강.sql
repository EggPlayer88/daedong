-- 복제 전용: PostgREST의 safeupdate에서도 한 행 예산 차감이 실행되게 한다.
-- 선차감액·한도·재시도·권한 정책은 바꾸지 않는다.
BEGIN;
DO $$
DECLARE source text; expected text;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM sandbox_private.environment WHERE project_ref='vfnemvoszjglfblsrzoh' AND run_id='daedong-year-20261028') THEN
  RAISE EXCEPTION 'SANDBOX_ONLY';
 END IF;
 SELECT pg_get_functiondef('sandbox_private.charge_ai()'::regprocedure) INTO source;
 IF position('SET burned_micro_usd=burned_micro_usd+amount WHERE singleton;' IN source)>0 THEN
  source:=replace(source,'SET burned_micro_usd=burned_micro_usd+amount WHERE singleton;','SET burned_micro_usd=burned_micro_usd+amount;');
 END IF;
 IF md5(source)<>'ac1e76c3100d52ea5f777cfeb901317f' THEN RAISE EXCEPTION 'SANDBOX_BUDGET_SOURCE_CHANGED';END IF;
 expected:=replace(source,'SET burned_micro_usd=burned_micro_usd+amount;','SET burned_micro_usd=burned_micro_usd+amount WHERE singleton;');
 IF expected=source THEN RAISE EXCEPTION 'SANDBOX_BUDGET_PATCH_MISSING';END IF;
 EXECUTE expected;
END $$;
COMMIT;
