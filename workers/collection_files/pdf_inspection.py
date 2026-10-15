"""실행·추출·네트워크 없이 PDF의 제한된 구조를 검사한다.

pypdf strict 파서와 입력별 한도를 함께 사용한다. passed는 악성 검사나
전체 페이지 렌더링 성공이 아니다. 미지원 코덱/증분 저장은 추정하지 않는다.
참조: https://pypdf.readthedocs.io/en/stable/user/robustness.html
      https://pdf-issues.pdfa.org/32000-2-2020/clause07.html (7.5.7/7.5.8)
      https://www.w3.org/TR/PNG-Filters.html
      https://pypdf.readthedocs.io/en/6.20.1/modules/Fit.html (문서 내부 보기 위치)
"""
from __future__ import annotations

import base64
from io import BytesIO
import math
import re
import warnings
from urllib.parse import urlsplit
import zlib

try:
    import pypdf
    from pypdf import PdfReader
    from pypdf._utils import read_non_whitespace, read_until_regex
    from pypdf.generic import (ArrayObject, ContentStream, DictionaryObject, IndirectObject,
                               NameObject, NullObject, StreamObject, read_object)
except ImportError:
    pypdf = None

try:
    from PIL import Image, ImageFile
except ImportError:
    Image = ImageFile = None


# 학교 정책값이 아닌 이 구현판의 기술적 지원 상한이다. 더 낮은 승인값을 우선한다.
PYPDF_VERSION = "6.20.1"
MAX_OBJECTS = 10000
MAX_GRAPH_NODES = 100000
MAX_CONTENT_OPERATIONS = 1000000
MAX_GRAPH_DEPTH = 64
MAX_IMAGE_PIXELS = 40000000
MAX_INPUT_BYTES = 100 * 1024 * 1024
MIME = "application/pdf"
_WHITE = b"\x00\t\n\x0c\r "
_LINE_END = re.compile(rb"[\r\n]")
_XREF_SECTION = re.compile(rb"(\d{1,10})[ \t]+(\d{1,10})[ \t]*(?:\r\n|\r|\n)")
_OBJECT_HEADER = re.compile(rb"(\d{1,10})[\x00\t\n\x0c\r ]+(\d{1,5})[\x00\t\n\x0c\r ]+obj(?=[\x00\t\n\x0c\r /<\[])")
_OBJECT_INDEX_NUMBER = re.compile(rb"\d{1,10}(?=[\x00\t\n\x0c\r ]|\Z)")
_STREAM_PREFIX = re.compile(rb"stream *(?:\r\n|\r|\n)\Z")
_FORBIDDEN_KEYS = frozenset((
    "/JS", "/JavaScript", "/OpenAction", "/AA", "/EmbeddedFiles", "/EF", "/AF", "/XFA",
    "/RichMedia", "/RichMediaContent", "/RichMediaSettings", "/3D", "/3DD", "/Movie", "/Sound",
    "/Collection", "/FDF", "/OPI", "/Ref", "/Alternates", "/FFilter", "/FDecodeParms", "/PS",
))
_FORBIDDEN_TYPES = frozenset(("/Filespec", "/EmbeddedFile", "/RichMedia", "/3D", "/Movie", "/Sound"))
_SAFE_ACTIONS = frozenset(("/GoTo", "/URI"))


class _Verdict(Exception):
    def __init__(self, code, status="rejected"):
        self.code, self.status = code, status


def _fail(code, status="rejected"):
    raise _Verdict(code, status)


def _valid_limits(limits):
    if not isinstance(limits, dict):
        return False
    for key in ("max_archive_entries", "max_entry_bytes", "max_expanded_bytes", "max_xml_bytes"):
        if type(limits.get(key)) is not int or limits[key] <= 0:
            return False
    ratio = limits.get("max_compression_ratio")
    return type(ratio) in (int, float) and math.isfinite(ratio) and ratio > 0


def _skip(data, position):
    while position < len(data):
        if data[position] in _WHITE:
            position += 1
        elif data[position:position + 1] == b"%":
            end = _LINE_END.search(data, position)
            position = len(data) if end is None else end.end()
        else:
            break
    return position


class _TrailerContext:
    strict = True

    def get_object(self, reference):
        # 트레일러 파싱 단계에서는 파일 본문 참조를 따라가지 않는다.
        _fail("pdf_trailer_invalid")


class _BudgetIO(BytesIO):
    """파싱 후 그래프 검사 전에 과도한 토큰/반복 읽기를 제한한다."""
    def __init__(self, data):
        super().__init__(data)
        self._length = len(data)
        self._remaining = max(4096, len(data) * 16)
        self._calls = MAX_GRAPH_NODES * 8

    def read(self, size=-1):
        amount = max(0, self._length - self.tell()) if size < 0 else min(size, max(0, self._length - self.tell()))
        self._remaining -= amount
        self._calls -= 1
        if self._remaining < 0 or self._calls < 0:
            _fail("pdf_resource_limit")
        return super().read(size)

    def readline(self, size=-1):
        self._calls -= 1
        if self._calls < 0:
            _fail("pdf_resource_limit")
        value = super().readline(size)
        self._remaining -= len(value)
        if self._remaining < 0:
            _fail("pdf_resource_limit")
        return value


