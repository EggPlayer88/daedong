-- 읽기 전용. 먼저 INT-09 전체 점검에 FAIL이 없는지 확인한다.
-- count/지문은 아래 이름의 자료만 포함하며 전체 DB 보존을 증명하지 않는다.
WITH memberships AS (
 SELECT id,school_id,account_id,status,valid_from,valid_to FROM workhub.memberships
), profile AS (
 SELECT id,role,is_active FROM public.users
)
SELECT 'OP1-P01' AS no,'선행 설치' AS item,
 CASE WHEN to_regclass('workhub_private.mp1_installs') IS NOT NULL
 AND to_regclass('workhub_private.t3_installs') IS NOT NULL THEN 'ok' ELSE 'FAIL' END AS status,
 'INT-09 전체 18행 FAIL 없음과 함께 판단' AS value
UNION ALL SELECT 'OP1-P02','OP1 미설치',
 CASE WHEN to_regclass('workhub_private.op1_installs') IS NULL THEN 'ok' ELSE 'info' END,
 CASE WHEN to_regclass('workhub_private.op1_installs') IS NULL THEN '미설치' ELSE '이미 설치됨: OP1-01 재실행 대신 OP1-02·INT-10 사용' END
UNION ALL SELECT 'OP1-P03','기존 T3 정책 학교 수','info',count(*)::text FROM workhub.timetable_intervention_policies
UNION ALL SELECT 'OP1-F01','기존 회원 ID·역할·활성 지문','compare',
 md5(coalesce(string_agg(row_to_json(p)::text,E'\n' ORDER BY p.id),'')) FROM profile p
UNION ALL SELECT 'OP1-F02','기존 소속·계정·상태·기간 지문','compare',
 md5(coalesce(string_agg(row_to_json(m)::text,E'\n' ORDER BY m.id),'')) FROM memberships m
ORDER BY no;
