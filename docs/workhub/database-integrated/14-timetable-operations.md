# 14. 시간표 준비·편성·조정·공유·변경 실행 설계

> 2026-10-13 · 보강판 1.1 · **설계 계약이며 구현·운영 반영 완료가 아니다.** 실제 DB 구축·SQL 실행·시간표 구현은 계속 보류한다. 사용자 설명을 반영해 기존 03의 시간표 26표와 API-18~20을 구체화한다. 신규는 관리자 기준자료판·수정요청 2표이고, 기존 로그인·회원·시간표 엔진·확정 SQL은 변경하지 않는다. 정형 변경 목록은 `timetable-extension.json`이다.

## 1. 확정한 제품 흐름과 역할

`관리자 기본자료 확정 → 시간표 담당자 조건 설정 → 편성 실행 → 후보 저장·비교·직접 조정 → 적용일부터 확정·공유 → 교사 변경 요청·관련 교사 동의 → 시간표 담당자 최종 승인·반영`

기본자료의 승인과 시간 배치의 결정은 서로 다른 권한이다. 담당자가 교사를 배치하다가 시수가 맞지 않는다고 공식 시수나 교과 담당을 몰래 바꾸지 못한다. 같은 사람이 관리자와 시간표 담당을 겸할 수는 있지만, 어떤 역할로 무엇을 확정했는지는 각각 기록한다. AI는 Claude를 사용하며 조건 해석·질문·대안 설명·허용 도구 호출을 맡는다. 수업 배치·시수·충돌·권한·최종 저장은 코드가 결정한다.

| 주체 | 할 수 있는 일 | 단독으로 할 수 없는 일 |
|---|---|---|
| 학교 관리자/공식 배정 담당 | 학년·학급·교사·학기·교과 시수·승인 수업/업무 배정 정리, 기본자료판 확정, 수정요청 검토 | 담당자의 개인 대화나 학생 관찰 열람, 기존 실시 수업 삭제 |
| 시간표 담당자 | 확정자료 읽기, 오류 수정요청, 조건 설정, 생성/저장/수정/비교, 기본표 확정, 교환 승인 | 공식 배정·시수 직접 변경, 미지원/충돌 후보 강제 배포, 본인 요청 최종 승인 |
| 일반 교사 | 확정 시간표 조회, 본인 수업 변경 요청, 본인이 참여하는 제안 동의/거절, 실제 실시 확인 | 다른 교사의 수업 단독 이동, 대화만으로 확정표 수정 |
| 지정 대리 승인자 | 담당자가 요청 당사자인 건의 최종 승인, 위임된 기간·범위 처리 | 학교 전체 관리자 권한 취득, 위임 기간 외 승인 |
| Claude | 자료의 누락 질문, 명확한 조건 초안, 후보 설명, 변경안 초안, 요청 상태 조회 | 담당 교사 임의 지정, 필수조건 자동 완화, 무응답을 동의로 간주, 범용 SQL 실행 |

위 권한 이름은 `timetable.basis.confirm / timetable.compose / timetable.publish / timetable.change.approve`라는 목적별 capability로 구현한다. 실제 role에 묶는 것은 공통 권한 정책을 따른다. 초기 공개 범위는 기존 규칙대로 superadmin/지정 시범 범위이며 전 교사 공개는 별도 운영 승인 후 진행한다.

## 2. 화면과 실제 사용 순서

| 화면 | 우선 표시 | 주요 동작·완료 조건 |
|---|---|---|
| 관리자 기본자료 | 학기, 교사/학급 수, 총 시수 차이, 미배정·중복·미확인 목록 | 기존 명부·배정 화면으로 이동해 수정 → 검토안 보기 → 기본자료 확정. 문제가 0인지와 확인한 예외를 표시 |
| 담당자 시작 화면 | 현재 확정자료판, 이전 편성안, 자료 변경 알림, 다음 할 일 1개 | 조건 설정 이어하기/편성안 열기. 관리자 자료를 다시 입력하게 하지 않음 |
| 조건 편집 | 필수/선호, 대상, 기간, 확인 여부, 지원 여부 | 직접 양식 입력 또는 AI와 입력. AI 초안과 실제 적용 조건을 나란히 확인 |
| 편성 작업 | 진행 상태, 취소, 후보 수, 제한 도달 여부 | 가능한 후보만 제공. 3개를 요청했어도 1개만 유효하면 1개 표시 |
| 조정 작업대 | 교사/학급/교실 시간표, 선택 수업 정보, 충돌 목록 | 드래그·키보드 이동, 고정/해제, 새 후보 저장, 두 후보 차이, 되돌리기, 선택 범위 재편성 |
| 배포 확인 | 적용 기간, 변경 교사/학급 수, 충돌, 기존 교환/실시 영향 | 미해결 필수 영향이 0인 정확한 후보판만 확정. 예약 적용일도 명확히 표시 |
| 교사용 시간표 | 오늘 내 수업, 변경 표시, 다음 수업 | 주/날짜 이동, 교사·학급·교실 검색, 변경 요청. 모바일은 일별 목록 우선 |
| 변경 요청함 | 내 응답 필요, 승인 필요, 반영 결과 | 변경 전후 한눈 비교, 수락/거절, 담당자 승인, 만료·취소·실패 이유 |

