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
from helpers.pdf_fixture import modern_pdf, png_rows

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
    test(label + "는 성공하지 않음", lambda body=body: verdict(objects=with_object(body)))


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
test("행 경계가 맞지 않는 PNG predictor는 거부", lambda: verdict(objects={**basic(), 4: stream(zlib.compress(b"q Q"), b"/Filter /FlateDecode /DecodeParms << /Predictor 12 >>")}))


def image_objects(width=16, height=16):
    output = BytesIO()
    Image.new("RGB", (width, height), (12, 24, 128)).save(output, "JPEG")
    objects = basic()
    objects[5] = stream(output.getvalue(), f"/Type /XObject /Subtype /Image /Width {width} /Height {height} /BitsPerComponent 8 /ColorSpace /DeviceRGB /Filter /DCTDecode".encode())
    return objects


test("JPEG 스캔 이미지가 들어 있는 실제 PDF 구조 통과", lambda: verdict(objects=image_objects(), status="passed"))
test("JPEG 이미지 픽셀 확장 한도", lambda: verdict(objects=image_objects(100, 100), limits={**LIMITS, "max_entry_bytes": 2000}))


def chained_image_expansion():
    output = BytesIO()
    Image.new("RGB", (1, 1), (12, 24, 128)).save(output, "JPEG")
    raw = output.getvalue()
    comment = b"x" * 50000
    raw = raw[:2] + b"\xff\xfe" + (len(comment) + 2).to_bytes(2, "big") + comment + raw[2:]
    image = stream(zlib.compress(raw), b"/Type /XObject /Subtype /Image /Width 1 /Height 1 /BitsPerComponent 8 /ColorSpace /DeviceRGB /Filter [/FlateDecode /DCTDecode]")
    objects = {**basic(), 5: image, 6: image}
    verdict(objects=objects, status="passed", limits={**LIMITS, "max_expanded_bytes": 2 * len(raw) + 3})
    verdict(objects=objects, limits={**LIMITS, "max_expanded_bytes": 2 * len(raw) + 2})


test("Flate→JPEG 연쇄의 중간 확장량도 전체 한도에 포함", chained_image_expansion)


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

test("xref·객체 스트림과 PNG Up을 함께 사용하는 PDF 통과", lambda: verdict(modern_pdf(), status="passed"))
test("객체 압축 없이 xref만 압축한 PDF 통과", lambda: verdict(modern_pdf(compressed=False, predictor=1), status="passed"))
test("xref W의 0폭은 type1·generation0 기본값으로 처리", lambda: verdict(modern_pdf(compressed=False, predictor=1, widths=(0, 4, 0), indices=[1, 4, 6, 1]), status="passed"))
test("객체 스트림의 객체 번호 순서가 비정렬이어도 offset 순서가 맞으면 통과", lambda: verdict(modern_pdf(members={3: basic()[3], 1: basic()[1], 2: basic()[2]}), status="passed"))
test("classic trailer 추가 활성 내용도 검사에서 누락하지 않음", lambda: verdict(pdf(trailer=b"/AA << >>"), code="pdf_active_content"))
test("xref stream dictionary의 미참조 활성 내용도 거부", lambda: verdict(modern_pdf(xref_dictionary=b"/JS (hidden)"), code="pdf_active_content"))

for label, changes in (
        ("압축 객체 index 불일치", {1: (2, 5, 2)}),
        ("압축 객체 index 중복", {2: (2, 5, 0)}),
        ("없는 압축 객체 소유자", {1: (2, 99, 0)}),
        ("압축 객체를 다시 압축 스트림 소유자로 지정", {1: (2, 2, 0)}),
        ("xref 스트림을 객체 스트림으로 지정", {1: (2, 6, 0)}),
        ("일반 내용 스트림을 객체 스트림으로 지정", {1: (2, 4, 0)}),
        ("실제 객체 offset 변조", {4: (1, 16, 0)}),
        ("실제 객체 generation 변조", {4: (1, 15, 1)}),
        ("xref 자신 offset 변조", {6: (1, 15, 0)}),
        ("0번 객체를 사용중 객체로 지정", {0: (1, 15, 0)}),
        ("자유 객체 참조로 교체", {1: (0, 0, 0)})):
    test(label + " 거부", lambda changes=changes: verdict(modern_pdf(xref_changes=changes)))
