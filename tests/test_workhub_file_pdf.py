"""실제 PDF 원문·압축 스트림으로 준비용 검사기의 경계와 미지원 판정을 검증한다."""
import base64
from contextlib import redirect_stderr
from io import BytesIO, StringIO
from pathlib import Path
import re
import sys
import zlib

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from workers.collection_files import pdf_inspection as module
from workers.collection_files.pdf_inspection import inspect_pdf
from pypdf import PdfWriter
from PIL import Image, ImageFile

LIMITS = {"max_archive_entries": 1000, "max_entry_bytes": 32 * 1024 * 1024,
          "max_expanded_bytes": 64 * 1024 * 1024, "max_compression_ratio": 1000,
          "max_xml_bytes": 16 * 1024 * 1024}


def stream(data=b"q Q", dictionary=b""):
    return b"<< /Length " + str(len(data)).encode() + b" " + dictionary + b" >>\nstream\n" + data + b"\nendstream"


def basic():
    return {
        1: b"<< /Type /Catalog /Pages 2 0 R >>",
        2: b"<< /Type /Pages /Count 1 /Kids [3 0 R] >>",
        3: b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << >> /Contents 4 0 R >>",
        4: stream(),
    }


def pdf(objects=None, trailer=b"", extra=b""):
    objects = basic() if objects is None else objects
    result = bytearray(b"%PDF-1.7\n%\xe2\xe3\xcf\xd3\n")
    offsets = {}
    for number, body in objects.items():
        offsets[number] = len(result)
        result.extend(str(number).encode() + b" 0 obj\n" + body + b"\nendobj\n")
    result.extend(extra)
    start = len(result)
    size = max(objects) + 1
    result.extend(b"xref\n0 " + str(size).encode() + b"\n0000000000 65535 f \n")
    for number in range(1, size):
        result.extend((f"{offsets[number]:010} 00000 n \n" if number in objects else "0000000000 00000 f \n").encode())
    result.extend(b"trailer\n<< /Size " + str(size).encode() + b" /Root 1 0 R " + trailer + b" >>\nstartxref\n" + str(start).encode() + b"\n%%EOF\n")
    return bytes(result)


def checked(data=None, objects=None, limits=None):
    return inspect_pdf(pdf(objects) if data is None else data, LIMITS if limits is None else limits)


def verdict(data=None, objects=None, status="rejected", code=None, limits=None):
    result = checked(data, objects, limits)
    assert result["status"] == status, result
    if code is not None:
        assert result["code"] == code, result
    assert set(result) == {"status", "code", "mime"} and result["mime"] == "application/pdf"


passed = failed = 0


def test(label, callback):
    global passed, failed
    try:
        callback()
        passed += 1
        print(f"  ✓ {label}")
    except Exception as error:
        failed += 1
        print(f"  ✗ {label}: {error!r}")


test("일반 xref와 실제 페이지·내용 스트림을 가진 PDF 통과", lambda: verdict(status="passed"))


def writer_pdf():
    writer = PdfWriter()
    writer.add_blank_page(width=595, height=842)
    writer.add_metadata({"/Title": "교사 문서 제출"})
    output = BytesIO()
    writer.write(output)
    verdict(output.getvalue(), status="passed")


test("pypdf가 실제 생성한 한글 메타데이터 PDF 통과", writer_pdf)

for name, payload in (("빈 파일", b""), ("다른 파일", b"PK\x03\x04"),
                      ("앞에 끼운 실행 코드", b"MZ" + pdf()), ("뒤에 끼운 데이터", pdf() + b"MZ"),
                      ("EOF 누락", pdf()[:-6]), ("xref 위치 변조", re.sub(rb"startxref\n\d+", b"startxref\n1", pdf())),
                      ("등재되지 않은 객체", pdf(extra=b"99 0 obj\nnull\nendobj\n")),
                      ("객체 끝 누락", pdf().replace(b"q Q\nendstream\nendobj", b"q Q\nendstream\nXXXXXX"))):
    test(name + " 거부", lambda payload=payload: verdict(payload))