AI 대화는 위 화면의 보조 입구다. AI 연결 장애가 있어도 조건 양식·직접 편집·수동 변경 요청·승인으로 동일 업무를 마칠 수 있어야 한다. 모든 드래그 작업은 키보드/대체 버튼 경로를 제공한다. 단순 선택에 긴 대화를 요구하지 않는다. 홈과 메신저 업무카드는 실제 `change_set_id` 또는 `lesson_instance_id`로 이동하며 카드의 읽음 상태를 승인 상태로 쓰지 않는다.

## 3. 관리자가 확정하는 기본자료판

### 3.1 내용과 검사

기준자료판에는 학교·학년도·학기, 학교 시간대, 일과/학년별 교시, 학급·수업집단, 교과 시수, 승인 교사·업무/수업 배정과 적용 기간, 사용 공간, 수강 중첩 검사에 필요한 최소 참여 관계를 고정한다. `course_groups.weekly_hours`와 `course_group_teachers`가 수업 요구의 원본이며 새 교과·교사 표를 만들지 않는다. 표시명과 ID는 분리한다. 동명이인을 이름으로 합치지 않는다.

확정 전 서버가 수업집단별 필요 시간·가용 슬롯·담당 유효기간·블록 합계·교사 자원·교실 요구·미확인 수강 관계를 검사한다. 원본의 `version`이 없는 기간 관계도 정렬된 값과 시작/종료일을 포함한 서버 지문으로 고정한다. 소수 시수를 임의 반올림하지 않는다. 격주·순환 운영 등 별도 패턴이 필요한 경우 그 요구와 엔진 지원을 확인하며, 지원하지 않으면 자동편성 입력으로 확정하지 않는다.

하나의 학기 중 담당 배정·학생 수강이 달라지면 기간별 관계를 유지한다. 하나의 주간 반복표로 안전하게 표현할 수 없는 변경은 적용 시작일부터 새 기본표로 나누거나 해당 운영형 지원을 요구한다. 현재 배정만 조회해서 과거 편성안을 재구성하지 않는다.

### 3.2 저장 방식

새 `timetable_basis_revisions`는 **확정된 불변판만** 저장한다. 관리자 수정 중 화면은 기존 원본 자료의 변경·검토 흐름을 사용하며 별도 미확정 명부 복사본을 만들지 않는다. `cmd_timetable_basis_preview` 결과에는 정규화한 snapshot·지문·원본 판 목록·오류/경고·영향이 들어간다. 확정 명령은 그 지문과 `terms.version`을 받아 원본을 다시 확인하고 불변판 생성과 `terms.current_timetable_basis_id` 갱신을 함께 커밋한다.

기준자료 snapshot은 허용된 JSON Schema만 사용한다. 필수 루트 키는 `schema_version, school_id, term_id, timezone, valid_from, valid_to, sources, teachers, classes, courses, assignments, bells, spaces, participation_conflicts`다. 각 sources 항목은 `entity_kind, entity_key, source_version_or_hash, valid_from, valid_to`를 가진다. source kind는 허용 목록이며 학교·학기·실제 원본 존재·승인 관계를 검증한다. 검증되지 않은 원시 AI JSON은 저장하지 않는다. 참여 관계의 학생 실명·상담·사유 원문은 snapshot에 복제하지 않는다.

**기준자료판 한 개는 학기 전체를 표현한다.** `[valid_from,valid_to)`는 정규화한 학기 전체 기간과 같아야 하며 그 안의 배정·명부·일과는 각자의 유효기간을 보존한다. 일부 기간 자료를 고쳐도 학기 전체 snapshot의 새판을 확정한다. 따라서 `terms.current_timetable_basis_id`는 학기 전체 자료의 최신 관리자 확정판 한 개를 가리킨다. 특정 날짜의 시간표를 고르는 포인터가 아니다. 이미 배포된 표는 당시 기준판을 참조하고 날짜별 조회는 배포판의 효력구간으로 결정한다. 부분기간 snapshot을 최신 포인터로 등록하여 다른 날짜의 기반이 사라지는 경우는 거부한다.

원본 명부/시수/배정이 확정판 이후 변경되면 기존판을 수정하지 않고 `BASIS_SOURCE_CHANGED`로 차이를 알린다. 이미 배포된 시간표를 자동 재배포하지 않는다. 새 생성·확정에는 최신 확정판과 현재 원본의 일치가 필요하다. 학교 전체 마스터 변경이 해당 편성 범위에 영향을 주는지는 source 지문으로 판정하고, 관계없는 다른 학기의 변경 때문에 작업을 막지 않는다.

