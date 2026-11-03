# 대화 업무 연결 검증

검증일: 2026-11-04 KST. 작업 브랜치 `feat/assistant-workflows`.

## 시작 기준

- #109 병합 및 main 기준: `0ef685372b90340dcea920aa43f6d67776192d9a`.
- GitHub 연동 Vercel `Production – daedong` 배포 7521718915: 같은 SHA, `success`, `Deployment has completed`.
- 운영 주소 `https://daedong-school.vercel.app/`: HTTP 200. 응답 자산 `index-DWxRFTOA.js`, `index-GAlIjEbl.css` 확인.
- 개별 Vercel 배포 주소는 로그인 보호로 이동하므로 그 주소의 내부 화면을 확인했다고 보지 않는다.
- main 검사 [41655856582](https://github.com/EggPlayer88/daedong/actions/runs/41655856582): 확인 당시 기본 시험·SQL 통합·빌드 성공, 전체 브라우저 시험 진행 중. 최종 상태는 PR 설명과 작업 보고에서 다시 확인한다.

## 로컬 자동 검증

| 구분 | 결과 |
|---|---:|
| `npm test` | 5,334건 통과, 실패/생략 없음 |
| 신규 명령 파서 | 36건 통과 |
| 신규 일정 초안 계약 | 9건 통과 |
| 신규 대화 자료 조회 | 8건 통과 |
| `npm run check:workhub` | 통과 |
| `npm run build` | 통과, 기존 500kB 번들 경고 유지 |
| 관련 브라우저 회귀 | 14개 파일 모두 통과 |
| 신규 대화 업무 브라우저 | 13건 통과 |
| 신규 일정 수신·복구 브라우저 | 8건 통과 |
| 신규 실제 연결 화면 브라우저 | 6건 통과 |

신규 단위 53건은 `npm test` 합계에 포함된다. 신규 브라우저 27건은 14개 파일 결과에 포함되며 기본 시험과 중복 합산하지 않는다.

관련 브라우저 실행 명령:

```sh
node tests/browser/run.mjs assistant global-search calendar-recovery calendar-views navigation-ui home-layout connection-exit
```

추가로 기존 학교 AI 정책 브라우저 15건도 통과했다. 320px 화면·큰 글자, 선택 근거와 과거 판, 미확정 요청 복구, 학교 변경·권한 철회를 다룬다. 실제 모바일 운영체제 키보드 검증은 아니다.

## 중요 확인

1. 예산이 닫혀 있어도 명시한 무료 이동/검색은 가능하며, 기존 AI 요청이나 정밀 검토가 자동 발생하지 않는다.
2. 할 일은 기존 Haiku 요청 한 번을 거친다. 내용 수정→확인→확정 후에만 저장하며, 응답 유실 후 같은 키로 복구해 저장 건수가 늘지 않는다.
3. 문서 결과의 ID/판과 학교 자료의 ID/판/위치가 기존 원본 조회에 전달된다. 현재 판으로 조용히 바꾸지 않는다.
4. 검색 중 취소·재검증·학교 변경은 결과를 폐기한다. 부분 조회와 조회 실패를 전체 0건으로 표시하지 않는다.
5. 일정은 개인 초안만 열고 자동 저장하지 않는다. 명시한 날짜·시각을 보존하고 기존 입력/미확정 저장을 덮어쓰지 않는다.
6. 같은 일정 전달을 재마운트 후 다시 받더라도 소비하지 않는다. 저장 응답 유실도 기존 일정의 같은 번호 복구로 처리한다.
7. 선택한 학생/문서 근거, 인용·부정·가정 문장, 잘못된 날짜·시각을 실행 명령으로 처리하지 않는다.
8. `database/`, `migrations/`, `packages/shared/`, `apps/main/api/`, 메뉴 공개 레지스트리 변경 없음.

## 시험 범위와 화면

실제 React·어댑터·parser에 합성 DB/AI 응답을 연결했다. 운영 학교 자료를 쓰거나 유료 AI를 호출하지 않았다. 새 기능의 실제 운영 왕복 완료를 의미하지 않는다.

- [자료 조회와 원본 열기](screenshots/assistant-workspace-search.png)
- [할 일 내용 확인](screenshots/assistant-task-review.png)
- [모바일 대화 화면](screenshots/assistant-workspace-mobile.png)
- [기존 일정 편집기로 전달](screenshots/assistant-calendar-draft.png)

브라우저 파일은 `tests/browser/run.mjs`에 등록되어 PR CI에서도 전체 회귀에 포함된다. SQL 적용 없이 앱 병합·배포로 반영하며, 병합은 사용자가 한다.
