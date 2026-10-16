"""DB/네트워크 없이 문서 컨테이너만 검사하는 제한된 준비용 프로필.

passed는 압축/기본 구조 검사의 성공이며 악성 검사나 앱 렌더링 성공이 아니다.
정책 한도는 호출자가 승인된 정책판에서 전달한다. 파일을 디스크에 풀지 않는다.
"""
from __future__ import annotations

from io import BytesIO
import math
import posixpath
import re
import stat
import struct
import unicodedata
from urllib.parse import unquote, urlsplit
import zipfile
import zlib

from .pdf_inspection import inspect_pdf
from .hwp_inspection import inspect_hwp

from .boilerplate import is_empty_hancom_script

try:
    from lxml import etree
except ImportError:  # 설치 실패도 성공으로 바꾸지 않는다.
    etree = None


MIMES = {
    "hwpx": "application/hwp+zip",
    "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "pdf": "application/pdf",
    "hwp": "application/x-hwp",
}
CT = "http://schemas.openxmlformats.org/package/2006/content-types"
REL = "http://schemas.openxmlformats.org/package/2006/relationships"
OFFICE_RELS = (
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/",
    "http://purl.oclc.org/ooxml/officeDocument/relationships/",
)
MAIN_TYPES = {
    "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml",
    "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml",
    "pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml",
}
MAIN_TAGS = {
    "docx": ("wordprocessingml", "document", "body"),
    "xlsx": ("spreadsheetml", "workbook", "sheets"),
    "pptx": ("presentationml", "presentation", None),
}
OPF = "http://www.idpf.org/2007/opf/"
OCF = "urn:oasis:names:tc:opendocument:xmlns:container"
ODF = "urn:oasis:names:tc:opendocument:xmlns:manifest:1.0"
HEAD = "http://www.hancom.co.kr/hwpml/2011/head"
SECTION = "http://www.hancom.co.kr/hwpml/2011/section"
_LIMIT_KEYS = ("max_archive_entries", "max_entry_bytes", "max_expanded_bytes", "max_xml_bytes")
_FORBIDDEN_SUFFIXES = frozenset((
    "exe", "dll", "com", "scr", "bat", "cmd", "ps1", "vbs", "vbe", "js", "jse",
    "hta", "msi", "lnk", "url", "jar", "class", "html", "htm", "svg", "bin",
    "zip", "7z", "rar", "gz", "tar", "docm", "xlsm", "pptm", "doc", "xls", "ppt",
    "docx", "xlsx", "pptx", "hwpx", "hwp", "pdf",
))
_FORBIDDEN_TYPE_MARKERS = ("macroenabled", "vbaproject", "oleobject", "activex", "javascript", "embeddedpackage")
_SPECIAL_XML = frozenset(("[Content_Types].xml", "Contents/content.hpf", "META-INF/container.xml", "META-INF/manifest.xml"))
_HWPX_SCRIPT_PATHS = ("Scripts/headerScripts.js", "Scripts/sourceScripts.js")
# 학교별 허용량이 아니라 이 제한 문법 프로필의 최대 입력 크기다.
_HWPX_BOILERPLATE_BYTES = 4096


class _Verdict(Exception):
    def __init__(self, code, status="rejected"):
        self.code, self.status = code, status


def _fail(code, status="rejected"):
    raise _Verdict(code, status)


def _limits_valid(limits):
    if not isinstance(limits, dict):
        return False
    for key in _LIMIT_KEYS:
        value = limits.get(key)
        if type(value) is not int or value <= 0:
            return False
    ratio = limits.get("max_compression_ratio")
    return ((type(ratio) is int and ratio > 0)
            or (type(ratio) is float and math.isfinite(ratio) and ratio > 0))


def _name(name, *, directory=False):
    # 동일 이름의 다른 해석을 피한다. URI 해독은 관계에서만 한 번 수행한다.
    if not name or unicodedata.normalize("NFC", name) != name:
        _fail("archive_name_unsafe")
    if any(unicodedata.category(c) in ("Cc", "Cf", "Cs") for c in name) or any(c in name for c in "\\:%?#"):
        _fail("archive_name_unsafe")
    value = name[:-1] if directory and name.endswith("/") else name
    if value.startswith("/") or any(p in ("", ".", "..") or p[-1:] in (" ", ".") for p in value.split("/")):
        _fail("archive_name_unsafe")
    return value


