"""HWP 5 계열의 제한된 구조 검사. 내용 실행·렌더링·악성 검사를 대신하지 않는다.

OLE 해석은 olefile 0.47에 맡기고, 그 결과에 체인 소유권/한도 검사를 더한다.
근거: 한컴 한글문서파일형식_5.0_revision1.3.pdf 3·4절, MS-CFB 2절.
https://cdn.hancom.com/link/docs/한글문서파일형식_5.0_revision1.3.pdf
https://learn.microsoft.com/en-us/openspecs/windows_protocols/ms-cfb/53989ce4-7b05-4f8d-829b-d08d6148375b
https://olefile.readthedocs.io/en/stable/olefile.html
"""
from __future__ import annotations

from io import BytesIO
import math
import re
import struct
import unicodedata
import warnings
import zlib

from .boilerplate import is_empty_hancom_script

try:
    import olefile
except ImportError:
    olefile = None
try:
    from PIL import Image, ImageFile, UnidentifiedImageError
except ImportError:
    Image = None
    UnidentifiedImageError = OSError

MIME = "application/x-hwp"
MAGIC = b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"
FREE, END, FAT, DIF = 0xFFFFFFFF, 0xFFFFFFFE, 0xFFFFFFFD, 0xFFFFFFFC
MAX_INPUT_BYTES = 100 * 1024 * 1024  # 운영 정책이 아닌 검사기 기술 상한
MAX_RECORDS = 100_000  # 짧은 레코드가 만드는 반복 작업의 기술 상한
VERSIONS_51 = frozenset((0x05010000, 0x05010001, 0x05010100))


class _Verdict(Exception):
    def __init__(self, code, status="rejected"):
        self.code, self.status = code, status


def _fail(code, status="rejected"):
    raise _Verdict(code, status)


def _limits_valid(limits):
    if not isinstance(limits, dict):
        return False
    if any(type(limits.get(k)) is not int or limits[k] <= 0 for k in
           ("max_archive_entries", "max_entry_bytes", "max_expanded_bytes", "max_xml_bytes")):
        return False
    ratio = limits.get("max_compression_ratio")
    return (type(ratio) is int and ratio > 0) or (type(ratio) is float and ratio > 0 and math.isfinite(ratio))