def _framing(data, limits):
    """복구 파서가 잘못된 xref를 추정하지 못하게 원본 위치/테이블을 먼저 확인한다."""
    if not re.match(rb"%PDF-(?:1\.[0-7]|2\.0)(?:\r\n|\r|\n)", data):
        _fail("signature_mismatch")
    tail = re.search(rb"startxref\s+(\d{1,12})\s+%%EOF[\x00\t\n\x0c\r ]*\Z", data)
    if tail is None:
        _fail("pdf_trailer_invalid")
    start = int(tail[1])
    if start >= tail.start():
        _fail("pdf_xref_invalid")
    if data[start:start + 4] != b"xref":
        return _stream_framing(data, limits, start, tail.start())
    position = _skip(data, start + 4)
    entries, offsets, ids = {}, set(), set()
    maximum = min(limits["max_archive_entries"], MAX_OBJECTS)
    while not data[position:position + 7] == b"trailer":
        header = _XREF_SECTION.match(data, position)
        if header is None:
            _fail("pdf_xref_invalid")
        first, count = int(header[1]), int(header[2])
        if not count or count > maximum + 1 or first + count > MAX_OBJECTS + 1:
            _fail("pdf_objects_limit")
        position = header.end()
        for number in range(first, first + count):
            if number in ids or len(ids) > maximum:
                _fail("pdf_xref_invalid")
            ids.add(number)
            row = data[position:position + 20]
            if not re.fullmatch(rb"\d{10} \d{5} [nf](?: \r| \n|\r\n)", row):
                _fail("pdf_xref_invalid")
            offset, generation = int(row[:10]), int(row[11:16])
            if generation > 65535:
                _fail("pdf_xref_invalid")
            if row[17:18] == b"n":
                if number == 0 or offset in offsets or not 0 < offset < start:
                    _fail("pdf_xref_invalid")
                if not re.match(rb"%d\s+%d\s+obj(?:[\x00\t\n\x0c\r /<\[])" % (number, generation), data[offset:offset + 80]):
                    _fail("pdf_xref_invalid")
                offsets.add(offset)
                entries[(number, generation)] = offset
            position += 20
        position = _skip(data, position)
        if position >= tail.start():
            _fail("pdf_xref_invalid")
    if tail.start() - position > min(limits["max_entry_bytes"], limits["max_xml_bytes"]):
        _fail("pdf_object_limit")
    stream = _BudgetIO(data)
    stream.seek(_skip(data, position + 7))
    trailer = read_object(stream, _TrailerContext())
    if not isinstance(trailer, DictionaryObject) or isinstance(trailer, StreamObject):
        _fail("pdf_trailer_invalid")
    if _skip(data, stream.tell()) != tail.start():
        _fail("pdf_trailer_invalid")
    if "/Encrypt" in trailer:
        _fail("document_encrypted")
    if "/Prev" in trailer or "/XRefStm" in trailer:
        _fail("pdf_incremental_unsupported", "unsupported")
    size = trailer.get("/Size")
    if isinstance(size, bool) or not isinstance(size, int) or size != max(ids, default=-1) + 1:
        _fail("pdf_trailer_invalid")
    if not entries or not isinstance(trailer.get("/Root"), IndirectObject):
        _fail("pdf_trailer_invalid")
    sorted_offsets = sorted(offsets)
    bounds = {offset: sorted_offsets[i + 1] if i + 1 < len(sorted_offsets) else start
              for i, offset in enumerate(sorted_offsets)}
    if any(end - offset > limits["max_entry_bytes"] for offset, end in bounds.items()):
        _fail("pdf_object_limit")
    # 등재되지 않은 앞쪽 객체/실행파일을 무시하지 않는다.
    header_end = re.match(rb"[^\r\n]+(?:\r\n|\r|\n)", data).end()
    if _skip(data, header_end) != sorted_offsets[0]:
        _fail("pdf_unlisted_data")
    return {"entries": entries, "bounds": bounds, "compressed": {},
            "trailer_position": _skip(data, position + 7), "xref_key": None, "predecoded": None}


def _direct_int(value, *, minimum=0, maximum=MAX_OBJECTS):
    if isinstance(value, bool) or not isinstance(value, int) or not minimum <= value <= maximum:
        _fail("pdf_xref_invalid")
    return int(value)


def _stream_length(data, body_start, parsed_end, value, context):
    """pypdf가 정정했을 수 있는 Length를 원본 dictionary와 실제 구간으로 재확인한다."""
    if data[parsed_end - 9:parsed_end] != b"endstream" or not isinstance(value._data, bytes):
        _fail("pdf_stream_length_invalid")
    end = parsed_end - 9
    for separator in (b"", b"\n", b"\r", b"\r\n"):
        data_end = end - len(separator)
        data_start = data_end - len(value._data)
        if (data_start < body_start or data[data_end:end] != separator
                or data[data_start:data_end] != value._data):
            continue
        marker = _STREAM_PREFIX.search(data, body_start, data_start)
        if marker is None:
            continue
        raw_dictionary = data[body_start:marker.start()]
        source = _BudgetIO(raw_dictionary)
        dictionary = read_object(source, context)
        if (not isinstance(dictionary, DictionaryObject) or isinstance(dictionary, StreamObject)
                or _skip(raw_dictionary, source.tell()) != len(raw_dictionary) or "/Length" not in dictionary):
            _fail("pdf_stream_length_invalid")
        declared = _resolve(dictionary.get("/Length"))
        if isinstance(declared, bool) or not isinstance(declared, int) or declared < 0 or declared != len(value._data):
            _fail("pdf_stream_length_invalid")
        return
    _fail("pdf_stream_length_invalid")


