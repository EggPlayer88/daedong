-- 수합 다운로드 호환 보강. 기존 설치 파일과 자료는 바꾸지 않는다.
-- Supabase의 인증 다운로드는 본문 전에 object.get_authenticated_info를 호출한다.
-- 같은 본인·부모판·5분 접근 허가 검사를 통과한 ready 파일에만 이 조회를 허용한다.
-- 목록/서명 URL/익명 읽기/미검사 파일은 계속 거부한다. 운영 실행은 사용자 승인 후.
BEGIN;
DO $patch$
DECLARE
  v_oid oid := to_regprocedure('workhub_storage.object_readable(text)');
  v_body text;
  v_definition text;
BEGIN
  IF v_oid IS NULL THEN RAISE EXCEPTION 'S1: R1 Storage 설치를 먼저 확인해 주세요.'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid=p.prolang
    WHERE p.oid=v_oid AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef
      AND p.provolatile='s' AND l.lanname='plpgsql'
      AND p.proconfig=ARRAY['search_path=""']::text[]) THEN
    RAISE EXCEPTION 'S1: 대상 함수의 소유자·실행 속성이 확정본과 다릅니다.';
  END IF;
  SELECT replace(prosrc,chr(13),'') INTO v_body FROM pg_proc WHERE oid=v_oid;
  IF md5(v_body)='082ef8d4160ba0577732deed0c6c2221' THEN RETURN; END IF;
  IF md5(v_body)<>'7a7e94587b550ee64cfdd04b6b21ed42' THEN
    RAISE EXCEPTION 'S1: 대상 함수가 확정 R1 원본과 다릅니다. 자동 교체하지 않습니다.';
  END IF;
  v_definition := replace(pg_get_functiondef(v_oid),chr(13),'');
  v_definition := replace(v_definition,
    'v_op NOT IN (''object.upload'', ''object.get_authenticated'')',
    'v_op NOT IN (''object.upload'', ''object.get_authenticated'', ''object.get_authenticated_info'')');
  v_definition := replace(v_definition,
    'v_op <> ''object.get_authenticated''',
    'v_op NOT IN (''object.get_authenticated'', ''object.get_authenticated_info'')');
  EXECUTE v_definition;
  IF (SELECT md5(replace(prosrc,chr(13),'')) FROM pg_proc WHERE oid=v_oid)<>'082ef8d4160ba0577732deed0c6c2221' THEN
    RAISE EXCEPTION 'S1: 교체 결과가 승인할 보강 원문과 다릅니다.';
  END IF;
END $patch$;
COMMIT;
SELECT 'S1-01' AS no, '수합 인증 다운로드의 파일 정보 조회 호환' AS item, 'ok' AS status;
