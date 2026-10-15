"""HWPX 원문 추출과 서버 권한 경로를 합성 ZIP으로 검증한다."""
import copy
import hashlib
import io
import sys
import zipfile
from datetime import datetime,timedelta,timezone
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/"apps/main/api/workhub-documents"))
from _guided_hwpx import HP,MappingError
from _knowledge_text import extract_text
from _knowledge_import import run,basic,CONTRACT,BUCKET
def sample(body):
    out=io.BytesIO()
    with zipfile.ZipFile(out,"w") as z:
        z.writestr("mimetype","application/hwp+zip")
        z.writestr("Contents/content.hpf","<manifest/>")
        z.writestr("META-INF/container.xml","<container/>")
        z.writestr("Contents/section0.xml",f'<s xmlns:hp="{HP}">{body}</s>')
    return out.getvalue()
RAW=sample('<hp:p><hp:run><hp:t>학교 규정</hp:t></hp:run><hp:run><hp:t> 제1조</hp:t></hp:run></hp:p><hp:p><hp:run><hp:t>협의한다.</hp:t></hp:run></hp:p>')
TOKEN="Bearer "+"a"*30
PAYLOAD={"memberId":"member","fileId":"file","requestKey":"request-one"}
ACTOR="11111111-1111-4111-8111-111111111111"
def env(data):return {"contract":CONTRACT,"schoolId":"school","memberId":"member","data":data}
class Client:
    def __init__(self):self.calls=[];self.downloads=[];self.raw=RAW;self.claim_change=None;self.finish_change=None
    def user(self,token):assert token==TOKEN;return ACTOR
    def rpc(self,name,args):
        self.calls.append((name,copy.deepcopy(args)))
        if name.endswith("_claim"):
            value=env({"state":"leased","leaseToken":"knowledge_lease_token","leaseExpiresAt":(datetime.now(timezone.utc)+timedelta(minutes=1)).isoformat(),"bucket":BUCKET,"path":"school/member/file/original.hwpx","fileVersion":1,"bytes":len(RAW),"sha256":hashlib.sha256(RAW).hexdigest(),"storageObjectId":"22222222-2222-4222-8222-222222222222","name":"학교규정.hwpx"})
            return self.claim_change(value) if self.claim_change else value
        value=env(args["p_result"])
        return self.finish_change(value) if self.finish_change else value
    def download(self,bucket,path,maximum):self.downloads.append((bucket,path));return self.raw
count=0
def check(name,fn):
    global count
    fn();count+=1;print("  ✓ "+name)
def reject(fn,code=None):
    try:fn()
    except (MappingError,basic.CheckError) as error:
        if code:assert error.code==code,(error.code,code)
        return
    raise AssertionError("거부되지 않았습니다")
def paragraphs():
    result=extract_text(RAW);assert [b["text"] for b in result["blocks"]]==["학교 규정 제1조","협의한다."];assert result["fileSha256"]==hashlib.sha256(RAW).hexdigest();assert result==extract_text(RAW);assert result["blocks"][0]["locator"]=="Contents/section0.xml / 문단 1"
check("여러 run의 실제 텍스트를 합치고 위치·해시를 고정한다",paragraphs)
def nested():
    body='<hp:p><hp:run><hp:tbl><hp:tr><hp:tc><hp:cellAddr rowAddr="0" colAddr="1"/><hp:p><hp:run><hp:t>표 셀 내용</hp:t></hp:run></hp:p></hp:tc></hp:tr></hp:tbl></hp:run></hp:p>'
    result=extract_text(sample(body));assert len(result["blocks"])==1 and result["blocks"][0]["text"]=="표 셀 내용";assert "1행 2열" in result["blocks"][0]["locator"]