def corrupt_xref():
    data = pdf()
    row = re.search(rb"\d{10} 00000 n", data)
    data = data[:row.start()] + b"0000000001" + data[row.start() + 10:]
    verdict(data, code="pdf_xref_invalid")


test("객체를 나중에 찾아 복구할 수 있어도 잘못된 xref offset 거부", corrupt_xref)
test("트레일러 Size 불일치 거부", lambda: verdict(pdf().replace(b"/Size 5", b"/Size 9")))
test("트레일러 중복 키 거부", lambda: verdict(pdf(trailer=b"/Root 1 0 R")))
test("이전 revision 참조는 명시 미지원", lambda: verdict(pdf(trailer=b"/Prev 9"), status="unsupported", code="pdf_incremental_unsupported"))
test("혼합 xref 표는 명시 미지원", lambda: verdict(pdf(trailer=b"/XRefStm 9"), status="unsupported"))
test("암호화 트레일러는 빈 비밀번호 여부와 무관하게 거부", lambda: verdict(pdf(trailer=b"/Encrypt 4 0 R"), code="document_encrypted"))


def encrypted_writer():
    writer = PdfWriter()
    writer.add_blank_page(width=100, height=100)
    writer.encrypt("")
    output = BytesIO(); writer.write(output)
    verdict(output.getvalue(), code="document_encrypted")


test("빈 비밀번호로 실제 암호화된 PDF도 거부", encrypted_writer)


def with_object(body):
    objects = basic(); objects[5] = body
    return objects


for label, body in (("JavaScript", rb"<< /S /JavaScript /JS (alert\(1\)) >>"),
                    ("이름 이스케이프 JavaScript", b"<< /Java#53cript 3 0 R >>"),
                    ("Launch", b"<< /S /Launch /F (a.exe) >>"),
                    ("외부 문서 이동", b"<< /S /GoToR /F (a.pdf) >>"),
                    ("양식 전송", b"<< /S /SubmitForm /F (https://example.test) >>"),
                    ("XFA", b"<< /XFA (x) >>"), ("첨부 파일", b"<< /EmbeddedFiles [] >>"),
                    ("파일 명세", b"<< /Type /Filespec /F (a.exe) >>"),
                    ("연결 파일", b"<< /AF [4 0 R] >>"), ("자동 열기 동작", b"<< /OpenAction [3 0 R /Fit] >>"),
                    ("추가 동작", b"<< /AA << >> >>"), ("리치 미디어", b"<< /Subtype /RichMedia >>"),
                    ("PostScript XObject", stream(b"0 0 moveto", b"/Type /XObject /Subtype /PS")),
                    ("PostScript 대체 형식", stream(b"0 0 moveto", b"/Type /XObject /Subtype /Form /Subtype2 /PS")),
                    ("PostScript 대체 키", b"<< /PS 4 0 R >>"),
                    ("외부 스트림", stream(b"", b"/F (https://example.test)"))):
    test(label + "은 도달하지 않는 객체에서도 거부", lambda body=body: verdict(objects=with_object(body)))


def link(uri):
    objects = basic()
    objects[5] = b"<< /Type /Annot /Subtype /Link /A << /S /URI /URI (" + uri + b") >> >>"
    return objects


test("수동 HTTPS 링크는 파일 외부 내용을 로드하지 않고 구조만 허용", lambda: verdict(objects=link(b"https://school.example/a"), status="passed"))
test("javascript URI 거부", lambda: verdict(objects=link(b"javascript:alert")))
test("로컬 파일 URI 거부", lambda: verdict(objects=link(b"file:///secret")))
test("알 수 없는 링크 동작 거부", lambda: verdict(objects=with_object(b"<< /A << /S /Unknown >> >>")))
test("체인 동작 거부", lambda: verdict(objects=with_object(b"<< /Type /Action /S /GoTo /D [3 0 R /Fit] /Next << /S /GoTo >> >>")))


for label, body in (("없는 객체 참조", b"<< /Missing 55 0 R >>"),
                    ("직접 중복 키", b"<< /Title (a) /Title (b) >>"),
                    ("객체 스트림", stream(b"", b"/Type /ObjStm /N 1 /First 0"))):
    test(label + "는 성공하지 않음", lambda body=body: verdict(objects=with_object(body), status="unsupported" if b"/ObjStm" in body else "rejected"))


