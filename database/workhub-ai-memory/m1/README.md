# M1 개인 AI 기억 — 비활성 설치 준비

이 패키지는 아직 운영에 적용하지 않았다. 기존 P10 모델·키·비용·게이트, P6 대화, 기존 회원 및 메뉴 공개 범위를 변경하지 않는다. 별도 학교 승인을 하기 전에는 새 기억 저장·수정·선택이 꺼져 있다.

교사가 직접 확인한 개인 응답 선호와 반복 업무 관례만 보관한다. 학교와 현재 소속으로 격리하고, 목록·변경·선택·삭제는 본인만 수행한다. 대화에서 자동으로 기억을 추출하거나 모든 AI 호출에 자동 주입하지 않는다. 화면에서 선택한 기억을 확인한 뒤 편집 가능한 질문에 참고 문구로 복사한다. 복사 이후 실제 전송은 기존 AI 확인·예산 절차를 따른다.

## 적용 보류 상태와 순서

| 순서 | 파일 | 작업 | 정상 기준 |
|---|---|---|---|
| 1 | `M1-00_사전점검_기존지문.sql` | 읽기만, 결과 저장 | P1 ok, F1~F8 비교 자료 보관 |
| 2 | `M1-01_개인기억_모델과함수.sql` | 별도 승인 뒤 비활성 설치 | 트랜잭션 성공, 재실행 금지 |
| 3 | `M1-02_사후점검.sql` | 읽기만 | 필수 10행 ok, 켜진 학교 수 info |
| 4 | M1-00 재실행 | 설치 전후 대조 | F1~F8 동일. 동시 실제 쓰기가 있었다면 원인을 확인 |
| 5 | `M1-03_개인기억_학교승인_양식.sql` | 배포·실제 왕복 확인 뒤 별도 승인 | 관리자 소속 ID, 승인 근거, true/false 세 칸 직접 입력 |

M1-01은 기존 P6 및 그 의존 단계가 설치돼 있어야 한다. M1-03은 기존 `year.manage` 권한을 가진 승인된 superadmin 관리자의 학교만 켠다. 임시로 사용자를 만들거나 권한을 늘리지 않는다. M1-03의 `false`는 저장·수정·참고 선택만 중지하며, 본인 목록·삭제·원번호 복구·닫기는 계속 가능하다. 제거 SQL은 제공하지 않는다.

M1-00은 기존 함수 정의/실행권한/소유자, 표/열/제약/트리거/권한, 회원·소속·감사, 기존 평가계획 제출, Storage 목록 행을 비교한다. Storage 파일 본문이나 외부 서비스는 비교하지 않는다. 기존 모듈별 점검을 대체하는 전체 설치 점검은 아니다.

## 계약

공개 함수 5개는 `memory.v1` 봉투를 쓴다. `{contract,schoolId,memberId,data}` 또는 `{contract,schoolId,memberId,error:{code}}`다. 기존 회원/학교 확인 단계 실패는 기존 `member_actor` 오류를 그대로 반환한다. 브라우저 API 역할은 표를 직접 읽거나 쓰지 못한다.

| RPC | 인자 | data |
|---|---|---|
| `workhub_ai_memory_list` | `p_member_id` | `{items,today,canWrite}` |
| `workhub_ai_memory_select` | `p_member_id,p_references` | `{items,today}` |
| `workhub_ai_memory_mutate` | `p_member_id,p_command,p_request_key` | 적용 접수증 |
| `workhub_ai_memory_recover` | 같은 인자 | 적용 접수증 또는 `{state:'missing'|'closed',requestKey}` |
| `workhub_ai_memory_close` | 같은 인자 | 적용 접수증 또는 `{state:'closed',requestKey}` |

`entry = {id,schoolId,memberId,version,title,body,category,enabled,expiresOn,createdAt,updatedAt}`. ID는 ASCII 영문·숫자·`_`·`-` 1~100자, 요청 번호는 8~100자다. 제목 80 / 내용 1,000 코드포인트, 공백만 입력은 거절하되 원문 앞뒤 공백은 보존한다. category는 `preference|routine`. 기억은 삭제 제외 최대 50개이며 목록은 ID ASCII 오름차순 전체를 반환한다. 페이지가 없어 숨은 다음 페이지를 오인하지 않는다. 한 번에 선택할 수 있는 기억은 1~5개다.

