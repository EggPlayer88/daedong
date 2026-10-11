# T01 — 기존 시스템 착수 기준선

작성일: 2026-10-11. 이 문서는 기존 서비스를 보존하면서 새 업무 흐름을 구축하기 위한 **소스·자산·회귀검사 기준선**이다. 운영 사이트나 DB를 조회한 실사 보고서, 새 앱의 배포 완료 보고서가 아니다. T01에서 작성한 것은 이 문서와 [자산 지문 목록](./baseline-assets.json) 두 파일뿐이다.

## 1. 기준과 확인 범위

| 구분 | 고정한 기준 |
|---|---|
| 기준 main | `6165bcc45c13f4bb8534b43ce853dd6729cab1fc` |
| 조사한 HEAD | `2ebdba7373feedbb18b73abf4d6237697a33dd97` |
| HEAD의 추가 변경 | Windows 회귀시험 경로·번들·Python 선택 및 체크아웃 줄바꿈 보완. [PR #2](https://github.com/EggPlayer88/daedong/pull/2) |
| 준수 규칙 | 저장소 `CLAUDE.md` 전체 및 `AGENTS.md`. 승인 대상과 보호 자산 경계를 유지한다. |
| 이번 증거 | 위 커밋의 로컬 소스·Git 원본 바이트, Windows 시험 출력 및 GitHub checks 조회 결과 |

조사 HEAD와 기준 main 사이의 차이는 테스트·개발 의존성·문서·`.gitattributes`에 한정된다. 보호 자산 37개는 두 커밋에서 모두 동일하다. 같은 작업 공간에서 진행 중인 `apps/workhub/**`와 관련 테스트·패키지 변경은 새 앱 담당자의 별도 변경이며, 그 결과를 이 기준선의 기존 검증 결과로 합산하지 않는다. 이 문서는 PR 병합이나 운영 반영이 완료됐다고 전제하지 않는다.

## 2. 기존에 노출되는 화면 — 소스 기준

근거는 `apps/main/src/lib/modules.js`의 `MODULES`와 `visibleModules()`, 이를 라우트 생성에 사용하는 `apps/main/src/App.jsx`다.

| 모듈 | 경로 | 등록된 공개 범위 |
|---|---|---|
| 대시보드 | `/` | `all` |
| 문서 작성 AI | `/doc-ai` | `all` |
| 평가계획 제출 | `/submissions` | `all` |
| 학사일정·캘린더 | `/calendar` | `superadmin` |
| 사용자 관리 | `/admin/users` | `admin`이면서 `users.manage` 충족 |

`all`은 이 모듈 표에서 역할에 따른 추가 제한이 없다는 뜻이다. 앱에는 별도의 로그인·프로필·승인 상태 분기가 있다. 표만으로 실제 로그인 성공, DB 접근 권한, 승인 실패 처리의 완전성을 검증했다고 해석하지 않는다. 메뉴와 라우트는 같은 목록을 사용하며, 신규 모듈의 기본 공개 범위는 `superadmin`이다. 공개 범위 확대는 별도 승인 사항이다.

이 HEAD의 표에는 시간표 모듈이 등록돼 있지 않다. 다른 작업 공간의 시간표 작업이나 현재 원격 운영 사이트의 상태는 이 표에 반영하지 않았다. 실제 Vercel 배포 커밋·설정과 운영 메뉴의 일치는 미확인이다.

## 3. 보호 자산의 지문과 보존 경계

`baseline-assets.json`은 파일별 경로, Git 원본 바이트 수, SHA-256, 기준 main 일치 여부, 작업 파일 비교 결과를 담는다. 지문은 `git show <HEAD>:<path>`의 **바이너리 출력**을 Python `subprocess`로 직접 읽어 산출했다. PowerShell의 텍스트 변환이나 현재 체크아웃의 줄바꿈을 원본으로 삼지 않았다.

| 지문 대상 | 개수 | 이번 확인 |
|---|---:|---|
| `migrations/**/*.sql`의 추적 파일 | 9 | 보관된 SQL 포함. 원본 일치이며 실제 DB 적용 여부는 미확인 |
| `apps/main/api/_hwpx/` | 5 | Python 엔진 4개와 README. 원본 경로 유지 |
| 실행용 `tpl-*.hwpx`·`token-map.json` | 7 | 양식 6개와 토큰 표 보존 |
| 실행용 manifest·`regulation-2026.json` | 2 | 전체 파일 지문과 보호 부분의 별도 의미 비교 |
| `doc-ai-templates-v4/` | 8 | 원본 양식 6개·FINAL manifest·token-map 보존 |
| `examples/`·`apps/main/public/examples/` | 6 | 확정 예시 원본 및 배포용 복사본 보존 |
| **합계** | **37** | **기준 main ↔ 조사 HEAD 모두 일치** |

현재 `core.autocrlf=true`다. 37개 중 20개는 작업 파일도 원본 바이트와 같고, 17개는 CRLF를 LF로만 치환하면 원본과 같다. 후자는 `crlf_only`로 기록했으며 내용 변경으로 분류하지 않았다. 이 작업에서 보호 파일의 줄바꿈을 바꾸지 않았다. 앞선 테스트 수정의 `.gitattributes`는 `prompt-rules.v2.md` 한 파일만 LF로 고정하며, 그 파일의 프롬프트 원문은 바뀌지 않았다.

manifest의 `routing`, `composition_rules`, `unused_handling`, `fixed_texts`, `token_families`, `final_check`, `filename_pattern` 7개 항목은 실행 자산과 FINAL 원본의 JSON 값이 모두 같다. 비교용 지문은 객체 키를 정렬한 UTF-8 JSON을 사용하며 배열 순서는 유지한다. 이것은 파일 바이트 지문과 별도 검사다. 규정의 `thresholds`·`rules` 지문도 기록했으며 `article`은 `rules` 내부에 포함된다. 규정의 현행성이나 새 학교 적용 가능성까지 확인한 것은 아니다.

지문 목록은 모든 저장소 파일의 백업 목록이 아니다. 보호 계약과 재사용 핵심 자산을 고정한 자료이며, 전체 데이터·파일 백업과 복원 검증을 대신하지 않는다. manifest 계약, 규정 수치·조문, SQL 원본, HWPX 엔진·양식·토큰 표의 수정 권한을 새로 부여하지 않는다.

## 4. 재사용과 신축의 경계

| 구분 | 실제 경로와 처리 원칙 |
|---|---|
| 그대로 보존 | `apps/main/api/_hwpx/`, `apps/main/api/doc-ai/_assets/`의 보호 자산, `doc-ai-templates-v4/`, 확정 예시·SQL 이력. 이동·재작성 없이 기존 경로를 유지한다. |
| 검사와 함께 재사용 검토 | `apps/main/api/doc-ai/generate.py`, `extract.py`, `_fill.py`, `_regulation.py` 및 관련 `tests/`. 기존 생성·추출·치환·규정 검사 동작을 근거로 삼되, 새 앱에서 동작한다는 사실은 별도 검증한다. |
| 새로 구성 | `apps/workhub/`의 화면 틀과 업무 흐름. 기존 앱을 계속 유지하는 별도 작업 경로다. 이 기준선만으로 새 앱의 API·DB·인증을 가동하지 않는다. |
| 그대로 복제하지 않을 부분 | `packages/shared/src/auth.js`·`permissions.js`의 `public.users` 단일 프로필 전제. 전국 서비스의 학교 소속·개인 공간·지원 권한은 승인된 별도 계약과 시험이 필요하다. 기존 인증을 이 문서에서 변경하지 않는다. |
| 배포 전 확인할 부분 | `apps/main/vercel.json`의 함수별 `includeFiles`, `generate.py`·`extract.py`의 상대 경로 import. 새 앱의 배포 Root와 함수 번들에서도 엔진·자산을 찾는지는 T03에서 확인한다. |

현재 문서 엔진은 `generate.py`와 `extract.py`가 자신의 파일 위치를 기준으로 `../_hwpx`를 읽고, 생성기는 같은 위치의 `_assets`를 읽는다. 로컬에서 다른 디렉터리로 이동해 시험하는 것만으로 Vercel 함수 패키징이 증명되지는 않는다. **T03 실제 배포 Root·Python/JS 함수 번들·자산 포함 검증은 대기 상태**다. 기존 엔진 경로를 옮겨 해결하거나 운영 배포 설정을 임의 변경하지 않는다.

## 5. 검증 근거와 남은 확인

| 항목 | 상태와 증거 |
|---|---|
| 기존 전체 Windows 회귀시험 | 조사 HEAD에서 최종 `npm test` **695검사 통과, Python 건너뜀 0**을 실행 결과로 확인했다. |
| 기존 Linux CI | 같은 HEAD의 GitHub check `test`가 `completed/success`임을 확인했다. [실행 결과](https://github.com/EggPlayer88/daedong/actions/runs/38119150694/job/114410094330). workflow는 Ubuntu·Node 22·Python 3.12, `lxml` 설치 후 `npm ci`와 `npm test`를 실행한다. |
| 보호 자산 | 이 문서 작업에서 Git 원본 37개와 작업 파일을 직접 대조했다. manifest 보호 항목 7개도 원본과 일치한다. |
| 새 앱을 포함한 검사 | 이 기준선의 695건과 별개다. 새 앱 담당 변경의 최종 회귀·화면·빌드 결과를 해당 PR에서 기록해야 한다. |
| 운영·배포·복구 | 운영 DB/RLS/버킷, 로그인과 가입 승인, 실제 Vercel Root·환경 설정·함수 번들, 외부 AI 호출 비용, 데이터 백업·실물 복원은 이 작업에서 검증하지 않았다. |

기존 발견사항 `BASE-DEP-001`: 기준 작업 공간의 `npm audit --json`은 간접 의존성 `source-map-js@1.2.1`에 **high 1건**을 보고했다. 영향 범위는 `>=1.0.0 <1.2.2`, 식별자는 [GHSA-68fv-2mgg-jv7q](https://github.com/advisories/GHSA-68fv-2mgg-jv7q)이며 indexed source-map section offsets에 따른 event-loop 서비스 거부 진단이다. `node_modules/source-map-js`, `isDirect:false`, `fixAvailable:true`가 출력됐고, 신규 의존성 추가 전 `npm ci`에서도 같은 high 1건이 보고됐다. 기준 lockfile의 PostCSS 의존 경로와 설치 버전도 확인했다. **도구 진단을 추적하는 것으로, 실제 서비스 악용이나 공격 가능 경로를 실험한 결과가 아니다.** T01 범위에서 의존성을 변경하지 않았으며, 별도 수정 범위·회귀 검증을 정해 처리할 항목으로 남긴다. 기존 회귀검사 통과가 이 진단을 해소하지는 않는다.

## 6. 이번에 정한 것과 인계

- Git 원본 SHA-256을 기준으로 정했다. Windows 줄바꿈 차이를 보호 자산 수정으로 오인하지 않기 위해서다. 향후 승인된 자산 변경은 기준 커밋·변경 근거와 함께 새 기준선을 남겨야 하며, 실패한 대조를 숨기려고 지문만 갱신하지 않는다.
- 기존 엔진·보호 자산 경로를 보존하고, 새 앱과 그 연결 검증을 분리했다. T03 검증에 실패하면 배포 구조를 재검토할 근거가 되며 원본 엔진을 임의 수정할 근거는 아니다.
- Windows·Linux의 기존 회귀 성공, 새 앱 검증, 원격 운영 확인을 서로 다른 증거로 기록했다. 상태 변경 시 이 문서와 JSON의 검증 항목을 같은 근거로 함께 갱신한다.

문서 작성은 DB·RLS·인증·API 키·비용 구조·외부 서비스 설정·메뉴 공개 확대의 승인이 아니다. 이 기준선 문서는 운영 배포나 보호 자산 변경을 포함하지 않는다. 다음 단계는 새 앱 변경의 회귀검증, T03 배포 번들 검증 및 해당 승인 절차이며, 기존 회귀 통과만으로 전환이나 공개를 결정하지 않는다. 사용자 기준인 **10월 31일 핵심 기능 전체 공개 목표, 필요 시 일정 조정, 완성도 90% 이상 및 필수 안전·제출·복구 검증 충족**은 별도 출시 판단으로 유지한다.