def _stream_framing(data, limits, start, tail_start):
    """xref 스트림의 직접 필드/실제 바이트를 먼저 검사해 파서 자동 복구를 차단한다."""
    header = _OBJECT_HEADER.match(data, start)
    if header is None or tail_start - start > limits["max_entry_bytes"]:
        _fail("pdf_xref_invalid")
    number, generation = int(header[1]), int(header[2])
    if number == 0 or generation > 65535:
        _fail("pdf_xref_invalid")
    stream = _BudgetIO(data)
    stream.seek(_skip(data, header.end()))
    xref = read_object(stream, _TrailerContext())
    parsed_end = stream.tell()
    end = _skip(data, stream.tell())
    if (not isinstance(xref, StreamObject) or xref.get("/Type") != "/XRef"
            or data[end:end + 6] != b"endobj" or _skip(data, end + 6) != tail_start):
        _fail("pdf_xref_invalid")
    _stream_length(data, _skip(data, header.end()), parsed_end, xref, _TrailerContext())
    if "/Encrypt" in xref:
        _fail("document_encrypted")
    if "/Prev" in xref or "/XRefStm" in xref:
        _fail("pdf_incremental_unsupported", "unsupported")
    size = _direct_int(xref.get("/Size"), minimum=1, maximum=MAX_OBJECTS + 1)
    widths = xref.get("/W")
    if not isinstance(widths, ArrayObject) or len(widths) != 3:
        _fail("pdf_xref_invalid")
    widths = [_direct_int(value, maximum=8) for value in widths]
    row_size = sum(widths)
    if not row_size:
        _fail("pdf_xref_invalid")
    ranges = xref.get("/Index", [0, size])
    if not isinstance(ranges, (list, ArrayObject)) or not ranges or len(ranges) % 2:
        _fail("pdf_xref_invalid")
    numbers, previous_end = [], 0
    maximum = min(limits["max_archive_entries"], MAX_OBJECTS)
    for offset in range(0, len(ranges), 2):
        first = _direct_int(ranges[offset], maximum=size - 1)
        count = _direct_int(ranges[offset + 1], minimum=1, maximum=size)
        if first < previous_end or first + count > size or len(numbers) + count > maximum + 1:
            _fail("pdf_xref_invalid")
        numbers.extend(range(first, first + count))
        previous_end = first + count
    if not numbers:
        _fail("pdf_xref_invalid")
    # Filter/DecodeParms도 직접 객체만 허용한다(ISO 32000, 7.5.8.2).
    pending, visited = [xref.get("/Filter"), xref.get("/DecodeParms")], 0
    while pending:
        visited += 1
        if visited > MAX_GRAPH_NODES:
            _fail("pdf_graph_limit")
        value = pending.pop()
        if isinstance(value, IndirectObject):
            _fail("pdf_xref_invalid")
        if isinstance(value, DictionaryObject):
            pending.extend(value.values())
        elif isinstance(value, ArrayObject):
            pending.extend(value)
    decoded, charge = _decode(xref, limits, limits["max_expanded_bytes"])
    if not isinstance(decoded, bytes) or len(decoded) != len(numbers) * row_size:
        _fail("pdf_xref_invalid")
    entries, compressed, offsets = {}, {}, set()
    position = 0
    for object_number in numbers:
        fields = []
        for index, width in enumerate(widths):
            fields.append(int.from_bytes(decoded[position:position + width], "big") if width else (1 if index == 0 else 0))
            position += width
        kind, field2, field3 = fields
        if kind == 0:
            # 자유 객체는 참조 대상으로 설치하지 않는다. 폭 1인 pdfTeX 표의 0번
            # 세대값 255도 참조/복구에 사용하지 않으므로 안전하게 읽을 수 있다.
            if field2 >= size or field3 > 65535:
                _fail("pdf_xref_invalid")
        elif kind == 1:
            if object_number == 0 or not 0 < field2 <= start or field2 in offsets or field3 > 65535:
                _fail("pdf_xref_invalid")
            actual = _OBJECT_HEADER.match(data, field2)
            if actual is None or (int(actual[1]), int(actual[2])) != (object_number, field3):
                _fail("pdf_xref_invalid")
            entries[(object_number, field3)] = field2
            offsets.add(field2)
        elif kind == 2:
            if object_number == 0 or not 0 < field2 < size or field3 >= maximum:
                _fail("pdf_xref_invalid")
            compressed[object_number] = (field2, field3)
        else:
            _fail("pdf_xref_entry_unsupported", "unsupported")
    key = (number, generation)
    if entries.get(key) != start or not isinstance(xref.get("/Root"), IndirectObject):
        _fail("pdf_xref_invalid")
    for owner, _ in compressed.values():
        if (owner, 0) not in entries or (owner, 0) == key:
            _fail("pdf_object_stream_invalid")
    sorted_offsets = sorted(offsets)
    bounds = {offset: sorted_offsets[i + 1] if i + 1 < len(sorted_offsets) else tail_start
              for i, offset in enumerate(sorted_offsets)}
    if any(end - offset > limits["max_entry_bytes"] for offset, end in bounds.items()):
        _fail("pdf_object_limit")
    header_end = re.match(rb"[^\r\n]+(?:\r\n|\r|\n)", data).end()
    if _skip(data, header_end) != sorted_offsets[0]:
        _fail("pdf_unlisted_data")
    return {"entries": entries, "bounds": bounds, "compressed": compressed,
            "trailer_position": _skip(data, header.end()), "xref_key": key, "predecoded": (decoded, charge)}


