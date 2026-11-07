-- 승인 후 실행. 키를 넣는 파일이 아니다. 검증한 대동여중 나이스 코드만 연결한다.
-- API 키는 Vercel Production 서버의 NEIS_API_KEY에만 저장한다.
BEGIN;
DO $$
DECLARE sid text; n integer;
BEGIN
 SELECT count(*),min(id) INTO n,sid FROM workhub.schools WHERE name='대동여자중학교' AND status='active' AND timezone='Asia/Seoul';
 IF n<>1 THEN RAISE EXCEPTION 'N1: 활성 대동여자중학교 1개인지 확인하세요'; END IF;
 IF EXISTS(SELECT 1 FROM neis_private.connections WHERE school_id<>sid)
 OR EXISTS(SELECT 1 FROM neis_private.connections WHERE school_id=sid AND (office_code<>'K10' OR school_code<>'7892043')) THEN RAISE EXCEPTION 'N1: 기존 연결과 다릅니다'; END IF;
 INSERT INTO neis_private.connections(school_id,office_code,school_code,school_name,active)
 VALUES(sid,'K10','7892043','대동여자중학교',true)
 ON CONFLICT(school_id) DO UPDATE SET active=true,updated_at=now();
END $$;
COMMIT;
SELECT 'N1-03' no,'ok' status,school_name,office_code,school_code,active FROM neis_private.connections;
