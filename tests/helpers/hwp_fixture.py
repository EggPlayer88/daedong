"""외부 문서를 복사하지 않는 합성 CFB/HWP5 시험 바이트 생성기."""
import struct
import zlib

FREE, END, FAT = 0xFFFFFFFF, 0xFFFFFFFE, 0xFFFFFFFD


def record(tag, payload=b"", level=0, extended=False):
    length = len(payload)
    if extended or length >= 4095:
        return struct.pack("<II", tag | (level << 10) | (4095 << 20), length) + payload
    return struct.pack("<I", tag | (level << 10) | (length << 20)) + payload


def deflate(raw, footer=False):
    writer = zlib.compressobj(wbits=-15)
    result = writer.compress(raw) + writer.flush()
    return result + (struct.pack("<II", zlib.crc32(raw), len(raw)) if footer else b"")


def hwp_streams(*, compressed=True, sections=1, footer=False, encrypt_version=0, empty_link=False, compatibility=False, version=0x05000300):
    header = bytearray(256)
    header[:17] = b"HWP Document File"
    struct.pack_into("<II", header, 32, version, int(compressed))
    struct.pack_into("<I", header, 44, encrypt_version)
    props = struct.pack("<7H3I", sections, 1, 1, 1, 1, 1, 1, 0, 0, 0)
    info = record(16, props) + record(17, bytes(72))
    if compatibility:
        # 명세의 정적 호환/변경 추적 정보. 실제 기록의 값을 복사하지 않는다.
        info += record(30, struct.pack("<I", 0)) + record(31, bytes(20), 1) + record(32, bytes(range(256)) * 4 + bytes(8), 1)
    streams = {"FileHeader": bytes(header), "DocInfo": deflate(info, footer) if compressed else info}
    if empty_link:
        streams["DocOptions/_LinkDoc"] = bytes(524)
    for number in range(sections):
        body = record(66, bytes(24 if version >= 0x05000302 else 22)) + record(67, "학교 수합 시험\r".encode("utf-16-le"), 1)
        streams[f"BodyText/Section{number}"] = deflate(body, footer) if compressed else body
    return streams


def numbering_51():
    """원본 데이터를 복사하지 않는 10단계 문단 번호 구조."""
    def level(number):
        text = (f"^{number}.").encode("utf-16-le")
        return struct.pack("<IHHIH", 0, 0, 50, FREE, len(text) // 2) + text
    return (b"".join(level(n) for n in range(1, 8)) + struct.pack("<H7I", 1, *([1] * 7))
            + b"".join(level(n) for n in range(8, 11)) + struct.pack("<3I", 1, 1, 1))


def cfb(streams, *, version=3):
    """1개 FAT의 작은 정상 CFB: mini/일반 stream 및 균형 directory tree."""
    size = 512 if version == 3 else 4096
    storages = sorted({name.rsplit("/", 1)[0] for name in streams if "/" in name})
    names = [""] + storages + list(streams)
    ids = {name: index for index, name in enumerate(names)}
    entries = [[FREE, FREE, FREE, END, 0] for _ in names]

    def tree(children):
        if not children:
            return FREE
        children.sort(key=lambda name: (len(name.rsplit("/", 1)[-1]), name.upper()))
        middle = len(children) // 2
        index = ids[children[middle]]
        entries[index][0] = tree(children[:middle])
        entries[index][1] = tree(children[middle + 1:])
        return index

    for parent in [""] + storages:
        children = [name for name in names[1:] if "/" in name and name.rsplit("/", 1)[0] == parent] if parent else [name for name in names[1:] if "/" not in name]
        entries[ids[parent]][2] = tree(children)
    directory_sectors = (len(names) * 128 + size - 1) // size
    sectors = [bytes(size)] * directory_sectors
    fat_links = [i + 1 if i + 1 < directory_sectors else END for i in range(directory_sectors)]
    mini, mini_links = bytearray(), []
    for name, raw in streams.items():
        if not raw:
            continue
        if len(raw) < 4096:
            start = len(mini) // 64
            number = (len(raw) + 63) // 64
            mini.extend(raw.ljust(number * 64, b"\0"))
            mini_links.extend([start + i + 1 if i + 1 < number else END for i in range(number)])
            entries[ids[name]][3:] = [start, len(raw)]

    def add_stream(raw):
        if not raw:
            return END
        start = len(sectors)
        number = (len(raw) + size - 1) // size
        for i in range(number):
            sectors.append(raw[i * size:(i + 1) * size].ljust(size, b"\0"))
            fat_links.append(start + i + 1 if i + 1 < number else END)
        return start

    mini_raw = struct.pack("<" + "I" * len(mini_links), *mini_links)
    mini_raw = mini_raw.ljust(((len(mini_raw) + size - 1) // size) * size, b"\xff")
    mini_start = add_stream(mini_raw)
    root_start = add_stream(bytes(mini))
    entries[0][3:] = [root_start, len(mini)]
    for name, raw in streams.items():
        if len(raw) >= 4096:
            entries[ids[name]][3:] = [add_stream(raw), len(raw)]
    directory = bytearray()
    for index, path in enumerate(names):
        name = "Root Entry" if not index else path.rsplit("/", 1)[-1]
        encoded = (name + "\0").encode("utf-16-le")
        assert len(encoded) <= 64
        left, right, child, start, length = entries[index]
        kind = 5 if index == 0 else 1 if path in storages else 2
        directory.extend(struct.pack("<64sHBBIII16sIQQIQ", encoded, len(encoded), kind, 1,
                                     left, right, child, bytes(16), 0, 0, 0, start, length))
    directory = directory.ljust(directory_sectors * size, b"\0")
    sectors[:directory_sectors] = [bytes(directory[i * size:(i + 1) * size]) for i in range(directory_sectors)]
    fat_sector = len(sectors)
    fat_links.append(FAT)
    assert len(fat_links) <= size // 4
    sectors.append(struct.pack("<" + "I" * len(fat_links), *fat_links).ljust(size, b"\xff"))
    header = bytearray(size)
    header[:8] = b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"
    struct.pack_into("<5H", header, 24, 0x3E, version, 0xFFFE, 9 if version == 3 else 12, 6)
    struct.pack_into("<9I", header, 40, directory_sectors if version == 4 else 0, 1, 0, 0,
                     4096, mini_start, len(mini_raw) // size, END, 0)
    header[76:512] = struct.pack("<I", fat_sector) + b"\xff" * 432
    return bytes(header) + b"".join(sectors)


def make_hwp(**kwargs):
    return cfb(hwp_streams(**kwargs))