### 3.3 담당자의 수정요청

담당자가 `수학 A반 시수가 3이 아니라 4로 보입니다`라고 요청하면 `timetable_basis_change_requests`에 근거판·수정 대상·현재 값·제안 값·사유를 저장한다. 허용된 field key와 실제 ID만 받으며 JSON 경로나 SQL을 임의 실행하지 않는다.

상태는 `requested → in_review → applied / rejected`, 검토 전후 신청자의 철회는 `withdrawn`, 같은 사안이 다른 새판으로 해결되어 요청 기준이 무효하면 `superseded`다. 이미 applied인 요청을 다시 열지 않는다. 관리자 승인만으로 applied라 하지 않고, 승인된 원본 변경과 새로운 기준자료판 확정이 실제 커밋되어 `resolved_basis_revision_id`가 생겨야 한다. 기준판이 달라지면 차이를 다시 보여 주고 수정요청을 새로 작성한다.

## 4. 조건·AI·엔진 계약

### 4.1 조건의 최소 형식

기존 `constraint_sets`를 불변 잠금판으로 사용한다. 잠금 전에 편집할 수 있으며 잠금 후 변경은 based_on_id를 둔 새 조건판이다. 조건 한 건은 다음 필드를 가진다.

`id, kind, strength(hard/school_hard/soft), weight(soft만), target_type/id, params, applies_from/to, source_type/ref, rationale, confirmed_by/at, engine_support, source_basis_revision_id, interpretation_schema_version`

기존 내부 enum `school_hard`를 유지한다. 화면에서는 hard와 school_hard 모두 ‘필수’로 묶고 학교 규칙에서 온 항목에 근거 표시를 붙인다. 모든 편성·수동검증·배포의 필수조건 판정은 두 값을 모두 포함한다. school_hard는 학교 규칙·확정 불가시간의 승인 근거가 있으므로 시간표 담당자 선호 편집으로 soft로 바꾸거나 제외하지 못한다. 원본 근거를 승인된 절차로 변경한 뒤 새 조건판에서 반영한다.

대상·날짜·시간·강도가 빠졌거나 서로 다른 뜻으로 해석될 수 있으면 확인 질문을 남긴다. 예를 들어 ‘수요일 못 와요’는 매주인지 특정 날짜인지 확인하고, 공식 확정 불가시간과 개인 선호를 구분한다. AI가 제안한 hard→soft 변경은 원래 조건과 새 조건, 영향을 보여 주고 담당자가 새 조건판에서 명시 확인해야 한다. 확정 복무 불가시간은 담당자 선호 편집으로 완화할 수 없다.

`engine_support`는 해당 engine/adapter 버전에 대한 검사 결과다. 미확인 값을 supported로 기본 지정하지 않는다. `supported / unsupported / unknown`을 구분한다. 입력에 담을 수 없는 필수조건은 편성을 막고, 미지원 선호도 적용했다고 말하지 않는다. 담당자가 그 선호를 이번 실행에서 명시 제외한 기록이 있어야 나머지 조건으로 진행할 수 있다. 기간 내 단 한 번의 예외는 주간 조건에 뭉개지 않고 날짜별 운영 경로로 처리한다.

### 4.2 실행과 결과

서버는 `basis_revision_id + locked constraint_set_id + 실제 조건 목록 지문 + 기존 후보/배포판 + 달력 지문 + 지원기능판`으로 정규화 입력을 만든다. 원본 input을 보존하고 엔진별 adapter가 이를 변환한다. 수업 단위의 내부 순번은 영구 `lesson_instance_id`로 사용하지 않는다.

기존 compositions의 실행 상태와 결과는 분리한다. 작업 상태는 `queued / running / completed / failed / cancelled`, 새 `result_kind`는 `feasible / optimal / infeasible / unresolved / invalid_input / unsupported / internal_error / cancelled`다. 기존 `timetable_compositions_status_check`와 옛 status를 사용하는 보조 CHECK 5개(`tt_compositions_finished`, `tt_compositions_limit_known`, `tt_compositions_proven`, `tt_compositions_infeasible_proof`, `tt_compositions_unresolved_limit`)를 아래 진리표로 함께 대체한다. 옛 status의 feasible 중 proven은 completed/optimal, 나머지는 completed/feasible이며 infeasible/unresolved는 completed와 동명 result_kind로 변환한다. 제한시간 내 해가 없다는 사실만으로 infeasible로 기록하지 않는다. infeasible은 엔진이 증명한 경우이고, 설명은 실제 충돌 근거/증명 범위만 사용한다. 특정 규정 탓이라는 추측을 확정 원인처럼 출력하지 않는다.

