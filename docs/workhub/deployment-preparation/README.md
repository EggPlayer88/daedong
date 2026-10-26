# 미적용 SQL 통합 검증과 배포 준비

> 현재 상태는 [2026-10-26 전체 구축 마무리](../construction-closeout/README.md)를 우선합니다. 아래는 작성 당시의 기록이며 이미 끝난 설치·배포·활성화를 다시 수행하는 지시가 아닙니다.

2026-10-21 · PR #77. **검토용 준비 자료이며 운영 실행 승인이 아니다.** 실제 DB 적용·기존 회원 연결·Claude 최종 검토·모듈 공개는 마지막 단계로 보류한다. 이번 준비는 GitHub와 저장소를 기준으로 하며 운영 DB를 조회하지 않는다.

## DB 적용 전 앱 흐름 점검

[최신 앱 마무리 보고](pre-db-completion.md)에 전체 흐름 점검, 화면 재시도·학교 원문 보존·여러 날 일정 표시 수정, 자동 시험과 마지막 서버 연결 작업을 정리했다. 기존 SQL 원문·운영 설정은 변경하지 않았다.

## 무엇을 한 묶음으로 확인하는가

| 묶음 | 경로 | 준비 대상 |
|---|---|---|
| 학교 교사 연결 | `database/workhub-school-data/p9/` | 기존 가입 교사 후보·확인·원번호 복구. 실제 연결은 보류 |
| 학교 자료 정정 | `database/workhub-school-data/p10/` | 수업·학생·관계 정정과 시간표 원본 보호 |
| 시간표 운영 확장 | `database/workhub-timetable/t3/` | 대강·휴강·보강·독립 승인·시범 정책 |
| 실제 시간표 가져오기 | `database/workhub-timetable/t4/` | 가져오기·현재 원본 비교·원자적 반영 |
| 학교 공통 AI | `database/workhub-ai-policy/p10/` | 학교 키·공통 예산·원장·운영 조회·서버 진단 |
| 학교 자료 과거판 | `database/workhub-knowledge-history/k1/` | 정확한 과거 문서판·원문·이력 조회 |
| 개인 AI 기억 | `database/workhub-ai-memory/m1/` | 본인 기억 CRUD·선택·복구·삭제 |

두 `P10`은 서로 다른 패키지다. 이름의 번호만 보고 실행하지 않는다. 정확한 경로·분류·해시는 [sql-inventory.json](sql-inventory.json)에 있다. 설치 파일과 읽기 전용 점검, 별도 승인/회원 연결/중지 파일을 분리한다. 기존 T2-07 기준선부터 상태가 예상과 맞는지 확인하는 절차이며, 이미 설치된 파일을 재실행하는 방식이 아니다.

## 자동 검증의 세 층

1. **배포 목록 검사:** 정확한 파일 집합·경로·원문 해시·의존 순서·사전/사후 점검 및 승인 파일 분리를 검사한다. 이 목록 검사가 SQL 로직의 정확성을 증명하지는 않는다.
2. **한 DB 통합:** 운영과 연결하지 않는 새 localhost PostgreSQL 17에 기존 기반과 미적용 패키지를 함께 설치한다. 설치 단계별 상태, 최종 INT-05, 기존 자료·활성 상태 보존, 권한·함수·트리거·제약 등의 훼손 탐지를 확인한다.
3. **모듈별 회귀와 앱 대조:** 학교 자료·시간표·AI·K1·M1의 기존 회귀를 함께 실행한다. 실제 SQL 응답을 현재 앱/서버 parser에 대조한다. 앞선 단계가 실패하면 뒤 단계를 멈추고 전체 실패로 기록한다.

격리 SQL 시험은 가상 교사 자료만 사용한다. 실제 Supabase Auth·PostgREST·Storage·Vercel·Claude의 운영 연결이나 실제 회원 승인을 증명하지 않는다. 설치 점검과 사용자 흐름 시험의 건수를 합쳐 기능 수나 완성률로 계산하지 않는다.

## 개발자가 재현하는 명령

```powershell
npm run check:workhub:deployment
$env:WORKHUB_DEPLOYMENT_PG_BIN='PostgreSQL 17 bin의 절대 경로'
npm run test:workhub:deployment
npm test
npm run build
npm run build:workhub
npm run prepare:workhub:deployment
```

