"""새 localhost PostgreSQL 17에서 기존 P1/P5/T1/P9와 TR1을 함께 검증한다. 운영 DSN을 받지 않는다."""
from pathlib import Path
import os, sys, json, datetime, copy, subprocess, concurrent.futures

ROOT = Path(__file__).resolve().parents[4]
if any(v and (k.upper().startswith('PG') or k.upper() in {'DATABASE_URL','SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY'}) for k,v in os.environ.items()):
    raise RuntimeError('외부 DB 접속 환경변수를 사용하지 않습니다.')
if len(sys.argv) != 1:
    raise RuntimeError('운영 DSN이나 실행 인자를 받지 않습니다.')
sys.path.insert(0,str(ROOT/'database/workhub-school-data/p9/test'))
import run_p9 as H
HERE = Path(__file__).resolve().parents[1]
CAPTURES=[]
def sql(folder, prefix):
    paths = list((ROOT/folder).glob(prefix+'_*.sql'))
    if len(paths) != 1: raise RuntimeError(prefix)
    H.file(paths[0])
def value(name,*args,uid=H.ADMIN):
    r=H.rpc(name, tuple(json.dumps(a,ensure_ascii=False) if isinstance(a,(dict,list)) else a for a in args),uid)
    if 'error' not in r:CAPTURES.append(dict(name=name,args=args,data=r['data']))
    return r