| status | result_kind | finished_at | limit_reached | optimality·결과 조건 |
|---|---|---|---|---|
| queued/running | NULL | NULL | NULL | unknown; 최종 결과 아님 |
| completed | feasible | 필수 | 실측 true/false | unknown; 독립 검증후보 1개 이상 |
| completed | optimal | 필수 | false | proven; 검증후보와 전체 입력 최적성 증명 |
| completed | infeasible | 필수 | false | unknown; 해당 전체 입력 불가능 증명 |
| completed | unresolved | 필수 | 실측 true/false | unknown; outcome_reason 필수, 유효한 최종 후보·증명 없음 |
| failed | invalid_input/unsupported/internal_error | 필수 | NULL | unknown; 자동배포 불가 |
| cancelled | cancelled | 필수 | NULL | unknown; 늦은 결과는 fencing으로 차단 |

표에 없는 조합은 거부한다. unresolved는 시간·자원 한도 등 실제 종료 이유를 제공하며 한도 도달 없이 결론을 얻지 못한 경우에도 false와 원인을 정확히 기록한다. 과거 failed는 진단에 따라 세 오류 종류를 구분하고 근거가 없으면 internal_error로 남긴다. 기존 진단·증명·실행 이력을 삭제하거나 성공 상태로 승격하지 않는다.

후보가 있는 시간 제한 종료는 feasible+limit_reached다. unknown 최적성을 ‘최적 시간표’라고 표시하지 않는다. 엔진 취소는 가능한 한 빨리 작업을 중단하며 늦게 도착한 결과는 fencing 값이 맞는 실행에만 저장한다. 재시도는 기존 jobs/outbox/접수증을 사용하며 중복 과금 방지를 위한 정확한 상한·모델 설정은 별도 승인 사항이다.

## 5. 임시저장·수동 수정·비교·고정

후보 placements는 불변이다. 이름을 붙이거나 수정할 때도 기존 후보를 덮어쓰지 않고 `derived_from_id`를 둔 새 후보를 만든다. 수동 후보는 원본 기준자료·조건판을 직접 참조하므로 composition_id가 없어도 해석 가능하다. AI 수정도 같은 전용 명령을 사용한다.

수동 이동은 먼저 변경안을 보여 준다. 충돌이 있어도 **초안 저장**은 허용하되 `validation_state=invalid`와 충돌 목록을 표시하며, 배포 버튼은 사용할 수 없다. unknown/stale도 배포 불가다. 구조화 검증 보고에는 code, 관련 수업/자원 ID, 실제 날짜/시각, violated_constraint_id, severity, 해결 가능한 입력 위치가 포함된다. 다른 교사의 개인 사유는 출력하지 않는다.

기본 비교 단위는 수업의 교사·학급/참여집단·요일/교시·실제 시각·공간이다. 위치는 같고 교사가 바뀐 경우도 변경으로 센다. 시수·블록 변경은 구조 변경으로 별도 표시하고 기존 unit 순번으로 억지 매칭하지 않는다. 엔진의 previous 지원을 검사한 뒤 지원 범위 밖이면 새 편성 경로를 제시한다.

고정 항목은 후보의 `locked_placements`에 영구 수업집단·회차키와 현재 배치 지문을 담는다. 새 기준자료에서 회차가 달라지면 고정이 무효라는 경고를 띄우며 해제/재연결 확인 없이는 탐색에 넣지 않는다. 잠긴 수업을 해제하는 AI 제안도 담당자 확인이 필요하다. 되돌리기는 과거 후보를 기반으로 새 후보를 만드는 행동이며 이미 공개된 표를 조용히 덮어쓰지 않는다.

## 6. 확정·적용 기간·공유

모든 날짜는 학교의 IANA 시간대 기준이며 국내 초기 학교는 확인된 `Asia/Seoul`을 사용한다. 날짜 효력은 `[effective_from, effective_to)`로 통일한다. 화면에서 ‘10월 31일까지’라고 받으면 다음 날을 exclusive 종료일로 저장하고 화면은 원래 의미로 표시한다. 학기의 기존 ends_on 의미는 별도 어댑터에서 변환하며 무조건 하루를 두 번 더하지 않는다. 시각 점유도 `[starts_at, ends_at)`이고 실제 시각으로 충돌을 계산한다.