def _zip_preflight(data, limits):
    # ZipFile이 중앙 디렉터리 객체를 만들기 전에 실제 레코드 수/경계를 제한한다.
    # ZIP64/다중 디스크는 이 준비용 프로필에서 명시적으로 지원하지 않는다.
    if not data.startswith(b"PK\x03\x04"):
        _fail("signature_mismatch")
    offset = data.rfind(b"PK\x05\x06", max(0, len(data) - 65557))
    if offset < 0 or offset + 22 > len(data):
        _fail("archive_corrupt")
    _, disk, cd_disk, disk_count, count, size, start, comment = struct.unpack_from("<4s4H2LH", data, offset)
    if disk or cd_disk or disk_count != count:
        _fail("archive_multidisk_unsupported", "unsupported")
    if count == 65535 or size == 0xFFFFFFFF or start == 0xFFFFFFFF:
        _fail("archive_zip64_unsupported", "unsupported")
    if not count or count > limits["max_archive_entries"]:
        _fail("archive_entries_limit")
    if offset + 22 + comment != len(data) or start + size != offset:
        _fail("archive_corrupt")
    position, actual = start, 0
    while position < offset:
        if position + 46 > offset or data[position:position + 4] != b"PK\x01\x02":
            _fail("archive_corrupt")
        name_len, extra_len, comment_len, disk_start = struct.unpack_from("<4H", data, position + 28)
        if disk_start:
            _fail("archive_multidisk_unsupported", "unsupported")
        end = position + 46 + name_len + extra_len + comment_len
        if end > offset or not name_len:
            _fail("archive_corrupt")
        raw_name = data[position + 46:position + 46 + name_len]
        if b"\x00" in raw_name:
            _fail("archive_name_unsafe")
        flags = struct.unpack_from("<H", data, position + 8)[0]
        decoded_name = raw_name.decode("utf-8" if flags & 0x800 else "cp437")
        _name(decoded_name, directory=decoded_name.endswith("/"))
        extra = data[position + 46 + name_len:position + 46 + name_len + extra_len]
        ep = 0
        while ep < len(extra):
            if ep + 4 > len(extra):
                _fail("archive_corrupt")
            kind, length = struct.unpack_from("<HH", extra, ep)
            if kind == 1:
                _fail("archive_zip64_unsupported", "unsupported")
            if kind == 0x7075:
                _fail("archive_alternate_name_unsupported", "unsupported")
            ep += 4 + length
            if ep > len(extra):
                _fail("archive_corrupt")
        actual += 1
        if actual > limits["max_archive_entries"]:
            _fail("archive_entries_limit")
        position = end
    if actual != count:
        _fail("archive_corrupt")
    return start


def _xml(raw):
    if etree is None:
        _fail("xml_parser_unavailable", "error")
    parser = etree.XMLParser(resolve_entities=False, no_network=True, load_dtd=False,
                             dtd_validation=False, huge_tree=False, recover=False)
    try:
        root = etree.fromstring(raw, parser)
    except (etree.XMLSyntaxError, ValueError):
        _fail("xml_invalid")
    tree = root.getroottree()
    # 바이트 정규식만 쓰면 UTF-16/UTF-32 선언을 놓친다. 파서 결과로도 확인한다.
    if tree.docinfo.doctype or tree.docinfo.internalDTD or tree.docinfo.externalDTD:
        _fail("xml_dtd_forbidden")
    if tree.xpath("//processing-instruction()"):
        _fail("xml_active_content")
    for node in root.iter():
        if isinstance(node, etree._Entity):
            _fail("xml_dtd_forbidden")
        if isinstance(node.tag, str) and node.tag.startswith("{http://www.w3.org/2001/XInclude}"):
            _fail("xml_active_content")
        if isinstance(node.tag, str) and etree.QName(node).localname.lower() in ("oleobject", "objectembed", "objectlink"):
            _fail("embedded_content_forbidden")
    return root


def _forbidden_type(value):
    return any(marker in value.lower() for marker in _FORBIDDEN_TYPE_MARKERS)


