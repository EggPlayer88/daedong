# PDF·HWP 검사 지원과 HWPX 호환성 인계

2026-10-15 · PR #37의 `feat/workhub-file-workers` → `feat/workhub-document-format-support`

> 이 문서는 PR #38 당시 결과다. 압축 PDF 및 HWP 실문서 호환성의 후속 보완·현재 제한은 [후속 구현 인계](38-document-compatibility.md)를 확인한다.

## 1. 결과와 적용 범위

기존 서버 파일 처리 코어에 PDF·HWP 전용 파서를 연결하고, 정상 HWPX의 기본 스크립트 호환성을 보완했다. 수합의 공개 RPC·DB 계약·준비 상태·실제 배포는 변경하지 않았다. 실제 문서 작성 AI나 시간표 작업도 포함하지 않는다.

**형식 검사 `passed`는 지원하는 구조 검사만 통과했다는 뜻이다.** 악성 검사·전체 페이지 렌더링·문서 의미 검증이 아니며, 실제 스캐너가 없으면 서버 검증 결과는 계속 `pending / not_scanned`다. 미지원 특징을 정상으로 추정하거나 문서를 자동으로 고쳐서 통과시키지 않는다.

| 형식 | 이번에 지원하는 범위 | 남은 제한 |
|---|---|---|
| PDF | 일반 xref 테이블의 비암호화 단일 저장본. 객체/참조·페이지 트리·스트림 검사, JPEG 스캔 이미지 디코딩 | xref/object stream·증분 저장·미지원 이미지/압축 코덱·predictor 등은 `unsupported` |
| HWP | 제한된 HWP 5.0의 OLE/미니 스트림 구조·FileHeader·DocInfo·본문 레코드·압축·기본 스크립트 검사 | 5.1, 알 수 없는 문서 옵션·확장 저장소/레코드, 보호/배포/DRM 및 실제 동작 스크립트 등 제한. 일반 현장 HWP 호환 미완료 |
| HWPX | 기존 ZIP/XML 방어 유지, 기본 선언·빈 함수만 갖춘 한컴 스크립트 두 파일을 추가 검사 | 임의 스크립트·다른 이벤트/명령·모호한 인코딩/참조는 거부. 전체 XSD/렌더링 검증 아님 |
| DOCX/XLSX/PPTX | 기존 컨테이너 검사 유지 | 기존의 매크로·임베디드 객체 등 제한 유지 |

## 2. 구현과 실패 처리

### PDF

`pdf_inspection.py`에서 `pypdf` strict 파서를 사용하고 입력별 구조 검사를 덧붙인다. `%PDF` 표식만 있는 손상 파일은 이제 미지원이 아니라 거부된다.

- EOF·startxref·xref 위치, 객체 번호/세대/실제 바이트 경계, 등재되지 않은 자료, trailer/Root와 카탈로그를 확인한다. 손상 파일의 자동 복구 결과를 정상으로 사용하지 않는다.
- 모든 등재 객체와 참조를 확인하고 페이지 트리의 순환·중복·부모·개수·크기·Contents를 검사한다.
- Flate·ASCIIHex·ASCII85·RunLength 스트림에 실제 확장량/압축률 한도를 적용한다. ASCII85의 짧은 표기 확장도 선제 계산한다.
- JPEG는 이미지 객체로 한정하고 Pillow로 실제 디코딩한다. 크기·채널·픽셀 메모리 한도를 확인한다. 전체 PDF 렌더링은 수행하지 않는다.
- JavaScript·자동 실행·외부 콘텐츠 로딩·첨부 파일·XFA·PostScript 등 활성/미지원 내용을 제한한다. 일반 HTTP(S)/메일 링크는 실제 접속하지 않는다.
- 페이지·Form·TilingPattern 본문은 제한된 디코딩 후 토큰을 읽는다. 손상된 dictionary를 자동 복구하거나 문서 본문을 오류 로그에 내보내지 않는다. 연산자를 계속 저장하지 않으며 문서 전체 연산 개수도 제한한다. 폰트/CMap과 문자열의 `BI`는 이미지로 오인하지 않는다.
- 일반 xref를 지원한다. 압축 xref/object stream, 증분 저장, PNG predictor, JPX/JBIG2/CCITT/LZW 및 인라인 이미지는 별도 미지원 결과로 남긴다. 새로 저장한 PDF라도 모두 지원한다고 보장하지 않는다.

파싱 예산과 크기 제한은 배포 환경의 강제 CPU/메모리/시간 제한을 대신하지 않는다. 라이브러리가 구조를 만드는 과정의 메모리까지 이 코드가 완전히 통제하는 것은 아니다.

### HWP

`hwp_inspection.py`는 `olefile`로 읽고 그 결과에 체인 소유권·문서별 구조 검사를 추가한다.

