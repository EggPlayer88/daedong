# W05 수합 운영 — 증분 SQL 계약

2026-10-16 · 실행 SQL이 아니다. R1S 원본은 변경하지 않았으며, Claude가 기존 R1/R1S와 함께 강제 규칙을 검증한 뒤 확정한다.

## 구현 범위

담당자 접수 마감/재개, 기한 변경, 비파괴 보관, 실제 미제출·보완 단위 선택 알림. 선택한 원본 판과 사유를 보여 준 뒤 확인한다. 충돌 시 최신 상태를 읽되 내 입력과 원래 판은 유지하며 다시 확인해야 새 명령을 만든다. 응답 유실은 원래 requestKey+command로 재확인한다. 읽음은 제출/검토 완료로 바뀌지 않는다.

새 기능은 `collections/operations.ts`, `CollectionOperations.tsx`가 원본이다. 파일 전송·HWPX 최소확인·수합 저장은 기존 R1S 경로, ZIP은 기존 PR #35 경로를 유지한다.

## RPC

공통 `services/scoped-rpc.ts` 봉투 `{contract:'collection-operations.v1',schoolId,memberId,data}`. 업무 오류는 data 대신 `error:{code}`. 두 키를 동시에 보내지 않는다. 사용자 identity와 현재 학교는 서버에서 도출한다.

- `workhub_collection_operations_get(p_member_id text,p_request_id text)` → 아래 State
- `workhub_collection_operations_mutate(p_member_id text,p_command jsonb,p_request_key text)` → `{requestKey,requestId,version,recordedAt}`. 성공 version=expectedVersion+1. 저장·원장·사이트 알림·감사 사건 원자적 처리.

```ts
type State = {
 requestId:string;version:number;phase:'open'|'closed'|'archived';dueDate:string;canManage:boolean;
 totals:{total:number;missing:number;submitted:number;accepted:number;changesRequested:number};
 units:{id:string;label:string;responsibleMemberId:string;version:number;
   state:'missing'|'submitted'|'accepted'|'changes_requested'}[];
};
```

관리자는 권한 있는 전체 제출 단위(최대2,000)와 합계를 받는다. 비관리자는 `units:[]`이고 합계 공개 범위는 담당자의 설정/역할 권한으로 판단한다. 보이지 않는 학생/타학교 이름이나 단위는 합계로도 유출하지 않는다. 2,000개 초과는 잘라 정상처럼 응답하지 말고 명시적인 조회 제한 오류/후속 계약을 사용한다. total은 네 상태 합이고 관리자 units 상태별 건수와도 일치해야 한다. 학교 날짜는 현재 R1 시간대 규칙을 따른다.

```ts
type Command =
 | {kind:'close'|'archive';requestId:string;expectedVersion:number;reason:string}
 | {kind:'reopen'|'extend';requestId:string;expectedVersion:number;reason:string;dueDate:string}
 | {kind:'remind';requestId:string;expectedVersion:number;reason:string;
     recipients:{unitId:string;memberId:string;expectedVersion:number}[]};
```

사유 1~1,000자. 알림 대상1~500단위, 중복 단위 금지. 담당 교사 ID는 현재 원본 책임자와 일치해야 하며 같은 학교·유효 소속·미제출 또는 보완 상태만 허용한다. 처리 전에 이미 제출/보완완료한 단위가 있으면 부분 전송하지 말고 전체 CONFLICT. `reason`은 알림본문이며 외부 SMS/이메일 전송을 만들지 않는다. 한 사람이 여러 단위 담당일 때 단위별 원본 링크를 유지하되 동일 명령 재시도로 중복 알림을 만들지 않는다.

## 상태와 기존 R1 결합

- R1의 `request.status=draft/published`를 바꾸지 않는다. 게시된 수합에 별도 운영판을 둔다.
- open → close → closed. open에서 extend/remind. closed → reopen/open 또는 archive/archived. archived → reopen/open. 최신 상태에서 불가능한 명령은 거부한다.
- 새 기한은 학교 현재일 이상이며 기존 전체기한/개별정정기한 상호작용을 명시한다. 기한이 과거여도 phase를 자동으로 open/closed 변경하지 않는다. 날짜에 따른 제출 차단은 기존 규칙과 함께 적용한다.
- **UI만 마감하는 SQL은 불합격**. phase 검사와 실제 저장을 같은 트랜잭션/잠금에서 수행해야 한다. 기존 수합 `prepare/complete/save_draft/submit` 및 질문형 생성본 제출도 우회하지 못하게 한다. 이미 접수된 동일 멱등 명령의 결과 재조회는 계속 가능하다.
- closed/archived 새 제출은 차단. 기존 양식·제출·완료본 읽기와 서명 내려받기/ZIP은 현재 권한을 확인하며 유지한다. 담당자 검토·보완요청·철회·정정의 허용 조합은 명시적으로 시험한다. 자동으로 자료를 삭제하지 않는다.
- `dueDate` 단일 원본과 R1 detail/홈/알림에 보이는 값이 같아야 한다. 원장만 바꾸고 원 수합 기한은 놔두는 구현은 금지한다.

## 수용 시험

두 학교/타교사 담당자 사칭, 승인취소, 역할·단위 책임자 변경, 마감과 동시 제출/파일확정, 접수 후 응답단절 재전송, 같은 키 다른 명령, 미제출선택 후 이미 제출됨, 알림 읽음/제출 독립, 마감 뒤 이전 PDF/HWPX 내려받기, 보관 후 원본/해시 불변, 직접 R1 RPC 우회 거부를 포함한다. 앱 parse 함수에 실제 응답을 넣어 대조한다.

## 화면 재검증과 입력 보존

- 운영 상태 callback은 검증된 조회 성공 때만 갱신한다. 일시 조회 실패를 open으로 해석하지 않는다. 상위 수합 화면은 마지막 확인한 closed/archived를 유지해 새 파일·초안 저장·최종 제출을 잠그며, 기존 내려받기와 원래 요청의 결과 확인은 유지한다. 서버 phase 강제 검증을 대체하는 규칙이 아니다.
- 책임 교사·제출단위 판·상태가 바뀌면 최종 확인 체크를 해제한다. 새 조회 상태에서 허용되지 않는 기존 명령은 제출하지 못한다.
- 결과 미확정 명령은 회원·학교·권한 범위의 공통 pending에 입력과 원래 key를 함께 보관한다. 편집 기억이 없어도 이 명령으로 복구하며 새 번호로 바꾸지 않는다.
- 브라우저 `tests/browser/workhub-collection-operations.mjs`: 재조회 실패의 closed 유지, 책임교사 변경 재확인, phase 변경 잠금, 편집 기억 없는 원요청 복구 포함 10건 통과. 실제 DB의 원자적 상태 전이·알림 중복 방지는 SQL 시험에서 별도로 증명한다.
