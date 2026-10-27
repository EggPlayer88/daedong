# 학교·수업·학생 기록 화면 검증

2026-10-27, Windows·Chrome. 기준은 #89 병합 커밋 `22ecd9909eff07fd0bfbfa1881ff9d2614b92401`이다.

## 결과

| 검사 | 결과 |
| --- | --- |
| `npm test` | **5,204건 전부 통과** |
| 관련 브라우저 회귀 | **20개 파일 / 279개 항목 통과**, 수정 후 해당 파일 재실행 포함 |
| 새 학교·수업·학생 기록 UI 회귀 | 위 279건에 포함된 **10건 통과** |
| 학생 기록 CSV·인쇄·화면 회귀 | 위 279건에 포함된 **21건 통과** |
| `npm run check:workhub` | 통과 |
| `npm run build` | 통과 |
| `npm run build:workhub` | 타입 검사·빌드 통과 |
| `npm run check:workhub:design` | 통과, 오류 0 |
| `git diff --check` | 통과 |

운영 앱 빌드의 500kB 초과 청크 경고는 남아 있다. 이번 작업에서 기존 기능의 번들 구성을 바꾸지 않았다.

## 실행 범위

```text
npm test
node tests/browser/run.mjs workhub-school workhub-teaching workhub-course-batch workhub-roster workhub-home-student workhub-record-export workhub-relations-list workhub-pilot-connected workhub-ui-polish workhub-appearance
node tests/browser/run.mjs workhub-school-records-ui workhub-school-data-maintenance
node tests/browser/run.mjs workhub-school-records-ui workhub-record-export
npm run check:workhub
npm run build
npm run build:workhub
npm run check:workhub:design
```

실제 React·전송 어댑터·입력 보호 코드를 사용했고 DB 응답은 합성 자료다. 운영 Supabase·실제 교사 계정·유료 AI를 호출하지 않았다. 새 UI 회귀는 외부 네트워크 요청과 브라우저 오류가 모두 0인지 확인했다.

## 새 화면 회귀 10건

1. 학교 구성 45학급 검색·마지막 페이지 조회. 목록 이동으로 쓰기 호출 0.
2. 학교 구성 입력 바로가기의 키보드 초점, 학교·교과 미저장 값과 전체 검토 유지. 검토만으로 쓰기 호출 0.
3. 선택한 수업이 검색에서 빠져도 해당 수업·학생 유지. 상담 선조회 0.
4. 담당 교사 검색으로 기존 선택·수업명·학기 기간이 지워지지 않음. 명시 저장 전 쓰기 호출 0.
5. 도구 접기 후 관찰 입력·이동 잠금 유지. 저장 응답 유실 뒤 원래 명령·요청 번호로 복구하고 실제 기록은 한 건.
6. 평가 확인은 처음에 체크되지 않음. 교사 확인 뒤 당시 기준판·점수가 그대로 전송되고 상담 선조회 0.
7. 자료 정정의 학생 45명 검색·페이지 이동. 정정 영향 확인 후 명시 동의 전 반영 차단.
8. 관리 권한이 없는 응답에서는 접힌 영역에도 수업 등록 버튼 없음.
9. 320px·글자 200%·어두운 스킨의 학생 기록 입력, 가로 넘침 없음과 키보드 저장 버튼 접근.
10. 같은 작은 화면 조건의 학교 구성 입력, 입력 색상·키보드 바로가기·미저장 값 유지.

기존 회귀에서는 수업·명부 일괄 입력, 활동 원문 정정, 학생 식별 일치, 관계 영향 비교, 충돌·응답 유실 복구, 권한 변경, 상담 분리, 평가 기준판, 기록 출력·CSV 수식 보호, 다중 페이지·학교 변경·팝업 차단·큰 글씨를 확인했다.

## 수정하며 확인한 문제

- Windows 제한 실행 환경에서는 임시 파일과 로컬 서버 접근을 사용하는 시험이 실패했다. 같은 검사를 일반 실행 권한에서 다시 돌려 전체 5,204건 통과를 확인했다. 운영 권한을 추가하거나 테스트 기대값을 낮추지 않았다.
- 관리 버튼을 펼치는 실제 사용자 동작을 기존 브라우저 시험에 추가했다. 미리보기·확인 체크·전송 횟수·원래 요청 번호 검사는 유지했다.
- 기록 출력 시험의 옛 한 문장 선택자를 분리된 수업명과 학생 수 확인으로 바꿨다. 이어서 발견한 긴 수업명·학생명의 가로 넘침은 제목 부모와 보조 문구의 줄바꿈으로 수정했다. 최종 출력 시험 21건과 새 UI 10건이 다시 통과했다.
- 교사 검색의 선택 보존과 관리 권한 응답을 검증하려고 기존 teaching fixture를 공용 파일로 옮겼다. 기본 합성 응답은 그대로이고 관리 권한 전환 hook만 추가했다.

## 운영 확인과 다음 단계

- #89 병합 커밋 `22ecd99`와 Vercel **Production success**가 일치한다. 배포 ID `7347634077`, 생성 시각은 **2026-10-27 10:07:23 KST**다.
- 이번 UI 변경은 별도 작업 브랜치에 있다. 새 PR의 GitHub CI·Vercel 미리보기는 PR에서 별도로 확인한다. 위 숫자는 로컬 자동 검증 결과다.
- 추가 SQL·환경변수는 없다. DB·인증·비용·권한·메뉴 공개 범위·실제 교사 소속은 변경하지 않았다.
- 사용자 병합 후 해당 병합 커밋의 운영 배포를 확인한다. 운영 자료를 변경하는 실사용 시험과 Claude 검토는 이번 범위에 포함하지 않았다.