if pypdf is not None:
    class _Reader(PdfReader):
        """객체 단위 경계와 참조를 입력별로 고정한다. 전역 파서를 변경하지 않는다."""
        def __init__(self, data, frame, limits):
            self._frame, self._limits = frame, limits
            self._allowed = frame["entries"]
            self._bounds = frame["bounds"]
            self._compressed = frame["compressed"]
            self._decoded = {}
            self._decoded_total = frame["predecoded"][1] if frame["predecoded"] is not None else 0
            self._active, self._active_streams, self._loaded_streams = set(), set(), set()
            self._raw = data
            super().__init__(_BudgetIO(data), strict=True)

        def read(self, stream):
            # 이미 검증한 인덱스만 설치한다. pypdf의 복구/무제한 xref 해제 경로는 부르지 않는다.
            self.xref = {}
            self.xref_free_entry = {}
            self.xref_objStm = dict(self._compressed)
            for (number, generation), offset in self._allowed.items():
                self.xref.setdefault(generation, {})[number] = offset
            stream.seek(self._frame["trailer_position"])
            trailer = read_object(stream, self)
            self.trailer = DictionaryObject()
            keys = trailer.keys() if self._frame["xref_key"] is None else ("/Size", "/Root", "/Info", "/ID")
            for key in keys:
                if key in trailer:
                    self.trailer[NameObject(key)] = trailer.raw_get(key)

        def decode_stream(self, stream):
            if id(stream) not in self._decoded:
                result = _decode(stream, self._limits, self._limits["max_expanded_bytes"] - self._decoded_total)
                self._decoded_total += result[1]
                self._decoded[id(stream)] = result
            return self._decoded[id(stream)]

        def load_object_stream(self, number):
            if number in self._loaded_streams:
                return
            if number in self._active_streams:
                _fail("pdf_object_stream_invalid")
            self._active_streams.add(number)
            try:
                container = self.get_object(IndirectObject(number, 0, self))
                if not isinstance(container, StreamObject) or container.get("/Type") != "/ObjStm":
                    _fail("pdf_object_stream_invalid")
                if "/Extends" in container:
                    _fail("pdf_object_stream_extends_unsupported", "unsupported")
                count = _direct_int(container.get("/N"), minimum=1,
                                    maximum=min(self._limits["max_archive_entries"], MAX_OBJECTS))
                decoded, _ = self.decode_stream(container)
                if not isinstance(decoded, bytes):
                    _fail("pdf_object_stream_invalid")
                first = _direct_int(container.get("/First"), minimum=1, maximum=len(decoded) - 1)
                header, position, members, ids = decoded[:first], 0, [], set()
                for index in range(count):
                    pair = []
                    for _ in range(2):
                        position = _skip(header, position)
                        match = _OBJECT_INDEX_NUMBER.match(header, position)
                        if match is None:
                            _fail("pdf_object_stream_invalid")
                        pair.append(int(match[0])); position = match.end()
                    member, offset = pair
                    if (member in ids or member == number or self._compressed.get(member) != (number, index)
                            or offset >= len(decoded) - first or (members and offset <= members[-1][1])):
                        _fail("pdf_object_stream_invalid")
                    ids.add(member); members.append((member, offset))
                if _skip(header, position) != len(header) or _skip(decoded, first) != first + members[0][1]:
                    _fail("pdf_object_stream_invalid")
                if {member for member, (owner, _) in self._compressed.items() if owner == number} != ids:
                    _fail("pdf_object_stream_invalid")
                source, values = _BudgetIO(decoded), []
                for index, (member, offset) in enumerate(members):
                    source.seek(first + offset)
                    value = read_object(source, self)
                    expected = first + members[index + 1][1] if index + 1 < len(members) else len(decoded)
                    if isinstance(value, (StreamObject, IndirectObject)) or _skip(decoded, source.tell()) != expected:
                        _fail("pdf_object_stream_invalid")
                    values.append((member, value))
                for member, value in values:
                    self.cache_indirect_object(0, member, value)
                self._loaded_streams.add(number)
            finally:
                self._active_streams.remove(number)

        def get_object(self, reference):
            if isinstance(reference, int):
                reference = IndirectObject(reference, 0, self)
            key = (reference.idnum, reference.generation)
            if key not in self._allowed and not (key[1] == 0 and key[0] in self._compressed):
                _fail("pdf_reference_invalid")
            cached = self.cache_get_indirect_object(reference.generation, reference.idnum)
            if cached is not None:
                return cached
            if key in self._active or len(self._active) >= MAX_GRAPH_DEPTH:
                _fail("pdf_reference_invalid")
            if key[1] == 0 and key[0] in self._compressed:
                self.load_object_stream(self._compressed[key[0]][0])
                value = self.cache_get_indirect_object(0, key[0])
                if value is None:
                    _fail("pdf_object_stream_invalid")
                return value
            self._active.add(key)
            try:
                header = _OBJECT_HEADER.match(self._raw, self._allowed[key])
                if header is None:
                    _fail("pdf_reference_invalid")
                self.stream.seek(_skip(self._raw, header.end()))
                value = read_object(self.stream, self)
                parsed_end = self.stream.tell()
                if isinstance(value, StreamObject):
                    _stream_length(self._raw, _skip(self._raw, header.end()), parsed_end, value, self)
                position = _skip(self._raw, parsed_end)
                if self._raw[position:position + 6] != b"endobj":
                    _fail("pdf_object_boundary_invalid")
                if _skip(self._raw, position + 6) != self._bounds[self._allowed[key]]:
                    _fail("pdf_unlisted_data")
                self.cache_indirect_object(key[1], key[0], value)
                if key == self._frame["xref_key"]:
                    self._decoded[id(value)] = self._frame["predecoded"]
                return value
            finally:
                self._active.remove(key)


def _resolve(value):
    return value.get_object() if isinstance(value, IndirectObject) else value


def _bounded(value, limit):
    if len(value) > limit:
        _fail("pdf_stream_limit")
    return value


def _flate(raw, limit):
    decoder = zlib.decompressobj()
    result = decoder.decompress(raw, limit + 1)
    if len(result) > limit or decoder.unconsumed_tail:
        _fail("pdf_stream_limit")
    if not decoder.eof or decoder.unused_data:
        _fail("pdf_stream_corrupt")
    return _bounded(result, limit)


