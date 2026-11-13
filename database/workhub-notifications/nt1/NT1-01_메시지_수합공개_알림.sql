-- NT1-01: 메시지 도착·수합 최초 공개 알림. 기존 함수·접수증·원본 자료는 변경하지 않는다.
-- 설치 이후 새 전송/공개부터 적용한다. 과거 자료 소급 알림, 학교 활성화/권한/비용 변경은 없다.
BEGIN;
DO $$ DECLARE r record; actual text;
BEGIN
 IF current_user<>'postgres' THEN RAISE EXCEPTION 'NT1: postgres 역할로 실행해 주세요.'; END IF;
 IF to_regclass('workhub_private.nt1_installs') IS NOT NULL THEN RAISE EXCEPTION 'NT1: 이미 설치되어 있습니다. NT1-02로 확인해 주세요.'; END IF;
 FOR r IN SELECT * FROM (VALUES
 ('workhub_private.p3_post(workhub_private.actor_context,text,text,text[],text)','de571a19885bc5016eb32cb5dc9af4ab'),
 ('workhub_private.c_cmd_publish(workhub_private.actor_context,jsonb,jsonb)','b586e8ac750e816d4d9b73eb7a0edb88'),
 ('workhub_private.p3_notify(text,text,text,text,text,text,text)','91003e540f773b97879f2ce5418cb725')) AS expected(signature,hash) LOOP
  SELECT md5(replace(prosrc,E'\r\n',E'\n')) INTO actual FROM pg_proc
   WHERE oid=to_regprocedure(r.signature) AND proowner='postgres'::regrole;
  IF actual IS DISTINCT FROM r.hash THEN RAISE EXCEPTION 'NT1: 선행 함수 원문/소유자 불일치: %',r.signature; END IF;
 END LOOP;
 IF to_regclass('workhub.notifications') IS NULL OR to_regclass('workhub.messages') IS NULL
 OR to_regclass('workhub.collection_unit_members') IS NULL THEN RAISE EXCEPTION 'NT1: R1·P3 설치를 먼저 확인해 주세요.'; END IF;
 IF EXISTS(SELECT 1 FROM pg_trigger WHERE tgname IN('nt1_message_notice','nt1_collection_notice'))
 OR to_regprocedure('workhub_private.nt1_message_notice()') IS NOT NULL
 OR to_regprocedure('workhub_private.nt1_collection_notice()') IS NOT NULL THEN
  RAISE EXCEPTION 'NT1: 같은 이름의 함수/트리거가 이미 있습니다.';
 END IF;
END $$;
CREATE TABLE workhub_private.nt1_installs(batch text PRIMARY KEY CHECK(batch='NT1-01'),installed_at timestamptz NOT NULL DEFAULT clock_timestamp());
ALTER TABLE workhub_private.nt1_installs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON workhub_private.nt1_installs FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER nt1_install_immutable BEFORE UPDATE OR DELETE ON workhub_private.nt1_installs
 FOR EACH ROW EXECUTE FUNCTION workhub_private.forbid_change();
CREATE FUNCTION workhub_private.nt1_message_notice() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE recipient record;
BEGIN
 -- 전송과 같은 트랜잭션이다. 알림 실패를 삼키거나 본문을 알림에 복제하지 않는다.
 FOR recipient IN SELECT m.membership_id FROM workhub.message_thread_members m
  WHERE m.school_id=NEW.school_id AND m.thread_id=NEW.thread_id
    AND m.membership_id<>NEW.sender_membership_id AND m.account_id<>NEW.sender_account_id
  ORDER BY m.membership_id COLLATE "C" LOOP
  PERFORM workhub_private.p3_notify(NEW.school_id,recipient.membership_id,
   '새 메시지: '||left(NEW.sender_name,120),'메시지가 도착했습니다. 대화를 열어 확인해 주세요.',
   'messages',NEW.thread_id,'nt1:message:'||NEW.id);
 END LOOP;
 RETURN NEW;
END $$;
CREATE FUNCTION workhub_private.nt1_collection_notice() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE recipient record;
BEGIN
 -- 공개 시 제출 단위가 모두 만들어진 뒤 실행한다. 한 교사가 여러 단위에 있어도 한 번만 알린다.
 FOR recipient IN SELECT DISTINCT m.membership_id COLLATE "C" AS membership_id FROM workhub.collection_unit_members m
  WHERE m.school_id=NEW.school_id AND m.collection_id=NEW.id AND m.removed_at IS NULL
    AND m.membership_id<>NEW.owner_membership_id AND m.account_id<>NEW.owner_account_id
  ORDER BY m.membership_id COLLATE "C" LOOP
  PERFORM workhub_private.p3_notify(NEW.school_id,recipient.membership_id,
   '새 수합: '||left(NEW.title,120),'제출 기한 '||to_char(NEW.due_on,'YYYY-MM-DD')||' · 수합을 열어 양식과 제출 대상을 확인해 주세요.',
   'collections',NEW.id,'nt1:collection:'||NEW.id);
 END LOOP;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION workhub_private.nt1_message_notice(),workhub_private.nt1_collection_notice() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER nt1_message_notice AFTER INSERT ON workhub.messages
 FOR EACH ROW EXECUTE FUNCTION workhub_private.nt1_message_notice();
CREATE TRIGGER nt1_collection_notice AFTER UPDATE OF state ON workhub.collections
 FOR EACH ROW WHEN (OLD.state='draft' AND NEW.state='published') EXECUTE FUNCTION workhub_private.nt1_collection_notice();
INSERT INTO workhub_private.nt1_installs(batch) VALUES('NT1-01');
COMMIT;
SELECT 'NT1-01' AS no,'ok' AS status,'이후 메시지 도착·수합 공개 알림을 연결했습니다.' AS detail;