test("알 수 없는 xref 엔트리 종류는 미지원", lambda: verdict(modern_pdf(xref_changes={1: (3, 5, 0)}), status="unsupported", code="pdf_xref_entry_unsupported"))

for label, args in (
        ("xref 범위 중복", {"indices": [0, 5, 4, 3]}),
        ("xref 범위 누락", {"indices": [0, 4, 6, 1]}),
        ("xref W 원소 누락", {"widths": (1, 4)}),
        ("xref 해제 길이 불일치", {"index_payload": b"short"}),
        ("객체 스트림 N가 0", {"object_count": 0}),
        ("객체 스트림 N 과다", {"object_count": 999999}),
        ("객체 스트림 First가 0", {"object_first": 0}),
        ("객체 스트림 First가 바깥", {"object_first": 999999}),
        ("객체 스트림 offset 중복", {"object_offsets": [0, 0, 0]}),
        ("객체 스트림 offset 역순", {"object_offsets": [30, 10, 0]}),
        ("객체 스트림 뒤 숨은 구문", {"object_payload": b"1 0 2 5 3 10 null null null hidden"})):
    test(label + " 거부", lambda args=args: verdict(modern_pdf(**args)))
test("객체 스트림 상속은 확정 지원하지 않음", lambda: verdict(modern_pdf(object_dictionary=b"/Extends 4 0 R"), status="unsupported"))
test("증분 xref는 최신 revision만 검사하고 통과시키지 않음", lambda: verdict(modern_pdf(xref_dictionary=b"/Prev 15"), status="unsupported", code="pdf_incremental_unsupported"))
test("혼합 xref는 명시 미지원", lambda: verdict(modern_pdf(xref_dictionary=b"/XRefStm 15"), status="unsupported"))

for label, source, replacement in (
        ("xref W 간접 참조", b"/W [1 4 2]", b"/W 4 0 R"),
        ("xref W 음수 폭", b"/W [1 4 2]", b"/W [1 -4 2]"),
        ("xref Index 간접 참조", b"/Index [0 7]", b"/Index 4 0 R"),
        ("xref Index 홀수 배열", b"/Index [0 7]", b"/Index [0 7 1]"),
        ("xref DecodeParms 간접 참조", b"/DecodeParms << /Predictor 12 /Columns 7 >>", b"/DecodeParms 4 0 R"),
        ("xref DecodeParms 내부 간접 참조", b"/Columns 7", b"/Columns 4 0 R"),
        ("xref Size 상한 초과", b"/Size 7", b"/Size 10000000")):
    test(label + " 거부", lambda source=source, replacement=replacement: verdict(modern_pdf().replace(source, replacement)))

for label, value in (
        ("단독 간접 참조", b"2 0 R"), ("객체 안의 스트림", stream(b"data")),
        ("객체 사이 숨은 값", b"null null"), ("중복 dictionary 키", b"<< /A 1 /A 2 >>"),
        ("압축 안 JavaScript", b"<< /JS (alert) >>")):
    test(label + "도 압축 객체에서 거부", lambda value=value: verdict(modern_pdf(members={1: value, 2: basic()[2], 3: basic()[3]})))


def original_length_recovery():
    data = modern_pdf()
    xref_start = int(re.search(rb"startxref\n(\d+)", data)[1])
    suffix = data[xref_start:]
    suffix = re.sub(rb"/Length \d+", b"/Length -1", suffix, count=1)
    suffix = suffix.replace(b"\nendstream", b"endstream", 1)
    verdict(data[:xref_start] + suffix, code="pdf_stream_length_invalid")


test("strict 파서도 복구하던 음수 stream Length를 원문에서 거부", original_length_recovery)