Linux는 일반 사용자와 PostgreSQL 17, Python `psycopg2`가 필요하다. 기존 CI가 모듈별 회귀를 이미 실행하므로 CI에서는 새 전체 설치 검사만 `node scripts/verify-workhub-deployment.mjs --integration-only`로 추가한다. 실행기 기본 포트는 55609이며 운영 DSN을 인자로 받지 않는다. 보고서 위치는 `WORKHUB_DEPLOYMENT_REPORT`, 시험 포트는 `WORKHUB_DEPLOYMENT_TEST_PORT`로 바꿀 수 있다.

검증 실행은 접속 주소를 덮을 수 있는 모든 `PG*`, 실제 DB/키 설정과 `*_WRITE_*` 원문 생성 플래그를 사전에 거부한다. 검증 전후 SQL 목록과 해시가 모두 맞아야 성공한다. 직접 생성 도구의 명시적 재생성 기능은 자동 검증에 사용하지 않는다.

기존 `scripts/check-workhub-deployment.mjs --site ...`는 공개 배포를 읽어 보는 별도 도구다. 이번 **SQL 목록 검사**는 `scripts/check-workhub-sql-package.mjs`이며 인터넷이나 실제 DB에 접속하지 않는다.

## 검토용 묶음 내보내기

`prepare:workhub:deployment`는 목록 검증을 통과한 SQL만 새 임시 폴더에 복사한다. 다른 위치가 필요하면 `-- --output-parent '이미 존재하는 상위 폴더'`를 지정한다. 기존 폴더나 파일을 덮어쓰지 않는다.

- 설치·점검·별도 승인·중지·보류 자료를 분리한다. 파일명 정렬이나 폴더 번호로 실행하지 않는다.
- 모든 SQL은 UTF-8/LF로 복사하고 실제 내보낸 바이트의 SHA-256을 `SHA256SUMS`에 기록한다. 내용은 바꾸지 않는다.
- 환경 파일, 실제 키, 운영 접속 정보, 채워진 승인본, 기존 회원 명단은 수집하지 않는다.
- `package-manifest.json`의 `review_only_not_approved`는 검토 자료라는 뜻이다. 내보내기 성공은 운영 승인·배포 성공이 아니다.
- 원본 설치 순서와 단계별 점검은 `sql-inventory.json`, 운영 전환 준비는 [runbook.md](runbook.md)를 따른다.

## 설치와 활성화를 구분할 때 주의할 점

AI 정책 P10은 설치만으로 기존 P6 직접 호출 경로를 바꾼다. 새 평가계획서 서버는 전역 키로 자동 대체하지 않는다. 따라서 **새 정책이 꺼져 있으니 기존 AI도 영향이 없다고 안내하지 않는다.** 사용 중 요청·학교 키·학교 연결·앱/서버 배포를 같은 전환 작업으로 준비해야 한다.

학교 자료 정정과 시간표 운영 보강도 기존 쓰기 보호·재공개 판단을 보강한다. T4와 K1은 기존에 켜진 모듈·권한을 이용하므로 설치만으로 자격을 갖춘 관리자의 새 경로가 준비될 수 있다. 각 패키지의 설치 영향은 목록과 runbook에 따로 기록한다. 기존 로그인·회원·확정 HWPX 엔진·공개 범위를 바꾸는 작업은 포함하지 않는다.

## 이번 단계 이후 남는 일

1. 최종 Claude 검토와 수정 결과를 확인한 뒤, 사용자가 마지막 전환 시점과 담당자·필요 자료를 확정한다.
2. 운영 기준선과 미적용 여부를 실제로 확인하고, 승인한 SQL만 순차 적용한다.
3. 서버 전용 환경·학교 키·Storage/AI 연결과 같은 판의 앱 배포를 확인한다.
4. 승인한 실제 교사와 학교 자료를 연결하고, 모듈별 활성화를 진행한다.
5. 제한된 실제 서비스 왕복 확인과 운영 결과를 별도 기록한다.

이후의 실제 사용 피드백과 개선은 위 구축·연결 작업과 구분한다. 최신 자동 검증 결과는 [verification.md](verification.md)에 기록한다.