def _entry_chunks(data, info, bound, physical_end):
    # 중앙 디렉터리의 거짓 file_size로 ZipExtFile이 확장 결과를 잘라 숨기지 못하게
    # deflate의 실제 끝까지 제한된 출력 청크로 읽고 CRC/길이를 직접 대조한다.
    offset = info.header_offset
    if offset < 0 or offset + 30 > len(data) or data[offset:offset + 4] != b"PK\x03\x04":
        _fail("archive_corrupt")
    _, _, flags, method, _, _, crc, compressed, expanded, name_len, extra_len = struct.unpack_from("<4s5H3L2H", data, offset)
    if flags != info.flag_bits or method != info.compress_type:
        _fail("archive_corrupt")
    raw_name = data[offset + 30:offset + 30 + name_len]
    local_name = raw_name.decode("utf-8" if flags & 0x800 else "cp437")
    if local_name != info.filename or b"\x00" in raw_name:
        _fail("archive_corrupt")
    extra = data[offset + 30 + name_len:offset + 30 + name_len + extra_len]
    ep = 0
    while ep < len(extra):
        if ep + 4 > len(extra):
            _fail("archive_corrupt")
        kind, length = struct.unpack_from("<HH", extra, ep)
        if kind == 1:
            _fail("archive_zip64_unsupported", "unsupported")
        if kind == 0x7075:
            _fail("archive_alternate_name_unsupported", "unsupported")
        ep += 4 + length
        if ep > len(extra):
            _fail("archive_corrupt")
    if not flags & 8 and (crc != info.CRC or compressed != info.compress_size or expanded != info.file_size):
        _fail("archive_corrupt")
    start = offset + 30 + name_len + extra_len
    end = start + info.compress_size
    if end > physical_end:
        _fail("archive_corrupt")
    trailing = data[end:physical_end]
    if flags & 8:
        if trailing.startswith(b"PK\x07\x08"):
            trailing = trailing[4:]
        if len(trailing) != 12 or struct.unpack("<3L", trailing) != (info.CRC, info.compress_size, info.file_size):
            _fail("archive_corrupt")
    elif trailing:
        _fail("archive_corrupt")
    actual, checksum = 0, 0
    decoder = zlib.decompressobj(-15) if method == zipfile.ZIP_DEFLATED else None
    for position in range(start, end, 65536):
        pending = data[position:min(position + 65536, end)]
        while pending:
            if decoder is None:
                chunk, pending = pending, b""
            else:
                chunk = decoder.decompress(pending, min(65536, bound - actual + 1))
                pending = decoder.unconsumed_tail
                if decoder.unused_data:
                    _fail("archive_corrupt")
            actual += len(chunk)
            if actual > bound:
                _fail("archive_entry_limit")
            checksum = zlib.crc32(chunk, checksum)
            yield chunk
    if decoder is not None and not decoder.eof:
        _fail("archive_corrupt")
    if actual != info.file_size or checksum != info.CRC:
        _fail("archive_corrupt")


