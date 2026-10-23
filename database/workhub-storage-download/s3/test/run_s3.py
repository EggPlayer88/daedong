"""격리 PG17에서 학교 원문 가져오기·게시·과거판·Storage 경계를 대조한다."""
from pathlib import Path
import base64, json, os, subprocess, sys
ROOT = Path(__file__).resolve().parents[4]
HERE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'database/workhub-storage-download/s2/test'))
import run_s2 as S2
from build_s3_check import build, OLD, NEW
I = S2.I
SIGNATURE = 'workhub_storage.knowledge_readable(text,uuid)'

def tests():
    S2.tests()
    import run_p4 as P
    member = I.run('select m.id from workhub.memberships m join workhub.accounts a on a.id=m.account_id where a.auth_user_id=%s', (P.U1,))[0][0]
    adm = P.P(P.U1, member)
    if I.run("select workhub_private.p4_reason(%s,'knowledge')", (adm.school,))[0][0] != 'ready':
        P.sqlfile(None, text=P.fill_json(str(ROOT / 'database/workhub/p4/P4-04_자료문서함활성화_양식.sql'), dict(
            approver_user_id=P.U1, approval_ref='격리 학교 자료', document_school_share='school_admin')))
    P.sqlfile(None, text=P.fill_json(str(ROOT / 'database/workhub/p4/P4-05_원문가져오기_양식활성화_양식.sql'), dict(
        module='knowledge_import', approver_user_id=P.U1, approval_ref='격리 원문 가져오기', max_file_bytes=20971520,
        verification_ref='운영 아님: 실제 Python 코드·격리 SQL·합성 Storage')))
    raw = P.doc_hwpx('가상 학교 원문 회귀')
    prep = P.data(adm.ki_prepare(P.fmeta('원문 회귀.hwpx', raw)))
    assert prep, '원문 예약 실패'
    path, fid = prep['path'], prep['fileId']
    assert P.put_object(P.U1, P.KB, path, raw) == 'OK'
    extracted, calls = P.extract(adm, fid, P.key())
    assert isinstance(extracted, dict), extracted
    ex = P.data(extracted)['extraction']
    inp = P.kin(title='가상 원문 회귀', body='\n\n'.join(b['text'] for b in ex['blocks']), frm=P.DAY())
    imp = dict(fileId=fid, fileVersion=1, extractionSha256=ex['extractionSha256'], input=inp)
    receipt = P.data(adm.ki_commit(imp))
    assert receipt, '원문 연결 초안 실패'
    sid = receipt['id']
    access = adm.ki_original(sid, 1)
    read = lambda uid=P.U1, op='object.get_authenticated_info', name=path: P.can_read(uid, P.KB, name, op)
    I.H.check('실제 원문 추출·초안·접근 RPC와 본문 성공, 보강 전 info 거부 재현',
              ex['fileSha256'] == P.sha(raw) and len(ex['blocks']) == 4 and P.data(access)['available']
              and read(op='object.get_authenticated') and not read())
    patch = (HERE / 'S3-01_학교자료_Storage정보조회_호환.sql').read_text(encoding='utf-8')
    post = (HERE / 'S3-02_사후점검.sql').read_text(encoding='utf-8')
    manifest = build()
    I.H.check('INT-08 재생성 일치', (HERE / 'INT-08_SQL편집기용_통합점검.sql').read_text(encoding='utf-8') == manifest)
    I.H.check('보강 전 국소·통합 점검이 누락 탐지', any(r[2]=='FAIL' for r in I.run(post)) and any(r[2]=='FAIL' for r in I.run(manifest)))
    protected = ['auth.users','public.users','public.doc_submissions','storage.objects','storage.buckets',
                 'workhub.module_activations','workhub.audit_events','workhub.outbox'] + ['workhub.'+t for t in P.P4_TABLES]
    before = I.preserve(protected)
    props = 'select proowner,proacl,prosecdef,proconfig,provolatile from pg_proc where oid=%s::regprocedure'
    attrs = I.run(props, (SIGNATURE,))[0]
    policies = I.run("select * from pg_policies where schemaname='storage' order by policyname")
    olddef = I.run('select pg_get_functiondef(%s::regprocedure)', (SIGNATURE,))[0][0]
    I.run(olddef.replace('\n','\r\n')); I.run(patch)
    I.H.check('CRLF 원본 보강 후 사후 점검 7행 ok', len(I.run(post))==7 and all(r[2]=='ok' for r in I.run(post)))
    I.H.check('기존 회원·원문·추출문·문서·활성화·감사 보존', I.preserve(protected)==before)
    I.H.check('함수 속성·ACL·Storage 정책 보존', I.run(props,(SIGNATURE,))[0]==attrs and I.run("select * from pg_policies where schemaname='storage' order by policyname")==policies)
    for op in ('object.get_authenticated_info','storage.object.get_authenticated_info','object.get_authenticated','storage.object.get_authenticated'):
        I.H.check('초안 작성자 원문 허용 '+op, read(op=op))
    for op in ('object.list','object.list_v2','object.sign','object.get_public','object.get_signed','object.info','object.upload',''):
        I.H.check('원문 우회 경로 차단 '+repr(op), not read(op=op))
    for uid in (P.T[21],P.T[27],None):
        I.H.check('초안 타인·타학교·익명 차단 '+str(uid), not read(uid=uid) and not read(uid=uid,op='object.get_authenticated'))
    updated = {**inp, 'body':'정리본 개정 내용'}
    assert P.data(adm.kn(dict(kind='update',id=sid,expectedVersion=1,input=updated)))
    draft_history = P.data(adm.go('workhub_knowledge_get',sid,1))
    I.H.check('초안 정리본 수정 후 이전 본문·원본 보존', draft_history['source']['body']==inp['body'] and draft_history['isCurrent'] is False and P.data(adm.ki_original(sid,1))['sha256']==P.sha(raw))
    assert P.data(adm.kn(dict(kind='publish',id=sid,expectedVersion=2,reason='가상 원문 확인')))
    reader = P.P(P.T[21], P.M[21])
    I.H.check('게시 뒤 같은 학교 유효 교사에게 RPC·info·본문 허용', P.data(reader.ki_original(sid,3))['available'] and read(uid=P.T[21]) and read(uid=P.T[21],op='object.get_authenticated'))
    I.H.check('게시 뒤에도 다른 학교·익명 차단', not read(uid=P.T[27]) and not read(uid=None))
    I.H.check('게시된 판은 직접 덮어쓰지 않음', P.ecode(adm.kn(dict(kind='update',id=sid,expectedVersion=3,input=inp)))=='CONFLICT')
    assert P.data(adm.kn(dict(kind='retire',id=sid,expectedVersion=3,reason='격리 회귀 종료')))
    history = P.data(adm.go('workhub_knowledge_get',sid,3))
    I.H.check('종료 후 과거 게시판 본문·판·원본 보존', history['source']['body']==updated['body'] and history['isCurrent'] is False and P.data(adm.ki_original(sid,3))['sha256']==P.sha(raw))
    I.H.check('종료된 자료의 과거 게시판은 교사 열람 가능, 과거 초안은 불가', P.data(reader.ki_original(sid,3))['available'] and P.ecode(reader.ki_original(sid,1))=='NOT_FOUND' and read(uid=P.T[21]))
    for label, sql, args in [
        ('소속 중지',"update workhub.memberships set status='suspended' where id=%s",(member,)),
        ('계정 중지',"update workhub.accounts set status='suspended' where auth_user_id=%s",(P.U1,)),
        ('회원 승인 보류',"update workhub.accounts set legacy_approval_state='hold' where auth_user_id=%s",(P.U1,)),
        ('학교 중지',"update workhub.schools set status='suspended' where id=%s",(adm.school,)),
        ('객체 교체',"update storage.objects set id=gen_random_uuid() where bucket_id=%s and name=%s",(P.KB,path)),
    ]:
        with I.H.connect(db=I.DB) as c:
            with c.cursor() as cur:
                cur.execute('begin'); cur.execute(sql,args); cur.execute('set local role authenticated')
                for op in ('object.get_authenticated_info','object.get_authenticated'):
                    cur.execute("select set_config('request.jwt.claim.sub',%s,true),set_config('storage.operation',%s,true)",(P.U1,op))
                    cur.execute('select count(*) from storage.objects where bucket_id=%s and name=%s',(P.KB,path))
                    I.H.check(label+' 차단 '+op,cur.fetchone()[0]==0)
                cur.execute('rollback')
    P.stop('knowledge_import')
    I.H.check('가져오기 중지 때 원문 정보·본문 차단', not read() and not read(op='object.get_authenticated'))
    P.resume('knowledge_import'); I.H.check('재개 후 원본 그대로 조회',read())
    reserved = P.data(adm.ki_prepare(P.fmeta('예약 원문.hwpx',raw)))
    I.H.check('미업로드 예약의 정보 조회는 거부', not read(name=reserved['path']))
    I.H.check('보강 후 원문 업로드 유지',P.put_object(P.U1,P.KB,reserved['path'],raw)=='OK')
    I.H.check('실물 고정 전 info 허용 안 함',not read(name=reserved['path']))
    repeat = I.preserve(protected); I.run(patch)
    I.H.check('재실행은 자료·권한 그대로',I.preserve(protected)==repeat and I.run(props,(SIGNATURE,))[0]==attrs)
    newdef=I.run('select pg_get_functiondef(%s::regprocedure)',(SIGNATURE,))[0][0]
    I.run(newdef.replace('BEGIN','BEGIN\n-- 훼손 회귀',1))
    I.H.check('본문 훼손 국소·통합 점검 탐지',any(r[2]=='FAIL' for r in I.run(post)) and any(r[2]=='FAIL' for r in I.run(manifest)))
    rejected=False
    try:I.run(patch)
    except Exception as e:rejected='확정 P4 원본과 다릅니다' in str(e)
    I.H.check('알 수 없는 함수 자동 교체 거부',rejected);I.run(newdef)
    I.run(f'grant execute on function {SIGNATURE} to anon')
    I.H.check('익명 실행 권한 훼손 탐지',any(r[2]=='FAIL' for r in I.run(post)) and any(r[2]=='FAIL' for r in I.run(manifest)))
    rejected=False
    try:I.run(patch)
    except Exception as e:rejected='소유자·권한·실행 속성' in str(e)
    I.H.check('권한이 달라진 함수 보강 거부',rejected)
    I.run(f'revoke execute on function {SIGNATURE} from anon')
    I.run(olddef);I.run(patch)
    I.H.check('LF 보강도 같은 지문',I.run("select md5(replace(prosrc,chr(13),'')) from pg_proc where oid=%s::regprocedure",(SIGNATURE,))[0][0]==NEW)
    original=I.read(ROOT/'database/workhub-deployment/integration/INT-05_전체구축_통합점검.sql')
    assert original.count(OLD)==1
    expected=I.run(original.replace(OLD,NEW).replace(S2.OLD,S2.NEW).replace(S2.S1.OLD,S2.S1.NEW).replace('INT-05-','INT-08-'))
    with I.H.connect(db=I.DB) as c:
        with c.cursor() as cur:
            cur.execute('begin read only');cur.execute(manifest);rows=cur.fetchall();cur.execute('rollback')
    I.H.check('INT-08 읽기 전용 18행·기존 판정식 동일',rows==expected and len(rows)==18 and all(r[2]!='FAIL' for r in rows))
    capture=I.H.WORK/'s3-capture.json'
    capture.write_text(json.dumps(dict(scope=dict(schoolId=adm.school,memberId=member,userId=P.U1),context=adm.ctx(),
        access=adm.ki_original(sid,3),sourceId=sid,sourceVersion=3,bytes=base64.b64encode(raw).decode()),ensure_ascii=False),encoding='utf-8')
    result=subprocess.run(['node',str(HERE/'test/app_original.mjs'),str(capture)],cwd=ROOT,capture_output=True,text=True,encoding='utf-8')
    print(result.stdout,flush=True)
    if result.returncode:print(result.stderr,file=sys.stderr,flush=True)
    I.H.check('실제 SQL·과거판 원본 앱 어댑터 대조',result.returncode==0)
    adm.c.close();reader.c.close()

I.H.tests=tests
if __name__=='__main__':I.H.main()
