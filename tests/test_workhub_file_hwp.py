"""OLE/HWP 실제 바이트의 구조·압축·호환성 경계를 시험한다."""
from io import BytesIO
from pathlib import Path
import struct
import sys
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "tests" / "helpers"))
from hwp_fixture import cfb, deflate, hwp_streams, make_hwp, record, FREE, END, FAT
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
    check("암호화 flag 없이 알고리즘 값만 있으면 보호 문서로 단정하지 않는다", lambda: expect(result(edited_header(44, 4)), "unsupported", "hwp_features_unsupported"))
    check("동일한 대소문자 이름의 두 stream을 거부한다", lambda: expect(result({**hwp_streams(), "docinfo": hwp_streams()["DocInfo"]}), "rejected"))
    check("구역 개수와 실제 Section 이름이 다르면 거부한다", lambda: expect(result({**hwp_streams(), "BodyText/Section2": hwp_streams()["BodyText/Section0"]}), "rejected", "hwp_section_mismatch"))
    check("임의 stream을 숨겨 통과할 수 없다", lambda: expect(result({**hwp_streams(), "Unknown": b"MZevil"}), "unsupported", "hwp_stream_unsupported"))
    check("검증하지 못한 문서 연결 저장소는 미지원이다", lambda: expect(result({**hwp_streams(), "DocOptions/_LinkDoc": b"path"}), "unsupported", "hwp_storage_unsupported"))
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


if __name__ == "__main__":
    run()
