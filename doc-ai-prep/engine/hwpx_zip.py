#!/usr/bin/env python3
"""HWPX 해체(unpack) / 재압축(pack) 도구.

HWPX는 ZIP 컨테이너지만 아무렇게나 압축하면 한글이 열지 못한다.
핵심 규칙:
  1. 'mimetype' 항목이 반드시 첫 번째 엔트리여야 하고, 무압축(ZIP_STORED)이어야 한다.
  2. 나머지 파일은 deflate 압축.
  3. 디렉터리 엔트리는 만들지 않는다.

사용법:
  python3 hwpx_zip.py unpack 문서.hwpx 작업폴더/
  python3 hwpx_zip.py pack 작업폴더/ 결과.hwpx
  python3 hwpx_zip.py list 문서.hwpx
"""
import sys
import zipfile
from pathlib import Path

MIMETYPE = "mimetype"
ORDER_HINT = [
    "mimetype",
    "version.xml",
    "settings.xml",
    "META-INF/container.xml",
    "META-INF/container.rdf",
    "META-INF/manifest.xml",
    "Contents/content.hpf",
    "Contents/header.xml",
]


def unpack(src: Path, dest: Path) -> None:
    dest.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(src) as z:
        infos = z.infolist()
        z.extractall(dest)
    # 원본 엔트리 순서와 압축 방식을 기억해 두었다가 재압축 시 그대로 복원한다.
    # (mimetype 외에도 무압축으로 저장된 항목이 있는 양식이 실제로 존재한다)
    lines = [f"{i.filename}\t{i.compress_type}" for i in infos]
    (dest / ".hwpx_order").write_text("\n".join(lines), encoding="utf-8")
    print(f"[unpack] {src.name} -> {dest}/  ({len(infos)}개 항목)")
    for i in infos:
        method = "STORED" if i.compress_type == zipfile.ZIP_STORED else "DEFLATE"
        print(f"  - {i.filename}  [{method}]")


def _entry_order(root: Path):
    """재압축 순서와 압축 방식을 결정한다. [(이름, compress_type), ...]"""
    files = sorted(
        str(p.relative_to(root)).replace("\\", "/")
        for p in root.rglob("*")
        if p.is_file() and p.name != ".hwpx_order"
    )
    fileset = set(files)

    order_file = root / ".hwpx_order"
    ordered, seen = [], set()
    if order_file.exists():
        for line in order_file.read_text(encoding="utf-8").splitlines():
            if not line.strip():
                continue
            name, _, ct = line.partition("\t")
            name = name.strip()
            if name in fileset and name not in seen:
                ordered.append((name, int(ct) if ct.strip().isdigit()
                                else zipfile.ZIP_DEFLATED))
                seen.add(name)
    else:
        for name in ORDER_HINT:
            if name in fileset and name not in seen:
                ct = zipfile.ZIP_STORED if name == MIMETYPE else zipfile.ZIP_DEFLATED
                ordered.append((name, ct))
                seen.add(name)

    # 원본에 없던 새 파일(예: 추가한 section1.xml)은 뒤에 붙인다.
    for name in files:
        if name not in seen:
            ordered.append((name, zipfile.ZIP_DEFLATED))
            seen.add(name)

    # mimetype은 무슨 일이 있어도 맨 앞이고 무압축이다.
    ordered = [e for e in ordered if e[0] != MIMETYPE]
    if MIMETYPE in fileset:
        ordered.insert(0, (MIMETYPE, zipfile.ZIP_STORED))
    return ordered


def pack(root: Path, out: Path) -> None:
    if not (root / MIMETYPE).exists():
        print(f"[!] 경고: {root}/mimetype 이 없습니다. 한글이 파일을 못 열 수 있습니다.")

    entries = _entry_order(root)
    out.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(out, "w") as z:
        for name, ct in entries:
            data = (root / name).read_bytes()
            zi = zipfile.ZipInfo(name)
            zi.compress_type = ct
            zi.external_attr = 0o600 << 16
            z.writestr(zi, data)
    print(f"[pack] {root} -> {out}  ({len(entries)}개 항목, {out.stat().st_size:,} bytes)")


def listing(src: Path) -> None:
    with zipfile.ZipFile(src) as z:
        print(f"{'항목':<40} {'크기':>10} {'압축':>8}")
        print("-" * 62)
        for i in z.infolist():
            method = "STORED" if i.compress_type == zipfile.ZIP_STORED else "DEFLATE"
            print(f"{i.filename:<40} {i.file_size:>10,} {method:>8}")


def main() -> int:
    if len(sys.argv) < 3:
        print(__doc__)
        return 1
    cmd = sys.argv[1]
    if cmd == "unpack" and len(sys.argv) == 4:
        unpack(Path(sys.argv[2]), Path(sys.argv[3]))
    elif cmd == "pack" and len(sys.argv) == 4:
        pack(Path(sys.argv[2]), Path(sys.argv[3]))
    elif cmd == "list":
        listing(Path(sys.argv[2]))
    else:
        print(__doc__)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
