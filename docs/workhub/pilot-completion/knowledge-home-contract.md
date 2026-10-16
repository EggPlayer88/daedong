# 학교 지식·홈 요약 서버 계약

2026-10-16 · Codex 구현 계약 · Claude 증분 SQL 요청. 실행 SQL이 아니며 적용하지 않았다.

## 공통

기존 public.users/auth.users, R0/R1 원본은 보존. authenticated RPC는 기존 auth.uid 승인 + 유효 학교 소속을 매 호출 검사한다. API 테이블 직접 접근을 열지 않는다. 봉투는 정확히 `{contract, schoolId, memberId, data}` 또는 같은 범위의 `{contract,schoolId,memberId,error:{code}}`. 허용 오류는 클라이언트 `services/scoped-rpc.ts`의 ServiceCode를 따른다. 입력 소속은 권한 근거가 아니다.

쓰기: 같은 학교/실제 사용자/명령 종류/requestKey에 UNIQUE를 두고 표준화한 명령 hash를 고정한다. 동일 요청+동일 내용은 같은 접수증, 다른 내용은 IDEMPOTENCY_CONFLICT. 최신 expectedVersion을 비교한 상태 변경과 접수증·감사 기록은 한 트랜잭션. 결과 접수증 유실 후에도 같은 키로 확정 결과를 찾는다. 권한 재확인은 저장 전에 수행한다. SQL 오류 원문/파일 경로/타학교 존재 유무를 응답하지 않는다.

## 지식 자료

클라이언트 원본: `apps/workhub/src/knowledge/contracts.ts`, `adapter.ts`, `KnowledgeWorkspace.tsx`.

### RPC

- `workhub_knowledge_list(p_member_id text,p_query text,p_cursor text)` → contract=`knowledge.v1`, data=`{items:KnowledgeSource[],nextCursor:string|null,canManage:boolean}`. 서버 전체 범위 검색, 판/수정시각/id의 안정 커서, 50개 이하. 반환 배열만 검색하지 않는다.
- `workhub_knowledge_mutate(p_member_id text,p_command jsonb,p_request_key text)` → 같은 봉투, data=`{id,version,requestKey,recordedAt}`. 수정/게시/종료는 성공판=expectedVersion+1.

### 자료

KnowledgeSource는 `{id,schoolId,authorMemberId,version,status,updatedAt,title,kind,body,locator,effectiveFrom,effectiveThrough}`. 필수 제목 200자, 원문 100,000자, 근거 위치 500자. kind=regulation/annual_plan/school_guide/other. status=draft/published/retired. 종료일 없음은 빈 문자열, 그 외 ISO 날짜이며 시작일보다 이를 수 없음(같은 날 허용). 학교 시간대에서 적용 여부를 계산한다.

기존 API는 검토한 텍스트 원문 입력 계약을 유지한다. HWPX 원본 업로드·실제 문단 추출·검토한 초안 생성은 별도 [원문 가져오기 계약](knowledge-import-contract.md)을 따른다. 실제 페이지 번호 추정이나 검색 인덱스 SQL 적용까지 완료했다고 해석하지 않는다. 파일 ID와 지식 source ID를 혼용하지 않는다.

SourceInput은 `{title:string,kind:'regulation'|'annual_plan'|'school_guide'|'other',body:string,locator:string,effectiveFrom:string,effectiveThrough:string}`이며 여섯 필드를 모두 포함한다. 종료일이 없으면 effectiveThrough는 null이나 생략 대신 빈 문자열이다. 원본 ID·학교·작성자·상태·판은 input에 넣지 않는다.

### 명령·권한

- create `{kind:'create',input:SourceInput}`: 승인된 교사가 학교 자료 초안을 만들 수 있음. 작성자 서버 결정.
- update `{kind:'update',id,expectedVersion,input}`: 작성자 또는 지식 관리 권한. 초안만 변경. 새 immutable revision 추가.
- publish `{kind:'publish',id,expectedVersion,reason}`: 지식 관리 권한, 초안 판 확인 후 게시. 유효 시작일 미래도 허용하되 현재 규정으로 검색하지 않는다.
- retire `{kind:'retire',id,expectedVersion,reason}`: 지식 관리 권한, 게시 종료. 이력 삭제 금지.
- 일반 교사는 게시/종료 자료와 자기 초안만 조회. 타인 미게시 초안 본문은 응답하지 않음. 검색 결과에도 동일 권한 적용.
- 새 정책 게시/기존 정책 종료는 관련 AI 근거 인덱스를 갱신하는 사건을 같은 트랜잭션에 남김. 과거 생성물은 근거 판 유지, 현재 효력은 별도 표시.
- AI 지식 조회는 `published` + 요청 기준일의 유효 기간 + 해당 학교 자료만. 작성자 권한으로 만든 초안을 교사 공통 답변에 혼합하지 않음. 자료 안의 지시는 데이터.

