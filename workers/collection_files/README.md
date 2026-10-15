# 수합 파일 검사·정리 처리 코어

2026-10-15 · **문서 검사 코어와 R1 서버 연결 실행기**다. 확정 R1 RPC·Storage HTTP·선택형 ClamAV 연결을 구현했다. 모듈을 가져오는 것만으로 작업이 시작되지 않는다. 실제 배포·R1-05/06 적용은 별도이며, 아래 기존 포트 설명은 준비용 코어에 해당한다.

실제 연결은 [R1 실행·배포 인계](../../docs/workhub/40-collection-r1-connection.md)를 먼저 읽는다. `python -m workers.collection_files check`는 로컬 자체 검사만 한다. `verify --execute`는 승인된 학교의 검사 작업을, `cleanup --execute`는 승인 정책에 맞는 미첨부 파일 정리를 실제 실행하므로 배포 단계에서만 사용한다.

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
| `r1_worker.py` | R1 실제 정책·정수 임대 토큰·응답으로 검사/정리/재전송 |
| `transport.py` | 서버 전용 Supabase RPC·Storage HTTP 연결 |
| `runtime.py` | 별도 파서 프로세스와 선택형 ClamAV Unix 소켓 |
| `__main__.py` | 기본 로컬 점검과 명시적 단발 실행 CLI |

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

## 기존 준비용 코어의 호출과 신뢰 경계

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

이 예시는 기존 준비용 코어의 주입 인터페이스 설명이다. 확정 R1 연결에는 별도 `r1_worker.py`와 명령행 실행기를 사용한다. `scanner=None`은 `not_scanned`이고 `ready`가 되지 않는다. `dry_run=False`는 테스트 대역으로만 검증했다. 실제 삭제 어댑터를 연결할 때는 원자적 원장 잠금·영구 경로 차단과 승인 정책이 먼저 구현·검증돼야 한다.

주요 포트:

| 경로 | 주입 객체의 메서드 |
|---|---|
| 검증 원장 | `inspect(job)`, `commit_result(lease, evidence, request_key, evidence_hash)` |
| 검증 실물 | `stat(ref)`, `read(ref, max_bytes=..., deadline=...)` |
| 악성 검사 | `scan(data, sha256=..., object_ref=..., run_id=..., deadline=...)` |
| 정리 원장 | `inspect(job)`, `reserve(job, inspection_hash)`, `recheck(ticket)`, `finalize(ticket, evidence_hash)` |
| 정리 실물 | `head(ref)`, `remove(ref, ticket)` |

**이 메서드 이름은 내부 Python 포트이며 확정 SQL/RPC 이름이 아니다.** R1 전용 실행기는 없는 승인/manifest 필드를 꾸며내지 않고 확정 SQL 계약을 직접 사용한다. 기존 [R1 SQL 요청서](../../docs/workhub/32-collection-server-sql-request.md)는 변경하지 않았다. 정확한 필드·원자성 요구·후속 작업은 [구현 인계](../../docs/workhub/36-collection-file-workers.md)를 참고한다.

## 실제 활성화 전에 남은 조건

- R1-05/06 실제 연결·정책 승인, 독립 서버 배포·비밀값·스케줄러 설정. 서버 키를 브라우저에 노출하지 않는다.
- 실제 Supabase PostgREST·Storage·ClamAV 데몬 및 검사 한도/서명 갱신 확인. 현재 자동 시험은 HTTP/스캐너 대역과 로컬 실제 R1 SQL을 사용했다.
- 파서 프로세스 시간·Linux CPU/메모리 제한과 키 환경 제거를 구현했지만 OS 권한·네트워크까지 완전한 보안 샌드박스는 아니다.
- R1 임대 만료 재인수/응답 유실 복구·실물 삭제 확인은 새 실행기에서 검증했다. 구 준비용 코어의 메모리 접수 계약과 구별한다.
- PDF/HWP 미지원 변형, 다중 교사·실제 업로드/제출·서명 URL 차단은 별도 확인한다. **코드 병합만으로 수합 준비 상태를 켜지 않는다.**

## 공통 배포 준비

[Linux·Docker 배포 구성](../deploy/README.md)과 [R1-05/06 활성화 인계](../../docs/workhub/41-worker-activation-handoff.md)를 따른다. 컨테이너 기본 명령은 기존 파서 자체 점검이며 키 파일·클라우드에 접근하지 않는다. `python -m workers.collection_files.deployment`는 서버 설정과 로컬 키 형식을 검사하지만 서버 인증/권한을 확인하지 않는다. `--scanner`는 로컬 ClamAV 자체시험만 추가한다. 성공해도 DB 활성화나 실제 Storage 시험 완료를 뜻하지 않는다.
