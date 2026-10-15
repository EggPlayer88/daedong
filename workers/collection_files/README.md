# 수합 파일 검사·정리 처리 코어

2026-10-15 · **DB·Storage·악성 검사 공급자를 연결하기 전의 독립 실행 코드**다. 웹 API, 배포 설정, 스케줄러, 서비스 키, 실제 SQL/Storage 어댑터는 포함하지 않는다. 모듈을 가져오는 것만으로 작업이 시작되지 않는다.

## 구성과 실행

| 파일 | 역할 |
|---|---|
| `inspection.py` | 받은 바이트의 문서 컨테이너 구조 검사. 외부 접속·디스크 압축 해제 없음 |
| `pdf_inspection.py` | PDF 객체·페이지·스트림·JPEG 검사. 지원하지 않는 저장 구조는 구분 |
| `hwp_inspection.py` | HWP 5.0과 명시된 5.1 세 버전의 OLE·레코드·기본 스크립트·이미지 검사 |
| `boilerplate.py` | 한컴 기본 별칭 선언·빈 문서 훅의 제한 문법 확인. JS 실행 없음 |
| `verification.py` | 원장·실물·정책 확인 → 원문 읽기 → 구조/악성 검사 분리 → 결과 접수 |
| `cleanup.py` | 참조·보존·진행 작업 확인 → 정리 예약 → 실물 삭제 확인 → 원장 확정 |
| `common.py` | 학교/파일 경로, 실물 식별, 작업 임대, 시각, 계약과 해시 검증 |

저장소 루트에서 Python 3.12와 `workers/requirements.txt`의 의존성을 사용한다. 기존 `lxml`에 `pypdf==6.20.1`, `olefile==0.47`, `Pillow==12.3.0`을 추가했다. 웹 API의 배포 의존성·외부 서비스 설정은 변경하지 않았다.

```bash
python3 -m venv tests/.venv
tests/.venv/bin/pip install -r workers/requirements.txt
npm test -- workhub_file_pdf
npm test -- workhub_file_hwp
npm test -- workhub_file_inspection
npm test -- workhub_file_verification
npm test -- workhub_file_cleanup
npm test
```

직접 Python으로 실행할 때 Windows 콘솔의 체크 표시 인코딩 오류를 피하려면 다음처럼 설정한다. `npm test` 러너는 이미 UTF-8을 설정한다.

```powershell
python -m venv tests/.venv
tests/.venv/Scripts/python.exe -m pip install -r workers/requirements.txt
$env:PYTHONUTF8 = '1'
$env:PYTHONIOENCODING = 'utf-8'
tests/.venv/Scripts/python.exe tests/test_workhub_file_inspection.py
tests/.venv/Scripts/python.exe tests/test_workhub_file_verification.py
tests/.venv/Scripts/python.exe tests/test_workhub_file_cleanup.py
```

시험의 원장·Storage·스캐너는 메모리 대역이다. 테스트에 들어 있는 승인 값·보존기간·압축 한도를 실제 학교 정책으로 복사하지 않는다.

## 문서 검사 프로필

`inspect_document(data, extension, limits)`는 `{status, code, mime}`를 반환한다. `passed`는 **이 코드가 지원하는 컨테이너 구조 검사 통과**다. 전체 표준/XSD 검증, 실제 프로그램 렌더링, 악성 코드 검사 통과를 뜻하지 않는다.

| 형식 | 현재 처리 |
|---|---|
| HWPX | ZIP·필수 파트·XML·매니페스트/관계 검사. 정확한 경로/참조의 기본 스크립트만 제한 문법으로 확인 |
| DOCX/XLSX/PPTX | ZIP·필수 파트·Content Types·관계·XML 검사. 매크로/임베디드 객체 등은 제한 |
| PDF | 일반/압축 xref·object stream·PNG predictor를 포함한 단일 저장본 검사. 증분/혼합 xref·미지원 코덱 등은 구분 |
| HWP | 5.0과 5.1.0.0/5.1.0.1/5.1.1.0의 제한된 프로필. 평문 헤더·버전별 레코드·빈 연결 옵션·기본 스크립트·이미지 검사. 보호 파일·미해석 옵션/확장은 미지원 |

압축 항목 수, 개별/전체 실제 확장량, 압축률, XML 크기는 명시적으로 받은 `limits`로 제한한다. 크기·CRC 위장, 디렉터리 데이터 위장, 경로 혼동, 암호화, DTD/엔티티, 외부 콘텐츠 관계를 거부한다. 외부 HTTP(S)/mailto 하이퍼링크는 관계 종류를 확인하되 실제로 열지 않는다. ZIP64·분할 ZIP·대체 Unicode 이름은 미지원이다.

