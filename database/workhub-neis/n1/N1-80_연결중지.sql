-- 승인 후 실행. 갱신·새 반영만 중지한다. 이미 반영한 일정과 원본·접수 기록은 유지한다.
BEGIN;
UPDATE neis_private.connections SET active=false,updated_at=now() WHERE school_name='대동여자중학교' AND office_code='K10' AND school_code='7892043';
COMMIT;
SELECT school_name,active FROM neis_private.connections;
