"""네트워크·외부 파일 없이 만드는 PDF 시험 원문. import 시 시험을 실행하지 않는다."""
import zlib


def stream(data, dictionary=b""):
    return b"<< /Length " + str(len(data)).encode() + b" " + dictionary + b" >>\nstream\n" + data + b"\nendstream"


def png_rows(raw, columns, filters=None, *, bytes_per_pixel=1):
    """시험 인코더. 여러 필터의 복원 결과를 알려진 원문과 비교할 때 사용한다."""
    if len(raw) % columns:
        raise ValueError("시험 행 길이 불일치")
    output, previous = bytearray(), bytes(columns)
    for index, start in enumerate(range(0, len(raw), columns)):
        row = raw[start:start + columns]
        kind = (filters or [2])[index % len(filters or [2])]
        output.append(kind)
        for position, value in enumerate(row):
            left = row[position - bytes_per_pixel] if position >= bytes_per_pixel else 0
            above = previous[position]
            upper_left = previous[position - bytes_per_pixel] if position >= bytes_per_pixel else 0
            if kind == 0:
                prediction = 0
            elif kind == 1:
                prediction = left
            elif kind == 2:
                prediction = above
            elif kind == 3:
                prediction = (left + above) // 2
            elif kind == 4:
                p = left + above - upper_left
                a, b, c = abs(p - left), abs(p - above), abs(p - upper_left)
                prediction = left if a <= b and a <= c else above if b <= c else upper_left
            else:
                raise ValueError("시험 필터 종류 오류")
            output.append((value - prediction) & 255)
        previous = row
    return bytes(output)


def modern_pdf(*, compressed=True, predictor=12, members=None, content=b"q Q", extra_objects=None,
               xref_changes=None, xref_dictionary=b"", object_dictionary=b"", object_payload=None,
               object_count=None, object_first=None, object_offsets=None,
               widths=(1, 4, 2), indices=None, index_payload=None):
    """실제 xref stream·ObjStm·PNG predictor PDF를 만들고 변이 지점을 노출한다."""
    members = {
        1: b"<< /Type /Catalog /Pages 2 0 R >>",
        2: b"<< /Type /Pages /Count 1 /Kids [3 0 R] >>",
        3: b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << >> /Contents 4 0 R >>",
    } if members is None else dict(members)
    extra_objects = {} if extra_objects is None else dict(extra_objects)
    object_stream_id = max([4, *members, *extra_objects]) + 1
    xref_id = object_stream_id + 1
    output = bytearray(b"%PDF-1.7\n%\xe2\xe3\xcf\xd3\n")
    offsets, compressed_rows = {}, {}

    def append(number, value):
        offsets[number] = len(output)
        output.extend(f"{number} 0 obj\n".encode() + value + b"\nendobj\n")

    append(4, stream(zlib.compress(content), b"/Filter /FlateDecode"))
    for number, value in extra_objects.items():
        append(number, value)
    if compressed:
        header, body = bytearray(), bytearray()
        for index, (number, value) in enumerate(members.items()):
            offset = len(body) if object_offsets is None else object_offsets[index]
            header.extend(f"{number} {offset} ".encode())
            body.extend(value + b"\n")
            compressed_rows[number] = (2, object_stream_id, index)
        payload = bytes(header + body) if object_payload is None else object_payload
        append(object_stream_id, stream(zlib.compress(payload),
               f"/Type /ObjStm /N {len(members) if object_count is None else object_count} /First {len(header) if object_first is None else object_first} /Filter /FlateDecode ".encode() + object_dictionary))
    else:
        for number, value in members.items():
            append(number, value)
    start = len(output)
    offsets[xref_id] = start
    size = xref_id + 1
    rows = {0: (0, 0, 65535), **{number: (1, offset, 0) for number, offset in offsets.items()}, **compressed_rows}
    rows.update(xref_changes or {})
    ranges = [0, size] if indices is None else indices
    numbers = [number for position in range(0, len(ranges), 2)
               for number in range(ranges[position], ranges[position] + ranges[position + 1])]
    raw = bytearray()
    for number in numbers:
        values = rows.get(number, (0, 0, 0))
        for value, width in zip(values, widths):
            if width:
                raw.extend(value.to_bytes(width, "big"))
    params = b""
    if predictor != 1:
        raw = bytearray(png_rows(bytes(raw), sum(widths)))
        params = f"/DecodeParms << /Predictor {predictor} /Columns {sum(widths)} >> ".encode()
    if index_payload is not None:
        raw = bytearray(index_payload)
    dictionary = (f"/Type /XRef /Size {size} /Root 1 0 R /W [{' '.join(map(str, widths))}] "
                  f"/Index [{' '.join(map(str, ranges))}] /Filter /FlateDecode ").encode()
    append(xref_id, stream(zlib.compress(bytes(raw)), dictionary + params + xref_dictionary))
    output.extend(b"startxref\n" + str(start).encode() + b"\n%%EOF\n")
    return bytes(output)
