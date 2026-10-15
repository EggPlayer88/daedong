# 수합 파일 검사·정리 처리 코어

2026-10-15 · **DB·Storage·악성 검사 공급자를 연결하기 전의 독립 실행 코드**다. 웹 API, 배포 설정, 스케줄러, 서비스 키, 실제 SQL/Storage 어댑터는 포함하지 않는다. 모듈을 가져오는 것만으로 작업이 시작되지 않는다.

## 구성과 실행

| 파일 | 역할 |
|---|---|
| `inspection.py` | 받은 바이트의 문서 컨테이너 구조 검사. 외부 접속·디스크 압축 해제 없음 |
| `verification.py` | 원장·실물·정책 확인 → 원문 읽기 → 구조/악성 검사 분리 → 결과 접수 |
| `cleanup.py` | 참조·보존·진행 작업 확인 → 정리 예약 → 실물 삭제 확인 → 원장 확정 |
| `common.py` | 학교/파일 경로, 실물 식별, 작업 임대, 시각, 계약과 해시 검증 |

저장소 루트에서 Python 3.12와 기존 테스트 의존성 `lxml`을 사용한다. 새 외부 패키지나 서비스는 설치하지 않았다.

```bash
npm test -- workhub_file_inspection
npm test -- workhub_file_verification
npm test -- workhub_file_cleanup
npm test
```

직접 Python으로 실행할 때 Windows 콘솔의 체크 표시 인코딩 오류를 피하려면 다음처럼 설정한다. `npm test` 러너는 이미 UTF-8을 설정한다.

```powershell
$env:PYTHONUTF8 = '1'
$env:PYTHONIOENCODING = 'utf-8'
python tests/test_workhub_file_inspection.py
python tests/test_workhub_file_verification.py
python tests/test_workhub_file_cleanup.py
```

시험의 원장·Storage·스캐너는 메모리 대역이다. 테스트에 들어 있는 승인 값·보존기간·압축 한도를 실제 학교 정책으로 복사하지 않는다.

## 문서 검사 프로필

`inspect_document(data, extension, limits)`는 `{status, code, mime}`를 반환한다. `passed`는 **이 코드가 지원하는 컨테이너 구조 검사 통과**다. 전체 표준/XSD 검증, 실제 프로그램 렌더링, 악성 코드 검사 통과를 뜻하지 않는다.

| 형식 | 현재 처리 |
|---|---|
| HWPX | ZIP·필수 파트·XML·매니페스트/관계 검사. 스크립트·임베디드 실행 콘텐츠 등은 제한 |
| DOCX/XLSX/PPTX | ZIP·필수 파트·Content Types·관계·XML 검사. 매크로/임베디드 객체 등은 제한 |
| PDF | 표식이 맞아도 `unsupported / format_parser_unavailable`. 전용 파서 미구현 |
| HWP | OLE 표식만으로 HWP를 확정하지 않음. 전용 파서 미구현으로 `unsupported` |

압축 항목 수, 개별/전체 실제 확장량, 압축률, XML 크기는 명시적으로 받은 `limits`로 제한한다. 크기·CRC 위장, 디렉터리 데이터 위장, 경로 혼동, 암호화, DTD/엔티티, 외부 콘텐츠 관계를 거부한다. 외부 HTTP(S)/mailto 하이퍼링크는 관계 종류를 확인하되 실제로 열지 않는다. ZIP64·분할 ZIP·대체 Unicode 이름은 미지원이다.

**기존 보호 HWPX 양식 6개를 읽기 전용으로 검사하면 3개 통과·3개 거부**다. `tpl-g2-exam1.hwpx`, `tpl-g2-perf3-arts.hwpx`, `tpl-g3-perf3.hwpx`에 포함된 `Scripts/headerScripts.js`·`Scripts/sourceScripts.js`가 엄격 프로필에 걸린다. 악성 파일로 판정한 것이 아니다. 기존 양식·엔진은 수정하지 않았다. 이 프로필을 그대로 모든 교사에게 적용하기 전에 정상 HWPX 호환성을 보완해야 한다.

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
- PDF/HWP 전용 파서와 정상 HWPX 호환성. 런타임의 CPU·메모리·입출력 시간 제한, 프로세스 격리.
- 임대 만료 후 재인수, 프로세스 재시작 뒤 접수 조회. 현재 메모리 재전송은 이를 대신하지 않는다.
- 사전 검사 오류의 영속 분류·재시도 상한·미지원 대기 처리. `SIZE_LIMIT` 등은 접수 없이 반환되므로 후속 작업자가 무한 재시도를 막아야 한다.
- 실제 Storage 삭제 API와 영구 정리 차단. `storage.objects` 행 삭제로 실물 삭제를 대신하지 않는다.
- 준비 상태 활성화와 실제 서버 통합 시험. **이번 코드만으로 수합 준비 상태를 켜지 않는다.**