def _read_archive(data, limits, *, extension=None):
    central_start = _zip_preflight(data, limits)
    names, roots, children, special, prefixes = set(), {}, {}, {}, {}
    folded, total = set(), 0
    with zipfile.ZipFile(BytesIO(data)) as archive:
        infos = archive.infolist()
        if min(i.header_offset for i in infos) != 0:
            _fail("archive_corrupt")
        offsets = sorted(i.header_offset for i in infos)
        if len(set(offsets)) != len(offsets):
            _fail("archive_corrupt")
        ends = dict(zip(offsets, offsets[1:] + [central_start]))
        for info in infos:
            name = _name(info.filename, directory=info.is_dir())
            if name.casefold() in folded:
                _fail("archive_duplicate_name")
            folded.add(name.casefold())
            mode = stat.S_IFMT(info.external_attr >> 16)
            if mode not in (0, stat.S_IFREG, stat.S_IFDIR) or stat.S_ISLNK(info.external_attr >> 16):
                _fail("archive_special_file")
            if info.flag_bits & (1 | 64):
                _fail("archive_encrypted")
            if info.flag_bits & ~(2 | 4 | 8 | 0x800):
                _fail("archive_flags_unsupported", "unsupported")
            if info.compress_type not in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED):
                _fail("archive_method_unsupported", "unsupported")
            if info.is_dir():
                if info.file_size:
                    _fail("archive_corrupt")
                for _ in _entry_chunks(data, info, 0, ends[info.header_offset]):
                    pass
                continue
            names.add(name)
            parts = name.lower().split("/")
            hwpx_script = extension == "hwpx" and name in _HWPX_SCRIPT_PATHS
            if not hwpx_script and (any(p in ("scripts", "embeddings", "activex") for p in parts) or parts[-1].split(".")[-1] in _FORBIDDEN_SUFFIXES or "vbaproject" in parts[-1]):
                _fail("embedded_content_forbidden")
            xml_part = name.lower().endswith((".xml", ".rels", ".hpf", ".rdf"))
            bound = min(limits["max_entry_bytes"], limits["max_xml_bytes"]) if xml_part else limits["max_entry_bytes"]
            if hwpx_script:
                bound = min(bound, _HWPX_BOILERPLATE_BYTES)
            if info.file_size > bound:
                _fail("xml_bytes_limit" if xml_part and info.file_size > limits["max_xml_bytes"] else "archive_entry_limit")
            if info.file_size > max(1, info.compress_size) * limits["max_compression_ratio"]:
                _fail("archive_ratio_limit")
            if total + info.file_size > limits["max_expanded_bytes"]:
                _fail("archive_expanded_limit")
            chunks, actual, prefix = [], 0, b""
            for chunk in _entry_chunks(data, info, bound, ends[info.header_offset]):
                actual += len(chunk)
                total += len(chunk)
                if total > limits["max_expanded_bytes"]:
                    _fail("archive_expanded_limit")
                if actual > max(1, info.compress_size) * limits["max_compression_ratio"]:
                    _fail("archive_ratio_limit")
                if len(prefix) < 16:
                    prefix = (prefix + chunk)[:16]
                if xml_part or name == "mimetype" or hwpx_script:
                    chunks.append(chunk)
            if actual != info.file_size:
                _fail("archive_corrupt")
            if prefix.startswith((b"MZ", b"\x7fELF", b"PK\x03\x04", b"PK\x05\x06", b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1")):
                _fail("embedded_content_forbidden")
            prefixes[name] = prefix
            if xml_part:
                root = _xml(b"".join(chunks))
                roots[name] = root.tag
                children[name] = {node.tag for node in root if isinstance(node.tag, str)}
                if name in _SPECIAL_XML or name.lower().endswith(".rels"):
                    special[name] = root
            elif name == "mimetype" or hwpx_script:
                special[name] = b"".join(chunks)
    # 파일 a와 디렉터리 a/b 같은 서로 다른 추출 해석도 거부한다.
    file_names_folded = {n.casefold() for n in names}
    for name in names:
        parent = posixpath.dirname(name)
        while parent:
            if parent.casefold() in file_names_folded:
                _fail("archive_name_unsafe")
            parent = posixpath.dirname(parent)
    return names, roots, children, special, prefixes


def _target(value, base, names):
    if (not isinstance(value, str) or not value or "\\" in value
            or value != value.strip() or re.search(r"%2f|%5c", value, re.IGNORECASE)
            or any(unicodedata.category(c) in ("Cc", "Cf", "Cs") for c in value)):
        _fail("relationship_invalid")
    split = urlsplit(value)
    if split.scheme or split.netloc or split.query or split.fragment:
        _fail("relationship_invalid")
    decoded = unquote(split.path, errors="strict")
    # 상대 .. 는 OPC에서 정상이다. 루트 밖으로 나가는 경우만 차단한다.
    elements = [] if decoded.startswith("/") else base.split("/") if base else []
    for part in decoded.split("/"):
        if part in ("", "."):
            continue
        if part == "..":
            if not elements:
                _fail("relationship_invalid")
            elements.pop()
        else:
            elements.append(part)
    resolved = "/".join(elements)
    _name(resolved)
    if resolved not in names or resolved.lower().endswith(".rels"):
        _fail("relationship_target_missing")
    return resolved


def _check_ooxml(extension, names, roots, children, special):
    # OPC 관계/파트 규칙: https://learn.microsoft.com/en-us/previous-versions/windows/desktop/opc/open-packaging-conventions-overview
    types = special.get("[Content_Types].xml")
    if types is None or types.tag != "{" + CT + "}Types" or "_rels/.rels" not in special:
        _fail("package_required_part_missing")
    defaults, overrides = {}, {}
    for entry in types:
        if not isinstance(entry.tag, str):
            continue
        content_type = entry.get("ContentType", "")
        if not content_type or _forbidden_type(content_type):
            _fail("content_type_forbidden")
        if entry.tag == "{" + CT + "}Default":
            key = entry.get("Extension", "").lower()
            if not re.fullmatch(r"[a-z0-9]+", key) or key in defaults:
                _fail("content_type_invalid")
            defaults[key] = content_type
        elif entry.tag == "{" + CT + "}Override":
            key = entry.get("PartName", "")
            if not key.startswith("/"):
                _fail("content_type_invalid")
            key = _target(key, "", names)
            if key in overrides:
                _fail("content_type_invalid")
            overrides[key] = content_type
        else:
            _fail("content_type_invalid")
    for name in names - {"[Content_Types].xml"}:
        value = overrides.get(name, defaults.get(name.rsplit(".", 1)[-1].lower()))
        if not value:
            _fail("content_type_missing")
        if (value.endswith("+xml") or value in ("application/xml", "text/xml")) and name not in roots:
            _fail("xml_part_extension_unsupported", "unsupported")
    main = []
    for name, root in special.items():
        if not name.lower().endswith(".rels"):
            continue
        if root.tag != "{" + REL + "}Relationships":
            _fail("relationship_invalid")
        if name == "_rels/.rels":
            base = ""
        elif "/_rels/" in name:
            before, after = name.rsplit("/_rels/", 1)
            source = before + "/" + after[:-5]
            if source not in names:
                _fail("relationship_source_missing")
            base = before
        else:
            _fail("relationship_invalid")
        ids = set()
        for relation in root:
            if not isinstance(relation.tag, str):
                continue
            rid, kind, target, mode = relation.get("Id"), relation.get("Type", ""), relation.get("Target"), relation.get("TargetMode", "Internal")
            if relation.tag != "{" + REL + "}Relationship" or not rid or rid in ids or not kind or not target or mode not in ("Internal", "External"):
                _fail("relationship_invalid")
            ids.add(rid)
            suffix = kind.rsplit("/", 1)[-1].lower()
            if _forbidden_type(kind) or suffix in ("package", "control", "attachedtemplate", "externallink", "externallinkpath", "altchunk", "afchunk"):
                _fail("embedded_content_forbidden")
            if mode == "External":
                # 클릭 링크만 허용한다. 원격 이미지/템플릿/통합문서 로딩은 거부한다.
                if kind not in tuple(p + "hyperlink" for p in OFFICE_RELS) or urlsplit(target).scheme.lower() not in ("http", "https", "mailto"):
                    _fail("external_content_forbidden")
                continue
            resolved = _target(target, base, names)
            if name == "_rels/.rels" and kind in tuple(p + "officeDocument" for p in OFFICE_RELS):
                main.append(resolved)
    if len(main) != 1 or overrides.get(main[0]) != MAIN_TYPES[extension]:
        _fail("main_part_invalid")
    family, local, child = MAIN_TAGS[extension]
    namespaces = (f"http://schemas.openxmlformats.org/{family}/2006/main", f"http://purl.oclc.org/ooxml/{family}/main")
    tag = roots.get(main[0])
    if tag not in tuple("{" + ns + "}" + local for ns in namespaces):
        _fail("main_part_invalid")
    if child and not any("{" + ns + "}" + child in children[main[0]] for ns in namespaces):
        _fail("main_part_invalid")


def _check_hwpx_boilerplate(special):
    # 한컴 저장본에서 확인한 UTF-16 기본 스크립트만 인정한다. 원본을 지우거나
    # 재작성하지 않으며 실행·주석 제거·표현식 해석을 전혀 하지 않는다.
    for path, role in zip(_HWPX_SCRIPT_PATHS, ("header", "source")):
        raw = special[path]
        try:
            encoding = "utf-16" if raw.startswith((b"\xff\xfe", b"\xfe\xff")) else "utf-16-le"
            text = raw.decode(encoding, errors="strict")
        except UnicodeError:
            _fail("hwpx_script_encoding_invalid")
        if not is_empty_hancom_script(text, role):
            _fail("hwpx_script_content_forbidden")


def _check_hwpx(names, roots, special):
    # HWPX 구성/스크립트/암호화: https://tech.hancom.com/hwpxformat/
    if special.get("mimetype") != b"application/hwp+zip":
        _fail("signature_mismatch")
    required = {"META-INF/container.xml", "META-INF/manifest.xml", "Contents/content.hpf", "Contents/header.xml"}
    if not required <= names:
        _fail("package_required_part_missing")
    container, manifest, package = (special[n] for n in ("META-INF/container.xml", "META-INF/manifest.xml", "Contents/content.hpf"))
    if container.tag != "{" + OCF + "}container" or manifest.tag != "{" + ODF + "}manifest" or package.tag != "{" + OPF + "}package":
        _fail("hwpx_manifest_invalid")
    if any(isinstance(node.tag, str) and "encrypt" in node.tag.lower() for node in manifest.iter()):
        _fail("archive_encrypted")
    rootfiles = container.findall("{" + OCF + "}rootfiles/{" + OCF + "}rootfile")
    paths = [_target(node.get("full-path"), "", names) for node in rootfiles]
    if paths.count("Contents/content.hpf") != 1:
        _fail("hwpx_manifest_invalid")
    script_paths = set(_HWPX_SCRIPT_PATHS) & names
    if script_paths and (script_paths != set(_HWPX_SCRIPT_PATHS)
                         or len(package.findall("{" + OPF + "}manifest")) != 1
                         or len(package.findall("{" + OPF + "}spine")) != 1):
        _fail("hwpx_script_manifest_invalid")
    items, targets, script_items = {}, set(), {}
    for item in package.findall("{" + OPF + "}manifest/{" + OPF + "}item"):
        item_id, media = item.get("id"), item.get("media-type", "")
        if not item_id or item_id in items or not media:
            _fail("hwpx_manifest_invalid")
        target = _target(item.get("href"), "", names)
        if target in targets:
            _fail("hwpx_manifest_invalid")
        targets.add(target)
        if target in script_paths:
            # 경로 별칭/다른 MIME/추가 속성으로 다른 실행 의미를 끼워 넣지 못한다.
            if (item.get("href") != target or set(item.attrib) != {"id", "href", "media-type"}
                    or re.fullmatch(r"application/x-javascript[ \t]*;[ \t]*charset=utf-16", media, re.IGNORECASE) is None):
                _fail("hwpx_script_manifest_invalid")
            script_items[target] = item_id
        elif _forbidden_type(media):
            _fail("hwpx_manifest_invalid")
        if (media.endswith("+xml") or media == "application/xml") and target not in roots:
            _fail("hwpx_manifest_invalid")
        items[item_id] = target
    spine = package.findall("{" + OPF + "}spine/{" + OPF + "}itemref")
    if not spine or any(item.get("idref") not in items for item in spine):
        _fail("hwpx_manifest_invalid")
    spine_paths = [items[item.get("idref")] for item in spine]
    if script_paths:
        if (set(script_items) != script_paths or any(spine_paths.count(path) != 1 for path in script_paths)
                or spine_paths.index(_HWPX_SCRIPT_PATHS[0]) > spine_paths.index(_HWPX_SCRIPT_PATHS[1])):
            _fail("hwpx_script_manifest_invalid")
        for item in spine:
            if items[item.get("idref")] in script_paths and (set(item.attrib) - {"idref", "linear"} or item.get("linear", "yes") != "yes"):
                _fail("hwpx_script_manifest_invalid")
        _check_hwpx_boilerplate(special)
    if roots.get("Contents/header.xml") != "{" + HEAD + "}head" or "Contents/header.xml" not in items.values():
        _fail("hwpx_main_part_invalid")
    if not any(roots.get(path) == "{" + SECTION + "}sec" for path in spine_paths):
        _fail("hwpx_main_part_invalid")


def inspect_document(data: bytes, extension: str, limits: dict) -> dict:
    """항상 고정 상태/코드만 반환한다. 예외 메시지·문서 본문은 노출하지 않는다."""
    if not _limits_valid(limits):
        return {"status": "error", "code": "inspection_limits_invalid", "mime": None}
    if not isinstance(data, bytes) or not isinstance(extension, str):
        return {"status": "error", "code": "inspection_input_invalid", "mime": None}
    extension = extension.lower().removeprefix(".")
    if extension not in MIMES:
        return {"status": "unsupported", "code": "format_unsupported", "mime": None}
    mime = MIMES[extension]
    try:
        if extension == "pdf":
            return inspect_pdf(data, limits)
        if extension == "hwp":
            return inspect_hwp(data, limits)
        names, roots, children, special, _ = _read_archive(data, limits, extension=extension)
        if extension == "hwpx":
            _check_hwpx(names, roots, special)
        else:
            _check_ooxml(extension, names, roots, children, special)
        return {"status": "passed", "code": "container_structure_passed", "mime": mime}
    except _Verdict as result:
        return {"status": result.status, "code": result.code, "mime": None}
    except (zipfile.BadZipFile, zipfile.LargeZipFile, EOFError, UnicodeError, struct.error, zlib.error, ValueError, RuntimeError, NotImplementedError):
        return {"status": "rejected", "code": "archive_corrupt", "mime": None}
    except Exception:
        return {"status": "error", "code": "inspection_failed", "mime": None}
