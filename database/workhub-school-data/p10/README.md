# P10 학교 자료 정정·보관

기존 회원·로그인·역할·메뉴 공개 범위와 이미 적용한 SQL 파일을 유지하면서 P9-C의 실제 작업 경로를 추가한다. 운영 실행은 하지 않았다. 새 SQL은 사용자 검토·승인 후 적용한다.

## 가능한 작업

| 작업 | 처리 | 반드시 막는 경우 |
|---|---|---|
| 수업 이름·기간 정정 | 같은 수업 ID, 다음 판, 변경 전후 원장 | 학기 밖, 담당·수강 기간 절단, 공개 시간표가 있는 수업의 기간 변경 |
| 시작 전 담당 정정 | 이전 담당은 시작 전 취소 사건으로 보존, 새 담당은 수업 전체 기간 | 이미 시작함, 기록·평가 기준·활동 원문이 있음, 공개 수업이 있음, 소속 기간 미충족 |
| 잘못 등록한 수업 취소 | 원행·관계·ID 보존, 새 기록·편성 원천에서 제외 | 기록 또는 공개 시간표가 있음 |
| 수업 보관·복원 | 새 쓰기를 막고 과거 조회를 유지, 보관 상태만 원래 ID로 복원 | 남은 공개 수업이 있음 |
| 학생 이름·관리 번호 정정 | 원래 학생 ID와 기록 연결 보존 | 학교 안 관리 번호 중복 |
| 학생 학년·반·번호 정정 | 원래 학적 ID와 수강 연결 보존 | 같은 학년도 좌석 중복, 학교 학년 초과 |
| 잘못 등록한 학생 취소·복원 | 원래 ID·관계를 남김, 취소 학생에게 새 기록/수강 금지, 같은 ID 복원 | 이미 기록·평가·활동 채택 이력 또는 공개 수업이 있음 |

수업 **취소 후 복원은 이번 범위에 없다**. 화면의 복원은 ‘보관 수업 복원’이다. 학생은 등록 취소 후 복원이 가능하다. 과거 수업 담당을 새 교사로 덮어쓰지 않는다. 이미 시작한 수업은 기존 P8 담당·수강 관계 변경 흐름을 사용한다.

학기·교과·학급 등록은 P1, 수업/명부 생성은 P5, 중도 담당·수강 변경은 P8, 기존 가입 교사 연결은 P9를 계속 사용한다. P10은 이름으로 교사를 추정하지 않고 소속 ID만 받는다. 가상 교사와 로그인 계정을 만들지 않는다.

## 설치·켜기·중지 순서

1. 기존 통합 점검을 저장한다. R0부터 P8/T1/T2/P9-01·02가 설치되어 있어야 한다.
2. `P10-01_정정_모델과함수.sql` 실행: 신규 원장·내부함수·RPC. **비활성 설치**다.
3. `P10-02_기존쓰기와시간표_보호.sql` 실행: 승인된 기존 함수·트리거·제약 지문이 정확히 같을 때만 보호를 보강한다. 하나라도 다르면 전체 파일을 되돌리고 멈춘다.
4. `P10-04_사후점검.sql` 실행: 9행, FAIL 0. 이후 T3/T4를 포함한 릴리스 통합 점검도 실행한다. 기존 T2-07/P9-05는 P10으로 의도적으로 바뀐 함수·트리거를 알지 못하므로 최종 전체 통합 점검을 대신하지 못한다.
5. 앱 배포 확인 후 사용자 승인으로만 `P10-03_정정기능_승인양식.sql`의 학교 ID·기존 관리자 Auth UID·승인 근거·앱 배포 근거·켜기 값을 직접 입력한다. 수업 모듈이 활성화되어 있어야 한다. 양식은 기능만 켜고 어떤 자료도 정정하지 않는다.
6. 중지할 때는 `P10-80_정정기능_비파괴중지.sql`. 원자료·원장·접수증은 남긴다. 현재 본인·소속·관리 권한이 유지되면 원래 번호의 결과 확인과 명시적 요청 닫기가 계속 가능하다. 재개는 새 승인 근거로 P10-03을 다시 실행한다.

기본 비활성이지만 P10-02 설치 후 무단 원자료 수정 보호와 실효 기간 기준 담당 중복 검사는 즉시 적용된다. 새로 취소·보관된 자료는 기능을 끈 뒤에도 기존 쓰기 경로에서 보호된다.

## 계약

계약명 `school-data-maintenance.v1`, 공통 봉투는 `{contract,schoolId,memberId,data}` 또는 `error:{code}`. 현재 학교의 `year.manage` 권한을 가진 관리자가 이용한다. 기존 `member_actor`와 legacy gate를 바꾸지 않는다.

