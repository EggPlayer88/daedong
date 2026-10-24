"""격리 PG17에서 S1 전체 회귀와 실제 문서 생성→정보·본문 RLS→앱 다운로드를 대조한다."""
from pathlib import Path
import base64,json,os,subprocess,sys
ROOT=Path(__file__).resolve().parents[4]
HERE=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'database/workhub-storage-download/s1/test'))
import run_s1 as S1
from build_s2_check import build,OLD,NEW
I=S1.I
SIGNATURE='workhub_storage.document_readable(text,uuid)'

def tests():
    S1.tests()
    os.environ['P4_APP_SRC']=str(ROOT)
    sys.path.insert(0,str(ROOT/'database/workhub/p4/test'))
    import run_p4 as P
    member=I.run('select m.id from workhub.memberships m join workhub.accounts a on a.id=m.account_id where a.auth_user_id=%s',(P.U1,))[0][0]
    adm=P.P(P.U1,member)
    P.sqlfile(None,text=P.fill_json(str(ROOT/'database/workhub/p4/P4-05_원문가져오기_양식활성화_양식.sql'),dict(
        module='guided',approver_user_id=P.U1,approval_ref='격리 회귀 질문형 양식',max_file_bytes=5000000,
        verification_ref='운영 아님: 실제 서버 코드와 로컬 PG 합성 Storage')))
    raw=P.tpl_hwpx('다운로드 호환 회귀')
    prep=P.data(adm.t_prepare(P.fmeta('합성 양식.hwpx',raw),'합성 양식'))
    assert prep, '양식 예약 실패'
    tid=prep['templateId'];source=prep['path']
    assert P.put_object(P.U1,P.DB,source,raw)=='OK'
    ins,_,_=P.guided(adm,'inspect',tid,1)
    assert isinstance(ins,dict),ins
    anchor=ins['data']['inspection']['anchors'][1]
    mapping=dict(profile='explicit_paragraph_v1',templateSha256=P.sha(raw),questions=[dict(
        id='name',label='성명',kind='text',required=True,maxLength=200,options=[],
        anchorId=anchor['id'],sourceText=anchor['sourceText'],sourceHash=anchor['sourceHash'])])
    assert P.data(adm.t(dict(kind='save_mapping',templateId=tid,expectedVersion=1,title='합성 양식',mapping=mapping)))
    response=P.data(adm.t(dict(kind='save_answers',templateId=tid,templateVersion=2,responseId=None,
        expectedVersion=0,answers={'name':'가상 교사'},preview=True)))
    assert response, '답변 저장 실패'
    rendered,_,_=P.guided(adm,'render',tid,2,response['responseId'],1)
    assert isinstance(rendered,dict),rendered
    artifact=rendered['data'];access=adm.art(artifact['artifactId']);path=P.data(access)['path']
    output=P.STORE[(P.DB,path)]
    from _guided_hwpx import inspect_template
    filled={a['id']:a['sourceText'] for a in inspect_template(output)['anchors']}
    I.H.check('실제 서버 코드·실제 SQL로 양식 분석·답변 저장·HWPX 생성',filled[anchor['id']]=='가상 교사' and artifact['sha256']==P.sha(output))
    read=lambda uid=P.U1,op='object.get_authenticated_info',name=path:P.can_read(uid,P.DB,name,op)
    I.H.check('수정 전 재현: 접근 RPC·본문 성공이지만 정보 조회는 거부',P.data(access) is not None and read(op='object.get_authenticated') and not read())
    patch=(HERE/'S2-01_생성문서_Storage정보조회_호환.sql').read_text(encoding='utf-8')
    post=(HERE/'S2-02_사후점검.sql').read_text(encoding='utf-8')
    manifest=build()
    I.H.check('INT-07 재생성 일치',(HERE/'INT-07_SQL편집기용_통합점검.sql').read_text(encoding='utf-8')==manifest)
    I.H.check('미보강 상태를 국소·통합 점검에서 탐지',any(r[2]=='FAIL' for r in I.run(post)) and any(r[2]=='FAIL' for r in I.run(manifest)))
    protected=['auth.users','public.users','public.doc_submissions','storage.objects','storage.buckets',
               'workhub.module_activations','workhub.file_access_grants','workhub.audit_events','workhub.outbox']+['workhub.'+t for t in P.P4_TABLES]
    before=I.preserve(protected)
    props="select proowner,proacl,prosecdef,proconfig,provolatile from pg_proc where oid=%s::regprocedure"
    attrs=I.run(props,(SIGNATURE,))[0]
    policies=I.run("select * from pg_policies where schemaname='storage' order by policyname")
    olddef=I.run('select pg_get_functiondef(%s::regprocedure)',(SIGNATURE,))[0][0]
    I.run(olddef.replace('\n','\r\n'));I.run(patch)
    I.H.check('CRLF 원본 보강 후 사후점검 6행 모두 ok',len(I.run(post))==6 and all(r[2]=='ok' for r in I.run(post)))
    I.H.check('기존 회원·문서·양식·응답·파일·활성화·감사 보존',I.preserve(protected)==before)
    I.H.check('함수 ACL·소유자·실행 속성과 Storage 정책 보존',I.run(props,(SIGNATURE,))[0]==attrs and I.run("select * from pg_policies where schemaname='storage' order by policyname")==policies)
    for op in ('object.get_authenticated_info','storage.object.get_authenticated_info','object.get_authenticated','storage.object.get_authenticated'):
        I.H.check('생성자 현재 파일 허용 '+op,read(op=op))
        I.H.check('양식 원본 브라우저 접근 거부 '+op,not read(op=op,name=source))
    for op in ('object.list','object.list_v2','object.sign','object.get_public','object.get_signed','object.info','object.upload',''):
        I.H.check('생성 파일 우회 경로 거부 '+repr(op),not read(op=op))
    for uid in (P.T[21],P.T[27],None):
        I.H.check('다른 교사·다른 학교·익명 정보와 본문 차단 '+str(uid),not read(uid=uid) and not read(uid=uid,op='object.get_authenticated'))
    P.stop('guided')
    I.H.check('모듈 중지 때 생성 파일 차단',not read() and not read(op='object.get_authenticated'))
    P.resume('guided');I.H.check('모듈 재개 후 원래 파일 조회 가능',read())
    # 시험 트랜잭션에서만 상태·객체를 바꾸고 항상 롤백한다.
    for label,sql,args in [
      ('소속 중지',"update workhub.memberships set status='suspended' where id=%s",(member,)),
      ('계정 중지',"update workhub.accounts set status='suspended' where auth_user_id=%s",(P.U1,)),
      ('회원 승인 보류',"update workhub.accounts set legacy_approval_state='hold' where auth_user_id=%s",(P.U1,)),
      ('학교 중지',"update workhub.schools set status='suspended' where id=%s",(adm.school,)),
      ('동일 경로 실물 교체',"update storage.objects set id=gen_random_uuid() where bucket_id=%s and name=%s",(P.DB,path)),
    ]:
        with I.H.connect(db=I.DB) as c:
            with c.cursor() as cur:
                cur.execute('begin');cur.execute(sql,args);cur.execute('set local role authenticated')
                for op in ('object.get_authenticated_info','object.get_authenticated'):
                    cur.execute("select set_config('request.jwt.claim.sub',%s,true),set_config('storage.operation',%s,true)",(P.U1,op))
                    cur.execute('select count(*) from storage.objects where bucket_id=%s and name=%s',(P.DB,path))
                    I.H.check(label+' '+op+' 거부',cur.fetchone()[0]==0)
                cur.execute('rollback')
    reserved=P.data(adm.t_prepare(P.fmeta('두번째 양식.hwpx',raw),'두번째 양식'))
    I.H.check('보강 후에도 양식 원본 예약·업로드 유지',reserved is not None and P.put_object(P.U1,P.DB,reserved['path'],raw)=='OK')
    before_repeat=I.preserve(protected);I.run(patch)
    I.H.check('재실행은 데이터·접근 권한 보존',I.preserve(protected)==before_repeat and I.run(props,(SIGNATURE,))[0]==attrs)
    newdef=I.run('select pg_get_functiondef(%s::regprocedure)',(SIGNATURE,))[0][0]
    I.run(newdef.replace('BEGIN','BEGIN\n-- 훼손 회귀',1))
    I.H.check('본문 훼손은 사후·통합 점검 탐지',any(r[2]=='FAIL' for r in I.run(post)) and any(r[2]=='FAIL' for r in I.run(manifest)))
    rejected=False
    try:I.run(patch)
    except Exception as e:rejected='확정 P4 원본과 다릅니다' in str(e)
    I.H.check('알 수 없는 본문은 덮어쓰지 않음',rejected);I.run(newdef)
    I.run(f'grant execute on function {SIGNATURE} to anon')
    I.H.check('익명 실행 권한 확대 탐지',any(r[2]=='FAIL' for r in I.run(post)) and any(r[2]=='FAIL' for r in I.run(manifest)))
    rejected=False
    try:I.run(patch)
    except Exception as e:rejected='소유자·권한·실행 속성' in str(e)
    I.H.check('권한이 달라진 함수에 자동 보강 거부',rejected)
    I.run(f'revoke execute on function {SIGNATURE} from anon')
    I.run(olddef);I.run(patch)
    I.H.check('LF 원본 경로도 동일 지문',I.run('select md5(replace(prosrc,chr(13),\'\')) from pg_proc where oid=%s::regprocedure',(SIGNATURE,))[0][0]==NEW)
    original=I.read(ROOT/'database/workhub-deployment/integration/INT-05_전체구축_통합점검.sql')
    assert original.count(OLD)==1 and original.count(S1.OLD)==1
    expected=I.run(original.replace(OLD,NEW).replace(S1.OLD,S1.NEW).replace('INT-05-','INT-07-'))
    with I.H.connect(db=I.DB) as c:
        with c.cursor() as cur:
            cur.execute('begin read only');cur.execute(manifest);rows=cur.fetchall();cur.execute('rollback')
    I.H.check('INT-07 읽기 전용 18행: 승인 지문 두 개 외 기존 판정 그대로',rows==expected and len(rows)==18 and all(r[2]!='FAIL' for r in rows))
    capture=I.H.WORK/'s2-capture.json'
    capture.write_text(json.dumps(dict(scope=dict(schoolId=adm.school,memberId=member,userId=P.U1),context=adm.ctx(),
        access=adm.art(artifact['artifactId']),bytes=base64.b64encode(output).decode()),ensure_ascii=False),encoding='utf-8')
    result=subprocess.run(['node',str(HERE/'test/app_download.mjs'),str(capture)],cwd=ROOT,capture_output=True,text=True,encoding='utf-8',
        env={**os.environ,'PYTHONUTF8':'1'})
    print(result.stdout,flush=True)
    if result.returncode:print(result.stderr,file=sys.stderr,flush=True)
    I.H.check('실제 SQL 응답·생성 바이트가 앱 다운로드 어댑터 4종 회귀 통과',result.returncode==0)
    adm.c.close()

I.H.tests=tests
if __name__=='__main__':I.H.main()
