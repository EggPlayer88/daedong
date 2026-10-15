# W14 업무 인계·새 학년도 — 증분 SQL 계약

2026-10-16 · SQL 요청서. 실제 학교나 학생 자료를 바꾸지 않았다. 원본은 `administration/transitions.ts`와 `SchoolTransitions.tsx`다.

## RPC/공통 규칙

`services/scoped-rpc.ts` 봉투 `{contract:'school-transitions.v1',schoolId,memberId,data}` 또는 범위가 같은 `error:{code}`. 모든 읽기/쓰기는 기존 승인+유효 학교 소속+공식 권한을 검사한다. 데이터 표 직접 권한을 열지 않는다.

- `workhub_school_transition_list(p_member_id,p_cursor)` → `{canManageYear,years,recipients,resources,records,nextCursor}`.
- `workhub_school_transition_preview(p_member_id,p_plan)` → `{fingerprint,expiresAt,summary,excluded,affectedCount}`. 읽기 요청이며 업무 소유권/학년도/명부를 바꾸지 않는다.
- `workhub_school_transition_mutate(p_member_id,p_command,p_request_key)` → `{requestKey,recordId,version,state,recordedAt}`. 같은 사용자·학교·키+내용은 같은 접수증. 다른 내용은 충돌. 원본변경과 감사/접수증 원자적 저장.

```ts
type Resource={kind:'duty'|'cooperation'|'collection';id:string;version:number;label:string};
type Plan =
 | {kind:'handover';recipientMemberId:string;recipientVersion:number;resources:Resource[];note:string}
 | {kind:'new_year';sourceYearId:string;targetYear:number;firstDay:string;lastDay:string;
     term1First:string;term1Last:string;term2First:string;term2Last:string;copyStructure:boolean};
type Command =
 | {kind:'apply';plan:Plan;fingerprint:string}
 | {kind:'accept'|'reject'|'cancel';recordId:string;expectedVersion:number;reason:string};
```

목록: years=`{id,label,year}[]` 100 이하; recipients=`{memberId,name,version}[]` 500 이하; resources 최대200; records 50 이하. 초과는 무음 절단하지 않고 명시적으로 범위 선택 계약이 필요하다. records=`{id,kind,title,version,state,canAccept,canCancel,summary:string[]}[]`. state=pending/accepted/rejected/cancelled/completed. pending 외에는 canAccept/canCancel 모두 false. 서버가 이름·ID·건수 모두 접근범위 안에서 반환한다. nextCursor는 기록의 안정 커서이며 개인 입력에 대한 영속 저장소가 아니다.

## 미리보기 지문

권한 있는 원본의 정규화된 plan, actor/school, 모든 resource version, recipient version, 학교관리 snapshot version, 현재 활성 학년도/날짜/구조 해시를 포함한 SHA256을 서버에서 생성한다. 확인할 요약과 복사하지 않을 항목, 영향 개수를 함께 반환한다. expiresAt은 타임존 있는 ISO 시각. 데이터변경/권한변경/만료 후 사용은 CONFLICT. 브라우저의 지문 문자열만 맞으면 통과시키지 않는다. apply 시 같은 데이터를 잠그고 미리보기 내용을 재검증한다. 동일 requestKey의 이미 확정된 결과 재조회에는 만료된 preview 때문에 재실행을 요구하지 않는다.

## 업무 인계

