"""기존 SQL은 읽기만 하며 TP1의 정확한 본문 교체 목록을 만든다."""
from pathlib import Path
import re,hashlib,json
HERE=Path(__file__).resolve().parent;ROOT=HERE.parents[2]
tr=ROOT/'database/workhub-teacher-roster/tr1/TR1-02_명부_편성_연결.sql'
p6a=ROOT/'database/workhub/p6/P6-01_비서_모델.sql';p6b=ROOT/'database/workhub/p6/P6-02_비서_공개함수.sql'
p10=ROOT/'database/workhub-ai-policy/p10/P10-02_학교AI_공통실행.sql'
SPECS=[
 (tr,'teacher_roster.snapshot(workhub_private.actor_context)','teacher_roster.links','teacher_pilot.effective_links',1),
 (tr,'teacher_roster.evaluate(workhub_private.actor_context,jsonb)','teacher_roster.links','teacher_pilot.effective_links',1),
 (tr,'teacher_roster.bridge(workhub_private.actor_context,text)','teacher_roster.links','teacher_pilot.bridge_links',2),
 (tr,'public.workhub_teacher_roster_published(text,text)','teacher_roster.links','teacher_pilot.effective_links',1),
 (p6a,'workhub_private.p6_service_member(uuid,text)','workhub_private.member_actor','teacher_pilot.actor',1),
 (p6b,'public.workhub_ai_threads_list(text,text,text)','workhub_private.member_actor','teacher_pilot.actor',1),
 (p6b,'public.workhub_ai_thread_get(text,text,text)','workhub_private.member_actor','teacher_pilot.actor',1),
 (p6b,'public.workhub_ai_confirm_task(text,jsonb,text)','workhub_private.member_actor','teacher_pilot.actor',1),
 (p10,'public.workhub_ai_policy_thread_get(text,text,text)','workhub_private.member_actor','teacher_pilot.actor',1),
]
def patches():
 rows=[]
 for path,sig,old,new,count in SPECS:
  name=sig.split('(')[0];s=path.read_text(encoding='utf-8')
  m=re.search(r'CREATE(?: OR REPLACE)? FUNCTION '+re.escape(name)+r'\([^$]+?AS \$\$(.*?)\$\$;',s,re.S)
  if not m or m[1].count(old)!=count:raise ValueError((sig,m[1].count(old) if m else None))
  h=lambda s:hashlib.md5(s.encode()).hexdigest()
  rows.append([sig,h(m[1]),h(m[1].replace(old,new)),old,new,count])
 return rows
def build():
 rows=patches()
 head="""-- TP1-02: 기존 확정 원문을 확인한 뒤 시험 연결의 종료와 제한 AI 진입만 보강한다.
BEGIN;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM teacher_pilot.installs WHERE batch='TP1-01') OR EXISTS(SELECT 1 FROM teacher_pilot.installs WHERE batch='TP1-02') THEN RAISE EXCEPTION 'TP1 installation order';END IF;
 IF EXISTS(SELECT 1 FROM teacher_pilot.batches) THEN RAISE EXCEPTION 'TP1-02를 먼저 설치한 뒤 시험 계정을 등록하세요.';END IF;
 IF (SELECT tgfoid FROM pg_trigger WHERE tgrelid='teacher_roster.links'::regclass AND tgname='tr1_links_immutable') IS DISTINCT FROM 'workhub_private.forbid_change()'::regprocedure THEN RAISE EXCEPTION 'TR1 link guard differs';END IF;
 IF EXISTS(SELECT 1 FROM (VALUES('links_pkey','f28d9883328794d54b21436385d02dce'),('links_school_id_member_id_daterange_excl','39ac56ecf6fc92f1a8d8de7fd6721d43'),('links_school_id_teacher_id_daterange_excl','eb0cf5b530a6352aec93975ec7846cc6')) expected(name,hash)
 LEFT JOIN pg_constraint c ON c.conrelid='teacher_roster.links'::regclass AND c.conname=expected.name WHERE md5(pg_get_constraintdef(c.oid)) IS DISTINCT FROM expected.hash) THEN RAISE EXCEPTION 'TR1 link constraint differs';END IF;
 IF (SELECT md5(pg_get_constraintdef(oid)) FROM pg_constraint WHERE conrelid='workhub.staff_assignments'::regclass AND conname='staff_assignments_one_homeroom') IS DISTINCT FROM '5289a9d06a8af3f7d5159a1450c0e3b8' THEN RAISE EXCEPTION 'P1 homeroom constraint differs';END IF;
 IF (SELECT md5(pg_get_constraintdef(oid)) FROM pg_constraint WHERE conrelid='workhub.staff_assignments'::regclass AND conname='staff_assignments_no_duplicate') IS DISTINCT FROM '253c7f0026f69362bc4fc5b81e2c7df4' THEN RAISE EXCEPTION 'P1 assignment constraint differs';END IF;
END $$;
"""
 # 먼저 모든 함수의 원본과 속성을 확인한다. 일부 교체 뒤 발견되어도 전체 트랜잭션은 되돌아간다.
 payload=json.dumps(rows,ensure_ascii=False,separators=(',',':'))
 pre="""DO $tp1$ DECLARE r jsonb;p pg_proc;BEGIN
 FOR r IN SELECT value FROM jsonb_array_elements($patches$"""+payload+"""$patches$::jsonb) LOOP
 SELECT * INTO p FROM pg_proc WHERE oid=to_regprocedure(r->>0);
 IF p.oid IS NULL OR md5(replace(p.prosrc,E'\\r\\n',E'\\n'))<>r->>1 OR p.proowner<>'postgres'::regrole
 OR p.prosecdef IS DISTINCT FROM (r->>0 NOT LIKE 'teacher_roster.%') OR NOT ('search_path=""'=ANY(p.proconfig)) THEN RAISE EXCEPTION 'TP1 원본/속성 불일치: %',r->>0;END IF;
 END LOOP;END $tp1$;
"""
 body=(HERE/'end-and-patch.sql.inc').read_text(encoding='utf-8')
 patch="""DO $tp1$ DECLARE r jsonb;d text;h text;BEGIN
 FOR r IN SELECT value FROM jsonb_array_elements($patches$"""+payload+"""$patches$::jsonb) LOOP
 SELECT pg_get_functiondef(to_regprocedure(r->>0)) INTO d;
 IF (length(d)-length(replace(d,r->>3,'')))/length(r->>3)<>(r->>5)::integer THEN RAISE EXCEPTION 'TP1 교체 개수 불일치';END IF;
 EXECUTE replace(d,r->>3,r->>4);
 SELECT md5(replace(prosrc,E'\\r\\n',E'\\n')) INTO h FROM pg_proc WHERE oid=to_regprocedure(r->>0);
 IF h<>r->>2 THEN RAISE EXCEPTION 'TP1 교체 후 원문 불일치';END IF;
 INSERT INTO teacher_pilot.patch_receipts(signature,before_hash,after_hash) VALUES(r->>0,r->>1,h);
 END LOOP;END $tp1$;
DO $$ DECLARE f regprocedure;BEGIN
 FOR f IN SELECT oid::regprocedure FROM pg_proc WHERE pronamespace='teacher_pilot'::regnamespace LOOP EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role',f);END LOOP;
END $$;
INSERT INTO teacher_pilot.installs(batch) VALUES('TP1-02');
COMMIT;
SELECT 'TP1-02' AS no,'ok' AS status,'시험 종료·AI 진입 보강을 설치했습니다. 시험 배치는 아직 허용하지 않았습니다.' AS detail;
"""
 return head+pre+body+patch