def tests():
    sql('database/workhub-school-data/p9','P9-01')
    sql('database/workhub-school-data/p9','P9-02')
    for n in ['01','02','03','07']: sql('database/workhub-timetable/t1','T1-'+n)
    for n in ['01','03','04','05','06']:sql('database/workhub-timetable/t2','T2-'+n)
    school,mid=H.q("SELECT m.school_id,m.id FROM workhub.memberships m JOIN workhub.accounts a ON a.id=m.account_id WHERE a.auth_user_id=%s",(H.ADMIN,))[0]
    H.q("INSERT INTO workhub.school_admin_activations(school_id,approved_by_membership_id,approval_ref,state) VALUES(%s,%s,'TR1 합성 시험','active')",(school,mid))
    original=H.q("SELECT (SELECT count(*) FROM auth.users),(SELECT count(*) FROM public.users),(SELECT count(*) FROM workhub.membership_roles),(SELECT count(*) FROM workhub.timetable_drafts)")
    sql('database/workhub-teacher-roster/tr1','TR1-01');sql('database/workhub-teacher-roster/tr1','TR1-02')
    get=lambda:value('workhub_teacher_roster_get',mid)['data']
    data=get();H.check('초기 명부·계획·연결 없음',data['revision']==0 and not data['teachers'] and not data['plans'] and not data['links'])
    p=json.loads((ROOT/'tests/fixtures/teacher-roster/nine-classes.json').read_text(encoding='utf-8'))['plan']
    today=H.q("SELECT workhub_private.today_in('Asia/Seoul')")[0][0]
    term=next((t for t in data['terms'] if datetime.date.fromisoformat(t['until'])>today+datetime.timedelta(days=8)),None)
    if term is None:raise RuntimeError('격리 DB의 시험 학기가 부족합니다.')
    p['termId']=term['id'];p['from']=max(today+datetime.timedelta(days=1),datetime.date.fromisoformat(term['from'])).isoformat();p['until']=term['until']
    p['homerooms']=[dict(classId=p['classes'][0]['id'],teacherId=p['teachers'][0]['id'])]
    for field,key,bad in [('teachers','name',''),('teachers','name',chr(0x85)),('teachers','name',chr(0xa0)+'교사'),('teachers','name','교사'+chr(0xfeff)),('teachers','id','x'*81),('courses','teacherId',None),('courses','classId',123),('slots','day',8),('slots','start',-1),('lessons','slotId','absent')]:
        broken=copy.deepcopy(p);broken[field][0][key]=bad
        H.check(field+'.'+key+' 입력 거절',value('workhub_teacher_roster_preview',mid,dict(kind='save',expectedRevision=0,plan=broken)).get('error',{}).get('code')=='INVALID_INPUT')
    def preview(i):return value('workhub_teacher_roster_preview',mid,i)['data']
    def command(v):return dict(previewId=v['id'],hash=v['hash'],intent=v['intent'])
    def apply(i,key):
        pr=preview(i);H.check(key+' 서버 미리보기 차단 없음',not pr['findings'])
        c=command(pr);r=value('workhub_teacher_roster_commit',mid,c,key)
        if 'error' in r:raise AssertionError(r)
        return c,r['data']
    save=dict(kind='save',expectedRevision=0,plan=p)
    c,r=apply(save,'tr1-save-request')
    H.check('가입 전 22명과 288교시 초안 저장',len(get()['teachers'])==22 and len(get()['plans'][0]['plan']['lessons'])==288)
    H.check('같은 요청 결과 복구',value('workhub_teacher_roster_commit',mid,c,'tr1-save-request')['data']==r)
    changed=copy.deepcopy(c);changed['intent']['plan']['title']='다른 명령'
    H.check('같은 번호 다른 본문 거절',value('workhub_teacher_roster_commit',mid,changed,'tr1-save-request')['error']['code']=='IDEMPOTENCY_CONFLICT')
    H.check('오래된 원본 판 거절',value('workhub_teacher_roster_preview',mid,save)['error']['code']=='CONFLICT')
    publish=dict(kind='publish',expectedRevision=1,planId=p['id'],version=1)
    c,r=apply(publish,'tr1-publish-request')
    H.check('미가입 교사만으로 시간표 확정',get()['plans'][0]['state']=='published')
    H.check('157개 실제 수업을 만들고 가짜 담당 계정은 만들지 않음',H.q('SELECT count(*) FROM teacher_roster.course_maps')[0][0]==157 and H.q('SELECT count(*) FROM workhub.course_assignments')[0][0]==0)
    H.check('기존 계정·역할·시간표 초안 보존',original==H.q("SELECT (SELECT count(*) FROM auth.users),(SELECT count(*) FROM public.users),(SELECT count(*) FROM workhub.membership_roles),(SELECT count(*) FROM workhub.timetable_drafts)"))
    # 이미 승인된 실제 소속만 선택한다. 로그인 계정·역할을 새로 만들지 않는다.
    linked=dict(kind='link',expectedRevision=2,teacherId=p['teachers'][0]['id'],memberId=mid,**{'from':today.isoformat(),'until':p['until']})
    c,r=apply(linked,'tr1-link-request')
    H.check('연결 후 계획 본문과 교시 그대로',get()['plans'][0]['plan']==p)
    H.check('연결된 교사의 담당 수업만 연결',H.q('SELECT count(*) FROM workhub.course_assignments')[0][0]==sum(x['teacherId']==p['teachers'][0]['id'] for x in p['courses']))
    H.check('확인한 담임만 실제 소속에 연결',H.q("SELECT count(*) FROM workhub.staff_assignments WHERE kind='homeroom' AND membership_id=%s",(mid,))[0][0]==1)
    H.check('과목마다 교과 담당 중복 없이 연결',H.q("SELECT count(*) FROM workhub.staff_assignments WHERE kind='subject' AND membership_id=%s",(mid,))[0][0]==len({x['subject'] for x in p['courses'] if x['teacherId']==p['teachers'][0]['id']}))
    H.check('동일 소속을 다른 명부에 중복 연결 거절',value('workhub_teacher_roster_preview',mid,{**linked,'expectedRevision':3,'teacherId':p['teachers'][1]['id']})['error']['code']=='CONFLICT')
    H.check('동일 명부를 같은 기간 중복 연결 거절',value('workhub_teacher_roster_preview',mid,{**linked,'expectedRevision':3})['error']['code']=='CONFLICT')
    H.check('없는 소속을 연결 거절',value('workhub_teacher_roster_preview',mid,{**linked,'expectedRevision':3,'memberId':'absent'})['error']['code']=='CONFLICT')
    H.check('가입 전 확정본을 덮어쓰기 거절',value('workhub_teacher_roster_preview',mid,{**save,'expectedRevision':3})['error']['code']=='CONFLICT')
    H.check('연결 후 일반 계정·역할 보존',original[:1]==H.q("SELECT (SELECT count(*) FROM auth.users),(SELECT count(*) FROM public.users),(SELECT count(*) FROM workhub.membership_roles),(SELECT count(*) FROM workhub.timetable_drafts)")[:1])
    # 종료된 요청은 늦게 도착해도 적용하지 않는다.
    another=copy.deepcopy(p);another['id']='another_plan'
    v=preview(dict(kind='save',expectedRevision=3,plan=another));c=command(v)
    closed=value('workhub_teacher_roster_close',mid,c,'tr1-close-request')['data']
    H.check('명시적 요청 닫기',closed==dict(outcome='closed',receipt=None))
    H.check('닫힌 뒤 늦은 저장 거절',value('workhub_teacher_roster_commit',mid,c,'tr1-close-request')['error']['code']=='CONFLICT')
    H.check('닫기 재확인 결과 동일',value('workhub_teacher_roster_close',mid,c,'tr1-close-request')['data']==closed)
    # 미확정 명령도 닫은 뒤 늦게 도착하면 쓰지 않는다. 모듈 중지 후 복구는 접수증을 먼저 확인한다.
    H.q('UPDATE teacher_roster.schools SET enabled=false WHERE school_id=%s',(school,))
    H.check('중지 뒤 새 미리보기 차단',value('workhub_teacher_roster_preview',mid,dict(kind='save',expectedRevision=3,plan=another))['error']['code']=='NOT_READY')
    H.check('중지 뒤 닫힌 요청 확인 유지',value('workhub_teacher_roster_close',mid,c,'tr1-close-request')['data']==closed)
    H.q('UPDATE teacher_roster.schools SET enabled=true WHERE school_id=%s',(school,))
    race=command(preview(dict(kind='save',expectedRevision=3,plan=another)))
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        results=list(pool.map(lambda _:value('workhub_teacher_roster_commit',mid,race,'tr1-race-request'),range(2)))
    H.check('동시 중복 접수 하나만 반영',results[0]==results[1] and get()['revision']==4)
    try:value('workhub_teacher_roster_get',mid,uid=H.TEACHER)
    except Exception:H.check('다른 로그인 관리자 소속 사칭 거절',True)
    else:raise AssertionError('다른 로그인으로 관리자 명부 조회')
    H.check('비활성 시간표 공개 조회 비노출',value('workhub_teacher_roster_published',mid,p['from'])['data']['plans']==[])
    H.q("INSERT INTO workhub.teaching_policies(school_id,counseling_scope,approved_by_membership_id,approval_ref) VALUES(%s,'off',%s,'TR1 합성 시험')",(school,mid))
    for module in ['teaching','timetable','timetable_operations']:
        H.q("INSERT INTO workhub.module_activations(school_id,module,state,approved_by_membership_id,approval_ref) VALUES(%s,%s,'active',%s,'TR1 합성 시험')",(school,module,mid))
    view=value('workhub_teacher_roster_published',mid,p['from'])['data']
    H.check('현재 운영 게이트를 통과한 288교시 공개 조회',view['available'] and len(view['plans'])==1 and len(view['plans'][0]['lessons'])==288)
    H.check('연결 계정의 내 기본 시간표 참조',view['myTeacherIds']==[p['teachers'][0]['id']])
    H.check('기간 밖 기본표 비노출',value('workhub_teacher_roster_published',mid,p['until'])['data']['plans']==[])
    post=H.file(HERE/'TR1-03_사후점검.sql');H.check('사후 점검 9행 FAIL 0',len(post)==9 and all(x[2]!='FAIL' for x in post))
    for role in ['anon','authenticated','service_role']:
        with H.connect() as conn:
            with conn.cursor() as cur:
                cur.execute('SET ROLE '+role)
                try:cur.execute('SELECT * FROM teacher_roster.teachers');raise AssertionError('표 직접 접근 허용')
                except Exception as e:
                    if 'permission denied' not in str(e):raise
                    H.check(role+' 직접 표 조회 거절',True)
    get()
    captures=H.WORK/'tr1-captures.json';captures.write_text(json.dumps(CAPTURES,ensure_ascii=False),encoding='utf-8')
    subprocess.run(['node',str(HERE/'test/validate_responses.mjs'),str(captures)],cwd=ROOT,check=True)
    print('APP_CAPTURE',captures,flush=True)
H.tests=tests
if __name__=='__main__':H.main()
