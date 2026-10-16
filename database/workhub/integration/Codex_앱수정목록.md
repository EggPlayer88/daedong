# Codex 에게 넘기는 앱 수정 목록 (통합 검토 5번 · 1번)

2026-10-16 · Claude Code. **검토 기준 앱: PR #59 `5799809`**(#48 `5f3d40f` 의 후속, 브랜치 `fix/workhub-pilot-contracts`). SQL 기준: 이 PR(통합 브랜치)의 각 단계 파일.
처음 판은 #48 기준이었고, #59 에서 C2 · C3 가 해결되어 아래 표의 상태 열을 바꿨습니다(재검토 근거는 `재검토_PR59.md`).
앱 수정은 Codex 브랜치에서, SQL 수정은 Claude 브랜치에서 합니다. Claude 는 Codex 브랜치를 고치지 않습니다.
재현은 모두 이 저장소의 시험(`database/workhub/*/test`)에서 실제로 나온 응답 · 입력입니다. 통합 회귀(`integration/test/run_integration.sh`)의 VI 구간이 같은 결과를 냅니다.

| # | 우선 | 항목 | SQL 변경 필요 | #59 상태 |
|---|---|---|---|---|
| C1 | **필수(협업 인계를 켜기 전)** | 협업 상세 parser 가 인계 이력을 거부 → #59 는 받지만 위조를 못 거름 | 없음(이미 반영) | **일부** — 정상 4건 수용, 위조 8건 중 5건 수용 |
| C2 | 필수(비서 활성화 전) | 할 일 초안 한도 200/4000 → 새 입력 · AI 출력 · 편집 120/2000 | 없음 | **해결** |
| C3 | 권장 | P6 · P7 앱이 보내기 전 막은 입력을 `INVALID_RESPONSE` 로 표시 | 없음 | **해결**(덤: 정지 소속 `FORBIDDEN` → `INACTIVE_MEMBERSHIP` 1건 남음) |
| C4 | 권장 | P2 일정 일괄 `includeMemberIds` 정렬 | 없음 | 남음(Codex 후속) |
| C5 | 권장 | P3 거절된 첨부의 재조회 | 없음 — `prepare` CONFLICT 뜻을 계약 · 시험으로 고정 | 남음(Codex 후속) |
| C6 | 결정 뒤 | 협업 알림 출처 | 결정에 따라 | 결정 대기 |
| C7 | 필수(비서 활성화 전) | 비서 입력 토큰을 보내기 전에 세기 | 있음 — `P6_비용통제_변경안.md` | 명세 · 비용 승인 대기 |

---

## C1. 협업 상세 — 인계 이력 (최우선, #59 에서 일부 해결)

- **파일/함수**: `apps/workhub/src/cooperation/adapter.ts` `detailResponse`, 화면의 이력 줄, `contracts.ts` `actionLabels`
- **#59 에서 된 것**: `handover` 를 알고, 전 받는 사람이 한 수락 · 완료 요청 행이 있는 상세를 받아들임(정상 4건 모두 수용).
- **#59 에서 남은 것**:
  1. 서버가 행마다 주는 `actorName` · `recipientMemberId`(그 행 **뒤**의 받는 사람) · `previousRecipientMemberId`(인계 행만)를 **검사하지도 화면에 쓰지도 않음**.
  2. 그래서 아래 위조 5건을 받아들임(받아들이면 안 됨 → `INVALID_INPUT`):
     | 위조 | #59 |
     |---|---|
     | 인계 행의 넘겨준 사람(`previousRecipientMemberId`)을 바꿈 | 수용(틀림) |
     | 모든 행의 받는 사람을 지금 받는 사람으로 덮음 | 수용(틀림) |
     | 인계가 아닌 행에 넘겨준 사람을 넣음 | 수용(틀림) |
     | 인계 전 한 행의 받는 사람만 지금 받는 사람으로 바꿈 | 수용(틀림) |
     | 두 번째 인계의 넘겨준 사람을 첫 받는 사람으로 바꿈 | 수용(틀림) |
     | 과거 처리자를 새 받는 사람으로 바꿈 · 인계 행을 지움 · 보낸 사람에게 인계 | 거부(맞음) |
- **기대 응답(고정 사례)**: `database/workhub/p7/test/cooperation_history_cases.json` — 실제 P7 시험 응답 그대로.
  - **정상 인계**: m-21(보낸 사람) · m-24(새 받는 사람)가 조회한 이력 4행(인계 1번) → 받아들임
  - **연쇄 인계**: m-25 · m-21 이 조회한 이력 8행(22→24→25, 완료 확인 대기 중 인계 포함) → 받아들임
  - **잘못된 넘겨준 사람**: 위 표의 1 · 5행 → 거부
  - **과거 기록 변경**: 위 표의 2 · 3 · 4행과 "과거 처리자를 새 받는 사람으로 바꿈" · "인계 행을 지움" → 거부
  - 각 사례에 `scope`(조회한 사람) · `raw`(서버 응답) · `expect`(`accept`/`reject`)가 있어 앱 시험에 그대로 넣을 수 있음.
