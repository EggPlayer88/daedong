# T4 — 실제 시간표 가져오기

신규 증분 SQL이다. 운영 적용 전 전체 묶음 검토를 먼저 한다. 기존 T1·T2 파일은 다시 실행하거나 수정하지 않는다.

## 동작

1. 현재 선택 학기의 공식 수업·교사·학급·공간을 조회한다.
2. 담당자가 CSV의 수업 ID와 배치를 명시적으로 연결한다. 동명이인·비슷한 과목명으로 추정하지 않는다.
3. 클라이언트와 서버가 수업 전체 포함, 주당 시수, 자원 충돌, 현재 자료 판을 확인한다.
4. 서버 미리보기의 유효기간은 10분이다. 입력·현재 자료·현재 기준판을 지문에 함께 넣는다.
5. 확인하면 기존 T1 준비 확정과 편성 초안 저장을 **같은 트랜잭션**에서 처리한다. 두 번째 저장이 실패해도 첫 번째만 남지 않는다.
6. 접수증의 `published`는 항상 `false`다. 실제 공개는 기존 T2의 적용 기간·영향 비교·확정 절차를 따로 거친다.

기존 공개본, 날짜별 수업, 교환·휴업·실시 기록을 가져오기가 직접 수정하지 않는다. 기존 기준판에 고정·불가 조건이 있으면 가져오기를 차단한다. 이를 조용히 제거하지 않고 편성 화면에서 조건을 확인하도록 한다.

## 입력 양식

`lessonId,courseId,day,label,start,end,periods,teacherIds,classIds,roomIds`

- `day`: 월요일 1~일요일 7.
- 시각: 학교의 주간 일과 기준 `09:00` 형식. 종료 `24:00`은 가능하되 자정을 넘기는 수업은 거부한다.
- 여러 교사·학급·공간 ID는 `|`로 구분한다.
- 한 수업의 연결 자원은 현재 공식 수업 연결과 정확히 같아야 한다. 다른 교사로 바꾸려면 먼저 P10 등의 공식 관계 정정을 완료하고 다시 조회한다.
- 선택 학기의 모든 수업이 있어야 한다. 일부 CSV 때문에 기존 수업을 누락시키지 않는다.
- 학교 양식의 활동 ID는 수업 ID 해시로 생성하여 목록 순서가 바뀌어도 유지한다.
- 9학급 연습 양식은 배치만 담고 실제 수업·교사 ID를 비워 둔다. 가상 교사의 동의·승인·실시 기록은 서버에 복사하지 않는다.

## 계약

응답 envelope: `{contract:'timetable-import.v1',schoolId,memberId,data}` 또는 `error:{code}`.

| RPC | 인자 | 응답 |
|---|---|---|
| `workhub_timetable_import_get` | `p_member_id` | 기존 `PreparationSource` |
| `workhub_timetable_import_preview` | `p_member_id,p_input` | `previewId,fingerprint,expiresAt,input,termId,lessonCount,courseCount,existingPublicationsPreserved:true` |
| `workhub_timetable_import_commit` | `p_member_id,p_command,p_request_key` | `requestKey,previewId,termId,basisId,basisRevision,draftId,draftVersion:1,lessonCount,recordedAt,published:false` |
| `workhub_timetable_import_close` | 위와 같음 | `requestKey,outcome:'applied'|'closed',receipt` |

`input={preparation,placements,title,fileHash}`. `preparation`은 기존 T1 `confirm` 입력이다. `command={previewId,fingerprint,input}`.

같은 학교 잠금 안에서 적용과 닫힘을 결정한다. 원 요청을 다시 보내면 원접수증을 우선 반환한다. 현재 모듈 중지·미리보기 만료로 이미 반영된 결과를 잃지 않는다. 본인 계정·현재 학교 소속과 **기존 관리자 권한**은 복구·닫기에도 계속 확인한다. 권한이 없어지면 자동으로 잠금을 풀거나 새 요청을 만들지 않는다.

닫기가 먼저 끝나면 늦게 도착한 저장은 거부한다. 저장이 먼저 끝나면 닫기는 원접수증을 돌려준다. 미리보기와 접수 원장은 수정·삭제를 막는다.

## 실행 전제와 순서

운영 실행을 승인하는 문서가 아니다. 검토가 끝난 버전에서 다음 순서로 진행한다.

1. T1 기본 및 T1-07이 설치되었는지 확인한다. 실제 자료를 쓸 때는 학교 자료·수업·교사 연결과 필요한 P9/P10 정정을 먼저 완료한다.
2. 기존 설치 상태를 해당 통합 점검으로 확인하고 결과를 저장한다.
3. SQL Editor의 `postgres` 역할로 `T4-01_정식시간표_가져오기.sql`을 한 번 실행한다.
4. 읽기 전용 `T4-02_가져오기_사후점검.sql`의 5행이 모두 `ok`인지 확인한다. 실패하면 활성화·가져오기를 진행하지 않는다.
5. 앱 배포 이후 공식 자료 조회 → CSV 비교 → 초안 저장 → 별도 공개 검토 순으로 확인한다.

T4에는 독립 활성화 양식이 없다. 기존 시간표 편성 모듈과 관리자 권한을 그대로 사용한다. 새 SQL 설치가 일반 교사 메뉴를 공개하지 않는다. 삭제·원상복구 SQL도 제공하지 않는다. 이미 생긴 기준판·초안·접수 원장을 보존한 채 사용을 중지한다.

## 자동 검증

```sh
P9_PG_BIN=/path/to/postgresql17/bin \
T4_CAPTURE=/tmp/t4-responses.json \
python database/workhub-timetable/t4/test/run_t4.py
T4_CAPTURE=/tmp/t4-responses.json node tests/test_workhub_timetable_import.mjs
PLAYWRIGHT_CHANNEL=chromium node tests/browser/workhub-timetable-import.mjs
```

시험은 임시 디렉터리·새 로컬 PostgreSQL 17을 사용한다. 운영 DSN을 받지 않는다. 동시 적용/닫기, 중복 키, 중간 실패의 원자 롤백, 만료, 판 충돌, 권한, 불변 원장과 앱 실제 응답 검증을 포함한다. 실제 Supabase/PostgREST와 교사의 Excel 파일 확인은 이 시험의 범위에 포함되지 않는다.
