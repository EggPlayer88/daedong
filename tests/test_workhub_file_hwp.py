"""OLE/HWP 실제 바이트의 구조·압축·호환성 경계를 시험한다."""
from io import BytesIO
from pathlib import Path
import struct
import sys
import zlib
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "tests" / "helpers"))
from hwp_fixture import cfb, deflate, hwp_streams, make_hwp, record, numbering_51, FREE, END, FAT
from workers.collection_files.hwp_inspection import inspect_hwp
import workers.collection_files.hwp_inspection as module
from PIL import Image

LIMITS = dict(max_archive_entries=100, max_entry_bytes=1024 * 1024,
              max_expanded_bytes=4 * 1024 * 1024, max_xml_bytes=1024 * 1024,
              max_compression_ratio=1000)


def result(streams=None, *, data=None, limits=None):
    return inspect_hwp(make_hwp() if streams is None and data is None else cfb(streams) if data is None else data,
                       LIMITS if limits is None else limits)


def expect(value, status, code=None):
    assert set(value) == {"status", "code", "mime"}, value
    assert value["status"] == status, value
    if code:
        assert value["code"] == code, value


def edited_header(offset, number, fmt="<I"):
    streams = hwp_streams()
    header = bytearray(streams["FileHeader"])
    struct.pack_into(fmt, header, offset, number)
    streams["FileHeader"] = bytes(header)
    return streams


def scripts(header="", source="", pre="", post="", *, compressed=True, footer=False):
    streams = hwp_streams(compressed=compressed, footer=footer)
    raw = b"".join(struct.pack("<I", len(text)) + text.encode("utf-16-le") for text in (header, source, pre, post)) + b"\xff" * 4
    streams["Scripts/DefaultJScript"] = deflate(raw, footer) if compressed else raw
    version = struct.pack("<II", 1, 0)
    streams["Scripts/JScriptVersion"] = deflate(version, footer) if compressed else version
    return streams


def picture(*, corrupt=False, compressed=True, mode=0, size=(2, 2)):
    streams = hwp_streams(compressed=compressed)
    buffer = BytesIO()
    Image.new("RGB", size).save(buffer, format="PNG")
    raw = b"\x89PNG\r\n\x1a\n" if corrupt else buffer.getvalue()
    item = record(18, struct.pack("<3H", 1 | (mode << 4), 1, 3) + "png".encode("utf-16-le"), 1)
    props = struct.pack("<7H3I", 1, 1, 1, 1, 1, 1, 1, 0, 0, 0)
    info = record(16, props) + record(17, bytes(72)) + item
    streams["DocInfo"] = deflate(info) if compressed else info
    streams["BinData/BIN0001.png"] = deflate(raw) if (compressed if mode == 0 else mode == 1) else raw
    return streams


def mutate(data, offset, value, fmt="<I"):
    data = bytearray(data)
    struct.pack_into(fmt, data, offset, value)
    return bytes(data)


def location(data, name):
    size = 1 << struct.unpack_from("<H", data, 30)[0]
    # 합성 fixture의 directory는 시작 sector에서 연속 배치된다.
    start = (struct.unpack_from("<I", data, 48)[0] + 1) * size
    for offset in range(start, len(data), 128):
        length = struct.unpack_from("<H", data, offset + 64)[0]
        if 2 <= length <= 64 and data[offset:offset + length - 2].decode("utf-16-le", errors="ignore") == name:
            return offset
    raise AssertionError(name)


def fat_offset(data, sector):
    size = 1 << struct.unpack_from("<H", data, 30)[0]
    fat = struct.unpack_from("<I", data, 76)[0]
    return (fat + 1) * size + sector * 4


def modern(version=0x05010100):
    streams = hwp_streams(version=version, compatibility=True, empty_link=True, encrypt_version=4)
    counts = [0] * 18
    counts[9], counts[11], counts[13] = 1, 1, 1
    info = zlib.decompress(streams["DocInfo"], -15)
    first_end = 4 + (struct.unpack_from("<I", info)[0] >> 20)
    map_end = first_end + 4 + 72
    styles = (record(21, bytes(74), 1) + record(23, numbering_51(), 1)
              + record(25, bytes(54 if version == 0x05010000 else 58), 1))
    streams["DocInfo"] = deflate(info[:first_end] + record(17, struct.pack("<18I", *counts)) + styles + info[map_end:])
    return streams