기본표 배포는 앞으로 적용할 기간을 명시한다. 같은 학교·학기·날짜에 적용될 기본표는 하나다. 새 표가 현재표의 일부 미래 기간을 대체하면 앞·대체·뒤 구간을 나누어 **남은 기간도 원자적으로 보존**한다. 예를 들어 기존 `[9월 1일, 다음 해 1월 1일)`에서 `[11월 1일, 12월 1일)`만 대체하면 앞 `[9월 1일, 11월 1일)`, 새표 `[11월 1일, 12월 1일)`, 뒤 복원판 `[12월 1일, 다음 해 1월 1일)`을 함께 확정한다. 한 version 행에 비연속 기간을 담지 않는다. 뒤 복원판은 기존 배치에서 새 candidate/version을 만들고 현재 기준자료·달력·승인된 미래 변경을 다시 검사한다. 뒤 기간을 보존할 수 없으면 전체 배포를 보류하며 해당 기간이 조용히 사라지지 않는다. 기존 기간 경계 변경과 파생 관계는 이력에 남기고 이미 실시한 수업의 원래 version 참조를 유지한다. 학교 달력·학년별 일과를 적용한 `lesson_instances`와 주간 표를 구분한다. 예정표 생성은 수업을 실제 실시했다는 기록이 아니다.

배포 미리보기에서 다음을 확인한다.

1. 현재 권한, 최신 기본자료판·조건판·후보 지문, solver/validator 지원 범위.
2. 후보 전체 hard 검사와 적용 기간 날짜별 휴업·일과·교사 불가·자원 점유.
3. 이미 승인된 미래 교환·보강·대강의 영향: 유지 가능, 재검토 필요, 대체할 변경을 항목별 분류.
4. 이미 실시한 수업·학생 활동 연결은 보존. 미해결 영향이 있으면 배포 차단.
5. 공개할 확정판·기간·영향 명세 지문에 대한 담당자의 확인.

미래 변경을 새 주간표로 덮어 없애지 않는다. 영향 검토를 마친 새 timetable_version, 필요한 lesson/occupancy 변경, receipt, audit, outbox를 한 트랜잭션으로 커밋한다. 많은 날짜를 준비해야 하면 jobs에서 임시 데이터를 만들고 최종 재검사 후 공개판 포인터를 원자 전환한다. 작업 준비중 결과는 일반 교사에게 확정표로 보이지 않는다. 알림 실패는 시간표 확정 실패로 바꾸지 않고 알림만 재시도한다.

교사용 DTO에는 현재 적용판·기준시각·변경 표시·갱신 여부를 포함한다. 오늘의 교사/학급/교실 표는 같은 날짜별 수업 원장을 읽는다. 임시 후보는 일반 교사 조회·검색·홈 집계에 노출하지 않는다. 캐시된 시간표가 오래됐거나 네트워크가 끊기면 마지막 갱신 시각을 보여 주고 변경 승인/반영은 온라인 최신 검사 없이 실행하지 않는다.

## 7. 확정 이후 교환·대강·보강

### 7.1 공통 요청 흐름

`draft → awaiting_consent → ready_for_approval → applied`를 기본 상태로 한다. `rejected / withdrawn / expired / superseded`는 종결이다. 별도 approved 상태를 오래 유지하지 않고 최종 승인과 반영을 같은 명령으로 수행한다. 데이터 경합으로 반영이 실패하면 applied라고 표시하지 않으며 안전한 오류와 새 검토 경로를 제시한다.

교사가 AI에게 요청하면 대상 날짜·수업·교환 범위를 확인한다. 서버가 현재 날짜별 수업과 승인된 교사 관계로 가능한 안을 계산한다. 교사는 실제 변경 전후와 관련 교사를 보고 동의 요청을 보낸다. 모든 필요한 참여자를 서버가 계산하므로 클라이언트가 참여자 목록에서 한 교사를 빼 동의를 생략할 수 없다.

다자 교환은 전체 순환의 모든 교사가 같은 candidate_sha256와 base_snapshot_sha256에 동의해야 한다. 한 명의 거절·만료·소속 종료·기준판 변경은 전체 적용을 막는다. 요청자의 제출도 정확한 후보판에 대한 본인 동의로 기록한다. 응답 또는 AI 메시지가 있다는 것만으로 동의로 간주하지 않는다.

내용·대상 교사·시각·영향·기준 수업판이 바뀌면 기존 change_set을 수정해 동의를 재사용하지 않는다. 새 change_set을 만들고 `supersedes_change_set_id`로 연결하여 필요한 동의를 다시 받는다. applied의 취소는 기존 원장을 삭제하는 동작이 아니라 현재 상태 기준의 새 역변경 요청이다.

초기 운영은 담당자 최종 승인형을 **설계 권고 기본값**으로 둔다. 요청자 본인과 동일 account의 다른 membership을 이용한 자기승인도 막는 정책을 제안한다. 이는 DECISIONS의 확정 D번호 신설이나 이미 채택된 학교 운영규정이라는 뜻이 아니며 운영 재개 시 정책 채택을 확인한다. 이 정책을 채택한 학교에서 대리 승인자가 없으면 해당 요청은 대기시키고 지정 절차를 안내한다. AI가 긴급하다고 판단해서 승인을 생략하지 않는다.

### 7.2 실제 수업 의미

