# 공개 문서 원본 호환성 재현

`document-corpus.json`은 공개 PDF/HWP의 출처·원본 길이·SHA-256·예상 판정만 저장한다. 표본 파일 자체나 외부 구현 코드는 저장소에 포함하지 않는다. `baseline_pr38`은 기준 커밋 `a4b467759bf2774a5106f8b746ccff4491cb0866`의 코드로 확인한 결과이며 `expected`는 현재 구현의 결과다. 이전에 검사한 11개 외에 **이번 추가 표본 27개도 이전 코드로 소급 검증**했다. 38개를 당시 모두 시험했다는 뜻이 아니다. 학교 교사의 문서는 포함하지 않는다.

## 검사

의존성을 `workers/requirements.txt`로 설치한 뒤 원본을 Git 제외 경로 `tests/.venv/format-fixtures/`에 준비한다. **파일을 수정하거나 새로 저장하지 않는다.**

```bash
tests/.venv/bin/python tests/check_document_corpus.py tests/.venv/format-fixtures
```

Windows:

```powershell
tests/.venv/Scripts/python.exe tests/check_document_corpus.py tests/.venv/format-fixtures
```

도구는 네트워크·DB를 사용하지 않고 로컬 파일만 읽는다. 예상 크기와 해시가 맞아야 파서를 호출한다. 원본이 없거나 달라지면 실패로 기록하며, 검사 가능한 파일만 세어서 통과로 보고하지 않는다. 종료 코드는 전체 판정 일치 `0`, 누락·변경·판정 불일치 `1`, 명세/입력 오류 `2`다.

결과의 `matched`는 미지원·거부 예상값이 맞는 경우도 포함한다. `structure_passed`가 실제 구조 검사 통과 수다. 둘을 호환률로 혼동하지 않는다. 구조 검사는 악성 검사·전체 렌더링·편집 프로그램 호환성 확인을 대신하지 않는다.

## 동일 조건 비교

공개 코퍼스 전용 시험 한도는 `tests/check_document_corpus.py`의 `CORPUS_LIMITS`에 있고 결과 JSON에도 출력한다. 학교 운영 정책이 아니며 서버 허용량을 변경하지 않는다.

| 형식 | 객체/항목 수 | 단일 항목 | 총 확장량 | XML/구조 한도 | 압축률 |
|---|---:|---:|---:|---:|---:|
| PDF | 10,000 | 32 MiB | 128 MiB | 16 MiB | 1,000 |
| HWP | 1,000 | 32 MiB | 64 MiB | 32 MiB | 1,000 |

도구는 HWPX에 HWP와 같은 시험 한도를 제공하지만, 이번 공개 코퍼스에는 HWPX가 없다. 기존 보호 HWPX 6종의 검사는 별도 회귀에 포함된다.

이 값은 PR #38 당시 공개 표본 실측 조건이다. 일반 PDF 단위 시험과 제출 접수 시험은 더 낮은 객체 상한을 쓰기도 한다. 특히 한컴 형식 명세 PDF는 객체 상한 1,000이면 거부되므로, 한도를 생략한 통과 비교는 부정확하다. 원본·기준 커밋·시험 한도를 함께 기록한다.

## 공개 원본 준비가 필요한 경우

명세의 `source`는 출처다. 검사 도구가 자동으로 가져오지 않는다. 다음은 선택적으로 공개 원본을 내려받는 Python 예시이며 가상환경 Python에서 실행한다. URL에 있는 파일이 갱신돼 해시가 달라지면 중단하고 출처를 다시 확인한다. 예상 해시를 무조건 새 값으로 바꾸지 않는다.

```python
import hashlib, json
from pathlib import Path
from urllib.request import urlopen

manifest = json.loads(Path("tests/fixtures/document-corpus.json").read_text(encoding="utf-8"))
destination = Path("tests/.venv/format-fixtures")
destination.mkdir(parents=True, exist_ok=True)
for item in manifest["files"]:
    assert item["source"].startswith("https://")
    with urlopen(item["source"], timeout=30) as response:
        data = response.read(item["bytes"] + 1)
    assert len(data) == item["bytes"]
    assert hashlib.sha256(data).hexdigest() == item["sha256"], item["file"]
    (destination / item["file"]).write_bytes(data)
```

외부 표본은 로컬 검증에만 사용한다. CI의 기본 회귀는 저장소 안의 독립적으로 만든 합성 PDF/CFB 바이트를 사용하여 외부 사이트 상태나 표본 재배포에 의존하지 않는다. 자동 회귀와 공개 원본 실측 결과를 별도로 보고한다.
