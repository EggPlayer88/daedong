# Codex 에게 넘기는 앱 수정 목록 (통합 검토 5번 · 1번)

2026-10-16 · Claude Code. **검토 기준 앱: PR #48 `5f3d40f`**. SQL 기준: 이 PR(통합 브랜치)의 각 단계 파일.
앱 수정은 Codex 브랜치에서, SQL 수정은 Claude 브랜치에서 합니다. Claude 는 Codex 브랜치를 고치지 않습니다.
재현은 모두 이 저장소의 시험(`database/workhub/*/test`)에서 실제로 나온 응답 · 입력입니다. 통합 회귀(`integration/test/run_integration.sh`)의 VI 구간이 같은 결과를 냅니다.

| # | 우선 | 항목 | SQL 변경 필요 |
|---|---|---|---|
| C1 | **필수(협업 인계를 켜기 전)** | 협업 상세 parser 가 인계 이력을 거부 | 없음(이미 반영) |
| C2 | 필수(비서 활성화 전) | 할 일 초안 한도 200/4000 → 새 입력 · AI 출력 · 편집 120/2000 | 없음 |
| C3 | 권장 | P6 · P7 앱이 보내기 전 막은 입력을 `INVALID_RESPONSE` 로 표시 | 없음 |
| C4 | 권장 | P2 일정 일괄 `includeMemberIds` 정렬 | 없음 |
| C5 | 권장 | P3 거절된 첨부의 재조회 | 없음(대안 B 는 있음) |
| C6 | 결정 뒤 | 협업 알림 출처 | 결정에 따라 |
| C7 | 필수(비서 활성화 전) | 비서 입력 토큰을 보내기 전에 세기 | 있음 — `P6_비용통제_변경안.md` |

---

## C1. 협업 상세 — 인계 이력 (통합 검토 1번, 최우선)

- **파일/함수**: `apps/workhub/src/cooperation/adapter.ts` `detailResponse`, 화면의 이력 줄(이름을 `senderName` · `recipientName` 으로 고르는 곳), `contracts.ts` `actionLabels`
- **RPC 호출**: 함 (`workhub_cooperation_get` 응답을 parser 가 거부 → 화면이 열리지 않음)
- **재현**: P7 시험 H23a~H32 (`p7/test/run_p7.py`). 보낸 사람 21 → 받는 사람 22 → 22 수락 · 완료 요청 → **완료 확인 대기 중** 22→24 인계 → 21 반려 → 24 완료 요청 → 24→25 **재인계** → 21 완료 확인. 각 시점에 21 · 22 · 24 · 25 가 상세를 조회한 실제 응답이 `P7_CAPTURE` 의 `coop_get`.
- **실제(지금 앱)**: 인계가 없는 상세는 받음. 인계 행이 있는 상세 4건(이력 4행 · 8행)을 모두 `INVALID_INPUT` 으로 거부. 이유 두 가지:
  1. `action === 'handover'` 를 모름(`actionLabels` 에 없음)
  2. 처리자가 **지금의** 보낸 사람 · 받는 사람 중 하나여야 한다고 검사 → 전 받는 사람(22)이 한 수락 · 완료 요청 행이 거부됨
- **기대**: 6건 모두 받음. 이력을 고치거나 지운 응답(과거 처리자를 새 받는 사람으로 바꿈 · 넘겨준 사람 바꿈 · 행의 받는 사람을 지금 사람으로 덮음 · 인계 행 삭제 · 인계 아닌 행에 넘겨준 사람 · 보낸 사람에게 인계)은 모두 `INVALID_INPUT`.
  화면 이력 줄은 "업무 인계 · 박○○", "수락 · (그때 받은 사람 이름)" 처럼 **그 행의 `actorName`** 을 씀.
- **서버가 주는 칸(P2 API 계약 반영, 행마다)**: `actorName`, `recipientMemberId`(그 행 **뒤**의 받는 사람), `previousRecipientMemberId`(인계 행만, 아니면 `null`).
- **기준 구현(그대로 옮겨도 됨)**: `database/workhub/p7/test/cooperation_history_contract.ts` 의 `proposedDetailResponse` · `historyLine`.
  상태를 처음부터 다시 따라가며 "그 행 때의 받는 사람"으로 `allowedActions` 를 검사하고, 인계는 `requested · accepted · completion_requested` 에서만 · 처리자 = 새 받는 사람 · 넘겨준 사람 = 직전 받는 사람 · 보낸 사람 아님.
- **지켜야 할 것**: 과거 행의 처리자를 새 담당자로 바꾸거나 행을 지워서 맞추지 않음. 어긋나면 화면을 열지 않음.
- **비공개 연결**: 전 받는 사람이 자기 할 일을 연결해 둔 협업을 넘기면, 새 받는 사람 응답의 `taskLink` 는 `null`(서버가 이미 그렇게 줌, P7 시험 H23a~H32). 앱은 `null` 을 받아들이기만 하면 됨.
- **확인 방법**: `P7_APP_SRC=<수정 브랜치> bash database/workhub/p7/test/run_all.sh` 의 V 구간에서 `KNOWN … 인계 이력을 거부` 줄이 사라지고, 지금 앱 기준 검사를 제안 계약 기준으로 바꾸면 됨.

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
- **대안 B(앱 + SQL)**: intent 에 `rejected` 를 더하고 서버가 재조회에 `{state:'rejected'}` 를 돌려줌 — 이 경우 Claude 가 P3-02 를 고침. 결정표 참고.

## C6. 협업 알림 출처 (P3 · P2)

- **파일/함수**: `apps/workhub/src/messaging/contracts.ts` `NotificationSource.module`(협업 없음), SQL `notifications_source_check`(같은 6종)
- **RPC 호출**: 해당 없음 — 지금은 협업 알림을 **만들지 않음**(서버 · 앱 모두 협업 출처가 없음). 홈 요약의 협업 개수로만 보임.
- **결정 필요**: 협업 알림을 사이트 알림에도 띄울지. 띄운다면 순서는 **앱 먼저**(`'cooperation'` 을 받아들이게) → 그 뒤 SQL(P3 CHECK 확장 + P2 협업 명령에서 알림 생성, Claude). 반대로 하면 지금 앱이 알림함 전체를 거부함.

## C7. 비서 입력 토큰 사전 셈

`P6_비용통제_변경안.md` 2-1절 A1~A6. SQL 짝(S1~S6)이 같이 들어가야 해서, 계란님 결정(D1~D9) 뒤 Claude · Codex 가 같은 판으로 맞춥니다.
