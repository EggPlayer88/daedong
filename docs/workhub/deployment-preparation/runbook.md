# 미적용 SQL·앱의 마지막 전환 준비

2026-10-21 · PR #77. 이 문서는 **준비용**이다. 지금 운영 SQL을 실행하거나, 실제 회원을 연결하거나, 기능을 켜거나, PR을 병합하라는 지시가 아니다. 사용자는 실제 DB 적용·회원 연결·최종 Claude 검토를 마지막으로 미뤘다. 이번 작업은 소스·격리 DB·합성 응답·CI만 확인한다.

파일별 적용 종류·의존성·해시는 [sql-inventory.json](sql-inventory.json)을 기준으로 한다. 같은 `P10` 이름이라도 `database/workhub-school-data/p10/`은 학교 자료 정정, `database/workhub-ai-policy/p10/`은 AI 비용·학교 키이므로 전체 경로로 구별한다.

## 1. 준비 완료와 운영 완료를 구분한다

| 증거 | 확인할 수 있는 것 | 확인할 수 없는 것 |
|---|---|---|
| 전체 단위 시험·타입·빌드 | 저장소 코드의 계약·컴파일·회귀 | 운영 설정과 실제 회원 연결 |
| 격리 PostgreSQL 17 통합 설치·훼손 시험 | 이 SQL 조합의 설치 순서·권한·보존·점검 탐지 | 실제 운영 DB가 같은 기준선인지 |
| 실제 SQL 응답 → 앱 검증 | 응답 필드·원번호·학교 범위 계약 | 실제 PostgREST·JWT·Storage 왕복 |
| 합성 브라우저 시험 | 실제 React와 전송 어댑터의 화면·입력·복구 | 실제 공급자 품질·지연·청구 |
| Vercel 미리보기 성공 | 해당 커밋의 미리보기 배포 성공 | Production 배포, 서버 비밀 설정, Python 함수의 실제 정상 처리 |
| 나중에 모을 운영 증거 | 지정한 배포·학교·계정의 실제 왕복 | 다른 학교·다른 권한의 무조건적인 성공 |

이전 대화·인계 기록의 운영 기준은 T2 계열이며 P1·P5·T1이 켜졌다고 보고되었다. 이는 **이번 작업에서 운영 DB를 조회해 다시 확인한 값이 아니다**. 이전 기록의 파일별 적용 이력과 나중 기준선 결과가 다르면 그 차이를 먼저 해결한다. 설치 여부를 추정해 기존 SQL을 재실행하지 않는다.

## 2. 배포에 포함되어야 하는 서버

배포 대상은 `apps/main`이다. `apps/main/vercel.json`과 실제 앱 어댑터가 아래 경로를 사용한다. 업무실을 별도 사이트로 배포하거나 다른 origin의 OAuth 설정을 새로 만들지 않는다.

| 경로 | 서버와 포함 파일 | 연결 전 확인 |
|---|---|---|
| `/api/doc-ai/chat` | Node, `api/_ai-policy/`, 평가계획·AI 공통 자산, `src/lib/planMarker.js` | 기존 승인 게이트 뒤 학교 공통 AI 원장 사용. 구 전역 키로 대체하지 않음 |
| `/api/doc-ai/generate`, `/api/doc-ai/extract` | Python, 기존 확정 HWPX 엔진·양식·관련 자산 | 확정 엔진/양식 원문 보존, `lxml` import와 기존 파일 처리 |
| `/api/collections/check-hwpx` | Python, `api/collections/**` | HWPX 기본 검사 프로필·Storage 원파일·해시·크기·원번호 |
| `/api/messages/check-hwpx` | Python, `api/messages/**`와 공통 collections 코드 | 메시지 첨부 소유·참여자와 기본 확인 계약 |
| `/api/workhub-documents/guided` | Python, `api/workhub-documents/**`와 공통 collections 코드 | 저장된 양식·답변의 원본 ID/판/해시, 명시 생성·첨부·제출 분리 |
| `/api/workhub-documents/extract-knowledge` | 같은 Python 묶음 | 학교 자료 HWPX 원문·추출판·다운로드 접근 |
| `/api/workhub-ai/chat` | Python, `api/workhub-ai/**`와 공통 collections 코드 | 학교 키·정책·예산·한 번의 실행권·정산 |
| `/api/workhub-ai/settings` | 같은 Python 묶음 | 관리자 키 저장·마스킹·원번호 복구, 평문 재출력 없음 |
| `/api/workhub-ai/operations` | 같은 Python 묶음 | 관리자 비용 조회·준비 진단. 진단만으로 공급자를 호출하지 않음 |
| 학교 자료·시간표·K1·M1 조회/명령 | 브라우저의 기존 Supabase RPC 연결 | 해당 SQL과 정확한 인자·응답 계약. 별도 AI 서버가 대신 권한을 부여하지 않음 |