| 종류 | 처리 계약 |
|---|---|
| 교환 | 두 개 이상 수업이 날짜/시각을 바꿈. 관련 교사·학생집단·공간 모두 함께 검증·반영 |
| 이동 | 한 수업의 날짜/시각 변경. 원래 칸이 빈칸인지 별도 활동인지 표시, 목적지 충돌 검사 |
| 대강/대체 | 원수업과 학급을 유지하면서 실제 담당을 변경. 승인 가능한 교사인지 검사. 자동 시수/비용 정산 규칙을 임의 만들지 않음 |
| 결강/휴강 | 예정 변경과 실제 미실시를 구분. 사유 분류·보강 필요·대체 활동을 기록 |
| 보강 | 어떤 미실시 수업을 보충하는지 replaces_lesson_id와 원장 관계로 고정. 이미 충당된 부족분 중복 보강 금지 |
| 장기 변경 | 특정 날짜 이후 새 주간 기본표로 처리. 날짜별 교환을 매주 반복 저장하지 않음 |
| 실시 정정 | 새 lesson_executions revision와 필요한 cover_ledger 보상행을 작성. 이전 실시 사실과 학생 기록을 삭제하지 않음 |

예정 시수·실제 시수·미실시·보강 필요·충당 완료를 분리해서 보여 준다. 시간이 지났다는 이유로 수업을 실시 완료로 바꾸지 않는다. 누계는 승인된 실시판과 계산식판에서 코드로 계산한다. 일시 교환으로 같은 수업을 서로 다른 ID로 중복 실시 처리하지 않는다.

## 8. 원자성·권한·동시 변경

공통 명령 계약의 현재 계정/학교/소속/정책 잠금과 멱등 선점 후, 관련 학교·학기 및 교사·학급·수업집단·학생·공간 자원키를 정렬해 동일 `lock_resources()` 규약으로 잠근다. 불가시간 등록·공간 예약·수강 관계 변경·기본표 배포·교환 반영도 이 규약을 사용한다. 아직 점유행이 없는 자원도 고정 자원키 잠금으로 경합시킨다.

잠금 이후 최신값을 다시 읽고 다음을 확인한다: 모든 lesson 기대판, 당사자 활성 소속·승인 수업 담당, 정확한 후보/기준판의 동의, 필수 동의자 누락 없음, 담당 승인권한·자기승인 금지, 확정 불가시간·수강 중첩·학사일정·공간 용량, 효력일과 기한. 하나라도 다르면 전체 롤백한다. 여러 교사 중 일부 시간표만 바꾸는 부분 성공은 없다.

표는 기존 복합 FK와 EXCLUDE/수용량 검증을 유지한다. 공유 공간은 개수만 세는 사전 검사로 끝내지 않고 동일 공간/시각 잠금 아래 합계를 검증한다. 적용 + 실시 관련 원장 변화 + audit + receipt + outbox는 같은 커밋이다. 알림 수신자는 실제 영향 대상에서 서버가 계산하며 불필요한 복무 상세 사유를 알림·메신저에 복제하지 않는다.

동일 멱등키·같은 요청은 현재 조회권한 확인 후 기존 결과를 반환한다. 같은 키·다른 후보는 `IDEMPOTENCY_CONFLICT`다. 원자 반영 응답이 유실되어 재시도해도 두 번 이동·두 번 시수 계상하지 않는다. 서버 로그에는 학생 실명·사유 원문·AI 전체 대화를 무조건 남기지 않는다.

## 9. DB 변경 범위와 관계

정확한 열 목록·키·인덱스는 `timetable-extension.json`을 따른다. `columns.references`는 참조 위치이며 단일열 FK를 허용한다는 뜻이 아니다.

| 변경 | 핵심 계약 |
|---|---|
| 신규 timetable_basis_revisions | id PK; (school_id,id,term_id) UNIQUE; 학기/확정자/이전판 복합 FK; revision_no·snapshot·source/전체 지문·기간·시간대·확정자. 불변판이며 일반 교사/AI 전체 조회 금지 |
| 신규 timetable_basis_change_requests | id PK; 학교·학기·기준판·신청자·검토자·해결판 복합 FK; 제한된 제안·사유·상태·expected version. 원본 수정 권한을 부여하지 않음 |
| terms | current_timetable_basis_id. 같은 school/term 판만 가리키며 기존 version으로 동시 확정 제어 |
| constraint_sets / timetable_constraints | 정확한 basis판 연결·조건 스키마판·지원 여부 검증. 잠금 후 내용 불변 |
| timetable_compositions | basis판·달력지문·adapter판·결과 종류. 기존 solver/job/seed/한도 활용 |
| timetable_candidates | 수동 후보도 basis·조건판 고정, 검증상태·보고·validator판·고정항목·표시명. 기존 불변 placements/derived_from 활용 |
| timetable_versions | basis판·달력지문 추가. 같은 학기 배포범위 중복·실시 보존·미래 변경 영향 검사 |
| timetable_change_sets | supersedes, 유효기한, required_participants 지문, 승인정책판. 후보 변경은 새 ID, 기존 동의 재사용 금지 |
| timetable_change_participants | 정확한 candidate/base와 required participant set에 응답 고정. 기존 response/role 재사용 |

