-- 업무실 입장/메신저 수신 자격을 바꾸지 않고 수업 담당 후보만 분리한다.
-- 아래 네 함수는 P5/P8 확정판의 본문 지문이 정확히 맞을 때만 교체한다.
BEGIN;
SET LOCAL lock_timeout='5s';
DO $$
DECLARE r record;f oid;body text;old text:='workhub_private.p2_member_reachable';new text:='workhub_private.p9_teacher_assignable';
BEGIN
 IF to_regprocedure('workhub_private.p9_teacher_assignable(text,text)') IS NULL THEN RAISE EXCEPTION 'P9-01을 먼저 설치하세요.';END IF;
 FOR r IN SELECT * FROM (VALUES
  ('p5_catalog','427777de358475b168c05c4409773440'),
  ('p5_course_create','94a99355cba3eaccc8ab47dedd05710a'),
  ('p8_rel_snapshot','a498c2e7caae18aad3b714745a75ab62'),
  ('p8_rel_eval','f77b6655eacf9b9070715a4073d17e7b')) v(name,expected) LOOP
  IF(SELECT count(*) FROM pg_proc WHERE pronamespace='workhub_private'::regnamespace AND proname=r.name)<>1 THEN RAISE EXCEPTION 'P9: 원본 함수가 없거나 중복됩니다: %',r.name;END IF;
  SELECT oid INTO f FROM pg_proc WHERE pronamespace='workhub_private'::regnamespace AND proname=r.name;
  body:=pg_get_functiondef(f);
  IF md5(body)<>r.expected OR (length(body)-length(replace(body,old,'')))/length(old)<>1 THEN RAISE EXCEPTION 'P9: 교체 대상이 확정 P5/P8 원본과 다릅니다: %',r.name;END IF;
  EXECUTE replace(body,old,new);
 END LOOP;
END $$;
INSERT INTO workhub_private.p9_installs(batch,release) VALUES('P9-02','2026-10-20.1');
COMMIT;