명령은 다음과 같으며 모든 필드를 정확히 보내야 한다.

```text
create {kind,id,title,body,category,enabled,expiresOn,confirmed:true}
update {kind,id,title,body,category,enabled,expiresOn,expectedVersion,confirmed:true}
delete {kind,id,expectedVersion,confirmed:true}
```

적용 접수증은 `{state:'applied',requestKey,kind,entryId,version}`이다. 생성 판은 1, 수정/삭제 판은 이전 판+1이다. 최대 판 2147483647에 대한 추가 변경은 `CONFLICT`다. 기한은 학교 시간대 날짜를 쓰며 기한 당일까지 유효하다. 새 생성의 과거 날짜는 거절한다. 이미 만료된 날짜를 그대로 둔 수정/중지는 가능하지만 다른 과거 날짜로 바꾸지는 못한다. 선택 참조는 `[{id,version}]`이며 요청 순서·판·활성·기한을 모두 검사하고 한 항목이라도 맞지 않으면 전체 거절한다.

## 응답 유실과 삭제 보장 범위

소속별 잠금과 요청 원장으로 같은 번호/명령을 중복 반영하지 않는다. 같은 번호에 다른 명령을 쓰면 `IDEMPOTENCY_CONFLICT`다. 복구는 현재 판·기한·학교 쓰기 중지보다 원접수증을 먼저 확인한다. 미접수 명령을 닫으면 취소 장벽이 남아 늦은 원요청도 `CONFLICT`로 거절된다. 이미 적용됐다면 닫기는 원접수증을 돌려준다. 본인 계정·승인·학교·소속 검사는 언제나 먼저다.

삭제는 현재 기억 행의 제목·본문을 NULL로 제거하고 만료일을 비우며 선택과 목록에서 제외한다. 요청 원장에는 본문이나 명령을 복제하지 않고 해시와 식별용 접수증만 남긴다. 감사에도 기억 본문은 기록하지 않는다. 삭제한 ID는 재사용하지 않아 과거 요청이 되살아날 수 없다.

이 삭제는 이미 질문에 복사된 문구, 저장된 대화, 공급자에게 전송된 내용, DB 백업까지 지우는 기능이 아니다. 사용자는 질문의 사본을 전송 전에 직접 확인/수정할 수 있다. 과거 대화 정화나 백업 즉시 삭제를 약속하지 않는다.

## 자동 시험

운영 DSN과 실제 키를 받지 않고 localhost의 새 임시 PostgreSQL 17만 시작한다. 외부 AI/Storage는 호출하지 않는다. 설치된 P10 위에 M1을 추가하고 이전 지문을 비교한다. 승인 양식은 격리 가상 자료로만 채워 시험한다.

```powershell
$env:M1_PG_BIN='PostgreSQL 17 bin 절대경로'
node scripts/verify-workhub-ai-memory.mjs
```

Linux에서는 같은 환경변수를 설정한 일반 사용자로 실행한다. `python3`에 `psycopg2`가 필요하며 Windows는 `python`을 기본으로 쓴다. `PYTHON`으로 실행기를 지정할 수 있다. 시험 포트는 `M1_TEST_PORT`(기본 55589, 49152~65535), 기록 폴더는 `WORKHUB_AI_MEMORY_REPORT`로 지정한다. 종료 시 임시 서버를 정지하며 기록은 보존한다.

시험에는 학교/회원 격리, 다른 소속 위조, 문법/버전/기한, 최대 50개 경합, 선택 원자성, 수정 경합, 원요청·닫기 경합, 삭제 실제 원문 제거, 과거 재전송, 중지 후 삭제·복구, 권한 및 보호 트리거 훼손 탐지, 실제 SQL 응답과 앱 parser 대조가 포함된다. 결과 숫자는 `test/RESULTS.md`에 기록한다. 실제 Supabase/PostgREST 왕복은 별도 남은 작업이다.