1. 내 현재 공식업무/내가 담당하는 협업·수합 중 인계할 자원을 고른다. note 필수2,000자 이하, 자원1~200개, 중복 종류+ID 금지.
2. 현재 같은 학교의 유효한 인수 교사와 버전을 고른다. 본인에게 인계 금지. 업무별 관리권한/책임 규칙을 검증한다.
3. preview 후 사람 확인 → apply는 **pending v1 인계 요청만** 만든다. 이 시점에 자원 소유자/열람 권한을 넘기지 않는다.
4. 받는 교사 accept 시 원본 각 판·인수자권한을 다시 확인하고 한 번에 인계한다. 바뀐 자원이 있으면 전체충돌, 부분 인계 금지. reject는 권한변경 없음. 요청자 cancel도 pending만 가능. accept/reject/cancel 접수증은 같은 recordId와 expectedVersion+1, 각각 accepted/rejected/cancelled 상태를 반환한다.
5. 수합은 담당자·공동책임자·검토자 충돌 금지 등 R1 규칙을 계속 만족해야 한다. 과거 작성자/접수증/감사 actor를 새 담당자로 소급 변경하지 않는다.

관찰·상담·개인DM·개인할일·교사 개인 문서·학생기록 초안·개인 AI 대화는 인계 대상 아님. 인계 자료의 제목/개수에 민감자료를 섞지 않는다. 업무 인계 수락이 기존 계정 승격/멤버 생성으로 이어지지 않는다.

## 새 학년도

- 학교관리 권한만. 기준학년도는 현재 학교 원본 ID. targetYear=2020~2100의 고유 학년도. 학교관리와 새 학년도 목록·생성은 `setup/assets/school-admin.json`의 `schoolYearBounds`를 공유한다. 공식 날짜6개는 사용자가 직접 입력하며 화면 기본값으로 채우지 않는다.
- 날짜 마지막 날 포함. `firstDay <= term1First <= term1Last < term2First <= term2Last <= lastDay`. 비어 있거나 겹침/역전/존재하지 않는 날짜 거부. 법정학년도와 실제등교일 혼용을 추측해 보정하지 않는다.
- copyStructure=true인 경우 부서·학년·반·교과 구조만 새 식별자로 복제한다. 반 이름이 같아도 기존 행을 덮지 않는다. 기존년도 구조·명부·학생자료·담당·일정은 수정하지 않는다. 공식담당의 기간 연장은 별도 학교관리 확인을 거친다.
- 학생 진급·반배정·전출/전입·관찰/평가/상담 복사는 자동화하지 않는다. 개인메시지/AI 대화/수합제출/파일도 복사하지 않는다.
- apply 결과는 completed v1. 새 학년도와 기본 구조 생성은 한 트랜잭션. 기존 학년도 강제 종료나 기본 선택년도 변경 없이 학교관리 목록에서 확인하게 한다.

## 수용 시험

개인자료가 인계 preview에도 없음, 인수 전 열람권한 없음, 다른학교/비활성인수자/책임충돌, 인계원본 변경 후 accept 충돌, 이미 수락/취소된 요청 재처리, preview 변조/만료/권한변경, 날짜경계·윤년·중복학년도, 생성중실패 원복, 같은키 재전송 한학년도만 생성, 이전년도/학생/계정 fingerprint 불변을 시험한다. 실제응답을 앱parser에 대조하고 수락 전후 권한을 복수계정으로 나중에 확인한다.

## 화면 재검증과 중복 처리 방지

- 회원 역할·유효기간·공식 관계가 바뀌면 화면 상태를 기존 범위와 격리한다. 대상 조회 실패 시 인계 원문·미리보기를 숨기고 입력과 요청 번호를 보존한다. 재연결 버튼으로 확인 후 복구한다.
- 현재 대상·원본 판이 달라지면 이전 미리보기와 최종 확인은 무효화한다. 적용 직전 SQL의 fingerprint·각 원본 판·인수자 권한 검증은 여전히 필수다.
- 응답 미확정 뒤 편집 기억이 없어져도 공통 pending의 동일 command/key를 복원한다. 반복 클릭과 결과 조회는 새 인계가 아니며, SQL 역시 동일 key 한 번 적용과 accept 원자성을 보장해야 한다.
- 브라우저 `tests/browser/workhub-school-transitions.mjs` 9건과 단위 `tests/test_workhub_school_transitions.mjs` 10건 통과. 합성 서버 결과를 사용하므로 실제 DB 동시성 시험과 구별한다.