**기존 보호 HWPX 양식 6개 모두 읽기 전용 검사에 통과한다.** 이전에 3개를 거부하던 기본 스크립트는 두 별칭 선언·빈 `OnDocument_New` 함수만 문법으로 확인한다. 정확한 두 경로·UTF-16·OPF MIME/manifest/spine가 일치해야 하며 임의 명령은 거부한다. 특정 파일명·해시 면제 목록을 사용하지 않고 기존 양식·엔진도 수정하지 않았다.

모든 PDF/HWP 변형의 지원을 뜻하지 않는다. PDF 공개 8개 모두 통과했으며, 시작 보기 설정은 실제 문서 내부 페이지 목적지만 허용한다. 자동 외부 이동·JS·연쇄 동작은 거부한다. 일반 HWP에도 있는 비영 `_LinkDoc` 연결 옵션은 `unsupported`로 남는다. HWP 공개 30개 중 8개 통과·22개 미지원으로 확인했다. [현재 지원과 실측 결과](../../docs/workhub/38-document-compatibility.md)를 먼저 확인한다. 코드가 구조를 읽고 검사하는 것과 악성 여부·문서 렌더링의 검증은 별개다.

공개 원본은 [해시 고정 명세와 재현 안내](../../tests/fixtures/README.md)로 별도 검사한다. 코퍼스 도구는 파일 누락·변경을 실패로 보고하며 시험 한도를 출력한다. CI 회귀는 외부 다운로드 없이 합성 파일로 실행한다.

## 호출과 신뢰 경계

```python
from workers.collection_files.verification import run_verification, commit_verification
from workers.collection_files.cleanup import run_cleanup

# job/policy와 아래 객체는 인증된 서버 어댑터가 공급해야 한다.
result = run_verification(job, policy, ledger, storage, now=clock, scanner=scanner)
if result.status == "result_unknown":
    # 같은 프로세스·원장 객체·유효 임대 범위에서 같은 키/본문으로 재확인한다.
    result = commit_verification(result.pending, ledger, now=clock)

# 기본값은 원장 조회만 하며 Storage 조회/삭제와 정리 예약을 호출하지 않는다.
preview = run_cleanup(cleanup_job, cleanup_ledger, storage, now=clock)
```

이 예시는 주입 인터페이스 설명이다. 운영용 인스턴스 생성 코드나 명령행 실행기는 없다. `scanner=None`은 `not_scanned`이고 `ready`가 되지 않는다. `dry_run=False`는 테스트 대역으로만 검증했다. 실제 삭제 어댑터를 연결할 때는 원자적 원장 잠금·영구 경로 차단과 승인 정책이 먼저 구현·검증돼야 한다.

주요 포트:

| 경로 | 주입 객체의 메서드 |
|---|---|
| 검증 원장 | `inspect(job)`, `commit_result(lease, evidence, request_key, evidence_hash)` |
| 검증 실물 | `stat(ref)`, `read(ref, max_bytes=..., deadline=...)` |
| 악성 검사 | `scan(data, sha256=..., object_ref=..., run_id=..., deadline=...)` |
| 정리 원장 | `inspect(job)`, `reserve(job, inspection_hash)`, `recheck(ticket)`, `finalize(ticket, evidence_hash)` |
| 정리 실물 | `head(ref)`, `remove(ref, ticket)` |

**이 메서드 이름은 내부 Python 포트이며 확정 SQL/RPC 이름이 아니다.** Claude의 R1 계약이 확정되면 어댑터가 변환한다. 기존 [R1 SQL 요청서](../../docs/workhub/32-collection-server-sql-request.md)는 변경하지 않았다. 정확한 필드·원자성 요구·후속 작업은 [구현 인계](../../docs/workhub/36-collection-file-workers.md)를 참고한다.

## 연결 전에 남은 조건

- 실제 서비스 주체 검증, 작업 선점·임대·결과 봉인, 승인 정책 교집합, Storage 객체 불변성 증명.
- 승인된 악성 검사기의 실제 판정, 엔진 신원·서명 최신성 검증. 현재 코어는 응답의 해시/실물/실행 ID·시각 연결을 확인한다.
- PDF 개정 저장/미지원 코덱, HWP 문서 옵션/확장 등 실제 표본 호환성 확대. 런타임의 CPU·메모리·입출력 시간 제한, 프로세스 격리.
- 임대 만료 후 재인수, 프로세스 재시작 뒤 접수 조회. 현재 메모리 재전송은 이를 대신하지 않는다.
- 사전 검사 오류의 영속 분류·재시도 상한·미지원 대기 처리. `SIZE_LIMIT` 등은 접수 없이 반환되므로 후속 작업자가 무한 재시도를 막아야 한다.
- 실제 Storage 삭제 API와 영구 정리 차단. `storage.objects` 행 삭제로 실물 삭제를 대신하지 않는다.
- 준비 상태 활성화와 실제 서버 통합 시험. **이번 코드만으로 수합 준비 상태를 켜지 않는다.**
