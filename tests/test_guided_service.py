"""생성 서버의 권한·원본·결과 확정 계약. 실제 Supabase 호출은 하지 않는다."""
import copy
import hashlib
import io
import sys
import zipfile
from datetime import datetime, timedelta, timezone
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "apps/main/api/workhub-documents"))
from _guided_service import run, basic, request, BUCKET
from _guided_hwpx import inspect_template, HP

out=io.BytesIO()
with zipfile.ZipFile(out,"w") as z:
    z.writestr("mimetype","application/hwp+zip")
    z.writestr("Contents/content.hpf","<manifest/>")
    z.writestr("META-INF/container.xml","<container/>")
    z.writestr("Contents/section0.xml",f'<s xmlns:hp="{HP}"><hp:p><hp:run><hp:t>원문</hp:t></hp:run></hp:p></s>')
RAW=out.getvalue()
INSPECT=inspect_template(RAW)
A=INSPECT["anchors"][0]
MAP={"profile":"explicit_paragraph_v1","templateSha256":INSPECT["templateSha256"],"questions":[{"id":"q-one","label":"이름","kind":"text","required":True,"maxLength":100,"options":[],"anchorId":A["id"],"sourceText":A["sourceText"],"sourceHash":A["sourceHash"]}]}
ACTOR="11111111-1111-4111-8111-111111111111"
MEMBER="member-one"
TOKEN="Bearer "+"a"*30
def payload(action="inspect"):
    return {"action":action,"memberId":MEMBER,"templateId":"template-one","templateVersion":1,"responseId":"response-one" if action=="render" else None,"responseVersion":1 if action=="render" else None,"requestKey":"request-one"}
def envelope(data,school="school-one"):
    return {"contract":"guided.v1","schoolId":school,"memberId":MEMBER,"data":data}
class Client:
    def __init__(self):
        self.calls=[];self.uploads=[];self.downloads=[];self.raw=RAW;self.claim_change=None;self.finish_change=None
    def user(self,token):
        assert token==TOKEN
        return ACTOR
    def rpc(self,name,args):
        self.calls.append((name,copy.deepcopy(args)))
        if name.endswith("_claim"):
            source={"bucket":BUCKET,"ownerMemberId":MEMBER,"path":"school-one/member-one/template-one/source.hwpx","bytes":len(RAW),"sha256":hashlib.sha256(RAW).hexdigest(),"storageObjectId":"22222222-2222-4222-8222-222222222222"}
            value=envelope({"state":"leased","leaseToken":"lease_token_1234567890","leaseExpiresAt":(datetime.now(timezone.utc)+timedelta(minutes=2)).isoformat(),"source":source,"mapping":copy.deepcopy(MAP),"answers":{"q-one":"입력"},"target":{"artifactId":"artifact-one","bucket":BUCKET,"path":"school-one/member-one/artifact-one/output.hwpx"}})
            return self.claim_change(value) if self.claim_change else value
        value=envelope(copy.deepcopy(args["p_result"]))
        return self.finish_change(value) if self.finish_change else value
    def download(self,bucket,path,maximum):
        self.downloads.append((bucket,path,maximum));return self.raw
    def upload(self,path,raw):
        self.uploads.append((path,raw))
def rejected(fn,code=None):
    try:fn()
    except basic.CheckError as error:
        if code:assert error.code==code,(error.code,code)
        return
    raise AssertionError("거부되지 않았습니다")
count=0
def check(name,fn):
    global count
    fn();count+=1;print("  ✓ "+name)
def success_inspect():
    c=Client();result=run(payload(),TOKEN,c);assert result["data"]["inspection"]==INSPECT;assert len(c.calls)==2;assert c.calls[0][1]["p_actor_user_id"]==ACTOR;assert not c.uploads