- **검사 규칙(기준 구현, 그대로 옮겨도 됨)**: `database/workhub/p7/test/cooperation_history_contract.ts` 의 `proposedDetailResponse` · `historyLine`.
  상태를 처음부터 다시 따라가며 "그 행 때의 받는 사람"으로 `allowedActions` 를 검사하고, 인계는 `requested · accepted · completion_requested` 에서만 ·
  처리자 = 새 받는 사람 · 넘겨준 사람 = 직전 받는 사람 · 보낸 사람 아님 · 각 행의 `recipientMemberId` = 그 행 뒤 받는 사람 · 마지막 행의 받는 사람 = 지금 받는 사람.
- **화면**: 이력 줄은 "업무 인계 · 박○○ → 최○○", "수락 · (그때 받은 사람 이름)" 처럼 **그 행의 `actorName`**(지금 담당자 이름으로 고르지 않음).
- **지켜야 할 것**: 과거 행의 처리자를 새 담당자로 바꾸거나 행을 지워서 맞추지 않음. 어긋나면 화면을 열지 않음.
- **비공개 연결**: 인계 뒤 새 받는 사람 응답의 `taskLink` 는 `null`(서버가 이미 그렇게 줌). 앱은 `null` 을 받아들이기만 하면 됨.
- **확인 방법**: `P7_APP_SRC=<수정 브랜치> bash database/workhub/p7/test/run_all.sh` 의 V 구간에서 `KNOWN 지금 앱 협업 상세 parser 가 위조 응답 …종을 받아들임` · `… 정상 인계 이력을 거부` 두 줄이 모두 사라지면 끝.
  (`P7_COOP_CASES=<경로>` 를 주면 같은 fixture 를 다시 씀.)
- **활성화 조건**: 이 수정이 배포되기 전에는 협업 인계(P7-05 · P7 transitions 의 cooperation 항목)를 켜지 않음.

## C2. 할 일 초안 한도 (P6 · R0)

- **파일/함수**: `apps/workhub/src/assistant/contracts.ts` `taskDraft`(200 · 4000), `AssistantPanel.tsx` 할 일 확인 입력칸 `maxLength={200}` · `{4000}`, `apps/main/api/workhub-ai/_assistant.py` `task_input`(200 · 4000) · `TOOL.input_schema.taskDraft`(길이 제한 없음)
- **RPC 호출**: 함(`workhub_ai_confirm_task`)
- **재현**: P6 시험 E09 — 제목 121자 초안을 확정.
- **실제**: 앱은 200자까지 받아 보내고, 서버(R0 `normalize_task_input`, 제목 120 · 메모 2000)가 `INVALID_INPUT` → 교사는 "입력 오류"만 봄.
- **기대(권장 한도 120 · 2000)**:
  - **새 입력 · 편집**: 입력칸 `maxLength` 120 · 2000, 확정 전 검사도 120 · 2000(`tasks/validation.ts` 와 같은 규칙).
  - **AI 출력**: `TOOL` 스키마에 `maxLength` 120 · 2000 을 주고, `checked_output` 의 초안 검사도 120 · 2000. 넘으면 그 초안만 버리지 말고 지금 규칙대로 `OUTPUT_INVALID`(사용량은 정산) — 조용히 자르지 않음.
  - **기존 긴 초안 읽기**: 이미 저장된 제안(서버는 200 · 4000 까지 보관 · 반환)은 parser 가 계속 200 · 4000 으로 **읽어서** 보여 주고, 확정 버튼만 "제목을 120자 이하로 줄여 주세요"로 막음.
- **SQL**: 바꾸지 않음(보관 한도 200 · 4000 은 옛 초안 읽기용으로 둠. 확정은 R0 가 120 · 2000 으로 막음).

## C3. 보내기 전에 막은 입력의 코드 (P6 · P7)

- **파일/함수**: `apps/workhub/src/assistant/server.ts`(질문 · 확정 명령 검사), `apps/workhub/src/collections/operations.ts`(수합 운영 명령), `apps/workhub/src/administration/transitions.ts`(업무 전환 미리보기 계획). 공통 원인: 입력 검사에 응답 검사용 `exact` · `invalid()` 를 같이 써서 `INVALID_RESPONSE` 를 던짐.
- **RPC 호출**: 안 함(앱이 먼저 막음 — 이 점은 맞음)
- **재현(시험 입력)**:
  - P6 질문 7건(`p6/test/run_p6.py` D13): 학교 모드 + `personal_assistant` · 공백 질문 · 4,001자 질문 · 대화 없이 판 1 · **모르는 칸 `x:1`** · 개인 모드 학생 초안 · 같은 근거 두 번
  - P6 확정 2건(E11): 모르는 칸 `x:1` · 판 0
  - P7 수합 운영 5건(`p7/test/run_p7.py` 258행 부근): 명령에 모르는 칸(`extra:1`) 등, 미리보기 2건(404행): 계획에 모르는 칸(`x:1`) 등
