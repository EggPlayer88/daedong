"""원본이 없거나 바뀐 상태를 실제 파일 검증 성공으로 보고하지 않는지 확인한다."""
from contextlib import redirect_stdout
from copy import deepcopy
import hashlib
from io import BytesIO, StringIO
import json
from pathlib import Path
import tempfile
from unittest.mock import patch

from pypdf import PdfWriter
import check_document_corpus as module

passed = failed = 0


def test(label, callback):
    global passed, failed
    try:
        callback()
        passed += 1
        print(f"  ✓ {label}")
    except Exception as error:
        failed += 1
        print(f"  ✗ {label}: {error!r}")


writer, output = PdfWriter(), BytesIO()
writer.add_blank_page(width=595, height=842)
writer.write(output)
writer.close()
BODY = output.getvalue()
ITEM = {"file": "sample.pdf", "bytes": len(BODY), "sha256": hashlib.sha256(BODY).hexdigest(),
        "expected": {"status": "passed", "code": "pdf_structure_passed"}}


def run_case(callback):
    with tempfile.TemporaryDirectory(prefix="workhub-corpus-") as name:
        directory = Path(name)
        (directory / "sample.pdf").write_bytes(BODY)
        callback(directory, {"files": [deepcopy(ITEM)]})


def original(directory, manifest):
    result = module.check_corpus(manifest, directory)
    assert result["matched"] == result["structure_passed"] == result["total"] == 1


test("동일 해시의 원본 PDF를 실제 파서로 검증한다", lambda: run_case(original))


def missing(directory, manifest):
    manifest["files"][0]["file"] = "missing.pdf"
    result = module.check_corpus(manifest, directory)
    assert result["matched"] == 0 and result["results"][0]["error"] == "corpus_file_missing"


test("누락 원본은 통과나 건너뜀으로 세지 않는다", lambda: run_case(missing))


def altered(directory, manifest):
    (directory / "sample.pdf").write_bytes(b"x" + BODY[1:])
    with patch.object(module, "inspect_document", side_effect=AssertionError("파서 호출 금지")):
        result = module.check_corpus(manifest, directory)
    assert result["results"][0]["error"] == "corpus_hash_mismatch"


test("길이가 같아도 해시가 다른 파일은 파싱 전에 중단한다", lambda: run_case(altered))


def wrong_size(directory, manifest):
    manifest["files"][0]["bytes"] -= 1
    with patch.object(module, "inspect_document", side_effect=AssertionError("파서 호출 금지")):
        result = module.check_corpus(manifest, directory)
    assert result["results"][0]["error"] == "corpus_size_mismatch"


test("원본 크기 불일치도 성공으로 세지 않는다", lambda: run_case(wrong_size))


def changed_verdict(directory, manifest):
    manifest["files"][0]["expected"] = {"status": "unsupported", "code": "unsupported_example"}
    result = module.check_corpus(manifest, directory)
    assert result["matched"] == 0 and result["structure_passed"] == 1


test("지원 판정 변화와 예상 결과 일치를 별도로 센다", lambda: run_case(changed_verdict))


def unsupported(directory, manifest):
    manifest["files"][0]["expected"] = {"status": "unsupported", "code": "unsupported_example"}
    with patch.object(module, "inspect_document", return_value={"status": "unsupported", "code": "unsupported_example", "mime": "application/pdf"}):
        result = module.check_corpus(manifest, directory)
    assert result["matched"] == 1 and result["structure_passed"] == 0


test("미지원 예상값이 맞아도 지원 통과로 세지 않는다", lambda: run_case(unsupported))


def invalid_manifest(directory, manifest):
    for bad in ("../sample.pdf", "C:/sample.pdf", "sample.pdf:secret", "sample.exe"):
        manifest["files"][0]["file"] = bad
        try:
            module.check_corpus(manifest, directory)
        except ValueError:
            continue
        raise AssertionError("외부 경로 허용")
    manifest["files"] = [deepcopy(ITEM), deepcopy(ITEM)]
    try:
        module.check_corpus(manifest, directory)
    except ValueError:
        return
    raise AssertionError("중복 파일 허용")


test("경로 이탈·대체 스트림·중복 명세를 거부한다", lambda: run_case(invalid_manifest))


def exit_codes(directory, manifest):
    path = directory / "manifest.json"
    with redirect_stdout(StringIO()):
        path.write_text(json.dumps(manifest), encoding="utf-8")
        assert module.main([str(directory), "--manifest", str(path)]) == 0
        manifest["files"][0]["sha256"] = "0" * 64
        path.write_text(json.dumps(manifest), encoding="utf-8")
        assert module.main([str(directory), "--manifest", str(path)]) == 1
        path.write_text("{", encoding="utf-8")
        assert module.main([str(directory), "--manifest", str(path)]) == 2


test("CLI는 일치·불일치·명세 오류에 서로 다른 종료 코드를 반환한다", lambda: run_case(exit_codes))

print(f"\n{passed} passed, {failed} failed")
if failed:
    raise SystemExit(1)