if __name__=='__main__':
 (HERE/'TP1-02_시험AI_연결종료.sql').write_text(build(),encoding='utf-8',newline='\n')
 (HERE/'patches.json').write_text(json.dumps(patches(),ensure_ascii=False,indent=2)+'\n',encoding='utf-8',newline='\n')
 payload=json.dumps(patches(),ensure_ascii=False,separators=(',',':'))
 pre="""-- 읽기 전용. 설치 전과 TP1-01·02 설치 직후 F1~F7을 비교한다. 계정 등록 이후에는 승인된 10명 추가분을 별도 대조한다.
WITH expected(v) AS(SELECT value FROM jsonb_array_elements($patches$"""+payload+"""$patches$::jsonb)), rows(no,item,status,value) AS(
SELECT 'TP1-00-01','TR1·OP1·P10 선행 설치',CASE WHEN to_regclass('teacher_roster.links') IS NOT NULL AND to_regclass('workhub.participant_grants') IS NOT NULL AND to_regclass('workhub.ai_school_policies') IS NOT NULL THEN 'ok' ELSE 'FAIL' END,NULL::text
UNION ALL SELECT 'TP1-00-02','TP1 설치 유무','info',coalesce(to_regnamespace('teacher_pilot')::text,'미설치')
UNION ALL SELECT 'TP1-00-03','기존 함수 원문 9개',CASE WHEN count(*)=9 AND bool_and(coalesce(md5(replace(p.prosrc,E'\\r\\n',E'\\n')) IN(e.v->>1,e.v->>2) AND p.proowner='postgres'::regrole,false)) THEN 'ok' ELSE 'FAIL' END,count(*)::text FROM expected e LEFT JOIN pg_proc p ON p.oid=to_regprocedure(e.v->>0)
UNION ALL SELECT 'TP1-00-04','명부·기본표 현황','info',jsonb_build_object('teachers',(SELECT count(*) FROM teacher_roster.teachers),'plans',(SELECT count(*) FROM teacher_roster.plans),'links',(SELECT count(*) FROM teacher_roster.links),'classes',(SELECT coalesce(sum(jsonb_array_length(body->'classes')),0) FROM teacher_roster.plans WHERE state='published'),'lessons',(SELECT coalesce(sum(jsonb_array_length(body->'lessons')),0) FROM teacher_roster.plans WHERE state='published'))::text
"""
 for n,table,omit in [(1,'public.users',[]),(2,'workhub.memberships',[]),(3,'workhub.membership_roles',[]),(4,'teacher_roster.plans',[]),(5,'teacher_roster.links',['tp1_end_date']),(6,'workhub.staff_assignments',['tp1_cancelled']),(7,'workhub.ai_school_policies',[])]:
  expr='to_jsonb(t)'+''.join("-'"+v+"'" for v in omit)
  pre+=f"UNION ALL SELECT 'F{n}','{table}','compare',jsonb_build_object('count',count(*),'md5',md5(coalesce(string_agg(v::text,chr(10) ORDER BY v::text),'')))::text FROM(SELECT {expr} v FROM {table} t) f\n"
 pre+=') SELECT * FROM rows ORDER BY no;\n'
 (HERE/'TP1-00_전후점검.sql').write_text(pre,encoding='utf-8',newline='\n')