위 Vercel 함수 설정은 모두 `maxDuration: 60`이며, 내부 처리 제한은 각 서버 코드가 더 짧게 적용한다. 이 값은 실제 함수 제한·대기 시간·요금제 적용을 증명하지 않는다. 실제 Production 함수 런타임과 제한은 마지막 배포 단계에서 확인한다. CI는 Node 22·Python 3.12로 검사한다. 저장소에는 Production 런타임 버전을 고정하는 `apps/main/.python-version`이나 Node engines 값이 없으므로 CI 버전과 운영 버전이 같다고 단정하지 않는다.

Python 의존성은 `apps/main/requirements.txt`의 `lxml`과 `cryptography`를 함께 포함해야 한다. 현재 업무실 AI 진입점 `chat.py`는 `_school_policy.execute`를 사용한다. 과거 `_assistant.py`에 남은 전역 키 보조 구현이 새 배포의 대체 실행 경로라고 해석하지 않는다.

## 3. 환경값 준비 — 이름만 기록

이 문서에는 실제 값·키·토큰·회원 UID를 넣지 않는다. 이번 작업은 로컬 환경 파일이나 운영 환경변수의 비밀 값을 읽지 않았다.

| 환경변수 이름 | 범위·검사 |
|---|---|
| `VITE_SUPABASE_URL` | 브라우저와 Node가 사용하는 기존 프로젝트 URL. 의도한 기존 프로젝트와 비교 |
| `VITE_SUPABASE_ANON_KEY` | 기존 공개 클라이언트 키. 기존 로그인·승인 조회에도 필요 |
| `SUPABASE_URL` | Python 서버가 우선 사용하는 선택적 URL. 함께 설정했다면 `VITE_SUPABASE_URL`과 같은 프로젝트여야 함 |
| `SUPABASE_SERVICE_ROLE_KEY` | Production 서버 전용. `VITE_` 이름이나 번들·로그·지원 파일에 넣지 않음 |
| `WORKHUB_AI_KEY_ENCRYPTION_KEYS` | 서버 전용 마스터 키 ID → base64 32바이트 키 목록. 백업·회전·접근 담당을 정함 |
| `WORKHUB_AI_ACTIVE_KEY_ID` | 새 학교 키 암호문에 사용할 키 ID. 위 목록에 존재해야 함 |

학교별 Anthropic 키는 마지막 단계의 학교 관리자 화면에서 등록하며 DB에는 암호문과 마스킹 값만 보관한다. 새 코드에는 `ANTHROPIC_API_KEY`/`ANTHROPIC_MODEL`로 학교 키·모델 정책을 우회하는 자동 대체 경로가 없다. 기존 전역 환경값의 정리 역시 별도 외부 설정 작업이다.

승인된 Haiku 기본·Sonnet 정밀 검토·학교별 월 USD 100 설정을 다시 정하지 않는다. 다만 마지막 실제 연결 시점에는 승인된 모델 자산과 SQL 정책의 일치, 그 학교 API 계정의 모델 사용 가능 여부를 확인해야 한다. 이것은 이번 비연결 자동 시험으로 확인되지 않는다.

## 4. 마지막 전환 때의 순서