기존 26표의 기본키를 교체하지 않는다. `lesson_instances`, 실행판, 점유표, 보강원장은 새 중복 테이블을 만들지 않고 기존 원자성 계약을 보강한다. 표 삭제/이관 실행은 이 설계의 범위가 아니다. 설계 확정 후 SQL 작성자가 실제 CHECK/trigger/RLS와 공통 권한을 함께 구현하고 교차 검토해야 한다.

기존 제약과 충돌하는 부분은 JSON `supersedes_constraints`에 정확한 이름을 적었다. `timetable_constraints_engine_support_check`는 partial을 unknown으로 재검증하는 지원상태 계약으로 대체하고 기본값도 unknown이다. 과거 supported도 엔진판 증거가 없으면 재검증한다. `timetable_change_sets_state_check`의 awaiting_peers는 awaiting_consent, awaiting_approval은 ready_for_approval로 매핑한다. 기존 reverted는 원장/역변경 연결을 확인해 applied와 reverts 관계로 보존하며, 근거가 없으면 수동 검토로 보류한다. `timetable_compositions_status_check`와 종료시각·한도·증명에 관한 보조 CHECK 5개의 변경은 4.2절의 전체 진리표를 따른다. 이는 미래 SQL의 명시 전환 요구이며 지금 기존 데이터나 제약을 변경하는 작업이 아니다.

## 10. API와 명령 DTO

공통 scope·idempotency_key·expected_version, 현재 JWT 해석, 오류·감사·outbox 규약은 05를 따른다. 아래는 API 기능군의 추가 세부명령이며 이 이름이 존재한다는 뜻은 아니다.

| 기능군 | 구체화할 명령·입력 | 결과/원자 단위 |
|---|---|---|
| API-29 신규, M09/M15 | `cmd_timetable_basis_preview(scope,term_id)`; `cmd_timetable_basis_confirm(term_id,expected_term_version,preview_sha256,source_manifest_sha256)` | 확정 불변판+학기 포인터+접수증. 원본 바뀌면 재미리보기 |
| API-29 | `cmd_timetable_basis_change_request(base_basis_revision_id,proposed_changes,reason)`; `cmd_timetable_basis_change_decide(request_id,expected_version,decision,preview_sha256)` | requested/검토결과. applied는 관리자 원본 변경+새 basis와 함께 확정 |
| API-18 보강 | import preview/apply에 basis_revision_id, mapping_sha256, source_file_sha256; 조회에는 effective_date/범위/cursor | 매핑 완료한 후보만 생성. 가져오기 성공을 자동배포로 간주하지 않음 |
| API-19 보강 | `cmd_save_timetable_conditions`, `cmd_lock_timetable_conditions`, 기존 start/validate/publish, `cmd_save_timetable_candidate`, `cmd_cancel_composition` | 조건 새판, 실행 ID, 충돌 초안, 불변 후보, 기간별 배포판 |
| API-20 보강 | 기존 propose/respond/apply/revert/execution에 exact source versions·candidate/base/participants 지문·expires_at | 모든 동의자 확인 후 적용. 거절/취소/만료를 상태로 반환 |

API-19 실행 요청 예시는 `{scope:{school_id,term_id}, basis_revision_id, constraint_set_id, base_candidate_id:null|id, input_sha256, expected_term_version, idempotency_key}`다. publish는 여기에 `candidate_id, placements_sha256, validation_sha256, effective_from, effective_to, impact_manifest_sha256`가 필요하다. 서버가 각 지문을 실물에서 다시 계산하며 클라이언트 해시끼리 맞는다는 이유로 검사하지 않는다.

API-20 respond는 `{change_set_id,expected_version,candidate_sha256,base_snapshot_sha256,required_participants_sha256,response}`다. apply는 동일 지문과 모든 source expected_versions를 받고, 승인주체는 JWT로 결정한다. 클라이언트 approved=true를 승인 근거로 사용하지 않는다.

읽기는 `timetable_basis_status / basis_change_requests / composition_status / candidate_diff / publish_impact / my_lessons / timetable_grid / change_candidates / consent_status / execution_ledger`로 분리한다. 교사 조회에 편성 원본 snapshot·개인 불가 사유를 싣지 않는다. 오류는 `BASIS_NOT_CONFIRMED, BASIS_SOURCE_CHANGED, BASIS_VERSION_CONFLICT, CONDITION_UNCONFIRMED, CONDITION_UNSUPPORTED, CANDIDATE_INVALID, CANDIDATE_STALE, SOLVER_UNRESOLVED, CONSENT_STALE, CONSENT_MISSING, CHANGE_EXPIRED, APPROVER_REQUIRED, SELF_APPROVAL_DENIED, RESOURCE_CONFLICT, EXECUTION_ALREADY_RECORDED`를 구별하고 안전한 다음 행동을 제공한다.