check("중첩된 표 텍스트를 중복 계산하지 않고 실제 셀 위치를 보존한다",nested)
def omitted():
    result=extract_text(sample('<hp:p><hp:run><hp:t>내용<hp:lineBreak/>다음<hp:tab/>칸</hp:t></hp:run><hp:run><hp:pic/></hp:run><hp:run><hp:equation/></hp:run></hp:p>'));assert result["blocks"][0]["text"]=="내용\n다음\t칸" and result["omittedObjects"]==2
check("그림·수식은 추정하지 않고 누락 개수를 알린다",omitted)
check("그림만 있는 문서를 빈 본문 성공으로 처리하지 않는다",lambda:reject(lambda:extract_text(sample('<hp:p><hp:run><hp:pic/></hp:run></hp:p>')),"NO_TEXT"))
check("본문 한도 초과를 조용히 자르지 않는다",lambda:reject(lambda:extract_text(sample('<hp:p><hp:run><hp:t>'+'가'*100001+'</hp:t></hp:run></hp:p>')),"EXTRACTION_TOO_LARGE"))
check("외부 엔티티 선언을 읽지 않는다",lambda:reject(lambda:extract_text(sample('<!DOCTYPE x><hp:p><hp:run><hp:t>본문</hp:t></hp:run></hp:p>'))))
def success():
    c=Client();result=run(PAYLOAD,TOKEN,c);assert result["data"]["extraction"]==extract_text(RAW);assert c.calls[0][1]["p_actor_user_id"]==ACTOR;assert c.calls[-1][1]["p_storage_object_id"]=="22222222-2222-4222-8222-222222222222"
check("확인한 계정·원본 객체로만 추출을 확정한다",success)
check("원본 주소를 클라이언트에서 주입할 수 없다",lambda:reject(lambda:run({**PAYLOAD,"path":"other/file.hwpx"},TOKEN,Client()),"INVALID_INPUT"))
check("로그인 없이는 service 원본을 읽지 않는다",lambda:reject(lambda:run(PAYLOAD,None,Client()),"UNAUTHENTICATED"))
def altered(name,patch):
    def test():
        c=Client();c.claim_change=lambda value:(patch(value) or value);reject(lambda:run(PAYLOAD,TOKEN,c));assert not c.downloads
    check(name,test)
altered("다른 학교 응답과 경로의 조합을 거부한다",lambda v:v.update(schoolId="other"))
altered("다른 교사의 원본 파일 경로를 거부한다",lambda v:v["data"].update(path="school/other/file/original.hwpx"))
altered("다른 버킷 파일을 지식 원문으로 재사용하지 않는다",lambda v:v["data"].update(bucket="workhub-document-files"))
altered("원본 객체ID 누락을 거부한다",lambda v:v["data"].update(storageObjectId=None))
altered("만료된 원문추출 lease를 거부한다",lambda v:v["data"].update(leaseExpiresAt="2020-01-01T00:00:00Z"))
altered("경로 문자가 들어간 파일명을 거부한다",lambda v:v["data"].update(name="../원본.hwpx"))
def mismatch():
    c=Client();c.raw=RAW+b"changed";reject(lambda:run(PAYLOAD,TOKEN,c),"CONFLICT");assert len(c.calls)==1
check("다운로드 중 원본이 바뀌면 추출 결과를 확정하지 않는다",mismatch)
def lost():
    c=Client()
    def error(value):raise basic.CheckError("RESULT_UNKNOWN")
    c.finish_change=error;reject(lambda:run(PAYLOAD,TOKEN,c),"RESULT_UNKNOWN")
check("추출 완료 응답 유실은 원래 요청 재확인 상태로 남긴다",lost)
def completed():
    c=Client();expected={"fileId":"file","fileVersion":1,"name":"학교규정.hwpx","extraction":extract_text(RAW)};c.claim_change=lambda v:env({"state":"completed","result":expected});assert run(PAYLOAD,TOKEN,c)["data"]==expected and not c.downloads
check("같은 요청 재실행은 이미 고정한 추출문을 반환한다",completed)
print(f"전부 통과 — {count}건")