def replace_doc_record(streams, tag, *, payload=None, level=None, remove=False, duplicate=False):
    streams = dict(streams)
    raw = zlib.decompress(streams["DocInfo"], -15)
    position, parts = 0, []
    while position < len(raw):
        header = struct.unpack_from("<I", raw, position)[0]
        current, old_level, size = header & 1023, (header >> 10) & 1023, header >> 20
        assert size < 4095
        position += 4
        value = raw[position:position + size]
        position += size
        if current == tag and remove:
            continue
        item = record(current, value if current != tag or payload is None else payload,
                      old_level if current != tag or level is None else level)
        parts.append(item)
        if current == tag and duplicate:
            parts.append(item)
    streams["DocInfo"] = deflate(b"".join(parts))
    return streams


def orphan_picture(*, compressed=True, corrupt=False):
    images = picture(compressed=compressed, corrupt=corrupt)
    return {**hwp_streams(compressed=compressed), "BinData/BIN0001.png": images["BinData/BIN0001.png"]}


def run():
    count = 0

    def check(title, fn):
        nonlocal count
        try:
            fn()
        except Exception:
            print("  ✗ " + title)
            raise
        count += 1
        print("  ✓ " + title)

    check("압축 HWP5의 mini stream을 실제 해석한다", lambda: expect(result(), "passed"))
    check("비압축 HWP5를 실제 해석한다", lambda: expect(result(hwp_streams(compressed=False)), "passed"))
    check("여러 구역을 문서 속성과 대조한다", lambda: expect(result(hwp_streams(sections=3)), "passed"))
    check("CFB 4의 4096바이트 sector도 검사한다", lambda: expect(result(data=cfb(hwp_streams(), version=4)), "passed"))
    check("CRC32/ISIZE가 일치하는 한컴 압축 꼬리를 허용한다", lambda: expect(result(hwp_streams(footer=True)), "passed"))
    regular = hwp_streams(compressed=False)
    regular["BodyText/Section0"] += record(67, b"A\0" * 3000, 1)
    check("4096바이트 이상 일반 FAT stream을 검사한다", lambda: expect(result(regular), "passed"))
    check("빈 기본 스크립트 container를 허용한다", lambda: expect(result(scripts()), "passed"))
    check("한컴의 기본 별칭·빈 함수만 허용한다", lambda: expect(result(scripts(
        "var Documents = XHwpDocuments;\r\nvar Document = Documents.Active_XHwpDocument;",
        "function OnDocument_New(){\r\n//todo : \r\n}", footer=True)), "passed"))
    check("비압축 기본 스크립트를 검사한다", lambda: expect(result(scripts(compressed=False)), "passed"))
    for mode in (0, 1, 2):
        check(f"그림 압축 모드 {mode}를 DocInfo와 대조한다", lambda mode=mode: expect(result(picture(mode=mode)), "passed"))
    check("PNG signature만 있는 잘린 그림은 거부한다", lambda: expect(result(picture(corrupt=True)), "rejected", "hwp_image_corrupt"))
    check("이미지 확장 메모리 한도를 검사한다", lambda: expect(result(picture(size=(100, 100)), limits={**LIMITS, "max_entry_bytes": 10000}), "rejected", "hwp_image_expanded_limit"))
    check("이미지 파서의 잘린 파일 허용 설정을 거부한다", lambda: _image_configuration())
    check("OLE signature만으로 HWP라고 인정하지 않는다", lambda: expect(result(data=b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"), "rejected"))
    check("다른 파일 signature를 거부한다", lambda: expect(result(data=b"%PDF-1.7"), "rejected", "signature_mismatch"))
    check("부분 sector로 잘린 OLE를 거부한다", lambda: expect(result(data=make_hwp()[:-1]), "rejected"))
    check("숨은 뒤쪽 바이트를 거부한다", lambda: expect(result(data=make_hwp() + b"x"), "rejected"))
    check("CFB byte-order 변조를 거부한다", lambda: expect(result(data=mutate(make_hwp(), 28, 0, "<H")), "rejected"))
    check("CFB FAT 수 부풀림을 거부한다", lambda: expect(result(data=mutate(make_hwp(), 44, 1000)), "rejected"))
    check("파일별 기술 상한을 파서 전에 검사한다", lambda: _input_limit())
    check("의존 라이브러리 누락을 성공으로 바꾸지 않는다", lambda: _missing_parser())
    check("예기치 않은 라이브러리 원문 오류를 노출하지 않는다", lambda: _parser_exception(RuntimeError("SECRET_file_path"), "hwp_inspection_failed"))
    check("파서 메모리 부족을 오류로 구분한다", lambda: _parser_exception(MemoryError("SECRET_file_path"), "hwp_resource_limit"))
    check("파서 재귀 한도 초과를 오류로 구분한다", lambda: _parser_exception(RecursionError("SECRET_file_path"), "hwp_resource_limit"))
    check("잘못된 정책 한도를 거부한다", lambda: expect(result(limits={**LIMITS, "max_entry_bytes": True}), "error"))
    check("파일 수 한도를 확인한다", lambda: expect(result(limits={**LIMITS, "max_archive_entries": 2}), "rejected", "hwp_entries_limit"))
    check("stream 원본 크기 한도를 확인한다", lambda: expect(result(limits={**LIMITS, "max_entry_bytes": 255}), "rejected", "hwp_entry_limit"))
    check("압축 확장 합계 한도를 확인한다", lambda: expect(result(limits={**LIMITS, "max_expanded_bytes": 300}), "rejected", "hwp_expanded_limit"))
    check("압축률 한도를 확인한다", lambda: expect(result(limits={**LIMITS, "max_compression_ratio": 1}), "rejected", "hwp_ratio_limit"))
    no_header = hwp_streams(); del no_header["FileHeader"]
    check("FileHeader 없는 OLE는 거부한다", lambda: expect(result(no_header), "rejected", "hwp_required_stream_missing"))
    bad_header = hwp_streams(); bad_header["FileHeader"] = b"X" * 256
    check("HWP signature가 틀린 FileHeader를 거부한다", lambda: expect(result(bad_header), "rejected", "hwp_header_invalid"))
    check("HWP 3 또는 다른 구조 버전은 미지원이다", lambda: expect(result(edited_header(32, 0x03000000)), "unsupported", "hwp_version_unsupported"))
    for bit in (1, 2, 4, 8, 10, 13):
        check(f"암호·배포·DRM 계열 flag {bit}는 미지원이다", lambda bit=bit: expect(result(edited_header(36, 1 | (1 << bit))), "unsupported", "hwp_protected_unsupported"))
    check("알 수 없는 새 기능 flag는 통과시키지 않는다", lambda: expect(result(edited_header(36, 1 | (1 << 31))), "unsupported"))
    for algorithm in range(1, 5):
        check(f"암호화 flag 없이 알고리즘 {algorithm}만 있으면 평문 구조까지 검사한다", lambda algorithm=algorithm: expect(result(edited_header(44, algorithm)), "passed"))
    check("알 수 없는 암호화 알고리즘은 허용하지 않는다", lambda: expect(result(edited_header(44, 5)), "unsupported", "hwp_features_unsupported"))
    check("평문 알고리즘 정보가 있어도 실제 암호 설정 flag는 미지원이다", lambda: _algorithm_with_protection())
    check("알고리즘 정보가 올바르더라도 암호문 같은 잘못된 본문은 거부한다", lambda: expect(result({**hwp_streams(encrypt_version=4), "BodyText/Section0": b"ciphertext"}), "rejected"))
    check("XML 서식 힌트만 있고 실제 서식 저장소가 없으면 검사한다", lambda: expect(result(edited_header(36, 33)), "passed"))
    check("실제 XML 서식 저장소는 계속 미지원이다", lambda: expect(result({**edited_header(36, 33), "XMLTemplate/Schema": b"<schema/>"}), "unsupported", "hwp_storage_unsupported"))
    check("동일한 대소문자 이름의 두 stream을 거부한다", lambda: expect(result({**hwp_streams(), "docinfo": hwp_streams()["DocInfo"]}), "rejected"))
    check("구역 개수와 실제 Section 이름이 다르면 거부한다", lambda: expect(result({**hwp_streams(), "BodyText/Section2": hwp_streams()["BodyText/Section0"]}), "rejected", "hwp_section_mismatch"))
    check("임의 stream을 숨겨 통과할 수 없다", lambda: expect(result({**hwp_streams(), "Unknown": b"MZevil"}), "unsupported", "hwp_stream_unsupported"))
    check("524바이트 전체가 0인 빈 문서 연결 정보를 검사한다", lambda: expect(result(hwp_streams(empty_link=True, encrypt_version=4)), "passed"))
    check("비압축 문서의 빈 연결 정보도 검사한다", lambda: expect(result(hwp_streams(compressed=False, empty_link=True, encrypt_version=4)), "passed"))
    check("검증하지 못한 문서 연결 형식은 미지원이다", lambda: expect(result({**hwp_streams(), "DocOptions/_LinkDoc": b"path"}), "unsupported", "hwp_document_link_unsupported"))
    for length in (0, 2, 522, 526):
        check(f"빈 바이트여도 확인하지 못한 연결 길이 {length}는 미지원이다", lambda length=length: expect(result({**hwp_streams(), "DocOptions/_LinkDoc": bytes(length)}), "unsupported", "hwp_document_link_unsupported"))
    check("첫 NUL 뒤의 비영 바이트를 임의의 여유 공간으로 간주하지 않는다", lambda: expect(result({**hwp_streams(), "DocOptions/_LinkDoc": bytes(2) + b"x" + bytes(521)}), "unsupported", "hwp_document_link_unsupported"))
    check("외부 문서 경로를 실행하거나 가져오지 않는다", lambda: expect(result({**hwp_streams(), "DocOptions/_LinkDoc": "https://example.invalid/evil".encode("utf-16-le").ljust(524, b"\0")}), "unsupported", "hwp_document_link_unsupported"))
    check("문서 연결 끝의 알 수 없는 옵션도 미지원이다", lambda: expect(result({**hwp_streams(), "DocOptions/_LinkDoc": bytes(520) + struct.pack("<I", 1)}), "unsupported", "hwp_document_link_unsupported"))
    check("DocOptions 안의 DRM 자료는 계속 미지원이다", lambda: expect(result({**hwp_streams(empty_link=True), "DocOptions/_DRMOption": bytes(4)}), "unsupported", "hwp_stream_unsupported"))
    check("DocOptions 안의 모르는 stream은 계속 미지원이다", lambda: expect(result({**hwp_streams(empty_link=True), "DocOptions/Unknown": b"MZ"}), "unsupported", "hwp_stream_unsupported"))
    check("5.0 정적 변경 추적 메타데이터를 실행 기능으로 오분류하지 않는다", lambda: expect(result(hwp_streams(compatibility=True)), "passed"))
    for target in (0, 1, 2):
        check(f"공식 호환 대상 {target}의 구조를 검사한다", lambda target=target: expect(result(replace_doc_record(hwp_streams(compatibility=True), 30, payload=struct.pack("<I", target))), "passed"))
    check("알 수 없는 호환 대상은 미지원이다", lambda: expect(result(replace_doc_record(hwp_streams(compatibility=True), 30, payload=struct.pack("<I", 3))), "unsupported", "hwp_compatibility_unsupported"))
    for tag, size in ((30, 4), (31, 20), (32, 1032)):
        check(f"호환 메타데이터 {tag}의 잘린 길이를 거부한다", lambda tag=tag, size=size: expect(result(replace_doc_record(hwp_streams(compatibility=True), tag, payload=bytes(size-1))), "rejected", "hwp_record_corrupt"))
        check(f"호환 메타데이터 {tag} 중복을 거부한다", lambda tag=tag: expect(result(replace_doc_record(hwp_streams(compatibility=True), tag, duplicate=True)), "rejected", "hwp_record_corrupt"))
        check(f"호환 메타데이터 {tag} 잘못된 레벨을 거부한다", lambda tag=tag: expect(result(replace_doc_record(hwp_streams(compatibility=True), tag, level=1 if tag==30 else 0)), "rejected", "hwp_record_corrupt"))
    check("호환 문서 부모가 없는 변경 추적 정보는 거부한다", lambda: expect(result(replace_doc_record(hwp_streams(compatibility=True), 30, remove=True)), "rejected", "hwp_record_corrupt"))
    check("사용중인 변경 추적 기능 flag는 계속 미지원이다", lambda: expect(result(edited_header(36, 1 | (1 << 14))), "unsupported", "hwp_features_unsupported"))
    for compressed in (True, False):
        check(f"미참조 PNG도 기본 압축 {compressed}에 따라 실제 해독한다", lambda compressed=compressed: expect(result(orphan_picture(compressed=compressed)), "passed"))
    check("미참조 PNG의 잘린 바이트를 거부한다", lambda: expect(result(orphan_picture(corrupt=True)), "rejected", "hwp_image_corrupt"))
    check("미참조 PNG에도 픽셀 메모리 한도를 적용한다", lambda: _orphan_image_limit())
    check("참조된 BinData가 없으면 여전히 거부한다", lambda: expect(result({k:v for k,v in picture().items() if not k.startswith("BinData/")}), "rejected", "hwp_binary_mismatch"))
    check("미참조 그림을 가장한 실행 바이트를 거부한다", lambda: expect(result({**hwp_streams(), "BinData/BIN0001.png": deflate(b"MZexecutable")}), "rejected", "hwp_image_signature_mismatch"))
    for name in ("BIN0001.ole", "BIN0001.exe", "BIN0000.png", "other.png", "BIN00001.png"):
        check(f"미참조 비지원 이름 {name}은 미지원이다", lambda name=name: expect(result({**hwp_streams(), f"BinData/{name}": b"MZ"}), "unsupported", "hwp_unreferenced_binary_unsupported"))
    check("미참조 이미지 압축 모드를 추측하여 재시도하지 않는다", lambda: expect(result({**hwp_streams(compressed=False), "BinData/BIN0001.png": picture()["BinData/BIN0001.png"]}), "rejected", "hwp_image_signature_mismatch"))
    for version in (0x05010000, 0x05010001, 0x05010100):
        check(f"확인한 5.1 버전 {version:08x}의 확장 구조를 검사한다", lambda version=version: expect(result(modern(version)), "passed"))
    for version in (0x05010002, 0x05010200, 0x05020000):
        check(f"확인하지 못한 버전 {version:08x}는 미지원이다", lambda version=version: expect(result(edited_header(32, version)), "unsupported", "hwp_version_unsupported"))
    for tag in (30, 31, 32):
        check(f"5.1 필수 호환 레코드 {tag} 누락은 거부한다", lambda tag=tag: expect(result(replace_doc_record(modern(), tag, remove=True)), "rejected"))
    for tag, wrong in ((16, 25), (17, 64), (21, 68), (25, 54)):
        check(f"5.1 레코드 {tag}에 구버전 길이를 넣으면 거부한다", lambda tag=tag, wrong=wrong: expect(result(replace_doc_record(modern(), tag, payload=bytes(wrong))), "rejected", "hwp_version_record_mismatch"))
    check("5.1 문단 헤더22바이트는 거부한다", lambda: expect(result({**modern(), "BodyText/Section0": deflate(record(66, bytes(22)))}), "rejected", "hwp_version_record_mismatch"))
    for level in (0, 7, 9):
        check(f"5.1 문단 수준 {level}은 마지막 DWORD에서 검사한다", lambda level=level: expect(result(replace_doc_record(modern(), 25, payload=bytes(54)+struct.pack("<I", level))), "passed"))
    check("5.1 문단 수준10은 지원 범위 밖으로 분류한다", lambda: expect(result(replace_doc_record(modern(), 25, payload=bytes(54)+struct.pack("<I", 10))), "unsupported", "hwp_layout_extension_unsupported"))
    check("5.1 ID 목록과 실제 정의 개수 불일치를 거부한다", lambda: expect(result(replace_doc_record(modern(), 17, payload=bytes(72))), "rejected", "hwp_id_mapping_mismatch"))
    check("5.1 개수가 같아도 ID 목록 밖 레코드는 거부한다", lambda: expect(result(replace_doc_record(modern(), 21, level=0)), "rejected", "hwp_record_corrupt"))
    check("5.1 ID 목록 레코드를 두 단계 아래에 숨기면 거부한다", lambda: expect(result(replace_doc_record(modern(), 23, level=2)), "rejected", "hwp_record_corrupt"))
    number = numbering_51()
    for label, value in (("기본 머리 절단", number[:10]), ("확장3단계 절단", number[:-20]),
                         ("시작번호 끝 절단", number[:-1]), ("뒤쪽 추가 바이트", number+b"x"),
                         ("문자 수 부풀림", mutate(number,12,65535,"<H")),
                         ("깨진 UTF16", number[:14]+b"\0\xd8"+number[16:])):
        check(f"5.1 문단 번호의 {label}를 거부한다", lambda value=value: expect(result(replace_doc_record(modern(),23,payload=value)), "rejected"))
    check("5.1에도 사용자 스크립트 금지를 유지한다", lambda: expect(result({**modern(), **{k:v for k,v in scripts(source="Run();").items() if k.startswith("Scripts/")}}), "unsupported", "hwp_script_unsupported"))
    check("추가 스크립트 파일을 거부한다", lambda: expect(result({**scripts(), "Scripts/Extra": b"evil"}), "unsupported"))
    for label, kwargs in (("소스 호출", {"source": "function OnDocument_New(){Run();}"}),
                          ("헤더 호출", {"header": "alert(1);"}), ("pre 호출", {"pre": "Run();"}),
                          ("post 호출", {"post": "Run();"})):
        check(f"기본값 이외 {label}은 미지원이다", lambda kwargs=kwargs: expect(result(scripts(**kwargs)), "unsupported", "hwp_script_unsupported"))
    for label, body, code in (
        ("레코드 길이 초과", struct.pack("<I", 66 | (4000 << 20)) + b"x", "hwp_record_corrupt"),
        ("확장 레코드 길이 누락", struct.pack("<I", 66 | (4095 << 20)), "hwp_record_corrupt"),
        ("빈 본문", b"", "hwp_required_record_missing"),
        ("본문 첫 레벨 비정상", record(66, bytes(22), 1), "hwp_record_corrupt"),
        ("갑작스러운 레벨 건너뜀", record(66, bytes(22)) + record(67, b"A\0", 3), "hwp_record_corrupt"),
        ("짧은 문단 헤더", record(66, b"x"), "hwp_record_corrupt"),
        ("홀수 UTF16 텍스트", record(66, bytes(22)) + record(67, b"x", 1), "hwp_record_corrupt"),
    ):
        check(label + "를 거부한다", lambda body=body, code=code: expect(result({**hwp_streams(), "BodyText/Section0": deflate(body)}), "rejected", code))
    check("모르는 본문 레코드는 미지원이다", lambda: expect(result({**hwp_streams(), "BodyText/Section0": deflate(record(66, bytes(22)) + record(511, b"x", 1))}), "unsupported", "hwp_record_unsupported"))
    check("짧은 레코드 폭탄을 개수 한도로 거부한다", lambda: _record_limit())
    check("OLE 개체 레코드를 미지원으로 남긴다", lambda: expect(result({**hwp_streams(), "BodyText/Section0": deflate(record(66, bytes(22)) + record(84, b"x", 1))}), "unsupported", "hwp_active_content_unsupported"))
    check("압축된 숨은 뒤쪽 데이터는 거부한다", lambda: expect(result({**hwp_streams(), "DocInfo": hwp_streams()["DocInfo"] + b"evil"}), "rejected", "hwp_compression_corrupt"))
    corrupt_crc = hwp_streams(footer=True); corrupt_crc["DocInfo"] = corrupt_crc["DocInfo"][:-8] + bytes(8)
    check("한컴 footer CRC가 다르면 거부한다", lambda: expect(result(corrupt_crc), "rejected", "hwp_compression_corrupt"))
    check("압축이 끝나기 전에 잘리면 거부한다", lambda: expect(result({**hwp_streams(), "DocInfo": hwp_streams()["DocInfo"][:-1]}), "rejected"))
    original = make_hwp()
    mini_start = struct.unpack_from("<I", original, 60)[0]
    mini_offset = (mini_start + 1) * 512
    file_entry = location(original, "FileHeader")
    file_start = struct.unpack_from("<I", original, file_entry + 116)[0]
    check("MiniFAT 순환을 거부한다", lambda: expect(result(data=mutate(original, mini_offset + file_start * 4, file_start)), "rejected"))
    body_entry = location(original, "Section0")
    body_start = struct.unpack_from("<I", original, body_entry + 116)[0]
    check("MiniFAT의 체인 중간 공유를 거부한다", lambda: expect(result(data=mutate(original, mini_offset + file_start * 4, body_start)), "rejected"))
    root_size = struct.unpack_from("<Q", original, 512 + 120)[0]
    check("루트 mini stream 밖의 숨은 MiniFAT 할당을 거부한다", lambda: expect(result(data=mutate(original, mini_offset + (root_size // 64) * 4, END)), "rejected", "hwp_hidden_allocation"))
    check("declared 크기보다 긴 mini 체인을 거부한다", lambda: expect(result(data=mutate(original, file_entry + 120, 64)), "rejected"))
    check("directory 순환을 거부한다", lambda: expect(result(data=mutate(original, body_entry + 68, (body_entry - 512) // 128)), "rejected"))
    root_child = struct.unpack_from("<I", original, 512 + 76)[0]
    check("경로 밖 활성 directory를 거부한다", lambda: expect(result(data=mutate(original, 512 + root_child * 128 + 68, FREE)), "rejected"))
    check("CFB directory FAT 순환을 거부한다", lambda: expect(result(data=mutate(original, fat_offset(original, 0), 0)), "rejected"))
    hidden = bytearray(original + bytes(512))
    hidden = mutate(hidden, fat_offset(original, len(original) // 512 - 1), END)
    check("참조되지 않은 할당 sector를 거부한다", lambda: expect(result(data=hidden), "rejected", "hwp_hidden_allocation"))
    check("물리 파일 밖의 숨은 FAT 할당을 거부한다", lambda: expect(result(data=mutate(original, fat_offset(original, len(original) // 512 - 1), END)), "rejected", "hwp_hidden_allocation"))
    print(f"\n{count} passed, 0 failed")


def _input_limit():
    with patch.object(module, "MAX_INPUT_BYTES", 100):
        expect(result(), "rejected", "hwp_input_limit")


def _missing_parser():
    with patch.object(module, "olefile", None):
        expect(result(), "error", "hwp_parser_unavailable")


def _parser_exception(error, code):
    with patch.object(module, "_cfb_header", side_effect=error):
        value = result()
        expect(value, "error", code)
        assert "SECRET" not in repr(value)


def _record_limit():
    with patch.object(module, "MAX_RECORDS", 2):
        body = record(66, bytes(22)) + record(67, b"a\0", 1) + record(67, b"b\0", 1)
        expect(result({**hwp_streams(), "BodyText/Section0": deflate(body)}), "rejected", "hwp_records_limit")


def _image_configuration():
    with patch.object(module.ImageFile, "LOAD_TRUNCATED_IMAGES", True):
        expect(result(picture()), "error", "hwp_image_parser_configuration_invalid")


def _algorithm_with_protection():
    streams = hwp_streams(encrypt_version=4)
    header = bytearray(streams["FileHeader"])
    struct.pack_into("<I", header, 36, 3)
    streams["FileHeader"] = bytes(header)
    expect(result(streams), "unsupported", "hwp_protected_unsupported")


def _orphan_image_limit():
    raw = picture(size=(100, 100))["BinData/BIN0001.png"]
    expect(result({**hwp_streams(), "BinData/BIN0001.png": raw}, limits={**LIMITS,"max_entry_bytes":10000}), "rejected", "hwp_image_expanded_limit")


if __name__ == "__main__":
    run()