## 11. 초·중·고 지원 범위와 검증

DB로 표현할 수 있다는 사실과 자동편성 엔진이 지원한다는 사실은 다르다. `school_timetable_types`의 증거·판을 사용해 **가져오기/조회, 자동편성, 수동조정 검증, 날짜별 변경** 각각의 지원을 확인한다. 알려진 과거 엔진 한계를 현재 해결됐다고 추정하지 않는다. 2026-10-11 검토의 기준 커밋과 재개 시점 엔진의 차이를 다시 검증한다.

| 학교 운영형 | 필수 시험 |
|---|---|
| 초등 | 학년별 다른 하루 교시, 담임 중심 수업+전담, 실제 비수업 칸, 쉬는 시간·블록 |
| 중등 학급 중심 | 교과별 시수, 교사 중복, 특별실 용량, 고정수업, 업무 불가시간 |
| 고교 선택·분반 | 행정학급과 실제 참여집단 분리, 동일 학생 수강 중첩, 합반·팀티칭, 참여기간 변경 |
| 복수 캠퍼스/공동수업 | 이동시간·외부 교사 자원·학교 간 자료 경계. 미지원이면 명시 차단 |
| 격주/특수 일과 | 회차·순환주·소수 시수·기간별 일과가 손실 없이 입력·출력·검증되는지 |

지원되지 않는 자동편성은 명확히 보류한다. 외부에서 만든 표를 가져오는 대안도 해당 모델의 독립 검증기가 모든 필수 충돌을 검사할 때만 배포할 수 있다. AI를 끄거나 사람이 직접 배치했다는 이유로 검증 한계를 우회하지 않는다.

## 12. 구현 티켓과 인수 기준

`TT-T01 기준자료/권한 DTO → TT-T02 기준자료 불변판·수정요청 → TT-T03 조건·엔진 adapter → TT-T04 조정 작업대 → TT-T05 배포·공유 → TT-T06 교환·동의·승인 → TT-T07 실시·보강 → TT-T08 메신저/홈 연결·학교형 종단검증` 순서다. 실제 DB/시간표 구현 재개 승인 전에는 인터페이스·합성 fixture·설계 검토까지만 진행한다. SQL 확정·실행·메뉴 공개를 티켓 완료의 암묵적 권한으로 취급하지 않는다.

각 티켓의 산출물과 인수시험은 JSON tickets/tests에 적었다. 핵심 인수는 관리자 자료를 담당자가 바꾸지 못함, 미지원 조건을 누락하지 않음, 충돌 초안은 저장하지만 배포 불가, 당사자 전원 최신판 동의, 자기승인 불가, 두 연결 경합에서 부분 반영 0건, 과거 실시/학생자료 보존, 신규 주간표가 미래 교환을 없애지 않음, AI 장애에서도 수동 운영 가능이다. 테스트 상태는 모두 `required_not_run_on_integrated_ddl`이며 이번 문서 검증을 운영 시험 통과로 표시하지 않는다.

## 13. 판단해서 정한 기본값과 변경 위치

| 기본값 | 이유 | 바꾸려면 |
|---|---|---|
| 관리자 기준자료 확정 후 담당자 편성 | 시수·공식 배정과 시간배치 권한을 분리 | 1·3절, API-29, 권한 계약을 함께 검토 |
| 충돌 초안 저장 허용, 배포는 hard 충족 필수 | 조정 과정의 중간 상태를 잃지 않음 | 5·6절과 candidate publish 검증 변경 |
| 교환은 모든 관련 교사 동의+담당 최종 승인 | 초기 운영의 책임·정합성을 명확히 함 | 학교별 승인정책 새판과 인수시험 필요 |
| 담당자 자기 요청은 지정 대리 승인 | 단독 신청·승인으로 다른 교사 일정 변경 방지 | 공통 자기승인 정책과 7절을 함께 검토 |
| 날짜별 변경과 주간 기본표 별도 | 이번 한 번과 매주 변경의 혼동 방지 | 6·7절의 원장 의미 변경은 DB 재검토 필요 |
| 기본자료 신설은 2표로 제한 | 기존 26표를 재사용하고 중복 모델 방지 | JSON changes와 통합 계약 집계 동시 수정 |

참고: `03-students-timetable.md` 7절, `05-api-site-contract.md` API-18~20, `Claude_시간표AI설계_인계요구사항.md`, `시간표알고리즘_검토보고서_2026-10-11.md`. 기존 엔진의 현재 구현 범위는 재개 시 실제 코드와 시험 결과를 기준으로 갱신한다.