- `workhub_school_data_get(p_member_id, p_course_id nullable)` — 사용 가능 상태, 학교 수업 목록, 선택 수업과 학생·학적, 담당 후보 및 소속 기간. 불가 상태는 내용 없는 목록. 수업/학생 최대 2,000개, 후보 300개이며 초과 시 부분 목록을 성공처럼 반환하지 않는다.
- `workhub_school_data_preview(p_member_id,p_intent)` — `{kind,courseId,entityId,expectedVersion,changes,reason}`. 응답 `{previewId,fingerprint,expiresAt,intent,allowed,blockers,impact,before,after}`. 10분 유효하며 반영 직전에 원본을 다시 검사한다.
- `workhub_school_data_commit(p_member_id,p_command,p_request_key)` — command `{previewId,fingerprint,intent}`. 접수증 `{requestKey,kind,entityId,version,recordedAt}`. 원래 키·원문이면 기존 접수증을 먼저 반환한다. 만료된 미리보기나 중지된 모듈이라도 이미 적용된 결과 확인은 유지한다.
- `workhub_school_data_close(p_member_id,p_command,p_request_key)` — `{requestKey,outcome:'applied'|'closed',receipt}`. 이미 적용되었으면 원접수증, 아니면 취소 장벽을 남긴다. 닫은 뒤 늦게 도착한 동일 명령은 반영되지 않는다. 닫기 응답이 끊기면 닫기만 같은 번호로 다시 확인한다.

`kind`: `course_correct`, `course_teacher_correct`, `course_cancel`, `course_archive`, `course_restore`, `student_correct`, `enrollment_correct`, `student_void`, `student_restore`.

- `course_correct.changes`: label/validFrom/validThrough 전부.
- `course_teacher_correct.changes`: teacherMemberIds 중복 없는 소속 ID 배열.
- `student_correct.changes`: name/schoolStudentKey 전부.
- `enrollment_correct.changes`: grade/classLabel/seatNumber 전부.
- 취소/보관/복원 changes는 빈 객체.

새 제출 전 오류는 `INVALID_INPUT` 등 확정 거절, 서버로 보낸 뒤 응답을 확인하지 못하면 `RESULT_UNKNOWN`이다. 결과 미상에서 단순 CONFLICT만 보고 잠금을 풀지 않는다. 원키 재조회 또는 서버의 명시 닫기 결과가 필요하다. 입력/복구는 이 탭 메모리이며 브라우저 종료 후 복원을 약속하지 않는다.

## 무결성과 연동

- 학기·기준판과 공통 학교 잠금(`t1_lock`) 아래에서 미리보기 지문·원본 판을 재확인한다. 동일 요청 적용과 닫기는 둘 중 하나로만 확정된다.
- 정정 전후 원장은 같은 트랜잭션의 전체 원행을 저장한다. 기존 불변 ID·학교·생성자·원래 기록은 바꿀 수 없다.
- 기존 P5 기록·평가·활동·명부·수강과 P8 관계 종료, T1 수업 연결, T2 예정/실시 수업 쓰기에도 상태 보호를 적용한다. 취소/보관 수업은 새 T1 원천에서 제외한다.
- 취소된 과거 담당 행 때문에 재배정이 막히지 않도록 기존 원기간 EXCLUDE를 **수업 잠금 + P8 실효 기간 겹침 검사**로 교체한다. 실제 겹치는 담당을 허용하지 않는다. 원래 EXCLUDE 정의가 다르면 설치를 거부한다.
- 미래 담당 정정은 공개/기록 없는 계획 수업만 대상으로 하며 이전 담당자로 되돌릴 때도 원행을 지우지 않고 새 담당 행을 추가한다.
- API 역할에게 표 접근 권한을 주지 않는다. private 함수는 API 실행 불가. 공개 4개 함수는 authenticated만 실행한다.

## 자동 검증

Windows PowerShell (운영 DSN 입력 없음):

```powershell
$env:P9_PG_BIN='C:/path/to/postgresql17/bin'
$env:PYTHONTZPATH='C:/path/to/postgresql17/share/timezone'
$env:P9_TEST_PORT='55549'
$env:P10_CAPTURE='C:/temp/p10-captures.json'
python database/workhub-school-data/p10/test/run_p10.py
node tests/test_workhub_school_data_maintenance.mjs
```

Python `psycopg2`, PostgreSQL 17, Node/의존 패키지가 필요하다. Linux는 PostgreSQL 실행 사용자(root 아님)로 실행한다. 새 임시 클러스터를 localhost 높은 포트에 만들며 외부 DSN을 받지 않고 끝나면 중지한다. R0~P8/T1/T2/P9 실제 원문을 먼저 설치한 뒤 P10을 시험한다.

시험 범위: 같은 ID 정정·복원, 미래 전체기간 담당 교체/되돌림, 과거 행 보존, 보관/취소 후 기존 쓰기 차단, T1 원천 필터, T2 새 수업 차단, 미리보기 만료, 원본 변경, 적용/닫기 경쟁, 권한 회수, 다른 학교 접수증 격리, 비활성 기본값, 승인/중지 양식, 보호 트리거 훼손 점검. 실제 SQL 응답을 앱 parser에 넣는 대조와 React 브라우저 입력·복구 시험도 별도로 실행한다.

실제 운영 Supabase/PostgREST 왕복, 운영 자료 정정, 실제 교사 공개는 이번 자동 시험의 증거에 포함하지 않는다.
