-- 기간 업무 메뉴 표시 설정. 기존 표·함수·RLS·양식은 변경하지 않는다.
-- 운영 적용은 검토 후 사용자가 실행한다. 설치 직후 메뉴 표시는 false다.
BEGIN;
CREATE SCHEMA IF NOT EXISTS site_presentation;
REVOKE ALL ON SCHEMA site_presentation FROM PUBLIC, anon, authenticated;
CREATE TABLE site_presentation.seasonal_work (
 feature text PRIMARY KEY CHECK (feature = 'assessment-plan'),
 enabled boolean NOT NULL DEFAULT false,
 version integer NOT NULL DEFAULT 1 CHECK (version > 0),
 updated_at timestamptz,
 updated_by text
);
CREATE TABLE site_presentation.seasonal_receipts (
 actor text NOT NULL,
 request_key uuid NOT NULL,
 feature text NOT NULL,
 enabled boolean NOT NULL,
 expected_version integer NOT NULL,
 result jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(actor, request_key)
);
ALTER TABLE site_presentation.seasonal_work ENABLE ROW LEVEL SECURITY;
ALTER TABLE site_presentation.seasonal_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA site_presentation FROM PUBLIC, anon, authenticated;
INSERT INTO site_presentation.seasonal_work(feature) VALUES ('assessment-plan');

CREATE FUNCTION public.site_seasonal_status() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE v_admin boolean; v_row site_presentation.seasonal_work;
BEGIN
 SELECT u.role IN ('admin','superadmin') INTO v_admin FROM public.users u WHERE u.id=auth.uid()::text AND u.is_active=true;
 IF NOT FOUND THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 SELECT * INTO STRICT v_row FROM site_presentation.seasonal_work WHERE feature='assessment-plan';
 RETURN jsonb_build_object('contract','site.seasonal.v1','feature',v_row.feature,'enabled',v_row.enabled,'version',v_row.version,'canManage',v_admin,'updatedAt',v_row.updated_at);
END $$;
CREATE FUNCTION public.site_seasonal_set(p_feature text,p_enabled boolean,p_expected_version integer,p_request_key uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE v_actor text:=auth.uid()::text; v_row site_presentation.seasonal_work; v_receipt site_presentation.seasonal_receipts; v_result jsonb;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.users WHERE id=v_actor AND is_active=true AND role IN ('admin','superadmin')) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 IF p_feature IS DISTINCT FROM 'assessment-plan' OR p_enabled IS NULL OR p_expected_version IS NULL OR p_expected_version<1 OR p_request_key IS NULL THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
 -- 표시 설정 행을 먼저 잠가 재전송과 다른 관리자 변경을 같은 순서로 검사한다.
 SELECT * INTO STRICT v_row FROM site_presentation.seasonal_work WHERE feature=p_feature FOR UPDATE;
 SELECT * INTO v_receipt FROM site_presentation.seasonal_receipts WHERE actor=v_actor AND request_key=p_request_key;
 IF FOUND THEN
  IF v_receipt.feature<>p_feature OR v_receipt.enabled<>p_enabled OR v_receipt.expected_version<>p_expected_version THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT'; END IF;
  RETURN v_receipt.result;
 END IF;
 IF v_row.version<>p_expected_version THEN RAISE EXCEPTION 'CONFLICT'; END IF;
 UPDATE site_presentation.seasonal_work SET enabled=p_enabled,version=version+1,updated_at=clock_timestamp(),updated_by=v_actor WHERE feature=p_feature RETURNING * INTO v_row;
 v_result:=jsonb_build_object('contract','site.seasonal.v1','feature',v_row.feature,'enabled',v_row.enabled,'version',v_row.version,'canManage',true,'updatedAt',v_row.updated_at);
 INSERT INTO site_presentation.seasonal_receipts(actor,request_key,feature,enabled,expected_version,result) VALUES(v_actor,p_request_key,p_feature,p_enabled,p_expected_version,v_result);
 RETURN v_result;
END $$;
REVOKE ALL ON FUNCTION public.site_seasonal_status() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.site_seasonal_set(text,boolean,integer,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.site_seasonal_status() TO authenticated;
GRANT EXECUTE ON FUNCTION public.site_seasonal_set(text,boolean,integer,uuid) TO authenticated;
COMMIT;
SELECT 'SP1-01' AS no,'ok' AS status,'기간 업무 표시 설정을 설치했습니다' AS detail;