- OLE 헤더/FAT/MiniFAT·스트림 체인 길이·교차 소유·순환·고아 할당·도달 불가능한 디렉터리를 검사한다. 컨테이너가 OLE라는 이유만으로 HWP로 인정하지 않는다.
- HWP FileHeader/버전/기능, DocInfo의 필수 레코드, 실제 Section 수, 본문 레코드 경계·레벨을 확인한다. 모든 레코드의 의미를 검증하지는 않는다.
- 무압축·raw DEFLATE를 처리하고 정상 표본에서 확인한 CRC32/ISIZE 꼬리 형식은 정확히 검증한다. 실제 확장량·압축률을 제한한다.
- 암호/DRM/배포문서, 알 수 없는 스트림·옵션·레코드, 내장 실행 객체는 지원 범위 밖으로 남긴다. 기본 스크립트는 제한된 문법만 검사하고 실행하지 않는다.
- 합성 OLE를 만드는 시험 도우미는 테스트에만 있으며 업로드 파일을 고치거나 생성하는 운영 기능이 아니다.

학교의 실제 HWP 파일은 아직 제공받아 시험하지 않았다. **공개 원본 7개도 전부 미지원으로 남았으므로 일반 HWP를 실사용할 준비가 됐다고 볼 수 없다.** 공개 표본의 상세 결과는 아래와 같다. 기본 HWP 5.0 파서를 추가한 것을 모든 HWP 호환 완료로 계산하지 않는다.

### HWPX

기존 6개 보호 양식 중 3개를 거부하던 원인은 `Scripts/headerScripts.js`·`Scripts/sourceScripts.js`의 기본 코드였다. 현재는 **기존 양식 6개 모두 동일 검사에 통과**한다. 양식 파일·토큰·기존 HWPX 엔진은 수정하지 않았다.

- 기본 두 별칭 선언과 빈 `OnDocument_New` 함수, 또는 공백만 허용한다. 일반 JS 파서나 실행기를 사용하지 않는다.
- 전체 텍스트를 제한 문법과 대조한다. 추가 명령·다른 훅·다른 주석·이스케이프를 끼워 넣으면 거부한다.
- 정확한 두 경로·UTF-16·작은 입력 상한·단일 OPF manifest/spine·MIME·유일한 참조/순서를 확인한다.
- 특정 파일명이나 원본 해시로 검사를 면제하지 않는다. 같은 JS를 DOCX 등 다른 형식에 넣어도 허용하지 않는다.
- 실제 보호 양식의 메모리 사본에 `alert(1)`을 넣는 변형도 거부되는지 확인한다. 원본은 바꾸지 않는다.

## 3. 의존성과 재현

`workers/requirements.txt`에 기존 lxml과 신규 `pypdf==6.20.1`, `olefile==0.47`, `Pillow==12.3.0`을 기록했다. 로컬 `tests/.venv`와 GitHub 시험 단계에만 설치한다. 기존 `apps/main/requirements.txt`·실제 배포 설정은 변경하지 않았다. 파서가 없으면 오류이며, 관련 시험이 실패한다.

```bash
python3 -m venv tests/.venv
tests/.venv/bin/pip install -r workers/requirements.txt
npm test -- workhub_file_pdf
npm test -- workhub_file_hwp
npm test -- workhub_file_inspection
npm test -- workhub_file_verification
npm test
```

Windows에서는 `tests/.venv/Scripts/python.exe -m pip install -r workers/requirements.txt`를 사용한다. `npm test`는 이 가상환경을 탐색하고 UTF-8 출력을 설정한다. 시험은 실제 PDF/CFB/ZIP 바이트를 만들며 원장·Storage·악성 검사기는 대역이다. 실제 서버 호출·파일 삭제·프로그램 실행은 없다.

## 4. 실제 파일 실측

공개 파일은 로컬의 Git 제외 경로 `tests/.venv/format-fixtures/`에서 읽기 전용으로 검사했다. 파일 자체는 저장소에 커밋하거나 재배포하지 않는다. 학교 교사의 파일을 외부에 보내지 않았다.

| PDF 표본 | 관측 결과 |
|---|---|
| 한컴 공개 HWP 5 형식 명세 PDF | 구조 검사 통과 |
| py-pdf 공식 표본 `011-google-doc-document/google-doc-document.pdf` | 구조 검사 통과 |
| py-pdf 공식 표본 `023-cmyk-image/cmyk-image.pdf` | 구조 검사 통과 |
| py-pdf 공식 표본 `001-trivial/minimal-document.pdf` | `unsupported / pdf_xref_stream_unsupported` |

