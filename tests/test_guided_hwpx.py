"""실제 ZIP/XML로 확인하는 명시적 HWPX 매핑 회귀."""
import copy
import hashlib
import io
import sys
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "apps/main/api/workhub-documents"))
from _guided_hwpx import inspect_template, fill_template, validate_answers, validate_mapping, MappingError, HP

COUNT = 0
def check(name, run):
    global COUNT
    run()
    COUNT += 1
    print("  ✓ " + name)

def reject(run):
    try:
        run()
    except (MappingError, ValueError):
        return
    raise AssertionError("거부되지 않았습니다")

def make_xml(body=None):
    body = body or '<hp:p id="1"><hp:run charPrIDRef="0"><hp:t>이름</hp:t></hp:run><hp:linesegarray><hp:lineseg textpos="0"/></hp:linesegarray></hp:p><hp:p id="2"><hp:run><hp:t>수정하지 않는 문단</hp:t></hp:run></hp:p>'
    return f'<hs:sec xmlns:hs="http://www.hancom.co.kr/hwpml/2011/section" xmlns:hp="{HP}">{body}</hs:sec>'.encode()

def sample(xml=None):
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w") as z:
        z.writestr("mimetype", "application/hwp+zip", compress_type=zipfile.ZIP_STORED)
        z.writestr("Contents/section0.xml", xml or make_xml())
        z.writestr("Contents/content.hpf", "<manifest/>")
        z.writestr("META-INF/container.xml", "<container/>")
        z.writestr("BinData/image.png", b"original-image-bytes")
    return out.getvalue()

raw = sample()
source = inspect_template(raw)
anchor = source["anchors"][0]
q = {"id":"question-one", "label":"이름을 입력해 주세요", "kind":"text", "required":True, "maxLength":500, "options":[], "anchorId":anchor["id"], "sourceText":anchor["sourceText"], "sourceHash":anchor["sourceHash"]}
mapping = {"profile":"explicit_paragraph_v1", "templateSha256":source["templateSha256"], "questions":[q]}

def exact_fill():
    filled = fill_template(raw, mapping, {"question-one":"홍길동 & <교사>"})
    read = inspect_template(filled)
    assert [a["sourceText"] for a in read["anchors"]] == ["홍길동 & <교사>", "수정하지 않는 문단"]
    with zipfile.ZipFile(io.BytesIO(filled)) as z:
        assert z.read("BinData/image.png") == b"original-image-bytes"
        assert b"linesegarray" not in z.read("Contents/section0.xml")
        assert z.read("mimetype") == b"application/hwp+zip"
    assert fill_template(raw,mapping,{"question-one":"홍길동 & <교사>"}) == filled
check("정해진 문단만 채우고 XML 특수문자·이미지·비대상 문단을 보존한다", exact_fill)
check("원본 전체 SHA가 바뀌면 주소가 같아도 거부한다", lambda: reject(lambda: fill_template(sample(make_xml().replace(b'id="1"',b'id="9"')),mapping,{"question-one":"답"})))
for field,value in (("sourceText","다른 원문"),("sourceHash","0"*64),("anchorId","Contents/section0.xml:p999999")):
    check("매핑 원문·주소 위조 거부: "+field, lambda field=field,value=value: reject(lambda: validate_mapping({**mapping,"questions":[{**q,field:value}]},source)))
check("같은 칸 중복 질문을 거부한다", lambda: reject(lambda: validate_mapping({**mapping,"questions":[q,{**q,"id":"question-two"}]},source)))
check("필수 답변 누락을 거부한다", lambda: reject(lambda: fill_template(raw,mapping,{})))
check("정의하지 않은 답변 키를 거부한다", lambda: reject(lambda: validate_answers(mapping,{"unknown":"답"})))
check("빈 필수 칸도 임시저장에서는 허용한다", lambda: validate_answers(mapping,{},False))
check("답변 길이 제한을 적용한다", lambda: reject(lambda: validate_answers(mapping,{"question-one":"가"*501})))
check("일반 글 질문의 줄바꿈을 거부한다", lambda: reject(lambda: validate_answers(mapping,{"question-one":"가\n나"})))
def multiline():
    m={**mapping,"questions":[{**q,"kind":"longtext"}]}
    result=fill_template(raw,m,{"question-one":"첫 줄\n둘째 줄\n셋째 줄"})
    assert inspect_template(result)["anchors"][0]["sourceText"] == "첫 줄\n둘째 줄\n셋째 줄"
check("여러 줄 답변은 HWPX lineBreak로 채우고 재확인한다",multiline)
for value in ("0","-3.14"):
    check("숫자 입력 허용: "+value,lambda value=value:validate_answers({**mapping,"questions":[{**q,"kind":"number"}]},{"question-one":value}))
for value in ("1e20","NaN","+1","01"):
    check("숫자 표시를 임의 계산하지 않고 거부: "+value,lambda value=value:reject(lambda:validate_answers({**mapping,"questions":[{**q,"kind":"number"}]},{"question-one":value})))
check("없는 날짜를 거부한다",lambda:reject(lambda:validate_answers({**mapping,"questions":[{**q,"kind":"date"}]},{"question-one":"2026-02-30"})))
check("선택 항목 밖의 답변을 거부한다",lambda:reject(lambda:validate_answers({**mapping,"questions":[{**q,"kind":"select","options":["동의","미동의"]}]},{"question-one":"알 수 없음"})))
def unsupported():
    mixed='<hp:p><hp:run><hp:t>첫 서식</hp:t></hp:run><hp:run><hp:t>다른 서식</hp:t></hp:run></hp:p>'
    value=inspect_template(sample(make_xml(mixed+'<hp:p><hp:run><hp:t>단순 칸</hp:t></hp:run></hp:p>')))
    assert value["unsupportedParagraphs"] == 1 and len(value["anchors"]) == 1
check("혼합서식 문단은 자동 선택하지 않는다",unsupported)
def cell():
    xml=make_xml('<hp:p><hp:run><hp:tbl><hp:tr><hp:tc><hp:cellAddr colAddr="2" rowAddr="3"/><hp:subList><hp:p><hp:run><hp:t>셀 값</hp:t></hp:run></hp:p></hp:subList></hp:tc></hp:tr></hp:tbl></hp:run></hp:p>')
    value=inspect_template(sample(xml));assert value["anchors"][0]["cell"]=={"row":"3","column":"2"}
check("표 셀도 실제 문단 주소와 행·열을 제시한다",cell)
check("DTD와 외부 엔티티를 해석하지 않는다",lambda:reject(lambda:inspect_template(sample(b'<!DOCTYPE x [<!ENTITY bad SYSTEM "file:///etc/passwd">]>'+make_xml()))))
check("변형 JSON 매핑의 임의 필드·경로를 거부한다",lambda:reject(lambda:validate_mapping({**mapping,"xpath":"//*"},source)))
def corrupt_section():
    corrupted = raw.replace(b'<hs:sec ', b'<xs:sec ', 1)
    assert corrupted != raw
    try:
        inspect_template(corrupted)
    except MappingError as error:
        assert error.code == "UNSUPPORTED_TEMPLATE"
        return
    raise AssertionError("CRC 오류를 확정된 원본 오류로 분류하지 못했습니다")
check("본문 ZIP CRC 오류는 서버 결과 미확정 대신 원본 형식 오류로 반환한다", corrupt_section)
print(f"전부 통과 — {COUNT}건")