이번 준비를 재현하는 명령은 다음과 같다. 격리 시험은 운영 접속 문자열을 받지 않고 PostgreSQL 17 실행 파일로 새 localhost 시험 DB를 만든다. `--integration-only`는 CI에서 다른 패키지 회귀와 중복하지 않고 한 DB의 통합 설치만 추가할 때 사용한다.

```text
npm run check:workhub:deployment
node scripts/check-workhub-sql-package.mjs
npm run test:workhub:deployment
node scripts/verify-workhub-deployment.mjs --integration-only
npm run prepare:workhub:deployment
```

앞의 두 명령은 같은 신규 SQL 목록 검증이다. 기존 `scripts/check-workhub-deployment.mjs`는 실제 공개 배포를 읽는 별도 감사 도구이며 이번 준비에서는 실행하지 않는다.

격리 실행의 환경변수는 `WORKHUB_DEPLOYMENT_PG_BIN`(PG17 bin), `WORKHUB_DEPLOYMENT_REPORT`(시험 기록 폴더), `WORKHUB_DEPLOYMENT_TEST_PORT`(기본 55609)다. 검토 묶음 내보내기는 기본으로 새 임시 폴더를 만들며 `--output-parent`로 기존 상위 폴더를 지정할 수 있다. **내보내기 도구는 SQL을 적용하거나 사용자 입력 칸을 채우지 않는다.** 실제 시험 결과와 생성 파일 목록을 함께 확인한다.

| 순서 | 누가·할 일 | 통과 기준과 멈출 기준 |
|---|---|---|
| A. 이번 준비 | Codex: 파일 목록·해시·의존성, 격리 통합 시험·기존 회귀·배포 구성 점검 | 실패·미설명 경고·누락 파일이 있으면 준비 완료로 표시하지 않음 |
| B. 마지막 검토 | 사용자: 최종 Claude 검토 및 수정 결과 확인, 전환 시간·영향 교사 범위 결정 | 실제 회원 연결을 미루는 동안 기존 평가계획 AI를 유지할지/잠시 멈출지 명시 |
| C. 운영 기준선 | 승인 후 사용자와 Codex: 현재 적용 단계·파일별 기록·기존 점검·지문을 읽기 전용으로 저장 | 이미 적용된 단계는 재실행하지 않음. 현재 전체 상태와 맞지 않는 옛 점검 FAIL을 임의로 무시하지 않음 |
| D. SQL 설치 | 사용자: inventory의 설치 단계만 승인한 순서로 실행. 매 단계 사후 점검과 이전 자료 대조 | 활성화·회원 연결·비용 확인 양식을 설치 묶음에 섞지 않음. 예상 함수 지문/권한이 다르면 중단 |
| E. 앱·서버 같은 판 배포 | 사용자 병합/배포, Codex 결과 확인. 브라우저·Node·Python·자산을 같은 커밋으로 준비 | Production 커밋과 함수 포함 파일, 서버 환경 범위 확인. 옛 탭은 갱신 |
| F. 실제 연결·승인 | 사용자 확정 UID·학교 자료·학교 키, 필요한 모듈별 별도 승인 | 가상 자료를 실제 회원으로 이관하지 않음. 이름·이메일 추정 매칭 금지 |
| G. 제한된 실왕복 | 승인된 관리자·시범 명단만 실제 RPC/Storage/공급자 확인, 증거 보관 | 불확실한 결과는 원번호 복구. 다음 단계로 넘어가려고 새 번호·재호출로 덮지 않음 |

순서 D와 E는 승인된 하나의 전환 시간 안에서 조율한다. **AI 정책 P10-02는 설치만으로 기존 P6 직접 prepare/start 경로를 차단한다.** 기존 시작 요청의 finish 경로는 보존하지만 “학교 정책이 꺼져 있으니 설치 영향이 없다”는 설명은 틀리다. 새 평가계획 서버도 학교 연결·정책·키가 없으면 준비되지 않은 것으로 중단한다. 기존 실제 회원 연결을 끝까지 미룬 채 이 PR만 먼저 운영 배포하면 기존 평가계획 AI 이용이 중단될 수 있다.

