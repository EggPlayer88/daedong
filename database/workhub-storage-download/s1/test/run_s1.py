"""운영 접속 없이 PG17 전체 설치 위에서 실제 RLS의 info→본문 다운로드를 시험한다."""
from pathlib import Path
import os,sys
ROOT=Path(__file__).resolve().parents[4]
HERE=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'database/workhub-deployment/integration/test'))
import run_integrated as I
from build_check import build,OLD,NEW
base_tests=I.tests

def tests():
    base_tests()
    os.environ['R0_PGHOST']='127.0.0.1'
    os.environ['R0_PG_PORT']=str(I.H.PORT)
    os.environ['R1_DIR']=str(ROOT/'database/workhub/r1')
    os.environ['R1S_API_DIR']=str(ROOT/'apps/main/api/collections')
    sys.path.insert(0,str(ROOT/'database/workhub/r1s/test'))
    import run_r1s as S
    S.r1.DB=I.DB
    S.fixtures()
    member=I.run('select m.id from workhub.memberships m join workhub.accounts a on a.id=m.account_id where a.auth_user_id=%s',(S.U1,))[0][0]
    adm=S.Who(S.U1,member)
    S.run_sql(S.activation(S.policies(['hwpx'],['hwpx'])))
    S.SVC=S.api(None,'service_role')
    form=S.coll_input(reviewMode='none',reviewerMemberId='',units=[dict(label='본인',responsibleMemberId=member,contributorMemberIds=[])],fileCollection=dict(policy=dict(extensions=['hwpx'],maxFileBytes=5000000,maxFiles=3),required=False,templates=[]))
    receipt=S.data(adm.mutate(dict(kind='create',input=form)))
    assert receipt, '수합 초안 생성 실패'
    rid=receipt['requestId'];parent=dict(kind='template',requestId=rid,version=1)
    raw=S.hwpx('가상 본인 수합')
    upload,_=S.prepare_put(adm,parent,'빈양식.hwpx',raw)
    S.storage_size(upload['path'],len(raw))
    result=S.api_check(adm,upload['fileId']);assert result['data']['state']=='ready',result
    form['fileCollection']['templates']=[result['data']['file']]
    assert S.data(adm.mutate(dict(kind='update',requestId=rid,expectedVersion=1,input=form)))
    parent['version']=2
    assert S.data(adm.rpc('workhub_file_access',parent,upload['fileId']))
    read=lambda uid=S.U1,op='object.get_authenticated_info':S.can_read_object(uid,upload['path'],op)
    I.H.check('수정 전: 본문 허용·실제 info 단계 거부로 장애 재현',read(op='object.get_authenticated') and not read())
    patch=(HERE/'S1-01_수합_Storage정보조회_호환.sql').read_text(encoding='utf-8')
    check=(HERE/'S1-02_사후점검.sql').read_text(encoding='utf-8')
    manifest=build()
    I.H.check('INT-06 저장 파일 재생성 일치',(HERE/'INT-06_SQL편집기용_통합점검.sql').read_text(encoding='utf-8')==manifest)
    I.H.check('INT-06은 미보강 상태를 성공으로 표시하지 않음',any(r[2]=='FAIL' for r in I.run(manifest)))
    protected=['auth.users','public.users','public.doc_submissions','storage.objects','workhub.collections','workhub.file_objects','workhub.file_access_grants','workhub.basic_profile_activations','workhub.module_activations']
    before=I.preserve(protected)
    attrs=I.run("select proowner,proacl,prosecdef,proconfig,provolatile from pg_proc where oid='workhub_storage.object_readable(text)'::regprocedure")[0]
    olddef=I.run("select pg_get_functiondef('workhub_storage.object_readable(text)'::regprocedure)")[0][0]
    # SQL Editor가 만든 CRLF도 같은 원본으로 검사한다.
    I.run(olddef.replace('\n','\r\n'));I.run(patch)
    I.H.check('CRLF 원본에 보강 후 사후점검 5행 모두 ok',len(I.run(check))==5 and all(r[2]=='ok' for r in I.run(check)))
    I.H.check('보강 시 기존 회원·자료·파일·접근 허가·활성화 보존',I.preserve(protected)==before)
    I.H.check('함수 소유자·ACL·SECURITY DEFINER·search_path·STABLE 보존',I.run("select proowner,proacl,prosecdef,proconfig,provolatile from pg_proc where oid='workhub_storage.object_readable(text)'::regprocedure")[0]==attrs)
    for op in ('object.get_authenticated_info','storage.object.get_authenticated_info','object.get_authenticated','storage.object.get_authenticated'):
        I.H.check('본인 현재판 접근 허가 '+op,read(op=op))
    for op in ('object.list','object.list_v2','object.sign','object.get_public','object.get_signed','object.info','object.upload',''):
        I.H.check('ready 파일 우회 작업 거부 '+repr(op),not read(op=op))
    for uid in (S.T[21],S.T[27],None):
        I.H.check('다른 교사·다른 학교·익명 접근 거부 '+str(uid),not read(uid=uid))
    # 시험 트랜잭션 안에서만 회수·만료를 재현한 뒤 항상 되돌린다.
    for label,sql in [
      ('회수된 허가',"update workhub.file_access_grants set revoked_at=clock_timestamp(),revoke_reason='test_revoke' where file_id=%s"),
      ('만료된 허가',"""with revoked as (
          update workhub.file_access_grants set revoked_at=clock_timestamp(),revoke_reason='test_expired'
          where file_id=%s returning *
        ) insert into workhub.file_access_grants
          (school_id,file_id,granted_to_account_id,granted_membership_id,method,
           resource_type,resource_id,resource_version,collection_id,unit_id,issued_at,expires_at)
        select school_id,file_id,granted_to_account_id,granted_membership_id,method,
          resource_type,resource_id,resource_version,collection_id,unit_id,
          clock_timestamp()-interval '10 minutes',clock_timestamp()-interval '5 minutes'
        from revoked"""),
    ]:
        with I.H.connect(db=I.DB) as c:
            with c.cursor() as cur:
                cur.execute('begin');cur.execute(sql,(upload['fileId'],))
                cur.execute('set local role authenticated')
                cur.execute("select set_config('request.jwt.claim.sub',%s,true),set_config('storage.operation','object.get_authenticated_info',true)",(S.U1,))
                cur.execute("select count(*) from storage.objects where name=%s",(upload['path'],))
                I.H.check(label+'로 파일 정보 조회 거부',cur.fetchone()[0]==0);cur.execute('rollback')
    I.run(patch);I.H.check('보강 재실행은 자료와 권한 그대로',I.preserve(protected)==before)
    newdef=I.run("select pg_get_functiondef('workhub_storage.object_readable(text)'::regprocedure)")[0][0]
    # 원문 일부 훼손을 허용 목록으로 뭉뚱그리지 않는다.
    I.run(newdef.replace('BEGIN','BEGIN\n-- 훼손 시험',1))
    I.H.check('함수 본문 훼손은 국소·통합 양쪽 탐지',any(r[2]=='FAIL' for r in I.run(check)) and any(r[2]=='FAIL' for r in I.run(manifest)))
    rejected=False
    try:I.run(patch)
    except Exception as error:rejected='확정 R1 원본과 다릅니다' in str(error)
    I.H.check('다른 원문 자동 덮어쓰기 거부',rejected);I.run(newdef)
    # LF 원본 경로도 별도로 실행한다.
    I.run(olddef);I.run(patch)
    I.H.check('LF 원본 교체 결과도 같은 지문',I.run("select md5(replace(prosrc,chr(13),'')) from pg_proc where oid='workhub_storage.object_readable(text)'::regprocedure")[0][0]==NEW)
    # 기존 목록 전체에서 승인 지문 1개만 교체했는지와 판정식 자체를 대조한다.
    original=I.read(I.ROOT/'database/workhub-deployment/integration/INT-05_전체구축_통합점검.sql')
    assert original.count(OLD)==1
    expected=I.run(original.replace(OLD,NEW).replace('INT-05-','INT-06-'))
    with I.H.connect(db=I.DB) as c:
        with c.cursor() as cur:
            cur.execute('begin read only');cur.execute(manifest);rows=cur.fetchall();cur.execute('rollback')
    I.H.check('편집기용 전체 18행은 원본의 승인 지문 1개 교체와 동일',rows==expected and len(rows)==18 and all(r[2]!='FAIL' for r in rows))
    assert S.data(adm.mutate(dict(kind='update',requestId=rid,expectedVersion=2,input={**form,'instructions':'다른 곳에서 수정'})))
    I.H.check('부모판 변경 뒤 이전 허가로 info·본문 모두 거부',not read() and not read(op='object.get_authenticated'))
    parent['version']=3;assert S.data(adm.rpc('workhub_file_access',parent,upload['fileId']))
    I.H.check('현재판 허가 재발급 후 정상 읽기',read())
    S.SVC.close();adm.c.close()

I.H.tests=tests
if __name__=='__main__':I.H.main()
