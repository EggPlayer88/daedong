"""실제 ZIP 바이트로 검사기 경계 시험. 아래 한도는 시험값이며 학교 정책이 아니다."""
from io import BytesIO
from pathlib import Path
import stat
import struct
import sys
import warnings
import zipfile
import zlib

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from workers.collection_files.inspection import inspect_document, CT, REL, OFFICE_RELS, MAIN_TYPES, OPF, OCF, ODF, HEAD, SECTION

LIMITS = {"max_archive_entries": 100, "max_entry_bytes": 32 * 1024 * 1024,
          "max_expanded_bytes": 64 * 1024 * 1024, "max_compression_ratio": 1000, "max_xml_bytes": 32 * 1024 * 1024}


def package(parts, method=zipfile.ZIP_DEFLATED):
    output = BytesIO()
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", UserWarning)
        with zipfile.ZipFile(output, "w", compression=method) as archive:
            for name, value in parts.items() if isinstance(parts, dict) else parts:
                if isinstance(name, str):
                    original = name
                    name = zipfile.ZipInfo(original)
                    name.filename = name.orig_filename = original
                    name.compress_type = method
                archive.writestr(name, value)
    return output.getvalue()


def ooxml(ext="docx"):
    folder, family, local, content = {
        "docx": ("word", "wordprocessingml", "document", "<m:body/>"),
        "xlsx": ("xl", "spreadsheetml", "workbook", "<m:sheets/>"),
        "pptx": ("ppt", "presentationml", "presentation", ""),
    }[ext]
    main = folder + "/" + local + ".xml"
    return {
        "[Content_Types].xml": f'<Types xmlns="{CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="dat" ContentType="application/octet-stream"/><Override PartName="/{main}" ContentType="{MAIN_TYPES[ext]}"/></Types>',
        "_rels/.rels": f'<Relationships xmlns="{REL}"><Relationship Id="rId1" Type="{OFFICE_RELS[0]}officeDocument" Target="{main}"/></Relationships>',
        main: f'<m:{local} xmlns:m="http://schemas.openxmlformats.org/{family}/2006/main">{content}</m:{local}>',
    }


def hwpx():
    return {
        "mimetype": b"application/hwp+zip",
        "META-INF/container.xml": f'<c:container xmlns:c="{OCF}"><c:rootfiles><c:rootfile full-path="Contents/content.hpf" media-type="application/hwpml-package+xml"/></c:rootfiles></c:container>',
        "META-INF/manifest.xml": f'<m:manifest xmlns:m="{ODF}"/>',
        "Contents/content.hpf": f'<o:package xmlns:o="{OPF}"><o:manifest><o:item id="header" href="Contents/header.xml" media-type="application/xml"/><o:item id="section" href="Contents/section0.xml" media-type="application/xml"/></o:manifest><o:spine><o:itemref idref="header"/><o:itemref idref="section"/></o:spine></o:package>',
        "Contents/header.xml": f'<h:head xmlns:h="{HEAD}"/>',
        "Contents/section0.xml": f'<s:sec xmlns:s="{SECTION}"/>',
    }


def hwpx_boilerplate(header=None, source=None, encoding="utf-16-le"):
    # 시험용 내용이다. 보호된 학교 양식이나 그 해시를 면제 목록으로 사용하지 않는다.
    parts = hwpx()
    header = "var Documents = XHwpDocuments;\r\nvar Document = Documents.Active_XHwpDocument;\r\n" if header is None else header
    source = "function OnDocument_New()\r\n{\r\n\t//todo : \r\n}\r\n" if source is None else source
    parts["Scripts/headerScripts.js"] = header.encode(encoding)
    parts["Scripts/sourceScripts.js"] = source.encode(encoding)
    scripts = '<o:item id="headersc" href="Scripts/headerScripts.js" media-type="application/x-javascript ;charset=utf-16"/><o:item id="sourcesc" href="Scripts/sourceScripts.js" media-type="application/x-javascript ;charset=utf-16"/>'
    spine = '<o:itemref idref="headersc" linear="yes"/><o:itemref idref="sourcesc" linear="yes"/>'
    parts["Contents/content.hpf"] = parts["Contents/content.hpf"].replace('</o:manifest>', scripts + '</o:manifest>').replace('</o:spine>', spine + '</o:spine>')
    return parts