def encoded(raw, filters):
    objects = basic(); objects[4] = stream(raw, b"/Filter " + filters)
    return objects


for label, payload, filters in (
        ("Flate", zlib.compress(b"q Q"), b"/FlateDecode"),
        ("ASCIIHex", b"712051>", b"/ASCIIHexDecode"),
        ("ASCII85", base64.a85encode(b"q Q") + b"~>", b"/ASCII85Decode"),
        ("RunLength", b"\x02q Q\x80", b"/RunLengthDecode"),
        ("ASCII85와 Flate 연결", base64.a85encode(zlib.compress(b"q Q")) + b"~>", b"[/ASCII85Decode /FlateDecode]")):
    test(label + " 스트림 검사 통과", lambda payload=payload, filters=filters: verdict(objects=encoded(payload, filters), status="passed"))

for label, payload, filters in (
        ("손상 Flate", b"bad", b"/FlateDecode"),
        ("잘린 Flate", zlib.compress(b"q Q")[:-1], b"/FlateDecode"),
        ("Flate 뒤 숨긴 데이터", zlib.compress(b"q Q") + b"hidden", b"/FlateDecode"),
        ("손상 ASCIIHex", b"ZZ>", b"/ASCIIHexDecode"),
        ("ASCIIHex 종료 누락", b"71", b"/ASCIIHexDecode"),
        ("손상 ASCII85", b"xxxx~>hidden", b"/ASCII85Decode"),
        ("RunLength 종료 누락", b"\x02q Q", b"/RunLengthDecode"),
        ("잘린 RunLength", b"\x05x", b"/RunLengthDecode")):
    test(label + " 거부", lambda payload=payload, filters=filters: verdict(objects=encoded(payload, filters)))

for codec in (b"/JBIG2Decode", b"/JPXDecode", b"/CCITTFaxDecode", b"/LZWDecode", b"/Crypt"):
    test(codec.decode() + "는 지원한다고 추정하지 않음", lambda codec=codec: verdict(objects=encoded(b"data", codec), status="unsupported"))

test("압축 확장 바이트 한도", lambda: verdict(objects=encoded(zlib.compress(b"x" * 10000), b"/FlateDecode"), limits={**LIMITS, "max_entry_bytes": 1000}))
test("압축 비율 한도", lambda: verdict(objects=encoded(zlib.compress(b"x" * 10000), b"/FlateDecode"), limits={**LIMITS, "max_compression_ratio": 3}))
test("객체 수 한도", lambda: verdict(limits={**LIMITS, "max_archive_entries": 2}))
test("전체 확장 합계 한도", lambda: verdict(objects={**basic(), 5: stream(b"A" * 20), 6: stream(b"B" * 20)}, limits={**LIMITS, "max_expanded_bytes": 30}))
test("해석하지 않은 predictor는 미지원", lambda: verdict(objects={**basic(), 4: stream(zlib.compress(b"q Q"), b"/Filter /FlateDecode /DecodeParms << /Predictor 12 >>")}, status="unsupported"))


def image_objects(width=16, height=16):
    output = BytesIO()
    Image.new("RGB", (width, height), (12, 24, 128)).save(output, "JPEG")
    objects = basic()
    objects[5] = stream(output.getvalue(), f"/Type /XObject /Subtype /Image /Width {width} /Height {height} /BitsPerComponent 8 /ColorSpace /DeviceRGB /Filter /DCTDecode".encode())
    return objects


test("JPEG 스캔 이미지가 들어 있는 실제 PDF 구조 통과", lambda: verdict(objects=image_objects(), status="passed"))
test("JPEG 이미지 픽셀 확장 한도", lambda: verdict(objects=image_objects(100, 100), limits={**LIMITS, "max_entry_bytes": 2000}))


def wrong_image_size():
    objects = image_objects(); objects[5] = objects[5].replace(b"/Width 16", b"/Width 17")
    verdict(objects=objects)


test("JPEG 헤더와 PDF 이미지 크기가 다르면 거부", wrong_image_size)