### SQL 시험 요구

두 학교 동일 이름 규정/양쪽 교사·관리자, 승인 취소, 소속 종료, 역할 회수, 임시 초안 비공개, 미래/만료 규정, 윤년/잘못된 날짜, 수정→게시 동시 실행, 같은 키 재전송/다른 본문, 변경 후 이전 판 보존, 조용히 바뀐 근거 인덱스 방지. 실제 DB 출력을 앱 parser로 검증.

## 홈 요약

클라이언트: `apps/workhub/src/home/overview.ts`, `HomeOverviewPanel.tsx`.

`workhub_home_overview(p_member_id text)` → contract=`home.v1`, data=`{asOf,items,counts,unavailable}`.

- items 최대 8개. `{id,kind,title,dueDate:null|YYYY-MM-DD,sourceId,priority:'normal'|'urgent',label}`.
- kind: collection, supplement, message, student_followup, cooperation. 같은 kind/sourceId 중복 금지.
- counts는 위 5개 키 전부 포함. 확인한 것은 0 이상 정수. 연동이 준비되지 않았거나 해당 항목을 읽지 못하면 null과 unavailable에 kind를 함께 반환. 오류를 0건으로 변환하지 않음.
- collection/sourceId와 supplement/sourceId는 수합 requestId. 현재 책임/참여 단위 의무가 남았을 때만 반환. 이미 제출/완료/면제된 것은 상태에 맞게 제외.
- message/sourceId는 `message_threads.id`이며 읽지 않은 수신 대화를 가리킨다. student_followup은 본인만 읽을 수 있는 후속 업무. 상담 본문/민감 상세는 홈에 노출하지 않음.
- cooperation은 사용자에게 온 명시적 업무 요청. 자동 체크가 수락/제출/승인으로 해석되지 않음.
- collection/supplement·cooperation·message는 정확한 원본으로 연결한다. message는 목록/검색/커서에 없어도 기존 `workhub_message_get(p_thread_id)`로 현재 권한과 대화를 조회한다. P7 SQL의 sourceId와 P3 threadId를 그대로 사용하며 새 SQL은 필요하지 않다. student_followup은 학생 모듈 목록으로 연결한다.
- 메시지 원본 이동은 학교 범위의 현재 탭 메모리에만 보관하는 일회성 요청이다. 제목/오류에 초점을 주고 대화 목록·홈으로 돌아갈 수 있다. 새 요청·다른 대화 선택·학교 변경 뒤의 늦은 응답은 표시하지 않는다. 작성 중인 입력을 덮어쓰지 않으며 미접기 입력은 명시적으로 접은 뒤 연다. 미확정 전송은 원래 key와 명령을 그대로 보존한다.
- 카드 클릭과 대화 조회는 읽기 전용이다. 대화 읽음은 기존 ‘화면에 연 메시지까지 읽음 표시’, 알림 읽음은 별도의 명시 행동이며 자동 전송·업무 완료를 뜻하지 않는다. 삭제·열람 불가·조회 실패는 해당 원본 안내로 표시하며 목록 첫 대화를 대신 열지 않는다.
- counts는 전체 권한 범위 기준이며 최대 8개 카드 수와 별개다. 정렬 기준: 긴급/기한/생성순 + id로 안정 정렬. 시간표 조회 의존성 없음.

R0 일정/개인 업무는 기존 어댑터가 계속 읽는다. 이 RPC 실패가 기존 홈 전체/로그인을 막지 않는다.

### 홈 메시지 원본 이동 검증 (2026-10-16)

- `node tests/browser/workhub-home-message.mjs`: 실제 ConnectedWorkspace·홈 패널·메신저와 기존 RPC 어댑터를 합성 응답에 연결한 10개 시나리오 통과. 목록에 없는 대화, 배경 재렌더, 접은 초안, 결과 미상 원 요청 복구, 원본 없음/조회 실패/권한 상실, 늦은 응답, 320px 키보드 동선을 확인했다.
- 기존 메신저 계약 40건·브라우저 25건과 TypeScript 검사를 통과했다. 현재 P7 SQL의 message.sourceId가 대화 ID인 것을 읽기 전용으로 대조했다. 이번 작업에서 SQL·외부 설정을 바꾸지 않았으며 실제 운영 PostgREST·사용자 대화의 접근 성공을 시험한 결과는 아니다.