출처: [한컴 명세서](https://cdn.hancom.com/link/docs/%ED%95%9C%EA%B8%80%EB%AC%B8%EC%84%9C%ED%8C%8C%EC%9D%BC%ED%98%95%EC%8B%9D_5.0_revision1.3.pdf), [py-pdf 공식 표본](https://github.com/py-pdf/sample-files). 이 4개 표본의 결과를 전체 PDF 호환률로 일반화하지 않는다. 최종 회귀 수치와 HWP 실측은 [진행 현황](PROGRESS.md)에 기록한다.

| HWP 공개 표본 | 결과 코드/이유 |
|---|---|
| pyhwp `headerfooter.hwp`, hwplib `blank.hwp` | `hwp_features_unsupported`: 추가 헤더 기능/알고리즘 정보 |
| pyhwp `password-12345.hwp` | `hwp_protected_unsupported`: 암호/보호 파일 |
| pyhwp `sample-5017.hwp`, `shapepict-scaled.hwp` | `hwp_storage_unsupported`: `DocOptions/_LinkDoc` 등 미해석 옵션 |
| hwp-swift `blank-win2020`, `plain-text-minimal` | `hwp_version_unsupported`: 5.1 형식 |

출처 저장소: [pyhwp](https://github.com/mete0r/pyhwp), [hwplib](https://github.com/neolord0/hwplib), [hwp-swift](https://github.com/sboh1214/hwp-swift). 표본 파일을 수정해서 통과시킨 결과는 포함하지 않는다. 원본 SHA-256·출처·저장소 라이선스·결과는 로컬 보고서의 `공개HWP_실측결과.json`에 보존한다. 미지원은 악성 판정이 아니다.

최종 `npm test` **1,865건 전부 통과**. 직전 1,634건보다 **231건 증가**했다: PDF 100건, HWP 73건, 기존 검사기 80→118건(+38), 검증 처리 35→55건(+20). 나머지 기존 회귀도 전부 통과했다. 기존 보호 양식의 해시 불변 시험도 포함된다. 자동 시험이 실제 서버/스캐너 연결, 문서 프로그램 렌더링, 사용자 실사용 확인을 대신하지 않는다.

## 5. 서버 연결과 남은 작업

기존 [R1 SQL 요청서](32-collection-server-sql-request.md)는 유지한다. 내부 `inspect_document(data, extension, limits)`의 반환 형식도 `{status, code, mime}`로 유지했다. 검사 결과 처리의 해시·실물 식별·임대·동일 키 접수 경계를 변경하지 않았다.

1. Claude R1 SQL 검토 → 사용자 적용 → 실제 원장/Storage 어댑터 연결.
2. 승인 악성 검사기·서비스 주체·정책·실행 격리/시간·메모리 제한 구현.
3. 미지원 PDF/HWP 특징의 실제 표본 확대와 교사 파일 호환성 검증. 미지원 파일을 악성으로 설명하지 않기.
4. 만료/재시작 복구, 영속 오류 분류·재시도 상한. 미지원 상태를 자동 무한 재시도하지 않기.
5. 자동 서버 통합 시험 후 준비 상태 활성화. 사용자 실사용 확인은 나중에 모아서 진행.

## 6. 판단해서 정한 것

| 결정 | 이유 | 변경 위치 |
|---|---|---|
| 전용 라이브러리와 제한된 검사 프로필 병행 | 복잡한 PDF/OLE 파서를 전부 재작성하지 않으면서 복구·확장·활성 내용의 경계를 확인 | `pdf_inspection.py`, `hwp_inspection.py` |
| HWPX 기본 스크립트만 문법으로 확인 | 양식 원본 수정이나 개별 파일 예외 없이 정상 문서 호환 | `boilerplate.py`, `inspection.py` |
| 미지원 특징은 명시적으로 남김 | 일반적인 파일이라도 검증하지 못한 내용을 정상이라고 추정하지 않음 | 형식별 `unsupported` 코드 |
| 실제 스캐너 없으면 계속 미검사 | 구조 검사와 악성 판정의 역할 구분 유지 | 기존 `verification.py` 유지, 연결 회귀 추가 |
| 작업자 의존성과 웹 API 배포 분리 | 이번 준비 작업으로 운영 실행 환경을 바꾸지 않음 | `workers/requirements.txt`, 시험 workflow |

참고: [pypdf strict 동작](https://pypdf.readthedocs.io/en/stable/user/robustness.html), [olefile API](https://olefile.readthedocs.io/en/stable/olefile.html), [한컴 HWP 5 공개 형식](https://cdn.hancom.com/link/docs/%ED%95%9C%EA%B8%80%EB%AC%B8%EC%84%9C%ED%8C%8C%EC%9D%BC%ED%98%95%EC%8B%9D_5.0_revision1.3.pdf), [한컴 HWPX 소개](https://tech.hancom.com/hwpxformat/). 외부 형식 설명과 별개로 이 코드가 실제 보장하는 범위는 위 지원 표와 시험 결과다.
