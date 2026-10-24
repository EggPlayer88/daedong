-- 질문형 양식 생성 파일 다운로드 호환. 입력할 값 없음. 운영 실행은 사용자가 한다.
-- 본문과 같은 소유자·소속·학교·객체 ID·모듈 검사를 파일 정보 조회에도 적용한다.
-- 양식 원본·목록·서명 URL 접근과 기존 설치 파일은 바꾸지 않는다. S1 적용 후 실행.
BEGIN;
DO $patch$
DECLARE
  v_oid oid := to_regprocedure('workhub_storage.document_readable(text,uuid)');
  v_body text;
  v_definition text;
BEGIN
  IF v_oid IS NULL THEN RAISE EXCEPTION 'S2: P4 Storage 설치를 먼저 확인해 주세요.'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('workhub_storage.object_readable(text)')
    AND md5(replace(prosrc,chr(13),''))='082ef8d4160ba0577732deed0c6c2221') THEN
    RAISE EXCEPTION 'S2: S1 수합 다운로드 보강을 먼저 확인해 주세요.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid=p.prolang
    WHERE p.oid=v_oid AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef
      AND p.provolatile='s' AND l.lanname='plpgsql'
      AND p.proconfig=ARRAY['search_path=""']::text[]
      AND has_function_privilege('authenticated',p.oid,'EXECUTE')
      AND NOT has_function_privilege('anon',p.oid,'EXECUTE')
      AND NOT has_function_privilege('service_role',p.oid,'EXECUTE')) THEN
    RAISE EXCEPTION 'S2: 대상 함수의 소유자·권한·실행 속성이 확정본과 다릅니다.';
  END IF;
  SELECT replace(prosrc,chr(13),'') INTO v_body FROM pg_proc WHERE oid=v_oid;
  IF md5(v_body)='626c7b65dca171d673cdea98db7e07a6' THEN RETURN; END IF;
  IF md5(v_body)<>'43c7e6cd7a65a6685b20bd92a6c377a5' THEN
    RAISE EXCEPTION 'S2: 대상 함수가 확정 P4 원본과 다릅니다. 자동 교체하지 않습니다.';
  END IF;
  v_definition := replace(pg_get_functiondef(v_oid),chr(13),'');
  v_definition := replace(v_definition,
    'v_op NOT IN (''object.upload'',''object.get_authenticated'')',
    'v_op NOT IN (''object.upload'',''object.get_authenticated'',''object.get_authenticated_info'')');
  v_definition := replace(v_definition,
    'v_op <> ''object.get_authenticated''',
    'v_op NOT IN (''object.get_authenticated'',''object.get_authenticated_info'')');
  EXECUTE v_definition;
  IF (SELECT md5(replace(prosrc,chr(13),'')) FROM pg_proc WHERE oid=v_oid)<>'626c7b65dca171d673cdea98db7e07a6' THEN
    RAISE EXCEPTION 'S2: 교체 결과가 승인할 보강 원문과 다릅니다.';
  END IF;
END $patch$;
COMMIT;
SELECT 'S2-01' AS no, '질문형 양식 생성 파일의 정보 조회 호환' AS item, 'ok' AS status;