- **실제**: `INVALID_RESPONSE`("서버 자료의 형식을 확인하지 못했습니다"). 같은 입력을 서버에 보내면 서버는 `INVALID_INPUT`.
- **기대**: 앱이 먼저 막을 때도 `INVALID_INPUT`(입력 확인 문구). **서버 응답이 깨졌을 때의 `INVALID_RESPONSE` · 쓰기 결과를 모를 때의 `RESULT_UNKNOWN` 은 지금처럼 유지.**
- 덤(P6 1건): 정지된 소속으로 질문 → 서버 `INACTIVE_MEMBERSHIP`, 앱이 먼저 `FORBIDDEN`. 서버와 같은 코드로 맞추는 것을 권장(정지 안내 문구가 달라짐).

## C4. 일정 일괄 — 직접 포함 교사 정렬 (P2)

- **파일/함수**: `apps/workhub/src/calendar/batch-domain.ts` `batchDraft` → `normalizeDraft`
- **RPC 호출**: 함(`workhub_calendar_batch_prepare`)
- **재현**: P2 시험 F01b — 이미 가져온 일정과 같은 내용인데 `audience.includeMemberIds` 순서만 `[m-23, m-22]` 로 다른 파일을 다시 비교.
- **실제**: 그 행이 `changed` 로 나옴(적용하면 내용은 같고 판만 오름). 서버 기준선은 정렬본이고, 비교는 앱이 보낸 원문 그대로라서.
- **기대**: 앱이 보내기 전에 `includeMemberIds` · `excludeMemberIds` 를 정렬(문자열 코드 순 — 서버 `COLLATE "C"` 와 같게) → `duplicate`.
- **SQL**: 바꾸지 않음(서버만 정렬하면 앱 parser 가 미리보기 해시 불일치로 거부함).

## C5. 거절된 첨부의 재조회 (P3)

- **파일/함수**: `apps/workhub/src/messaging/files.ts` `prepare(…, { replayOnly: true })`, `MessageFileIntent.state`
- **RPC 호출**: 함(`workhub_message_file_prepare` 같은 요청 번호 재전송)
- **재현**: P3 시험 — 첨부 확인에서 `rejected`(예: 실물 바꿔치기 `object_changed`)가 된 파일을 같은 요청 번호로 다시 prepare.
- **실제**: 서버 `CONFLICT`(intent 상태에 `rejected` 가 없어서). 앱은 "충돌"로 보여 줌.
- **기대(권장 A, 앱만)**: 파일 ID 를 알면 `status(fileId)` 를 불러 `rejected` 를 "이 파일은 확인을 통과하지 못했습니다. 새로 첨부해 주세요"로 보여 줌. 응답을 잃어 파일 ID 를 모르면 같은 문구 + 새 요청 번호로 다시 첨부.
- **CONFLICT 의 뜻(계약 고정)**: `prepare` 의 `CONFLICT` 는 "같은 번호 · 같은 내용의 예약이 rejected(기본 확인 거절 · 실물 바뀜 · 크기 다름 · 기한 지남)로 끝남" **하나뿐**(`P3_API계약.md` 첨부 절, 시험 O45c~e). 이 뜻을 `mutate` 의 `CONFLICT`(판 · 명단 · 붙인 파일 상태)나 시간 초과(`RESULT_UNKNOWN`)에 쓰지 않음. 같은 번호 · 다른 내용은 `IDEMPOTENCY_CONFLICT`.
- **대안 B(앱 + SQL)**: intent 에 `rejected` 를 더하고 서버가 재조회에 `{state:'rejected'}` 를 돌려줌 — 이 경우 Claude 가 P3-02 를 고침. 결정표 참고.

## C6. 협업 알림 출처 (P3 · P2)

- **파일/함수**: `apps/workhub/src/messaging/contracts.ts` `NotificationSource.module`(협업 없음), SQL `notifications_source_check`(같은 6종)
- **RPC 호출**: 해당 없음 — 지금은 협업 알림을 **만들지 않음**(서버 · 앱 모두 협업 출처가 없음). 홈 요약의 협업 개수로만 보임.
- **결정 필요**: 협업 알림을 사이트 알림에도 띄울지. 띄운다면 순서는 **앱 먼저**(`'cooperation'` 을 받아들이게) → 그 뒤 SQL(P3 CHECK 확장 + P2 협업 명령에서 알림 생성, Claude). 반대로 하면 지금 앱이 알림함 전체를 거부함.

## C7. 비서 입력 토큰 사전 셈

`P6_비용통제_변경안.md` 2-1절 A1~A11(`COUNT_FAILED` · `over_reservation` 포함), 시험 5-2절 B1~B9, 배포 순서 4절(앱 먼저). SQL 짝(S1~S6)이 같이 들어가야 해서, 계란님 결정(D1~D10) 뒤 Claude · Codex 가 같은 판으로 맞춥니다.
