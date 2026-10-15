"""다운로드 없이 로컬 공개 원본의 해시와 형식 판정을 재현한다."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from workers.collection_files.inspection import inspect_document

MAX_FILE_BYTES = 100 * 1024 * 1024
# PR #38의 공개 표본 실측에 사용한 시험용 한도를 형식별로 고정한다.
# 학교 운영 정책이나 업로드 허용량이 아니며 실행 결과에도 값을 기록한다.
LIMITS = {"max_archive_entries": 1000, "max_entry_bytes": 32 * 1024 * 1024,
          "max_expanded_bytes": 64 * 1024 * 1024, "max_xml_bytes": 32 * 1024 * 1024,
          "max_compression_ratio": 1000}
PDF_LIMITS = {**LIMITS, "max_archive_entries": 10000,
              "max_expanded_bytes": 128 * 1024 * 1024, "max_xml_bytes": 16 * 1024 * 1024}
CORPUS_LIMITS = {"pdf": PDF_LIMITS, "hwp": LIMITS, "hwpx": LIMITS}


def check_corpus(manifest, directory):
    """미지원 예상값의 일치도 기록하되 지원 성공 수와 구분한다."""
    directory = Path(directory).resolve(strict=True)
    if not directory.is_dir() or not isinstance(manifest, dict):
        raise ValueError("invalid_corpus_input")
    entries = manifest.get("files")
    if not isinstance(entries, list) or not 1 <= len(entries) <= 100:
        raise ValueError("invalid_corpus_manifest")
    names, results = set(), []
    # 파일을 읽기 전에 전체 명세를 검사한다. 외부 경로/네트워크는 사용하지 않는다.
    for item in entries:
        if not isinstance(item, dict):
            raise ValueError("invalid_corpus_manifest")
        name = item.get("file")
        if (not isinstance(name, str) or not re.fullmatch(r"[a-zA-Z0-9_.-]+\.(?:pdf|hwp|hwpx)", name)
                or name.casefold() in names or len(name) > 160
                or not isinstance(item.get("sha256"), str)
                or not re.fullmatch(r"[0-9a-f]{64}", item["sha256"])
                or type(item.get("bytes")) is not int or not 0 < item["bytes"] <= MAX_FILE_BYTES
                or not isinstance(item.get("expected"), dict)
                or item["expected"].get("status") not in ("passed", "unsupported", "rejected")
                or not isinstance(item["expected"].get("code"), str)
                or not re.fullmatch(r"[a-z_]+", item["expected"]["code"])):
            raise ValueError("invalid_corpus_manifest")
        names.add(name.casefold())
    for item in entries:
        path = directory / item["file"]
        row = {"file": item["file"], "expected": item["expected"], "matched": False}
        try:
            if path.is_symlink() or path.resolve().parent != directory:
                raise ValueError("corpus_path_invalid")
            # 신고 길이가 틀린 파일은 파서로 전달하지 않는다. 실제 읽기도 상한을 둔다.
            if path.stat().st_size != item["bytes"]:
                raise ValueError("corpus_size_mismatch")
            with path.open("rb") as stream:
                body = stream.read(item["bytes"] + 1)
            if len(body) != item["bytes"] or hashlib.sha256(body).hexdigest() != item["sha256"]:
                raise ValueError("corpus_hash_mismatch")
            extension = path.suffix[1:]
            result = inspect_document(body, extension, CORPUS_LIMITS[extension])
            row["observed"] = {key: result[key] for key in ("status", "code")}
            row["matched"] = row["observed"] == item["expected"]
        except FileNotFoundError:
            row["error"] = "corpus_file_missing"
        except OSError:
            row["error"] = "corpus_file_unreadable"
        except ValueError as error:
            row["error"] = str(error) if str(error) in (
                "corpus_path_invalid", "corpus_size_mismatch", "corpus_hash_mismatch"
            ) else "corpus_input_invalid"
        results.append(row)
    return {"limits_by_extension": CORPUS_LIMITS,
            "total": len(results), "matched": sum(row["matched"] for row in results),
            "structure_passed": sum(row.get("observed", {}).get("status") == "passed" for row in results),
            "results": results}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("directory", type=Path, help="공개 표본 원본을 보관한 로컬 폴더")
    parser.add_argument("--manifest", type=Path, default=ROOT / "tests/fixtures/document-corpus.json")
    args = parser.parse_args(argv)
    try:
        with args.manifest.open("rb") as stream:
            raw = stream.read(65537)
        if len(raw) > 65536:
            raise ValueError("manifest_too_large")
        report = check_corpus(json.loads(raw.decode("utf-8")), args.directory)
    except (OSError, ValueError):
        print(json.dumps({"error": "corpus_input_invalid"}))
        return 2
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0 if report["matched"] == report["total"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