def corrupt_jpeg():
    objects = image_objects()
    objects[5] = stream(b"\xff\xd8bad\xff\xd9", b"/Subtype /Image /Width 16 /Height 16 /BitsPerComponent 8 /Filter /DCTDecode")
    verdict(objects=objects)


test("JPEG 시작과 끝만 맞춘 가짜 이미지 거부", corrupt_jpeg)


def relaxed_pillow():
    old = ImageFile.LOAD_TRUNCATED_IMAGES
    try:
        ImageFile.LOAD_TRUNCATED_IMAGES = True
        verdict(objects=image_objects(), status="error", code="pdf_image_parser_configuration")
    finally:
        ImageFile.LOAD_TRUNCATED_IMAGES = old


test("잘린 이미지를 허용하도록 완화된 외부 프로세스 설정 거부", relaxed_pillow)


def page_change(number, value):
    objects = basic(); objects[number] = value
    return objects


for label, number, body in (
        ("페이지 개수 불일치", 2, b"<< /Type /Pages /Count 2 /Kids [3 0 R] >>"),
        ("순환 페이지", 2, b"<< /Type /Pages /Count 1 /Kids [2 0 R] >>"),
        ("중복 페이지", 2, b"<< /Type /Pages /Count 2 /Kids [3 0 R 3 0 R] >>"),
        ("부모 누락", 3, b"<< /Type /Page /MediaBox [0 0 595 842] >>"),
        ("부모 불일치", 3, b"<< /Type /Page /Parent 1 0 R /MediaBox [0 0 595 842] >>"),
        ("빈 페이지 트리", 2, b"<< /Type /Pages /Count 0 /Kids [] >>"),
        ("뒤집힌 페이지 크기", 3, b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 -1 842] >>"),
        ("비스트림 페이지 본문", 3, b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents (bad) >>"),
        ("카탈로그 종류 오류", 1, b"<< /Type /Wrong /Pages 2 0 R >>")):
    test(label + " 거부", lambda number=number, body=body: verdict(objects=page_change(number, body)))


def inherited_size():
    objects = basic()
    objects[2] = b"<< /Type /Pages /Count 1 /Kids [3 0 R] /MediaBox [0 0 595 842] >>"
    objects[3] = b"<< /Type /Page /Parent 2 0 R /Resources << >> /Contents 4 0 R >>"
    verdict(objects=objects, status="passed")


test("부모에서 물려받은 페이지 크기 지원", inherited_size)
test("깊은 직접 객체 그래프 거부", lambda: verdict(objects=with_object(b"[" * 100 + b"null" + b"]" * 100)))
test("깨진 검사 입력은 오류", lambda: verdict(data=b"", limits={**LIMITS, "max_entry_bytes": True}, status="error"))


def missing_dependency():
    original = module.pypdf
    try:
        module.pypdf = None
        verdict(status="error", code="pdf_parser_unavailable")
    finally:
        module.pypdf = original


test("파서 미설치는 성공/스킵으로 바꾸지 않음", missing_dependency)


def ascii85_preflight():
    old = module.base64.a85decode
    try:
        def forbidden(*args, **kwargs):
            raise AssertionError("한도 전에 디코더 호출")
        module.base64.a85decode = forbidden
        verdict(objects=encoded(b"z" * 2000 + b"~>", b"/ASCII85Decode"),
                limits={**LIMITS, "max_entry_bytes": 4000}, code="pdf_stream_limit")
    finally:
        module.base64.a85decode = old


test("ASCII85 z 축약은 실제 디코딩 전에 확장 한도를 검사", ascii85_preflight)
test("ASCII85 큰 반복도 작은 그룹 단위로 정상 해제", lambda: verdict(objects=encoded(b"z" * 20000 + b"~>", b"/ASCII85Decode"), status="passed"))
test("ASCII85 5자리 그룹 중간의 z 거부", lambda: verdict(objects=encoded(b"!z~>", b"/ASCII85Decode")))
test("픽셀값이 큰 비JPEG 이미지도 헤더 단계에서 거부", lambda: verdict(objects={**basic(), 5: stream(b"", b"/Subtype /Image /Width 999999 /Height 999999 /Filter /FlateDecode")}, code="pdf_image_pixels_limit"))


def missing_image_dependency():
    old = module.Image
    try:
        objects = image_objects()
        module.Image = None
        verdict(objects=objects, status="error", code="pdf_image_parser_unavailable")
    finally:
        module.Image = old


test("JPEG 파서 미설치도 검사 성공으로 바꾸지 않음", missing_image_dependency)


def parser_version_changed():
    old = module.PYPDF_VERSION
    try:
        module.PYPDF_VERSION = "unknown"
        verdict(status="error", code="pdf_parser_version_unsupported")
    finally:
        module.PYPDF_VERSION = old


test("검증하지 않은 파서 버전은 자동 활성화하지 않음", parser_version_changed)

test("실제 본문의 BI 연산자는 명시 미지원", lambda: verdict(objects={**basic(), 4: stream(b"BI /W 1 /H 1 /F /JPXDecode ID data EI")}, status="unsupported", code="pdf_inline_image_unsupported"))
test("Flate 본문 안의 BI도 명시 미지원", lambda: verdict(objects=encoded(zlib.compress(b"BI /W 1 /H 1 ID x EI"), b"/FlateDecode"), status="unsupported", code="pdf_inline_image_unsupported"))
test("문자열 BI는 인라인 이미지로 오인하지 않음", lambda: verdict(objects={**basic(), 4: stream(b"BT (BI is text) Tj ET")}, status="passed"))
test("주석 BI는 인라인 이미지로 오인하지 않음", lambda: verdict(objects={**basic(), 4: stream(b"% BI comment\nq Q")}, status="passed"))
test("Form XObject의 BI도 명시 미지원", lambda: verdict(objects={**basic(), 5: stream(b"BI /W 1 /H 1 ID x EI", b"/Type /XObject /Subtype /Form")}, status="unsupported", code="pdf_inline_image_unsupported"))
test("Tiling pattern의 BI도 명시 미지원", lambda: verdict(objects={**basic(), 5: stream(b"BI /W 1 /H 1 ID x EI", b"/Type /Pattern /PatternType 1")}, status="unsupported", code="pdf_inline_image_unsupported"))
test("폰트와 CMap 스트림의 BI 문자열은 본문으로 파싱하지 않음", lambda: verdict(objects={**basic(), 5: stream(b"BI", b"/Type /CMap")}, status="passed"))


def content_array():
    objects = basic()
    objects[3] = objects[3].replace(b"/Contents 4 0 R", b"/Contents [4 0 R 5 0 R]")
    objects[4] = stream(b"BT (BI is")
    objects[5] = stream(b" text) Tj ET")
    verdict(objects=objects, status="passed")


test("여러 본문 스트림에 걸친 문자열도 논리적으로 이어서 검사", content_array)


def operations_limit():
    old = module.MAX_CONTENT_OPERATIONS
    try:
        module.MAX_CONTENT_OPERATIONS = 100
        verdict(objects={**basic(), 4: stream(b"q Q\n" * 100)}, code="pdf_content_operations_limit")
    finally:
        module.MAX_CONTENT_OPERATIONS = old


test("그리기 연산자 수는 목록을 쌓기 전에 제한", operations_limit)


def damaged_content_dictionary():
    output = StringIO()
    with redirect_stderr(output):
        verdict(objects={**basic(), 4: stream(b"<< (FAKE_PRIVATE_BODY) 1 >> xx")})
    assert "FAKE_PRIVATE_BODY" not in output.getvalue(), output.getvalue()


test("손상 본문 dictionary는 복구하지 않고 거부하며 원문을 로그에 남기지 않음", damaged_content_dictionary)
test("본문 dictionary의 중복 키도 복구하지 않음", lambda: verdict(objects={**basic(), 4: stream(b"<< /A 1 /A 2 >> xx")}))
test("본문 끝에 연산자 없이 남은 인자 거부", lambda: verdict(objects={**basic(), 4: stream(b"1 2 3")}))

print(f"\n{passed} passed, {failed} failed")
if failed:
    raise SystemExit(1)