def _run_length(raw, limit):
    result, position = bytearray(), 0
    while position < len(raw):
        length = raw[position]
        position += 1
        if length == 128:
            if raw[position:].strip(_WHITE):
                _fail("pdf_stream_corrupt")
            return bytes(result)
        if length < 128:
            chunk = raw[position:position + length + 1]
            if len(chunk) != length + 1:
                _fail("pdf_stream_corrupt")
            position += length + 1
        else:
            if position == len(raw):
                _fail("pdf_stream_corrupt")
            chunk = raw[position:position + 1] * (257 - length)
            position += 1
        if len(result) + len(chunk) > limit:
            _fail("pdf_stream_limit")
        result.extend(chunk)
    _fail("pdf_stream_corrupt")


def _ascii85(raw, limit):
    clean = re.sub(rb"[\x00\t\n\x0c\r ]", b"", raw)
    if not clean.endswith(b"~>") or clean.startswith(b"<~"):
        _fail("pdf_stream_corrupt")
    payload, group, count = clean[:-2], 0, 0
    for byte in payload:
        if byte == ord("z"):
            if group:
                _fail("pdf_stream_corrupt")
            count += 4
        elif ord("!") <= byte <= ord("u"):
            group += 1
            if group == 5:
                count += 4
                group = 0
        else:
            _fail("pdf_stream_corrupt")
        if count > limit:
            _fail("pdf_stream_limit")
    if group == 1:
        _fail("pdf_stream_corrupt")
    if count + max(0, group - 1) > limit:
        _fail("pdf_stream_limit")
    # z 축약이 한도 안이더라도 큰 임시 리스트를 만들지 않도록 그룹 경계로 나눈다.
    result, start, group = bytearray(), 0, 0
    for index, byte in enumerate(payload):
        group = 0 if byte == ord("z") else (group + 1) % 5
        if index - start >= 16384 and group == 0:
            result.extend(base64.a85decode(payload[start:index + 1]))
            start = index + 1
    result.extend(base64.a85decode(payload[start:]))
    return bytes(result)


def _jpeg(raw, stream, limit):
    if Image is None or ImageFile is None:
        _fail("pdf_image_parser_unavailable", "error")
    if stream.get("/Subtype") != "/Image" or stream.get("/BitsPerComponent") != 8:
        _fail("pdf_image_format_unsupported", "unsupported")
    if not raw.startswith(b"\xff\xd8") or not raw.endswith(b"\xff\xd9"):
        _fail("pdf_image_corrupt")
    # 전역 LOAD_TRUNCATED_IMAGES를 변경하지 않으며 완화된 프로세스 설정도 사용하지 않는다.
    if ImageFile.LOAD_TRUNCATED_IMAGES:
        _fail("pdf_image_parser_configuration", "error")
    with warnings.catch_warnings():
        warnings.simplefilter("error", Image.DecompressionBombWarning)
        with Image.open(BytesIO(raw), formats=("JPEG",)) as image:
            width, height = image.size
            channels = len(image.getbands())
            if (stream.get("/Width") != width or stream.get("/Height") != height
                    or width <= 0 or height <= 0 or image.mode not in ("L", "RGB", "CMYK")):
                _fail("pdf_image_corrupt")
            pixel_bytes = width * height * channels
            if width * height > MAX_IMAGE_PIXELS or pixel_bytes > limit:
                _fail("pdf_stream_limit")
            image.load()
            return pixel_bytes


