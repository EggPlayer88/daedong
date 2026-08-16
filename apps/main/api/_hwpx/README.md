# api/_hwpx — HWPX 엔진 (이식본)

`doc-ai-prep/engine/` 의 **검증된 확정본을 그대로 복사**한 것이다 (2026-08-16).

## ⚠ 수정 금지

이 폴더의 `.py` 4개는 **읽기 전용으로 취급한다.** import 해서 쓰되 고치지 않는다.
버그를 발견하면 원본(`doc-ai-prep/engine/`)에서 고치고 다시 복사한다 — 양쪽이 갈라지면
"검증된 코드"라는 전제가 깨진다.

| 파일 | 역할 | 서버에서 사용 |
|------|------|--------------|
| `hwpx_lib.py` | 문서 편집 엔진 (load/save/smart_replace/verify 등) | ✅ |
| `hwpx_zip.py` | HWPX ZIP 해체·재압축 (mimetype 규칙 보존) | ✅ |
| `analyze_template.py` | 양식 구조 분석 CLI | ❌ (템플릿 통합 작업용 동반) |
| `extract_text.py` | 본문 텍스트 추출 CLI | ❌ (템플릿 통합 작업용 동반) |

## 사용법 (generate.py 에서)

```python
sys.path.insert(0, str(Path(__file__).parent.parent / "_hwpx"))
from hwpx_lib import load_section, save_section, smart_replace, verify_hwpx
from hwpx_zip import unpack, pack
```

`from hwpx_lib import *` 도 동작하지만(`__all__` 정의됨), 어떤 함수를 쓰는지 드러나도록
명시적 import 를 쓴다.

## 의존성

`lxml` — `apps/main/requirements.txt` 에 선언되어 있다. Vercel Python 런타임이 이 파일을
읽어 설치한다.

## 지켜야 할 원칙 (hwpx_lib 문서화 주석 요약)

1. `section0.xml` 을 새로 쓰지 않는다 — 기존 요소를 deepcopy 해서 텍스트만 바꾼다
2. XML 을 문자열 조작하지 않는다 — 항상 lxml 트리로 다룬다
3. `mimetype` 은 ZIP 첫 엔트리 + 무압축 (`hwpx_zip.pack` 이 보장)
4. 여러 구간 교체는 **뒤에서부터 역순**