따라서 기존 AI를 계속 제공해야 한다면 전환 전까지 새 앱/AI SQL을 먼저 운영에 배포하지 않는다. 전환 때에는 시작·미상 요청을 확인하고, 필요한 명시 학교 매핑·키·정책·동일판 배포를 함께 마무리한다. 기존 HWPX 생성 엔진과 일반 로그인 보존은 AI 호출의 계속 사용 가능성을 뜻하지 않는다.

## 5. 모듈별 켜기 조건

아래 파일은 **승인 양식**이며 자동 설치 순서에 넣지 않는다. 실제 미설치/기설치 여부와 현재 활성화는 마지막 기준선에서 다시 확인한다.

| 기능 | 필요한 별도 조건·양식 |
|---|---|
| 기존 교사의 업무실 소속 | `school-data/p9/P9-03` 승인 명단과 실제 UID·재직 기간. 일반 교사 메뉴 공개 확대와는 별개 |
| 학교 자료 정정 | `school-data/p10/P10-03`, 수업 모듈·관리 권한·앱 배포 근거 |
| 시간표 운영·시범 확장 | T2-08 및 T3-05의 실제 시범 명단·서로 다른 승인 담당 계정 2명·배포 근거. T2-02 알림 출처의 파일별 적용 여부도 확인 |
| 실제 시간표 가져오기 | T4 설치·앱 배포 후 기존 T1 관리자 권한으로 가능. 독립된 T4 활성화가 없으므로 “설치만으로 모든 기능은 꺼짐”이라고 설명하지 않음 |
| HWPX 수합 | R1S-04의 배포 확인·학교 정책. 검사 API·서버 키 준비 확인 후 제한된 실제 파일 왕복. R1-05 독립 검사기 연결은 계속 보류 |
| 메시지 첨부 | 메시지 모듈과 P3-05의 파일 한도·배포 확인. 실제 첨부 왕복은 승인 후 두 시범 계정으로 수행 |
| 학교 자료·문서함·질문형 수합 | P4 계열의 모듈 승인·원본 접근·Python 생성/추출 경로·private Storage. K1은 별도 활성화 없이 기존 knowledge 활성 상태를 따름 |
| AI 비서·평가계획 | AI P10-05 정책, 학교 키, P10-06 실제 평가계획 회원의 명시 학교 연결, P10-07 공통 제어. 업무실 assistant의 기존 P6 활성화는 별개 |
| 개인 AI 기억 | M1-03 학교 승인. 새 생성·수정·선택은 켜기 필요; 본인 목록·삭제·원번호 복구·닫기는 중지 뒤에도 유지 |

기존 협업·홈·인계 등의 P7/P8 활성화도 현재 상태와 승인 근거를 확인한 뒤 각각 진행한다. `app_deploy_ref`와 `verification_ref`는 사람이 확인해 남기는 기록이지 서버가 배포를 자동 증명하는 값이 아니다. 화면 메뉴를 숨기는 것만으로 서버의 시범 자격 검사를 대신하지 않는다.

## 6. 중지와 되돌림

- 원인 불명 응답은 결과를 모르는 요청으로 보존한다. 같은 원문·같은 번호로 접수 결과 또는 닫힘을 확인한다.
- 기능 중지는 해당 패키지의 비파괴 중지/제어 양식으로 한다. 학교 자료 정정은 P10-80, HWPX 수합은 R1S-80, 메시지 첨부 등 모듈은 기존 P2-80, AI 공통 정책은 AI P10-07의 false, 개인 기억은 M1-03의 false를 따른다. 각 패키지의 현재 소속·권한·복구 조건을 먼저 확인한다.
- 적용된 시간표·메시지·제출·비용 원장·접수증을 삭제하거나, 이전 설치 SQL로 덮어쓰지 않는다. 설치 원복이 필요하면 의존 이력을 확인한 별도 증분을 검토한다.
- AI 앱만 구버전으로 돌려 전역 키로 호출하게 하면 새 학교 비용 원장을 우회할 수 있다. 새 호출을 중지한 채 앱·SQL·원장·실행 중 요청을 함께 판단한다.
- 이미 질문에 복사하거나 전송한 개인 기억, 기존 대화, 외부 공급자 입력, DB 백업은 M1 기억 삭제만으로 제거되지 않는다.

