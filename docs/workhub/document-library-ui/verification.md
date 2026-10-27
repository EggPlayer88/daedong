# 문서 작업 화면 자동 검증

2026-10-27 · Windows / Chrome. 기준 main `5f8844b` (#90).

| 검사 | 최종 결과 |
|---|---:|
| `npm test` | **5,204 / 0** |
| 관련 브라우저 회귀 | **14개 파일 · 207개 항목 / 실패 0** |
| 새 UI 회귀 | 위 결과에 포함된 **13건** |
| 문서 스킨·대비·큰 글씨 | 위 결과에 포함된 **22건** |
| `npm run check:workhub` | 통과 |
| `npm run build` | 통과 |
| `npm run build:workhub` | 타입 검사·빌드 통과 |
| `npm run check:workhub:design` | 통과 · 오류 0 |
| `git diff --check` | 통과 |

운영 앱의 기존 500kB 초과 청크 경고는 남아 있다. 이번 UI 작업에서 번들 분리 구조를 변경하지 않았다.

## 브라우저 범위

```text
node tests/browser/run.mjs workhub-document workhub-guided workhub-knowledge workhub-pilot-connected workhub-ui-polish workhub-workflow-ui
```

| 시험 파일 | 항목 |
|---|---:|
| workhub-ui-polish | 6 |
| workhub-workflow-ui | 5 |
| workhub-document-library-ui | 13 |
| workhub-document-collection-flow | 10 |
| workhub-guided-setup | 17 |
| workhub-document-open | 18 |
| workhub-document-review | 27 |
| workhub-knowledge-assistant | 20 |
| workhub-guided-ai | 15 |
| workhub-knowledge | 10 |
| workhub-knowledge-import | 11 |
| workhub-pilot-connected | 18 |
| workhub-documents | 15 |
| workhub-document-appearance | 22 |
| **합계** | **207** |

[실행기 결과](browser-results.json), [새 화면 13건 결과](ui-results.json).

## 보존을 확인한 동작

- 단계 바로가기는 초점·스크롤만 이동하고 미저장 질문·답변·원문 위치를 보존한다. 자동 저장·AI 호출·파일 생성은 0건이다.
- 일반 응답자에게 질문 편집·게시 조작을 새로 노출하지 않는다.
- 파일을 내려받고 직접 확인하기 전에는 게시·첨부가 잠긴다. 게시에는 기존 수합 선택도 필요하다.
- 생성 후 답변을 바꾸면 옛 생성물 확인·게시 영역이 사라진다.
- 기존 파일 생성→수합 첨부→초안 저장→최종 제출→전체 ZIP 흐름이 통과한다. 합성 응답과 실제 Python 생성·검사 결과를 대조한다.
- 응답 유실·늦은 응답·학교 변경·권한 회수·충돌·정확한 과거 판·인쇄 팝업 차단 회귀가 통과한다.
- 320px, 글자 200%, 밝음·어두움·웜 스킨에서 가로 넘침·키보드 접근·입력 보존과 대비를 확인한다.

## 수정 과정에서 발견한 사항

- 수합 선택 칸에 명시적인 접근성 이름을 추가했다. 연결·버전·게시 명령과 유효성 조건은 그대로다.
- 추천 영역에 보조 배경을 쓰면서 기존 스킨 시험의 단일 배경 가정이 맞지 않았다. 해당 영역의 배경 토큰을 별도로 대조하고 설명 글의 실제 부모 배경 대비도 검사하도록 강화했다. 이 검사로 웜 스킨의 낮은 대비를 찾아 추천 설명 글색을 보완했다. 4.5:1 기준은 유지했다.
- 간소화한 설명에서 담당자가 방식을 결정한다는 기존 안내가 빠져 텍스트 회귀 1건이 실패했다. 짧은 문장으로 안내를 복구한 뒤 전체 5,204건을 다시 통과했다.
- 기존 문서·학교 자료 합성 fixture를 공용 파일로 옮겼다. 기본 응답과 이전 시험의 기대값은 그대로이며 새 UI 회귀도 같은 응답을 사용한다.

## 검증 경계와 배포

### PR #91 검사 후 수업 일괄 등록 시험 보완

- 첫 원격 실행 `40442412820`은 브라우저 파일 141개 중 140개가 통과했다. 새 문서 화면 13건은 통과했고, 기존 `workhub-course-batch`의 학교·계정 전환 시나리오만 실패했다.
- React가 새 계정 화면을 반영하기 전에 시험이 이전 계정의 열린 관리 영역을 확인했다. 이후 새 화면에서는 관리 영역이 접혀 있어 `수업 여러 개 등록` 버튼을 12초 기다리다 끝났다.
- 합성 fixture에 현재 학교·소속 표시를 넣고, 시험이 새 계정 렌더를 확인한 뒤 관리 영역을 열도록 바꿨다. 고정 대기시간이나 재시도를 추가하지 않았으며 원래 CSV·완료 응답의 격리 검증도 유지했다. 앱·권한·전송 로직은 바꾸지 않았다.
- 해당 브라우저 파일을 **5회 연속 실행하여 매회 9건 통과**를 확인했다. 전체 `npm test` 재검사와 새 원격 CI 결과는 PR에 기록한다. 최초 로컬 재검사는 Windows 샌드박스의 임시 폴더 접근 거부가 발생하여 정상 실행 권한으로 다시 진행했다.

실제 React·어댑터·파서·파일 관련 기존 회귀를 사용하되 DB·Storage 응답은 합성이다. 운영 Supabase, 실제 교사 계정, 유료 AI는 호출하지 않았다. 로컬 브라우저 시험 통과를 운영 배포 확인으로 보지 않는다.

DB·SQL·권한·인증·공개 범위·AI 모델/비용·파일 생성 엔진·자산 변경은 없다. 추가 SQL이나 환경변수는 필요하지 않다. PR의 원격 GitHub CI·Vercel 미리보기는 별도이며, 사용자 병합 후 Production 커밋을 확인한다.