def _cfb_header(data):
    # 라이브러리의 FAT 할당 전에 물리적 크기와 FAT/DIFAT 목록을 제한한다.
    if len(data) < 512 or data[:8] != MAGIC:
        _fail("signature_mismatch")
    version, order, shift, mini = struct.unpack_from("<4H", data, 26)
    if version not in (3, 4):
        _fail("hwp_container_version_unsupported", "unsupported")
    if order != 0xFFFE or shift != (9 if version == 3 else 12) or mini != 6:
        _fail("hwp_container_corrupt")
    size = 1 << shift
    if len(data) < size * 3 or len(data) % size or any(data[8:24]) or any(data[34:40]):
        _fail("hwp_container_corrupt")
    if version == 4 and any(data[512:size]):
        _fail("hwp_container_corrupt")
    count = len(data) // size - 1
    directory_count, fat_count = struct.unpack_from("<2I", data, 40)
    cutoff, mini_start, mini_count, dif_start, dif_count = struct.unpack_from("<5I", data, 56)
    if cutoff != 4096 or not 0 < fat_count <= count or mini_count > count or dif_count > count:
        _fail("hwp_container_corrupt")
    if version == 3 and directory_count:
        _fail("hwp_container_corrupt")
    if version == 4 and not 0 < directory_count <= count:
        _fail("hwp_container_corrupt")
    fats, difs, fat_seen, dif_seen = [], [], set(), set()

    def add_fats(values):
        for sector in values:
            if sector == FREE:
                continue
            if sector >= count or sector in fat_seen or len(fats) >= fat_count:
                _fail("hwp_container_corrupt")
            fat_seen.add(sector)
            fats.append(sector)

    add_fats(struct.unpack_from("<109I", data, 76))
    current = dif_start
    for _ in range(dif_count):
        if current >= count or current in dif_seen or current in fat_seen:
            _fail("hwp_container_corrupt")
        dif_seen.add(current)
        difs.append(current)
        values = struct.unpack_from("<" + "I" * (size // 4), data, (current + 1) * size)
        add_fats(values[:-1])
        current = values[-1]
    if current != END or len(fats) != fat_count or fat_seen & dif_seen:
        _fail("hwp_container_corrupt")
    if (mini_count == 0 and mini_start != END) or (mini_count and mini_start >= count):
        _fail("hwp_container_corrupt")
    return size, count, fats, difs


def _chain(table, start, count, used, owner, expected=None):
    result = []
    while start != END:
        if start >= count or start >= len(table) or start in used:
            _fail("hwp_chain_invalid")
        used[start] = owner
        result.append(start)
        if expected is not None and len(result) > expected:
            _fail("hwp_chain_invalid")
        start = int(table[start])
    if expected is not None and len(result) != expected:
        _fail("hwp_chain_invalid")
    return result


def _check_allocation(ole, data, size, count, fats, difs, limits):
    # olefile의 시작 섹터 중복 검사에 더해 체인 중간 공유/고아 할당도 확인한다.
    # FREE 영역이나 마지막 섹터의 오래된 여유 바이트는 삭제/악성 판정하지 않는다.
    used = {}
    for sector, marker in [(s, FAT) for s in fats] + [(s, DIF) for s in difs]:
        if sector >= len(ole.fat) or int(ole.fat[sector]) != marker or sector in used:
            _fail("hwp_chain_invalid")
        used[sector] = "metadata"
    dirs = _chain(ole.fat, ole.first_dir_sector, count, used, "directory")
    if ole.dll_version == 4 and len(dirs) != ole.num_dir_sectors:
        _fail("hwp_chain_invalid")
    directory = ole.directory_fp.getvalue()
    active = 0
    for index in range(len(directory) // 128):
        kind = directory[index * 128 + 66]
        entry = ole.direntries[index]
        if kind:
            active += 1
            if entry is None or kind not in (1, 2, 5):
                _fail("hwp_directory_unreachable")
        elif entry is not None:
            _fail("hwp_container_corrupt")
    if active - 1 > limits["max_archive_entries"]:
        _fail("hwp_entries_limit")
    mini_sectors = _chain(ole.fat, ole.first_mini_fat_sector, count, used, "minifat", ole.num_mini_fat_sectors)
    root_size = ole.root.size
    if root_size > len(data) or root_size % 64:
        _fail("hwp_chain_invalid")
    _chain(ole.fat, ole.root.isectStart, count, used, "ministream", (root_size + size - 1) // size)
    if root_size:
        ole.loadminifat()
    # 라이브러리가 물리/루트 크기로 잘라낸 FAT 뒷부분도 FREE인지 대조한다.
    fat_values = (value for sector in fats for value in struct.unpack_from("<" + "I" * (size // 4), data, (sector + 1) * size))
    mini_values = (value for sector in mini_sectors for value in struct.unpack_from("<" + "I" * (size // 4), data, (sector + 1) * size))
    if any(value != FREE and index >= count for index, value in enumerate(fat_values)) or any(value != FREE and index >= root_size // 64 for index, value in enumerate(mini_values)):
        _fail("hwp_hidden_allocation")
    mini_used, total = {}, 0
    for entry in ole.direntries:
        if entry is None or entry.entry_type != 2:
            continue
        if entry.size > limits["max_entry_bytes"]:
            _fail("hwp_entry_limit")
        total += entry.size
        if total > limits["max_expanded_bytes"]:
            _fail("hwp_expanded_limit")
        if entry.size < 4096:
            table = ole.minifat if root_size else []
            _chain(table, entry.isectStart, root_size // 64, mini_used, entry.sid, (entry.size + 63) // 64)
        else:
            _chain(ole.fat, entry.isectStart, count, used, entry.sid, (entry.size + size - 1) // size)
    if any(int(value) != FREE and index not in used for index, value in enumerate(ole.fat)):
        _fail("hwp_hidden_allocation")
    if root_size and any(int(value) != FREE and index not in mini_used for index, value in enumerate(ole.minifat)):
        _fail("hwp_hidden_allocation")


def _decode_stream(raw, compressed, limits, total):
    if not compressed:
        result = raw
    else:
        decoder, pieces, actual, checksum, trailer = zlib.decompressobj(-15), [], 0, 0, b""
        for offset in range(0, len(raw), 65536):
            pending = raw[offset:offset + 65536]
            if decoder.eof:
                trailer += pending
                if len(trailer) > 8:
                    _fail("hwp_compression_corrupt")
                continue
            while pending:
                piece = decoder.decompress(pending, min(65536, limits["max_entry_bytes"] - actual + 1))
                pending = decoder.unconsumed_tail
                actual += len(piece)
                if actual > limits["max_entry_bytes"]:
                    _fail("hwp_entry_limit")
                if actual > max(1, len(raw)) * limits["max_compression_ratio"]:
                    _fail("hwp_ratio_limit")
                if total + actual > limits["max_expanded_bytes"]:
                    _fail("hwp_expanded_limit")
                if decoder.unused_data:
                    trailer += decoder.unused_data
                    if len(trailer) > 8:
                        _fail("hwp_compression_corrupt")
                checksum = zlib.crc32(piece, checksum)
                pieces.append(piece)
        if not decoder.eof:
            _fail("hwp_compression_corrupt")
        # 한컴의 일부 HWP5에는 raw DEFLATE 뒤 CRC32/ISIZE가 붙는다.
        # 공개 pyhwp 원본에서도 확인했으며 임의의 뒤쪽 바이트는 허용하지 않는다.
        if trailer and trailer != struct.pack("<II", checksum, actual & 0xFFFFFFFF):
            _fail("hwp_compression_corrupt")
        result = b"".join(pieces)
    if len(result) > limits["max_entry_bytes"]:
        _fail("hwp_entry_limit")
    if total + len(result) > limits["max_expanded_bytes"]:
        _fail("hwp_expanded_limit")
    return result


def _numbering_51(payload):
    # 명세 표 38/39의 필드 합은 문단 머리 12B(4+2+2+4)다(표의 8B 합계는 불일치).
    # 5.1의 실제 한컴 원본에서도 7+3단계 각각 머리+UTF16 문자열을 확인했다.
    # 문자열/확장 시작번호까지 경계를 검사하며, 번호의 렌더링 의미는 평가하지 않는다.
    position = 0

    def levels(count):
        nonlocal position
        for _ in range(count):
            if position + 14 > len(payload):
                _fail("hwp_record_corrupt")
            chars = struct.unpack_from("<H", payload, position + 12)[0]
            position += 14
            end = position + chars * 2
            if end > len(payload):
                _fail("hwp_record_corrupt")
            payload[position:end].decode("utf-16-le")
            position = end

    levels(7)
    position += 2 + 7 * 4  # 전체 시작번호 + 수준 1~7 시작번호
    levels(3)
    if position + 3 * 4 != len(payload):
        _fail("hwp_record_corrupt")


def _records(raw, *, docinfo=False, version=None):
    # 모든 레코드의 경계/레벨을 보되 모든 의미 필드를 해석한다고 주장하지 않는다.
    position, previous, count, root_tag = 0, 0, 0, None
    compatibility = set()
    known_doc = set(range(16, 33)) | {92, 94, 96, 97}
    known_body = set(range(66, 94)) | {95, 98, 115}
    profile_51 = version in VERSIONS_51
    profile_lengths = {16: 26, 17: 72, 21: 74, 25: 54 if version == 0x05010000 else 58} if docinfo else {66: 24}
    while position < len(raw):
        if count >= MAX_RECORDS:
            _fail("hwp_records_limit")
        if position + 4 > len(raw):
            _fail("hwp_record_corrupt")
        header = struct.unpack_from("<I", raw, position)[0]
        tag, level, length = header & 1023, (header >> 10) & 1023, header >> 20
        position += 4
        if length == 4095:
            if position + 4 > len(raw):
                _fail("hwp_record_corrupt")
            length = struct.unpack_from("<I", raw, position)[0]
            position += 4
            if length < 4095:
                _fail("hwp_record_corrupt")
        if position + length > len(raw) or level > previous + 1 or (not count and level != 0):
            _fail("hwp_record_corrupt")
        if tag not in (known_doc if docinfo else known_body):
            _fail("hwp_record_unsupported", "unsupported")
        if (docinfo and tag in (27, 28, 29, 96, 97)) or (not docinfo and tag in (84, 87, 89, 91, 92, 95, 98, 115)):
            _fail("hwp_active_content_unsupported", "unsupported")
        payload = raw[position:position + length]
        if level == 0:
            root_tag = tag
        if profile_51:
            # 5.1을 5.0의 느슨한 버전 별칭으로 취급하지 않는다. 공식 명세와
            # 한컴 실측 버전표에 확인된 레코드 길이/확장 경계를 별도로 대조한다.
            # https://github.com/STAIxBWLB/hwp-cli/blob/main/docs/design/19-hwp5-spec-supplement.md
            if tag in profile_lengths and length != profile_lengths[tag]:
                _fail("hwp_version_record_mismatch")
            if docinfo and (18 <= tag <= 26 or tag in (92, 94)) and (level != 1 or root_tag != 17):
                _fail("hwp_record_corrupt")
            if docinfo and tag == 23:
                _numbering_51(payload)
            if docinfo and tag == 25 and length == 58:
                # hwplib 원저자의 ForParaShape.read는 마지막 DWORD를 ParaLevel로
                # 해석한다. 실제 한컴 5.1 문서도 수준 0..9이며 '항상 0인 패딩'이 아니다.
                # https://github.com/neolord0/hwplib/blob/main/src/main/java/kr/dogfoot/hwplib/reader/docinfo/ForParaShape.java
                if struct.unpack_from("<I", payload, 54)[0] > 9:
                    _fail("hwp_layout_extension_unsupported", "unsupported")
        if docinfo and tag in (30, 31, 32):
            # 명세 표 4·13 및 4.2.14/15: 호환 문서와 그 하위의 수동적인
            # 배치/변경 추적 메타데이터다. 스크립트나 실행 개체로 오분류하지 않는다.
            # 글꼴/스타일과 마찬가지로 렌더링 의미 전체가 아닌 레코드 구조 검사다.
            expected_length, expected_level = {30: (4, 0), 31: (20, 1), 32: (1032, 1)}[tag]
            if tag in compatibility or length != expected_length or level != expected_level or root_tag != 30:
                _fail("hwp_record_corrupt")
            if tag == 30 and struct.unpack_from("<I", payload)[0] not in (0, 1, 2):
                _fail("hwp_compatibility_unsupported", "unsupported")
            compatibility.add(tag)
        if not docinfo and tag == 66 and length < 22:
            _fail("hwp_record_corrupt")
        if not docinfo and tag == 67 and length % 2:
            _fail("hwp_record_corrupt")
        if not count and tag != (16 if docinfo else 66):
            _fail("hwp_required_record_missing")
        count += 1
        previous, position = level, position + length
        yield tag, level, payload
    if not count:
        _fail("hwp_required_record_missing")
    if docinfo and profile_51 and compatibility != {30, 31, 32}:
        _fail("hwp_required_compatibility_missing")


def _binary_metadata(records, compressed):
    images = {}
    for tag, _, payload in records:
        if tag != 18:
            continue
        if len(payload) < 6:
            _fail("hwp_record_corrupt")
        flags, binary_id, chars = struct.unpack_from("<3H", payload)
        if flags & 15 != 1:
            _fail("hwp_embedded_content_unsupported", "unsupported")
        mode = (flags >> 4) & 3
        if flags & ~0x33F or mode == 3 or len(payload) != 6 + chars * 2 or not binary_id:
            _fail("hwp_record_corrupt")
        extension = payload[6:].decode("utf-16-le").lower()
        if extension not in ("png", "jpg", "jpeg", "gif", "bmp"):
            _fail("hwp_embedded_content_unsupported", "unsupported")
        name = f"BinData/BIN{binary_id:04X}.{extension}"
        if name.casefold() in images:
            _fail("hwp_record_corrupt")
        images[name.casefold()] = (compressed if mode == 0 else mode == 1, extension)
    return images


def _image(raw, limits, total, extension=None):
    signatures = {"png": (b"\x89PNG\r\n\x1a\n",), "jpg": (b"\xff\xd8\xff",),
                  "jpeg": (b"\xff\xd8\xff",), "gif": (b"GIF87a", b"GIF89a"), "bmp": (b"BM",)}
    allowed = signatures.get(extension, sum(signatures.values(), ()))
    if not raw.startswith(allowed):
        _fail("hwp_image_signature_mismatch")
    if Image is None:
        _fail("hwp_image_parser_unavailable", "error")
    if ImageFile.LOAD_TRUNCATED_IMAGES:
        _fail("hwp_image_parser_configuration_invalid", "error")
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(BytesIO(raw)) as picture:
                width, height = picture.size
                decoded = width * height * 4
                if decoded > limits["max_entry_bytes"] or decoded + total > limits["max_expanded_bytes"]:
                    _fail("hwp_image_expanded_limit")
                if getattr(picture, "n_frames", 1) != 1:
                    _fail("hwp_image_animation_unsupported", "unsupported")
                picture.verify()
            with Image.open(BytesIO(raw)) as picture:
                picture.load()
        return decoded
    except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombWarning, Image.DecompressionBombError):
        _fail("hwp_image_corrupt")


def _scripts(raw):
    # 공개 원본의 네 문자열을 확인했다. header/source만 HWPX의 정확한 기본식과 공유한다.
    position = 0
    for role in ("header", "source", "pre", "post"):
        if position + 4 > len(raw):
            _fail("hwp_script_corrupt")
        length = struct.unpack_from("<I", raw, position)[0]
        position += 4
        if position + length * 2 > len(raw):
            _fail("hwp_script_corrupt")
        text = raw[position:position + length * 2].decode("utf-16-le")
        allowed = is_empty_hancom_script(text, role) if role in ("header", "source") else len(text) <= 2048 and all(c in " \t\r\n" for c in text)
        if not allowed:
            _fail("hwp_script_unsupported", "unsupported")
        position += length * 2
    if raw[position:] != b"\xff\xff\xff\xff":
        _fail("hwp_script_corrupt")


def _header(header):
    if len(header) != 256 or header[:32] != b"HWP Document File" + b"\x00" * 15:
        _fail("hwp_header_invalid")
    version, flags, license_flags, encrypt_version = struct.unpack_from("<4I", header, 32)
    if version >> 16 != 0x0500 and version not in VERSIONS_51:
        _fail("hwp_version_unsupported", "unsupported")
    if flags & ((1 << 1) | (1 << 2) | (1 << 4) | (1 << 8) | (1 << 10) | (1 << 13)):
        _fail("hwp_protected_unsupported", "unsupported")
    # 표 3의 EncryptVersion(0..4)은 알고리즘 정보이며 암호 여부는 bit 1이다.
    # 평문 DocInfo/BodyText 검사를 생략하지 않고, 알려지지 않은 알고리즘은 막는다.
    # XML 서식의 존재 힌트(bit 5)만으로 실행 기능이라고 단정하지 않는다.
    # 실제 XMLTemplate 저장소/stream은 아래 경로 허용 목록에서 계속 미지원이다.
    if encrypt_version not in range(5) or flags & ~((1 << 0) | (1 << 3) | (1 << 5) | (1 << 11) | (1 << 12) | (1 << 15) | (1 << 17)) or license_flags & ~7 or any(header[49:]):
        _fail("hwp_features_unsupported", "unsupported")
    return version, flags


def _document(ole, limits):
    if not ole.exists("FileHeader") or ole.get_type("FileHeader") != 2:
        _fail("hwp_required_stream_missing")
    with ole.openstream("FileHeader") as stream:
        version, flags = _header(stream.read())
    entries = ole.listdir(streams=True, storages=True)
    paths, streams = set(), {}
    for parts in entries:
        path = "/".join(parts)
        if path.casefold() in paths or len(parts) > 2:
            _fail("hwp_directory_invalid")
        paths.add(path.casefold())
        for part in parts:
            if (not part or part != unicodedata.normalize("NFC", part) or part in (".", "..")
                    or any(c in part for c in "/\\:") or part[-1:] in (".", " ")
                    or any(unicodedata.category(c) in ("Cc", "Cf", "Cs") for c in part)
                    and part != "\x05HwpSummaryInformation"):
                _fail("hwp_directory_invalid")
        kind = ole.get_type(parts)
        if kind == 1:
            if path not in ("BodyText", "BinData", "Scripts", "DocOptions"):
                _fail("hwp_storage_unsupported", "unsupported")
        elif kind == 2:
            with ole.openstream(parts) as stream:
                raw = stream.read()
            if len(raw) != ole.get_size(parts):
                _fail("hwp_container_corrupt")
            streams[path] = raw
    if not {"FileHeader", "DocInfo", "BodyText/Section0"} <= streams.keys():
        _fail("hwp_required_stream_missing")
    compressed, total = bool(flags & 1), 256
    doc = _decode_stream(streams["DocInfo"], compressed, limits, total)
    total += len(doc)
    # 모든 레코드를 리스트로 쌓으면 짧은 레코드 폭탄에서 객체 수가 폭증한다.
    properties, id_map, images, counts = None, None, {}, {}
    for tag, level, payload in _records(doc, docinfo=True, version=version):
        if tag == 16:
            if properties is not None or level != 0 or len(payload) < 26:
                _fail("hwp_record_corrupt")
            properties = payload
        elif tag == 17:
            if id_map is not None or level != 0 or len(payload) < 32 or len(payload) % 4:
                _fail("hwp_record_corrupt")
            id_map = payload
        elif tag == 18:
            addition = _binary_metadata([(tag, level, payload)], compressed)
            if images.keys() & addition.keys():
                _fail("hwp_record_corrupt")
            images.update(addition)
            if len(images) > limits["max_archive_entries"]:
                _fail("hwp_entries_limit")
        counts[tag] = counts.get(tag, 0) + 1
    if properties is None or id_map is None:
        _fail("hwp_required_record_missing")
    if version in VERSIONS_51:
        # 구조 검사에는 5.1의 18개 ID 목록과 실제 레코드 개수 대조도 포함한다.
        declared = struct.unpack("<18I", id_map)
        expected = {18: declared[0], 19: sum(declared[1:8]), **dict(zip(range(20, 27), declared[8:15])),
                    92: declared[15], 96: declared[16], 97: declared[17]}
        if any(counts.get(tag, 0) != count for tag, count in expected.items()):
            _fail("hwp_id_mapping_mismatch")
    section_count = struct.unpack_from("<H", properties)[0]
    sections = {name for name in streams if name.startswith("BodyText/")}
    if not section_count or sections != {f"BodyText/Section{i}" for i in range(section_count)}:
        _fail("hwp_section_mismatch")
    image_paths = {name.casefold() for name in streams if name.startswith("BinData/")}
    if not images.keys() <= image_paths:
        _fail("hwp_binary_mismatch")
    # 편집 후 남은 미참조 그림도 실제 바이트를 검사한다. 참조된 파일 누락은
    # 위에서 거부하고, 잔재는 표준 BINxxxx.그림확장자/기본 압축만 지원한다.
    # 압축 모드를 추측하며 여러 번 재시도하거나 OLE/실행 파일을 허용하지 않는다.
    for path in image_paths - images.keys():
        match = re.fullmatch(r"bindata/bin([0-9a-f]{4})\.(png|jpg|jpeg|gif|bmp)", path)
        if not match or not int(match[1], 16):
            _fail("hwp_unreferenced_binary_unsupported", "unsupported")
        images[path] = (compressed, match[2])
    scripts = {name for name in streams if name.startswith("Scripts/")}
    if scripts and scripts != {"Scripts/DefaultJScript", "Scripts/JScriptVersion"}:
        _fail("hwp_script_unsupported", "unsupported")
    if flags & 8 and not scripts:
        _fail("hwp_script_corrupt")
    for name, raw in streams.items():
        if name in ("FileHeader", "DocInfo"):
            continue
        is_compressed = compressed if name in sections or name in scripts else images[name.casefold()][0] if name.casefold() in images else False
        value = _decode_stream(raw, is_compressed, limits, total)
        total += len(value)
        if name in sections:
            for _ in _records(value, version=version):
                pass
        elif name.casefold() in images:
            total += _image(value, limits, total, images[name.casefold()][1])
        elif name == "PrvText":
            value.decode("utf-16-le")
        elif name == "PrvImage":
            total += _image(value, limits, total)
        elif name == "Scripts/DefaultJScript":
            _scripts(value)
        elif name == "Scripts/JScriptVersion":
            if value != struct.pack("<2I", 1, 0):
                _fail("hwp_script_version_unsupported", "unsupported")
        elif name == "DocOptions/_LinkDoc":
            # 명세 3.2.8은 연결 문서 경로만 설명하고 버퍼 필드는 정의하지 않는다.
            # 공개 원본/작성기의 524B 전체 0인 빈 형식만 확인한다. 첫 NUL 뒤의
            # 비영 바이트를 임의 여유 공간으로 간주하거나 외부 경로를 열지 않는다.
            if len(value) != 524 or any(value):
                _fail("hwp_document_link_unsupported", "unsupported")
        elif name == "\x05HwpSummaryInformation":
            # OLEPS 메타데이터를 실행하지 않고 서명/최소 길이만 확인한다.
            if len(value) < 28 or not value.startswith(b"\xfe\xff"):
                _fail("hwp_summary_invalid")
        else:
            _fail("hwp_stream_unsupported", "unsupported")


def inspect_hwp(data: bytes, limits: dict) -> dict:
    """제한된 HWP5 구조 판정. 오류에 파일 내용/라이브러리 원문을 싣지 않는다."""
    if not _limits_valid(limits) or type(data) is not bytes:
        return {"status": "error", "code": "invalid_inspection_input", "mime": None}
    if len(data) > MAX_INPUT_BYTES:
        return {"status": "rejected", "code": "hwp_input_limit", "mime": None}
    if olefile is None:
        return {"status": "error", "code": "hwp_parser_unavailable", "mime": None}
    identified = False
    try:
        size, count, fats, difs = _cfb_header(data)

        class BoundedOle(olefile.OleFileIO):
            def loaddirectory(self, sector):
                # 전체 directory 객체/재귀 트리 생성 전에 라이브러리로 읽은 크기를 제한한다.
                with self._open(sector, force_FAT=True) as directory:
                    entries = directory.size // 128
                    if entries > limits["max_archive_entries"] + size // 128 + 1:
                        _fail("hwp_entries_limit")
                super().loaddirectory(sector)

        with BoundedOle(BytesIO(data), raise_defects=olefile.DEFECT_INCORRECT) as ole:
            _check_allocation(ole, data, size, count, fats, difs, limits)
            if ole.exists("FileHeader") and ole.get_type("FileHeader") == 2 and ole.get_size("FileHeader") == 256:
                with ole.openstream("FileHeader") as header:
                    identified = header.read(32) == b"HWP Document File" + b"\0" * 15
            _document(ole, limits)
        return {"status": "passed", "code": "hwp_structure_checked", "mime": MIME}
    except _Verdict as verdict:
        return {"status": verdict.status, "code": verdict.code, "mime": MIME if identified else None}
    except (MemoryError, RecursionError):
        return {"status": "error", "code": "hwp_resource_limit", "mime": MIME if identified else None}
    except (OSError, ValueError, TypeError, KeyError, IndexError, OverflowError, struct.error, zlib.error):
        return {"status": "rejected", "code": "hwp_container_corrupt", "mime": None}
    except Exception:
        return {"status": "error", "code": "hwp_inspection_failed", "mime": MIME if identified else None}