## 7. 마지막 단계에서 채울 증거표

지금 아래 칸은 미확인 상태로 둔다. 비밀 값·학생 원문·교사 이메일은 기록하지 않는다. 운영 SQL 결과나 진단 파일을 공유할 때도 필요한 상태·건수·지문·커밋만 남긴다.

| 증거 | 기록할 내용 | 현재 |
|---|---|---|
| 검토 대상 | 앱 커밋, SQL inventory 버전·해시, CI URL | 작업 결과에 기록 |
| 운영 기준선 | 프로젝트 일치, 적용 파일 목록, 점검 결과·확인 시각 | 미실행 |
| 자료 보존 | 회원·제출·Storage 목록 등 전후 지문과 차이 사유 | 운영 미확인 |
| Production | 실제 배포 ID·커밋·함수 목록·runtime·성공 시각 | 미확인 |
| 서버 설정 | 필요한 환경변수 존재·범위·프로젝트 일치, 비밀 원문 제외 | 미확인 |
| 연결·승인 | 승인된 UID 명단의 보관 위치, 실제 담당·기간·독립 승인자, 양식 해시·승인 근거 | 보류 |
| 파일 왕복 | 업로드→complete→기본 확인→본인/허용 참여자 다운로드, 권한 없는 접근 거부 | 미확인 |
| AI 왕복 | 선택 모델·예약·1회 호출·정산·미상 복구, 공급자 사용량 대조 | 미확인·실제 호출 0 |
| 기억 왕복 | 본인 CRUD·선택·삭제·다른 소속 거부, 이미 복사한 질문과 삭제 범위 구분 | 운영 미확인 |

## 8. 사용자 결정이 남은 것

1. 마지막 검토·운영 SQL·병합/배포·모듈 활성화 시점과 전환 시간 동안 기존 AI의 사용 방식.
2. 승인할 실제 회원 UID·학교 소속 기간·실제 학교 자료·시범 명단·독립 승인 담당자.
3. 학교 API 키 및 암호화 마스터 키의 등록·보관·백업·교체 담당.
4. 결과 미상 비용을 확인할 담당자·주기, 공급자 명세 대조·장기 보관/삭제 정책.
5. 기존 양식에 아직 빈칸인 파일 크기·개수 등 학교별 운영 정책. 코드의 기술 상한과 사용자가 정하는 정책을 구분한다.

모델 배정·학교별 키·월 USD 100은 이미 승인되었다. 이번 준비를 이유로 다시 바꾸거나 실제 키를 요청하지 않는다. 외부 교사 수업 사이트 연동, 독립 검사기 서버, 자동 정리·운영 예약 작업은 계속 이번 범위에서 제외한다.

## 근거 파일

- `apps/main/vercel.json`, `apps/main/requirements.txt`, `.github/workflows/test.yml`
- `apps/main/api/doc-ai/chat.js`, `apps/main/api/_ai-policy/gateway.mjs`
- `apps/main/api/workhub-ai/chat.py`, `_school_policy.py`, `_school_settings.py`, `_school_operations.py`
- `apps/main/api/collections/_hwpx_basic.py`, `apps/workhub/src/documents/guided-adapter.ts`
- `database/workhub-ai-policy/p10/README.md`, `database/workhub-school-data/integration/README.md`
- `database/workhub-school-data/p10/README.md`, `database/workhub-timetable/t3/README.md`
- `database/workhub/r1s/R1S-04_학교활성화_양식.sql`, `database/workhub/p3/P3-05_첨부활성화_양식.sql`
- `database/workhub-knowledge-history/k1/README.md`, `database/workhub-ai-memory/m1/README.md`