def _png_predictor(decoded, parameters, limit):
    """PNG 행 필터를 실제 행 바이트로 복구한다. 짧은 행을 0으로 채우지 않는다."""
    values = {}
    for key, default in (("/Predictor", 1), ("/Colors", 1), ("/BitsPerComponent", 8), ("/Columns", 1)):
        value = _resolve(parameters.get(key, default))
        if isinstance(value, bool) or not isinstance(value, int) or value < 1:
            _fail("pdf_predictor_invalid")
        values[key] = int(value)
    if any(key not in values for key in parameters):
        _fail("pdf_predictor_parameters_unsupported", "unsupported")
    predictor, colors, bits, columns = (values[key] for key in ("/Predictor", "/Colors", "/BitsPerComponent", "/Columns"))
    if bits not in (1, 2, 4, 8, 16):
        _fail("pdf_predictor_invalid")
    row_size = (columns * colors * bits + 7) // 8
    step = max(1, (colors * bits + 7) // 8)
    if row_size > limit or step > limit:
        _fail("pdf_predictor_row_limit")
    if predictor == 1:
        return decoded
    if not 10 <= predictor <= 15:
        _fail("pdf_predictor_unsupported", "unsupported")
    if len(decoded) % (row_size + 1):
        _fail("pdf_predictor_invalid")
    if len(decoded) // (row_size + 1) * row_size > limit:
        _fail("pdf_stream_limit")
    if not decoded:
        return b""
    output, previous = bytearray(), bytearray(row_size)
    for start in range(0, len(decoded), row_size + 1):
        kind = decoded[start]
        if kind > 4:
            _fail("pdf_predictor_invalid")
        row = bytearray(decoded[start + 1:start + row_size + 1])
        for index in range(row_size):
            left = row[index - step] if index >= step else 0
            above = previous[index]
            upper_left = previous[index - step] if index >= step else 0
            if kind == 1:
                row[index] = (row[index] + left) & 255
            elif kind == 2:
                row[index] = (row[index] + above) & 255
            elif kind == 3:
                row[index] = (row[index] + (left + above) // 2) & 255
            elif kind == 4:
                estimate = left + above - upper_left
                a, b, c = abs(estimate - left), abs(estimate - above), abs(estimate - upper_left)
                prediction = left if a <= b and a <= c else above if b <= c else upper_left
                row[index] = (row[index] + prediction) & 255
        output.extend(row)
        previous = row
    return bytes(output)


def _decode(stream, limits, remaining):
    raw = stream._data
    if not isinstance(raw, bytes):
        _fail("pdf_stream_corrupt")
    maximum = min(limits["max_entry_bytes"], remaining)
    _bounded(raw, maximum)
    if _resolve(stream.get("/Subtype")) == "/Image":
        width, height = _resolve(stream.get("/Width")), _resolve(stream.get("/Height"))
        if (isinstance(width, bool) or isinstance(height, bool) or not isinstance(width, int)
                or not isinstance(height, int) or width <= 0 or height <= 0):
            _fail("pdf_image_corrupt")
        if width * height > MAX_IMAGE_PIXELS:
            _fail("pdf_image_pixels_limit")
    filters = _resolve(stream.get("/Filter"))
    filters = [] if filters is None else list(filters) if isinstance(filters, ArrayObject) else [filters]
    if len(filters) > 4:
        _fail("pdf_filters_limit")
    parameters = _resolve(stream.get("/DecodeParms"))
    parameters = [None] * len(filters) if parameters is None else list(parameters) if isinstance(parameters, ArrayObject) else [parameters]
    if len(parameters) != len(filters):
        _fail("pdf_stream_corrupt")
    decoded, expanded = raw, len(raw)
    for index, (filter_name, params) in enumerate(zip(filters, parameters)):
        filter_name, params = _resolve(filter_name), _resolve(params)
        if isinstance(params, NullObject):
            params = None
        if params is not None:
            if not isinstance(params, DictionaryObject):
                _fail("pdf_stream_corrupt")
            if filter_name not in ("/FlateDecode", "/Fl") and params:
                _fail("pdf_filter_parameters_unsupported", "unsupported")
        if filter_name in ("/FlateDecode", "/Fl"):
            decoded = _flate(decoded, maximum)
            expanded = max(expanded, len(decoded))
            if params is not None:
                decoded = _png_predictor(decoded, params, maximum)
        elif filter_name in ("/ASCIIHexDecode", "/AHx"):
            clean = re.sub(rb"[\x00\t\n\x0c\r ]", b"", decoded)
            if not clean.endswith(b">") or not re.fullmatch(rb"[0-9A-Fa-f]*>", clean):
                _fail("pdf_stream_corrupt")
            clean = clean[:-1]
            decoded = bytes.fromhex((clean + (b"0" if len(clean) % 2 else b"")).decode("ascii"))
        elif filter_name in ("/ASCII85Decode", "/A85"):
            decoded = _ascii85(decoded, maximum)
        elif filter_name in ("/RunLengthDecode", "/RL"):
            decoded = _run_length(decoded, maximum)
        elif filter_name in ("/DCTDecode", "/DCT"):
            if index != len(filters) - 1:
                _fail("pdf_filters_unsupported", "unsupported")
            expanded = max(expanded, _jpeg(decoded, stream, maximum))
            if expanded / max(1, len(raw)) > limits["max_compression_ratio"]:
                _fail("pdf_compression_ratio_limit")
            return None, expanded
        else:
            _fail("pdf_filter_unsupported", "unsupported")
        _bounded(decoded, maximum)
        expanded = max(expanded, len(decoded))
        if expanded / max(1, len(raw)) > limits["max_compression_ratio"]:
            _fail("pdf_compression_ratio_limit")
    return decoded, expanded


def _action(value):
    value = _resolve(value)
    if not isinstance(value, DictionaryObject) or isinstance(value, StreamObject):
        _fail("pdf_action_invalid")
    subtype = _resolve(value.get("/S"))
    if subtype not in _SAFE_ACTIONS:
        _fail("pdf_active_content")
    if subtype == "/URI":
        uri = _resolve(value.get("/URI"))
        if not isinstance(uri, str) or len(uri) > 4096 or any(ord(c) < 32 for c in uri):
            _fail("pdf_external_reference")
        parsed = urlsplit(uri)
        if parsed.scheme.lower() not in ("https", "http", "mailto"):
            _fail("pdf_external_reference")
    if "/Next" in value:
        _fail("pdf_active_content")


def _objects(reader, entries, limits):
    catalog = _resolve(reader.trailer.get("/Root"))
    stack = [(reader.trailer, 0)]
    for number, generation in entries:
        stack.append((IndirectObject(number, generation, reader), 0))
    for number in reader._compressed:
        stack.append((IndirectObject(number, 0, reader), 0))
    visited_refs, visited_containers = set(), set()
    decoded_streams, drawing_groups = {}, []
    nodes, expanded = 0, 0
    while stack:
        item, depth = stack.pop()
        nodes += 1
        if nodes > MAX_GRAPH_NODES or depth > MAX_GRAPH_DEPTH:
            _fail("pdf_graph_limit")
        if isinstance(item, IndirectObject):
            key = (item.idnum, item.generation)
            if key in visited_refs:
                continue
            visited_refs.add(key)
            stack.append((item.get_object(), depth + 1))
        elif isinstance(item, (DictionaryObject, ArrayObject)):
            if id(item) in visited_containers:
                continue
            visited_containers.add(id(item))
            if isinstance(item, ArrayObject):
                stack.extend((child, depth + 1) for child in item)
                continue
            if any(key in _FORBIDDEN_KEYS and not (key == "/OpenAction" and item is catalog)
                   for key in item):
                _fail("pdf_active_content")
            object_type = _resolve(item.get("/Type"))
            if object_type in _FORBIDDEN_TYPES or _resolve(item.get("/Subtype")) in _FORBIDDEN_TYPES:
                _fail("pdf_active_content")
            if _resolve(item.get("/Subtype")) == "/PS" or _resolve(item.get("/Subtype2")) == "/PS":
                _fail("pdf_active_content")
            if object_type == "/ObjStm":
                reference = getattr(item, "indirect_reference", None)
                if not isinstance(item, StreamObject) or not isinstance(reference, IndirectObject) or reference.generation != 0:
                    _fail("pdf_object_stream_invalid")
                reader.load_object_stream(reference.idnum)
            if object_type == "/XRef":
                reference = getattr(item, "indirect_reference", None)
                if (not isinstance(item, StreamObject) or not isinstance(reference, IndirectObject)
                        or (reference.idnum, reference.generation) != reader._frame["xref_key"]):
                    _fail("pdf_xref_invalid")
            if object_type == "/Action":
                _action(item)
            if "/A" in item:
                _action(item["/A"])
            if "/S" in item and _resolve(item.get("/S")) in (
                    "/JavaScript", "/Launch", "/GoToR", "/GoToE", "/SubmitForm", "/ImportData", "/Rendition"):
                _fail("pdf_active_content")
            if isinstance(item, StreamObject):
                if "/F" in item:
                    _fail("pdf_external_reference")
                decoded, charge = reader.decode_stream(item)
                decoded_streams[id(item)] = decoded
                expanded += charge
                if expanded > limits["max_expanded_bytes"]:
                    _fail("pdf_expanded_limit")
                if _resolve(item.get("/Subtype")) == "/Form" or _resolve(item.get("/PatternType")) == 1:
                    drawing_groups.append([item])
            stack.extend((child, depth + 1) for child in item.values())
    return decoded_streams, drawing_groups


def _initial_view(value, page_keys):
    """시작 시 문서 내부 페이지를 보는 설정만 허용한다. 동작 실행/이름 추정은 하지 않는다."""
    value = _resolve(value)
    if isinstance(value, DictionaryObject) and not isinstance(value, StreamObject):
        if "/Next" in value or _resolve(value.get("/S")) != "/GoTo":
            _fail("pdf_active_content")
        if set(value) - {"/Type", "/S", "/D"}:
            _fail("pdf_initial_view_unsupported", "unsupported")
        if "/Type" in value:
            action_type = _resolve(value.get("/Type"))
            if not isinstance(action_type, NameObject) or action_type != "/Action":
                _fail("pdf_initial_view_invalid")
        if not isinstance(_resolve(value.get("/S")), NameObject) or "/D" not in value:
            _fail("pdf_initial_view_invalid")
        value = _resolve(value.get("/D"))
    if not isinstance(value, ArrayObject):
        _fail("pdf_initial_view_unsupported", "unsupported")
    if len(value) < 2 or not isinstance(value[0], IndirectObject):
        _fail("pdf_initial_view_invalid")
    reference = value[0]
    if (reference.idnum, reference.generation) not in page_keys:
        _fail("pdf_initial_view_invalid")
    mode = _resolve(value[1])
    arities = {"/XYZ": 3, "/Fit": 0, "/FitH": 1, "/FitV": 1,
               "/FitR": 4, "/FitB": 0, "/FitBH": 1, "/FitBV": 1}
    if not isinstance(mode, NameObject) or mode not in arities:
        _fail("pdf_initial_view_unsupported", "unsupported")
    if len(value) != arities[mode] + 2:
        _fail("pdf_initial_view_invalid")
    numbers = [_resolve(item) for item in value[2:]]
    for number in numbers:
        if isinstance(number, NullObject) and mode != "/FitR":
            continue
        if isinstance(number, bool) or not isinstance(number, (int, float)) or not math.isfinite(number):
            _fail("pdf_initial_view_invalid")
    if mode == "/XYZ" and not isinstance(numbers[2], NullObject) and numbers[2] < 0:
        _fail("pdf_initial_view_invalid")
    if mode == "/FitR" and (numbers[2] <= numbers[0] or numbers[3] <= numbers[1]):
        _fail("pdf_initial_view_invalid")


def _page_graph(reader, limits):
    root = _resolve(reader.trailer.get("/Root"))
    if (not isinstance(root, DictionaryObject) or isinstance(root, StreamObject)
            or not isinstance(root.get("/Type"), NameObject) or root.get("/Type") != "/Catalog"):
        _fail("pdf_catalog_invalid")
    page_root = root.get("/Pages")
    if not isinstance(page_root, IndirectObject):
        _fail("pdf_page_graph_invalid")
    stack = [(page_root, None, None, 0, False)]
    counts, seen, drawing_groups, page_keys = {}, set(), [], set()
    maximum = min(limits["max_archive_entries"], MAX_OBJECTS)
    while stack:
        reference, parent, inherited_box, depth, closing = stack.pop()
        if not isinstance(reference, IndirectObject) or depth > MAX_GRAPH_DEPTH:
            _fail("pdf_page_graph_invalid")
        key = (reference.idnum, reference.generation)
        node = reference.get_object()
        if not isinstance(node, DictionaryObject) or isinstance(node, StreamObject):
            _fail("pdf_page_graph_invalid")
        if closing:
            children = _resolve(node.get("/Kids"))
            count = sum(counts[(child.idnum, child.generation)] for child in children)
            declared = _resolve(node.get("/Count"))
            if isinstance(declared, bool) or not isinstance(declared, int) or declared != count:
                _fail("pdf_page_count_invalid")
            counts[key] = count
            continue
        if key in seen or len(seen) >= maximum:
            _fail("pdf_page_graph_invalid")
        seen.add(key)
        if parent is None:
            if "/Parent" in node:
                _fail("pdf_page_graph_invalid")
        else:
            actual_parent = node.get("/Parent")
            if not isinstance(actual_parent, IndirectObject) or (actual_parent.idnum, actual_parent.generation) != parent:
                _fail("pdf_page_graph_invalid")
        box = _resolve(node.get("/MediaBox", inherited_box))
        if node.get("/Type") == "/Pages":
            children = _resolve(node.get("/Kids"))
            if not isinstance(children, ArrayObject) or not children:
                _fail("pdf_page_graph_invalid")
            stack.append((reference, parent, box, depth, True))
            stack.extend((child, key, box, depth + 1, False) for child in reversed(children))
        elif node.get("/Type") == "/Page":
            if "/Kids" in node or not isinstance(box, ArrayObject) or len(box) != 4:
                _fail("pdf_page_graph_invalid")
            coords = [_resolve(value) for value in box]
            if any(isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) for value in coords):
                _fail("pdf_page_graph_invalid")
            if coords[2] <= coords[0] or coords[3] <= coords[1]:
                _fail("pdf_page_graph_invalid")
            contents = _resolve(node.get("/Contents"))
            if contents is not None:
                content_list = contents if isinstance(contents, ArrayObject) else [contents]
                if any(not isinstance(_resolve(content), StreamObject) for content in content_list):
                    _fail("pdf_page_content_invalid")
                drawing_groups.append([_resolve(content) for content in content_list])
            counts[key] = 1
            page_keys.add(key)
        else:
            _fail("pdf_page_graph_invalid")
    if "/OpenAction" in root:
        _initial_view(root.get("/OpenAction"), page_keys)
    return drawing_groups


def _drawing_content(groups, decoded_streams, limits):
    """본문의 실제 BI 토큰을 구분한다. 폰트/CMap/메타데이터는 그리기 명령이 아니다."""
    class OperationSink(list):
        def append(self, value):
            nonlocal operations
            operations += 1
            if operations > MAX_CONTENT_OPERATIONS:
                _fail("pdf_content_operations_limit")
            # 연산자 목록은 판정에 필요하지 않다. 보관하지 않아 메모리를 제한한다.

    class ContentReader(ContentStream):
        def _parse_content_stream(self, stream):
            # pypdf의 토큰/객체 파서를 재사용하되 pdf=None의 관대한 dictionary 복구는
            # 허용하지 않는다. 문서 원문을 담은 경고 로그도 이 경로에서 만들지 않는다.
            context, operands = _TrailerContext(), 0
            while True:
                peek = read_non_whitespace(stream)
                if not peek:
                    if operands:
                        _fail("pdf_content_invalid")
                    return
                stream.seek(-1, 1)
                if peek.isalpha() or peek in (b"'", b'"'):
                    operator = read_until_regex(stream=stream, regex=NameObject.delimiter_pattern,
                                                length=self._OPERATOR_LENGTH_LIMIT)
                    if operator == b"BI":
                        if operands:
                            _fail("pdf_content_invalid")
                        self._read_inline_image(stream)
                    self._operations.append((None, operator))
                    operands = 0
                elif peek == b"%":
                    while peek not in (b"\r", b"\n", b""):
                        peek = stream.read(1)
                else:
                    read_object(stream, context, self.forced_encoding)
                    operands += 1
                    if operands > MAX_GRAPH_NODES:
                        _fail("pdf_content_limit")

        def _read_inline_image(self, stream):
            _fail("pdf_inline_image_unsupported", "unsupported")

    seen, processed_bytes, operations = set(), 0, 0
    for group in groups:
        key = tuple(id(item) for item in group)
        if key in seen:
            continue
        seen.add(key)
        pieces, size = [], 0
        for item in group:
            decoded = decoded_streams.get(id(item))
            if not isinstance(decoded, bytes):
                _fail("pdf_page_content_invalid")
            size += len(decoded) + 1
            if size > limits["max_entry_bytes"]:
                _fail("pdf_content_limit")
            pieces.append(decoded)
        processed_bytes += size
        if processed_bytes > limits["max_expanded_bytes"]:
            _fail("pdf_content_limit")
        parser = ContentReader(None, None)
        parser._operations = OperationSink()
        parser._parse_content_stream(_BudgetIO(b"\n".join(pieces)))


def inspect_pdf(data: bytes, limits: dict) -> dict:
    """승인 한도를 적용한 PDF 구조 검사. 오류 원문/문서 내용은 결과에 포함하지 않는다."""
    result = lambda status, code: {"status": status, "code": code, "mime": MIME}
    if not isinstance(data, bytes) or not _valid_limits(limits):
        return result("error", "invalid_inspection_input")
    if len(data) > MAX_INPUT_BYTES:
        return result("rejected", "pdf_input_limit")
    if pypdf is None:
        return result("error", "pdf_parser_unavailable")
    if pypdf.__version__ != PYPDF_VERSION:
        return result("error", "pdf_parser_version_unsupported")
    reader = None
    try:
        frame = _framing(data, limits)
        reader = _Reader(data, frame, limits)
        if reader.is_encrypted:
            _fail("document_encrypted")
        decoded_streams, drawing_groups = _objects(reader, frame["entries"], limits)
        drawing_groups.extend(_page_graph(reader, limits))
        _drawing_content(drawing_groups, decoded_streams, limits)
        return result("passed", "pdf_structure_passed")
    except _Verdict as verdict:
        return result(verdict.status, verdict.code)
    except (MemoryError, RecursionError):
        return result("rejected", "pdf_resource_limit")
    except Exception:
        return result("rejected", "pdf_structure_invalid")
    finally:
        if reader is not None:
            reader.close()
