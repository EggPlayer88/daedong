-- 설치·앱 배포 뒤, 지정 계정만 승인한다. 회원/학교 역할을 올리지 않는다.
-- expectedRevision: 신규 0, 변경/연장은 OP1 관리 화면에서 확인한 현재 판.
-- scopes는 아래 예시의 연결 업무를 포함한다. 필요 없는 업무는 의존 관계와 함께 제거한다.
-- 종료는 현재부터 최대 7일. 기간이 지나면 예약 작업 없이 매 요청에서 차단된다.
BEGIN;
SET LOCAL lock_timeout='5s';
SELECT workhub_private.op1_set_grant($input$
{
 "confirm":false,
 "schoolId":"<학교 ID>",
 "userId":"<기존 시험 계정 Auth UID>",
 "memberId":"<같은 계정의 학교 소속 ID>",
 "adminUserId":"<승인한 기존 학교 관리자 Auth UID>",
 "scopes":["messages","tasks","calendar","cooperation","collections","transitions","teaching","timetable"],
 "active":true,
 "expiresAt":"<최대 7일 이내 종료 시각과 시간대>",
 "expectedRevision":0,
 "approvalRef":"<승인 일시와 범위>",
 "appDeployRef":"<OP1 앱 배포 커밋과 확인 근거>"
}
$input$::jsonb);
COMMIT;