def one_byte_length_recovery():
    data = modern_pdf()
    xref_start = int(re.search(rb"startxref\n(\d+)", data)[1])
    suffix = data[xref_start:]
    length = int(re.search(rb"/Length (\d+)", suffix)[1])
    suffix = suffix.replace(b"/Length " + str(length).encode(), b"/Length " + str(length + 1).encode(), 1)
    verdict(data[:xref_start] + suffix)


test("라이브러리가 보정할 수 있는 한 바이트 Length 오차도 거부", one_byte_length_recovery)


def predictor_case(colors, bits, columns):
    row_size = (colors * bits * columns + 7) // 8
    raw = bytes((i * 73 + 251) % 256 for i in range(row_size * 5))
    encoded = png_rows(raw, row_size, [0, 1, 2, 3, 4], bytes_per_pixel=max(1, (colors * bits + 7) // 8))
    from pypdf.generic import DictionaryObject, NameObject, NumberObject
    parameters = DictionaryObject({NameObject(key): NumberObject(value) for key, value in
                                  (("/Predictor", 15), ("/Colors", colors), ("/BitsPerComponent", bits), ("/Columns", columns))})
    assert module._png_predictor(encoded, parameters, 100000) == raw


for colors, bits, columns in ((1, 1, 13), (1, 2, 7), (3, 4, 5), (3, 8, 7), (4, 16, 3)):
    test(f"PNG 5개 필터 실제 복원 colors={colors} bits={bits} columns={columns}",
         lambda colors=colors, bits=bits, columns=columns: predictor_case(colors, bits, columns))


def png_document(raw, params):
    return {**basic(), 4: stream(zlib.compress(raw), b"/Filter /FlateDecode /DecodeParms << " + params + b" >>")}


def png_inline_image():
    content = b"BI /W 1 /H 1 ID x EI"
    verdict(objects=png_document(png_rows(content, len(content), [1]),
                                f"/Predictor 11 /Columns {len(content)}".encode()),
            status="unsupported", code="pdf_inline_image_unsupported")


test("본문 PNG Sub 복원 후 실제 BI 토큰도 거부", png_inline_image)
test("PNG 실제 행 tag는 Predictor12 고정값과 달라도 유효한 tag면 처리", lambda: verdict(objects=png_document(b"\x00q Q", b"/Predictor 12 /Columns 3"), status="passed"))
for label, raw, params in (
        ("알 수 없는 PNG 행 필터", b"\x05q Q", b"/Predictor 15 /Columns 3"),
        ("짧은 PNG 행", b"\x00q Q", b"/Predictor 12 /Columns 4"),
        ("0열 PNG", b"", b"/Predictor 12 /Columns 0"),
        ("불리언 PNG 열수", b"", b"/Predictor 12 /Columns true"),
        ("잘못된 PNG 비트수", b"", b"/Predictor 12 /BitsPerComponent 3"),
        ("음수 PNG 색수", b"", b"/Predictor 12 /Colors -1"),
        ("빈 데이터여도 과대한 PNG 행", b"", b"/Predictor 12 /Columns 9999999999999999999")):
    test(label + " 거부", lambda raw=raw, params=params: verdict(objects=png_document(raw, params)))
test("TIFF predictor는 명시 미지원", lambda: verdict(objects=png_document(b"q Q", b"/Predictor 2"), status="unsupported"))


def initial_view(value, extra=None):
    objects = basic()
    objects[1] = b"<< /Type /Catalog /Pages 2 0 R /OpenAction " + value + b" >>"
    objects.update(extra or {})
    return objects


for destination in (b"[3 0 R /Fit]", b"[3 0 R /XYZ null null 0]", b"[3 0 R /XYZ 10 20 1.5]",
                    b"[3 0 R /FitH null]", b"[3 0 R /FitV 0]", b"[3 0 R /FitR 0 0 595 842]",
                    b"[3 0 R /FitB]", b"[3 0 R /FitBH null]", b"[3 0 R /FitBV null]"):
    test("실제 문서 내부 시작 보기 " + destination.decode() + " 통과",
         lambda destination=destination: verdict(objects=initial_view(destination), status="passed"))
test("내부 GoTo 시작 보기는 간접 action·destination도 실물 대조", lambda: verdict(objects=initial_view(
    b"5 0 R", {5: b"<< /Type /Action /S /GoTo /D 6 0 R >>", 6: b"[3 0 R /Fit]"}), status="passed"))
test("압축 객체 Catalog의 시작 보기 설정도 검사", lambda: verdict(modern_pdf(members={
    1: b"<< /Type /Catalog /Pages 2 0 R /OpenAction << /S /GoTo /D [3 0 R /Fit] >> >>",
    2: basic()[2], 3: basic()[3]}), status="passed"))

for label, destination in (
        ("없는 페이지", b"[99 0 R /Fit]"), ("페이지 트리 자체", b"[2 0 R /Fit]"),
        ("페이지 번호 정수", b"[0 /Fit]"), ("잘못된 generation", b"[3 1 R /Fit]"),
        ("Fit 여분 인자", b"[3 0 R /Fit 0]"), ("XYZ 누락 인자", b"[3 0 R /XYZ 0 0]"),
        ("XYZ 음수 배율", b"[3 0 R /XYZ 0 0 -1]"), ("불리언 좌표", b"[3 0 R /FitH true]"),
        ("문자열 좌표", b"[3 0 R /FitV (0)]"), ("FitR null 좌표", b"[3 0 R /FitR null 0 10 10]"),
        ("FitR 역전 사각형", b"[3 0 R /FitR 10 10 0 0]"),
        ("무한대 좌표", b"[3 0 R /FitH " + b"9" * 400 + b".0]"),
        ("자동 외부 URI", b"<< /S /URI /URI (https://example.test) >>"),
        ("자동 JavaScript", b"<< /S /JavaScript /JS (alert) >>"),
        ("연쇄 동작", b"<< /S /GoTo /D [3 0 R /Fit] /Next << /S /URI /URI (https://example.test) >> >>"),
        ("잘못된 action Type", b"<< /Type /Catalog /S /GoTo /D [3 0 R /Fit] >>"),
        ("이름이 아닌 action Type", b"<< /Type (/Action) /S /GoTo /D [3 0 R /Fit] >>")):
    test("시작 보기의 " + label + " 거부", lambda destination=destination: verdict(objects=initial_view(destination)))
test("페이지 그래프에 없는 고아 Page 목적지 거부", lambda: verdict(objects=initial_view(
    b"[5 0 R /Fit]", {5: b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] >>"}), code="pdf_initial_view_invalid"))
test("실제 Root가 아닌 가짜 Catalog의 OpenAction 거부", lambda: verdict(objects={
    **basic(), 5: b"<< /Type /Catalog /OpenAction [3 0 R /Fit] >>"}, code="pdf_active_content"))
test("Catalog를 stream으로 위장한 시작 보기 거부", lambda: verdict(objects={
    **basic(), 1: stream(b"q Q", b"/Type /Catalog /Pages 2 0 R /OpenAction [3 0 R /Fit]")},
    code="pdf_catalog_invalid"))
test("문자열 Type을 사용한 가짜 Catalog 거부", lambda: verdict(objects={
    **basic(), 1: b"<< /Type (/Catalog) /Pages 2 0 R /OpenAction [3 0 R /Fit] >>"},
    code="pdf_catalog_invalid"))
for label, destination in (
        ("이름 목적지", b"(page1)"), ("미구현 보기 방식", b"[3 0 R /Other]"),
        ("GoTo 추가 키", b"<< /S /GoTo /D [3 0 R /Fit] /Unknown 1 >>")):
    test("시작 보기 " + label + "는 추정 없이 미지원", lambda destination=destination: verdict(
        objects=initial_view(destination), status="unsupported", code="pdf_initial_view_unsupported"))

print(f"\n{passed} passed, {failed} failed")
if failed:
    raise SystemExit(1)