check("로그인 사용자와 소속을 전달하고 실제 원본을 분석·확정한다",success_inspect)
def success_render():
    c=Client();result=run(payload("render"),TOKEN,c);assert len(c.uploads)==1;assert result["data"]["sha256"]==hashlib.sha256(c.uploads[0][1]).hexdigest();assert inspect_template(c.uploads[0][1])["anchors"][0]["sourceText"]=="입력";assert c.calls[-1][1]["p_source_object_id"]=="22222222-2222-4222-8222-222222222222"
check("저장된 매핑·응답으로 생성하고 원본 객체ID를 확정 단계에서 대조한다",success_render)
check("요청에 임의 파일 경로나 답변을 끼울 수 없다",lambda:rejected(lambda:request({**payload(),"path":"other/file.hwpx"}),"INVALID_INPUT"))
check("로그인 토큰이 없으면 원본을 조회하지 않는다",lambda:rejected(lambda:run(payload(),None,Client()),"UNAUTHENTICATED"))
def mutate_claim(name,change,action="inspect"):
    def test():
        c=Client();c.claim_change=lambda v:(change(v) or v);rejected(lambda:run(payload(action),TOKEN,c));assert not c.uploads
    check(name,test)
mutate_claim("다른 소속 envelope 거부",lambda v:v.update(memberId="other"))
mutate_claim("학교 경로가 다른 원본 거부",lambda v:v["data"]["source"].update(path="other/member-one/template-one/source.hwpx"))
mutate_claim("수합/메신저 버킷 ID 재사용 거부",lambda v:v["data"]["source"].update(bucket="workhub-collection-files"))
mutate_claim("객체ID가 없는 원본 거부",lambda v:v["data"]["source"].update(storageObjectId=None))
mutate_claim("만료된 생성 lease 거부",lambda v:v["data"].update(leaseExpiresAt="2020-01-01T00:00:00Z"))
mutate_claim("원본 크기 상한 초과 거부",lambda v:v["data"]["source"].update(bytes=10**9))
mutate_claim("출력 경로를 다른 사용자에게 보내지 않는다",lambda v:v["data"]["target"].update(path="school-one/other/artifact-one/output.hwpx"),"render")
mutate_claim("원본과 다른 질문 매핑 해시를 거부",lambda v:v["data"]["mapping"].update(templateSha256="0"*64),"render")
mutate_claim("서버에 저장된 필수 답변 누락은 생성 거부",lambda v:v["data"].update(answers={}),"render")
def damaged():
    c=Client();c.raw=RAW+b"changed";rejected(lambda:run(payload(),TOKEN,c),"CONFLICT");assert len(c.calls)==1
check("원본 bytes/hash 변경은 확정하지 않는다",damaged)
def mismatch_finish():
    c=Client();c.finish_change=lambda v:{**v,"data":{**v["data"],"templateVersion":2}};rejected(lambda:run(payload(),TOKEN,c),"INVALID_RESPONSE")
check("확정 응답이 다른 버전이면 성공으로 보이지 않는다",mismatch_finish)
def completed():
    c=Client();c.claim_change=lambda v:envelope({"state":"completed","result":{"templateId":"template-one","templateVersion":1,"inspection":INSPECT}});result=run(payload(),TOKEN,c);assert result["data"]["inspection"]==INSPECT;assert not c.downloads and not c.uploads and len(c.calls)==1
check("이미 확정한 요청은 파일 읽기·업로드 없이 기존 결과를 반환한다",completed)
def pending():
    c=Client();c.claim_change=lambda v:envelope({"state":"pending"});rejected(lambda:run(payload(),TOKEN,c),"RESULT_UNKNOWN");assert not c.downloads
check("처리 중인 같은 요청은 새 작업을 시작하지 않는다",pending)
def failed_finish():
    c=Client()
    def failure(value):raise basic.CheckError("RESULT_UNKNOWN")
    c.finish_change=failure;rejected(lambda:run(payload("render"),TOKEN,c),"RESULT_UNKNOWN");assert len(c.uploads)==1
check("출력 뒤 확정 응답 유실은 결과불명으로 남긴다",failed_finish)
print(f"전부 통과 — {count}건")