def change_hwpx_manifest(parts, before, after):
    return {**parts, "Contents/content.hpf": parts["Contents/content.hpf"].replace(before, after)}


def result(parts=None, ext="docx", limits=None, data=None):
    return inspect_document(data if data is not None else package(ooxml() if parts is None else parts), ext, LIMITS if limits is None else limits)


def check(title, fn):
    try:
        fn()
    except Exception:
        print("  ✗ " + title)
        raise
    print("  ✓ " + title)


def expect(value, *, status=None, code=None):
    assert set(value) == {"status", "code", "mime"}, value
    if status:
        assert value["status"] == status, value
    if code:
        assert value["code"] == code, value


for ext in ("docx", "xlsx", "pptx", "hwpx"):
    check(ext + " 정상 기본 구조", lambda ext=ext: expect(result(hwpx() if ext == "hwpx" else ooxml(ext), ext), status="passed"))
check("대문자 확장자 정규화", lambda: expect(result(ext=".DOCX"), status="passed"))
check("확장자와 패키지 종류 불일치", lambda: expect(result(ext="xlsx"), code="main_part_invalid"))
check("PDF 표식만으로 통과하지 않음", lambda: expect(result(ext="pdf", data=b"%PDF-1.7\nnot-a-parsed-document"), status="rejected"))
check("OLE 표식만으로 HWP라고 확정하지 않음", lambda: expect(result(ext="hwp", data=b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1" + b"x" * 20), status="rejected"))
check("다른 파일을 PDF로 위장", lambda: expect(result(ext="pdf", data=b"plain text"), code="signature_mismatch"))
check("미지원 확장자", lambda: expect(result(ext="exe"), status="unsupported"))
check("필수 한도 누락", lambda: expect(result(limits={}), code="inspection_limits_invalid"))
for value in (0, -1, True, "12", float("inf"), float("nan")):
    check("잘못된 확장 한도 " + repr(value), lambda value=value: expect(result(limits={**LIMITS, "max_expanded_bytes": value}), code="inspection_limits_invalid"))
check("무한 압축 비율 거부", lambda: expect(result(limits={**LIMITS, "max_compression_ratio": float("inf")}), code="inspection_limits_invalid"))
check("비바이트 입력 거부", lambda: expect(inspect_document("x", "docx", LIMITS), code="inspection_input_invalid"))
check("일반 ZIP는 문서가 아님", lambda: expect(result({"note.xml": "<note/>"}), code="package_required_part_missing"))
check("잘린 압축", lambda: expect(result(data=package(ooxml())[:-8]), status="rejected"))
check("압축 뒤 추가 자료", lambda: expect(result(data=package(ooxml()) + b"secret"), code="archive_corrupt"))
check("실행 파일 앞부분을 붙인 ZIP", lambda: expect(result(data=b"MZ" + package(ooxml())), code="signature_mismatch"))
check("엔트리 수 한도", lambda: expect(result(limits={**LIMITS, "max_archive_entries": 2}), code="archive_entries_limit"))
check("XML 개별 한도", lambda: expect(result(limits={**LIMITS, "max_xml_bytes": 50}), code="xml_bytes_limit"))
check("전체 확장 한도", lambda: expect(result(limits={**LIMITS, "max_expanded_bytes": 600}), code="archive_expanded_limit"))
check("높은 압축률", lambda: expect(result({**ooxml(), "huge.dat": b"x" * 100000}, limits={**LIMITS, "max_compression_ratio": 10}), code="archive_ratio_limit"))
check("중복 대소문자 이름", lambda: expect(result([*ooxml().items(), ("WORD/DOCUMENT.XML", "<x/>")]), code="archive_duplicate_name"))
check("정확히 중복 이름", lambda: expect(result([*ooxml().items(), ("word/document.xml", "<x/>")]), code="archive_duplicate_name"))
for name in ("../escape.xml", "/absolute.xml", "a\\b.xml", "a//b.xml", "a/./b.xml", "a%2fb.xml", "a:b.xml", "a./b.xml", "x\x01.xml", "a/e\u0301.xml"):
    check("위험하거나 모호한 이름 " + repr(name), lambda name=name: expect(result({**ooxml(), name: b"x"}), code="archive_name_unsafe"))
check("파일과 하위 경로 충돌", lambda: expect(result({**ooxml(), "a.dat": b"x", "a.dat/b.xml": b"<x/>"}), code="archive_name_unsafe"))


def symlink():
    link = zipfile.ZipInfo("link.dat")
    link.create_system = 3
    link.external_attr = (stat.S_IFLNK | 0o777) << 16
    expect(result([*ooxml().items(), (link, "target")]), code="archive_special_file")


check("심볼릭 링크 거부", symlink)
check("미지원 BZIP2 압축", lambda: expect(result(data=package(ooxml(), zipfile.ZIP_BZIP2)), status="unsupported"))
check("참조 없는 단독 HWPX 스크립트 거부", lambda: expect(result({**hwpx(), "Scripts/sourceScripts.js": ""}, "hwpx"), code="hwpx_script_manifest_invalid"))
check("실행파일 표식을 자료로 위장", lambda: expect(result({**ooxml(), "payload.dat": b"MZhidden"}), code="embedded_content_forbidden"))
check("중첩 ZIP 표식 거부", lambda: expect(result({**ooxml(), "payload.dat": package({"x": "y"})}), code="embedded_content_forbidden"))
check("내장 OLE 거부", lambda: expect(result({**ooxml(), "payload.dat": b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"}), code="embedded_content_forbidden"))
check("매크로 컨텐츠 타입 거부", lambda: expect(result({**ooxml(), "[Content_Types].xml": ooxml()["[Content_Types].xml"].replace(MAIN_TYPES["docx"], "application/vnd.ms-word.document.macroEnabled.main+xml")}), code="content_type_forbidden"))


for encoding in ("utf-8", "utf-16", "utf-32"):
    payload = ('<?xml version="1.0" encoding="' + encoding + '"?><!DOCTYPE x [<!ENTITY dangerous SYSTEM "file:///not-read">]><x>&dangerous;</x>').encode(encoding)
    check("외부 엔티티/DTD " + encoding, lambda payload=payload: expect(result({**ooxml(), "extra.xml": payload}), code="xml_dtd_forbidden"))
check("XML 손상", lambda: expect(result({**ooxml(), "extra.xml": b"<x>"}), code="xml_invalid"))
check("XML 스타일시트 처리 명령", lambda: expect(result({**ooxml(), "extra.xml": '<?xml-stylesheet href="https://example.test/a.xsl"?><x/>'}), code="xml_active_content"))
check("XML XInclude", lambda: expect(result({**ooxml(), "extra.xml": '<x xmlns:i="http://www.w3.org/2001/XInclude"><i:include href="file:///x"/></x>'}), code="xml_active_content"))
check("잘못된 주 문서 루트", lambda: expect(result({**ooxml(), "word/document.xml": "<document/>"}), code="main_part_invalid"))


def rels(kind="hyperlink", target="https://example.test/", mode="External"):
    return f'<Relationships xmlns="{REL}"><Relationship Id="rId2" Type="{OFFICE_RELS[0]}{kind}" Target="{target}" TargetMode="{mode}"/></Relationships>'


check("일반 외부 하이퍼링크 허용", lambda: expect(result({**ooxml(), "word/_rels/document.xml.rels": rels()}), status="passed"))
check("외부 이미지 로딩 거부", lambda: expect(result({**ooxml(), "word/_rels/document.xml.rels": rels("image")}), code="external_content_forbidden"))
check("대문자 관계 확장자도 검사", lambda: expect(result({**ooxml(), "word/_rels/document.xml.RELS": rels("image")}), code="external_content_forbidden"))
check("javascript 하이퍼링크 거부", lambda: expect(result({**ooxml(), "word/_rels/document.xml.rels": rels(target="javascript:alert(1)")}), code="external_content_forbidden"))
check("없는 관계 대상", lambda: expect(result({**ooxml(), "word/_rels/document.xml.rels": rels("styles", "styles.xml", "Internal")}), code="relationship_target_missing"))
check("루트 밖 관계", lambda: expect(result({**ooxml(), "word/_rels/document.xml.rels": rels("styles", "../../x.xml", "Internal")}), code="relationship_invalid"))
check("인코딩된 UNC 관계 구분자", lambda: expect(result({**ooxml(), "host/path.xml": "<x/>", "word/_rels/document.xml.rels": rels("styles", "%2F%2Fhost/path.xml", "Internal")}), code="relationship_invalid"))
check("정상 상대 부모 관계", lambda: expect(result({**ooxml(), "shared.xml": "<style/>", "word/_rels/document.xml.rels": rels("styles", "../shared.xml", "Internal")}), status="passed"))
check("관계 원본 누락", lambda: expect(result({**ooxml(), "word/_rels/missing.xml.rels": rels()}), code="relationship_source_missing"))
check("암호화 HWPX manifest", lambda: expect(result({**hwpx(), "META-INF/manifest.xml": f'<m:manifest xmlns:m="{ODF}"><m:encryption-data/></m:manifest>'}, "hwpx"), code="archive_encrypted"))
check("HWPX spine 참조 누락", lambda: expect(result({**hwpx(), "Contents/content.hpf": hwpx()["Contents/content.hpf"].replace('idref="section"', 'idref="absent"')}, "hwpx"), code="hwpx_manifest_invalid"))
check("HWPX 본문 루트 위장", lambda: expect(result({**hwpx(), "Contents/section0.xml": "<sec/>"}, "hwpx"), code="hwpx_main_part_invalid"))
check("HWPX 기본 별칭과 빈 문서 생성 훅", lambda: expect(result(hwpx_boilerplate(), "hwpx"), status="passed"))
check("HWPX 기본 스크립트 BOM UTF-16", lambda: expect(result(hwpx_boilerplate(encoding="utf-16"), "hwpx"), status="passed"))
check("HWPX UTF-16BE BOM", lambda: expect(result({**hwpx_boilerplate(), **{name: b"\xfe\xff" + raw.decode("utf-16-le").encode("utf-16-be") for name, raw in hwpx_boilerplate().items() if name.endswith(".js")}}, "hwpx"), status="passed"))
check("HWPX 두 스크립트가 공백만인 경우", lambda: expect(result(hwpx_boilerplate(header="\t \r\n", source=""), "hwpx"), status="passed"))
check("HWPX 주석 없는 빈 훅과 ASCII 공백 변형", lambda: expect(result(hwpx_boilerplate(source=" function\tOnDocument_New ( ) {\n } "), "hwpx"), status="passed"))
for script in (
    "function OnDocument_New(){ alert(1); }",
    "function OnDocument_New(){}; alert(1)",
    "function OnDocument_New(){/* benign */}",
    "function OnDocument_New(){//todo : alert(1)\n}",
    "function OnDocument_New(){//todo :\n alert(1)\n}",
    "function OnDocument_New(){//todo :\u2028alert(1)\n}",
    "function OnDocument_New(){//todo : }",
    "function OnDocument_Open(){}",
    "function OnDocument_New(x = alert(1)){}",
    "function OnDocument_New(){} function OnDocument_New(){alert(1)}",
    "function OnDocument_\\u004eew(){}",
):
    check("HWPX 동작/추가 문법 있는 소스 거부 " + repr(script), lambda script=script: expect(result(hwpx_boilerplate(source=script), "hwpx"), code="hwpx_script_content_forbidden"))
for script in (
    "var Documents = alert(1); var Document = Documents.Active_XHwpDocument;",
    "var Documents = XHwpDocuments; var Document = Documents.Open();",
    "var Documents = XHwpDocuments; var Document = Documents.Active_XHwpDocument; alert(1)",
    "var Documents = XHwpDocuments; var Document = Documents.Active_XHwpDocument\u2028;",
):
    check("HWPX 기본 별칭 외 헤더 거부 " + repr(script), lambda script=script: expect(result(hwpx_boilerplate(header=script), "hwpx"), code="hwpx_script_content_forbidden"))
check("HWPX 잘못된 UTF-16 길이", lambda: expect(result({**hwpx_boilerplate(), "Scripts/sourceScripts.js": b"x"}, "hwpx"), code="hwpx_script_encoding_invalid"))
check("HWPX charset과 실제 UTF-8 불일치", lambda: expect(result(hwpx_boilerplate(encoding="utf-8"), "hwpx"), status="rejected"))
check("HWPX 검사 문법 크기 상한", lambda: expect(result(hwpx_boilerplate(source=" " * 2049), "hwpx"), code="archive_entry_limit"))
check("HWPX 미등록 기본 스크립트 쌍", lambda: expect(result({**hwpx_boilerplate(), "Contents/content.hpf": hwpx()["Contents/content.hpf"]}, "hwpx"), code="hwpx_script_manifest_invalid"))
check("HWPX 스크립트 MIME 위장", lambda: expect(result(change_hwpx_manifest(hwpx_boilerplate(), 'application/x-javascript ;charset=utf-16', 'application/octet-stream'), "hwpx"), code="hwpx_script_manifest_invalid"))
check("HWPX 스크립트 charset 위장", lambda: expect(result(change_hwpx_manifest(hwpx_boilerplate(), 'charset=utf-16', 'charset=utf-8'), "hwpx"), code="hwpx_script_manifest_invalid"))
check("HWPX 스크립트 manifest 추가 속성", lambda: expect(result(change_hwpx_manifest(hwpx_boilerplate(), 'id="headersc"', 'id="headersc" fallback="header"'), "hwpx"), code="hwpx_script_manifest_invalid"))
check("HWPX 다른 id의 스크립트 대상 중복", lambda: expect(result(change_hwpx_manifest(hwpx_boilerplate(), '</o:manifest>', '<o:item id="alias" href="Scripts/headerScripts.js" media-type="application/x-javascript ;charset=utf-16"/></o:manifest>'), "hwpx"), code="hwpx_manifest_invalid"))
check("HWPX 스크립트 경로 별칭", lambda: expect(result(change_hwpx_manifest(hwpx_boilerplate(), 'href="Scripts/headerScripts.js"', 'href="/Scripts/headerScripts.js"'), "hwpx"), code="hwpx_script_manifest_invalid"))
check("HWPX 스크립트 spine 누락", lambda: expect(result(change_hwpx_manifest(hwpx_boilerplate(), '<o:itemref idref="sourcesc" linear="yes"/>', ''), "hwpx"), code="hwpx_script_manifest_invalid"))
check("HWPX 스크립트 spine 중복", lambda: expect(result(change_hwpx_manifest(hwpx_boilerplate(), '<o:itemref idref="sourcesc" linear="yes"/>', '<o:itemref idref="sourcesc"/><o:itemref idref="sourcesc"/>'), "hwpx"), code="hwpx_script_manifest_invalid"))
check("HWPX 스크립트 spine 역순", lambda: expect(result(change_hwpx_manifest(hwpx_boilerplate(), '<o:itemref idref="headersc" linear="yes"/><o:itemref idref="sourcesc" linear="yes"/>', '<o:itemref idref="sourcesc"/><o:itemref idref="headersc"/>'), "hwpx"), code="hwpx_script_manifest_invalid"))
check("HWPX 스크립트 spine 해석 변경 속성", lambda: expect(result(change_hwpx_manifest(hwpx_boilerplate(), 'idref="sourcesc" linear="yes"', 'idref="sourcesc" linear="no"'), "hwpx"), code="hwpx_script_manifest_invalid"))
check("HWPX 스크립트가 있을 때 두 manifest 거부", lambda: expect(result(change_hwpx_manifest(hwpx_boilerplate(), '</o:manifest>', '</o:manifest><o:manifest/>'), "hwpx"), code="hwpx_script_manifest_invalid"))
check("HWPX 추가 스크립트 거부", lambda: expect(result({**hwpx_boilerplate(), "Scripts/extra.js": b""}, "hwpx"), code="embedded_content_forbidden"))
check("HWPX 기본 파일명도 대소문자 별칭 거부", lambda: expect(result({**hwpx(), "scripts/headerScripts.js": b""}, "hwpx"), code="embedded_content_forbidden"))
check("OOXML에 HWPX 기본 스크립트를 넣어도 거부", lambda: expect(result({**ooxml(), "Scripts/headerScripts.js": hwpx_boilerplate()["Scripts/headerScripts.js"]}), code="embedded_content_forbidden"))


def patch_entry(data, name, *, size=None, crc=None, flags=None):
    buffer = bytearray(data)
    with zipfile.ZipFile(BytesIO(data)) as archive:
        info = archive.getinfo(name)
    central = data.find(b"PK\x01\x02")
    while central >= 0:
        name_len, extra_len, comment_len = struct.unpack_from("<3H", data, central + 28)
        found = data[central + 46:central + 46 + name_len].decode("utf-8")
        if found == name:
            for value, local_offset, central_offset, fmt in ((size, 22, 24, "<L"), (crc, 14, 16, "<L"), (flags, 6, 8, "<H")):
                if value is not None:
                    struct.pack_into(fmt, buffer, info.header_offset + local_offset, value)
                    struct.pack_into(fmt, buffer, central + central_offset, value)
            return bytes(buffer)
        central += 46 + name_len + extra_len + comment_len
    raise AssertionError("fixture entry not found")


check("CRC 손상 실제 읽기 검출", lambda: expect(result(data=patch_entry(package(ooxml()), "word/document.xml", crc=123)), code="archive_corrupt"))
check("암호화 ZIP 플래그", lambda: expect(result(data=patch_entry(package(ooxml()), "word/document.xml", flags=1)), code="archive_encrypted"))
check("거짓 작은 크기에서도 실제 압축 확장 상한", lambda: expect(result(data=patch_entry(package({**ooxml(), "large.dat": b"x" * 10000}), "large.dat", size=1, crc=zlib.crc32(b"x")), limits={**LIMITS, "max_entry_bytes": 2000}), code="archive_entry_limit"))
check("빈 폴더로 위장한 압축 본문은 첫 바이트에서 거부", lambda: expect(result(data=patch_entry(package({**ooxml(), "folder/": b"x" * 10000}), "folder/", size=0, crc=0)), code="archive_entry_limit"))


def false_count():
    data = bytearray(package(ooxml()))
    offset = data.rfind(b"PK\x05\x06")
    struct.pack_into("<HH", data, offset + 8, 1, 1)
    expect(result(data=bytes(data)), code="archive_corrupt")


check("거짓 중앙 디렉터리 개수", false_count)


def padding():
    data = bytearray(package(ooxml()))
    start = data.find(b"PK\x01\x02")
    data[start:start] = b"unlisted-local-data"
    offset = data.rfind(b"PK\x05\x06")
    struct.pack_into("<L", data, offset + 16, start + len(b"unlisted-local-data"))
    expect(result(data=bytes(data)), code="archive_corrupt")


check("중앙 목록 밖 패딩/자료 거부", padding)


def local_alternate_name():
    entry = zipfile.ZipInfo("extra.dat")
    entry.extra = struct.pack("<HH", 0x7075, 3) + b"xyz"
    data = bytearray(package([*ooxml().items(), (entry, b"x")]))
    # 중앙 extra만 무해한 필드로 바꾸고 local Unicode 이름 우회는 남긴다.
    central = data.find(b"PK\x01\x02")
    while data[central:central + 4] == b"PK\x01\x02":
        name_len, extra_len, comment_len = struct.unpack_from("<3H", data, central + 28)
        if data[central + 46:central + 46 + name_len] == b"extra.dat":
            struct.pack_into("<H", data, central + 46 + name_len, 0xFFFF)
            break
        central += 46 + name_len + extra_len + comment_len
    expect(result(data=bytes(data)), code="archive_alternate_name_unsupported")


check("local 헤더의 대체 Unicode 이름도 거부", local_alternate_name)


def descriptor():
    class NonSeeking(BytesIO):
        def seekable(self):
            return False
        def seek(self, *_):
            raise OSError("fixture nonseekable")
    target = NonSeeking()
    with zipfile.ZipFile(target, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for name, value in ooxml().items():
            archive.writestr(name, value)
    expect(result(data=target.getvalue()), status="passed")


check("데이터 디스크립터가 있는 정상 ZIP", descriptor)
for fixture in sorted((ROOT / "apps/main/api/doc-ai/_assets").glob("tpl-*.hwpx")):
    # 원본과 파일명/해시 면제 목록 없이 모든 양식을 같은 내용 검사로 확인한다.
    check("읽기 전용 기존 HWPX " + fixture.name, lambda fixture=fixture: expect(result(ext="hwpx", data=fixture.read_bytes()), status="passed"))


def altered_existing_boilerplate():
    # 파일명이 익숙해도 본문이 달라지면 거부한다. 양식은 읽기만 하고 메모리 사본을 변조한다.
    for fixture in (ROOT / "apps/main/api/doc-ai/_assets").glob("tpl-*.hwpx"):
        with zipfile.ZipFile(fixture) as archive:
            if "Scripts/sourceScripts.js" not in archive.namelist():
                continue
            parts = {name: archive.read(name) for name in archive.namelist()}
        parts["Scripts/sourceScripts.js"] = "function OnDocument_New(){ alert(1); }".encode("utf-16-le")
        expect(result(parts, "hwpx"), code="hwpx_script_content_forbidden")
        return
    raise AssertionError("기본 스크립트가 있는 읽기 전용 양식을 찾지 못함")


check("실제 양식의 메모리 사본에 동작을 추가하면 거부", altered_existing_boilerplate)
