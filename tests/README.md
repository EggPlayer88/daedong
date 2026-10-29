# tests/ — 검증 스크립트

업무 연결 통합 회귀: `test_workhub_virtual_school_flow.mjs`는 두 가상 학교의 72교사를 반복한다. `tests/browser/workhub-cross-module.mjs`는 실제 연결 셸의 AI·메시지·질문형 수합·할 일 원본 왕복 8개를 확인한다. 두 파일은 각각 전체 단위/브라우저 러너에 포함한다. DB·Storage·AI 응답이 합성인 경계와 재실행 명령은 [학교 AI 검증 기록](../docs/workhub/ai-school-policy/verification.md)을 따른다.

수합 다운로드: `test_workhub_collection_download.mjs`는 전송 실패를 권한 오류로 오인하지 않는 안내를, `browser/workhub-collection-create.mjs`는 같은 초안에서 재다운로드와 실제 권한 거절 시 상세 비노출을 확인한다. 실제 SQL·RLS의 정보 조회→본문 읽기 경계는 [S1 격리 PostgreSQL 회귀](../database/workhub-storage-download/s1/README.md)에서 별도로 실행한다.

테스트 프레임워크 없이 실행하는 스크립트다. JSX 검사는 esbuild와 React를 사용하므로 먼저 `npm ci`를 실행한다.
각 파일은 단독 실행 가능하고, 성공하면 `✓` 줄과 `전부 통과`, 실패하면 `✗` 와 종료코드 1.

```bash
npm test                 # 단위·계약·SSR·Python 전체 (브라우저 검사는 아래 별도 명령)
npm test -- hours        # 파일명에 'hours' 가 든 것만
node tests/test_gate.mjs # 단독 실행
```

## Python 테스트 준비 (1회)

`generate.py` / `extract.py`는 `lxml`이 필요하다. 수합 파일 검사에는 고정 버전의 `pypdf`·`olefile`·`Pillow`도 사용한다. 학교 API 키 암호화 시험에는 `cryptography`도 필요하다. 전체 시험은 작업자·시간표·웹 API의 아래 의존성을 함께 설치한다. `apps/main/requirements.txt`는 웹 API 배포에도 사용하는 의존성 원본이다.

```bash
python3 -m venv tests/.venv
tests/.venv/bin/pip install -r workers/requirements.txt
tests/.venv/bin/pip install -r apps/main/requirements.txt
tests/.venv/bin/pip install -r packages/timetable/requirements.txt
```

Windows PowerShell에서는 다음과 같이 준비한다.

```powershell
python -m venv tests/.venv
tests/.venv/Scripts/python.exe -m pip install -r workers/requirements.txt
tests/.venv/Scripts/python.exe -m pip install -r apps/main/requirements.txt
tests/.venv/Scripts/python.exe -m pip install -r packages/timetable/requirements.txt
npm test
```

러너는 `$PYTHON` → `tests/.venv` → `.venv` → `python3` → `python` 순으로 lxml 이 있는
인터프리터를 찾는다. 못 찾으면 **Python 몫을 건너뛰고 그 사실을 출력한다**
(조용히 통과시키지 않는다).
Python이 선택된 뒤 형식별 파서가 빠져 있으면 관련 시험이 실패한다. 파서 부재를 정상 검사 결과로 계산하지 않는다.
시간표 시험은 고정 버전 OR-Tools로 실제 계산을 실행하며 의존성이 없으면 실패한다. 설치 명령은 위의 `packages/timetable/requirements.txt`를 사용한다.
가상환경의 Windows `Scripts/python.exe`와 POSIX `bin/python` 경로를 모두 지원한다.
`PYTHON`에는 실행 파일 경로 하나만 지정한다(공백·한글 허용). `py -3` 같은 명령문은 넣지 않는다.
러너는 자식 프로세스의 작업 폴더를 저장소 루트로 고정하고 Python 출력을 UTF-8로 받는다.

브라우저 모듈 검사는 `helpers/load-browser-module.mjs`의 가상 JSX 진입점을 사용한다.
임시 번들은 파일 URL로 불러오며, 빌드·로딩 성공 여부와 관계없이 전용 임시 폴더를 정리한다.
프롬프트 원문은 `.gitattributes`로 LF 체크아웃을 고정한다(본문 구분자 `\n---\n` 보존).

## 무엇을 지키는 테스트인가

| 파일 | 지키는 것 |
|---|---|
| `test_browser_loader.mjs` | 공백·한글·`#`가 있는 경로에서 실제 JSX 렌더, 빌드 실패·모듈 실행 실패 시 임시 폴더 정리 |
| `test_v4.py` | 실제 양식 6종으로 hwpx 생성 전 구간. **token-map 전수 대조**(맵 ≠ 양식 → 실패), 모르는 토큰은 즉시 실패, short=0 항 생략, **성취수준 수준당 4칸**(모자라면 공란·문자열 하나도 수용), 3학년 성취수준 부재, 자유학기 활동 블록, 프롬프트 골격 ↔ 치환 경로 이음매, 양식 sha256 불변 |
| `test_scales.py` | 배점 정합성 — 회차 100점 / 수행 합 100점 / 반영비율 100%, 만점 표기 `N점(M%)` 서버 계산, 한도 초과 시 거부 대신 안내 |
| `test_hours.py` | 시수/누계 고정표 주입, `hours_manual` 보존, 범위 밖 처리, 표 자체 무결성(누계 단조·합계·ok) |
| `test_extract.py` | 참고자료 hwpx 추출, 표→마크다운, 길이 상한, 거부 5종 |
| `test_gate_py.py` | D20 승인 게이트 (generate·extract) — 실패 시 **대기로 판정**하는지 |
| `test_chat_v2.mjs` | 시스템 프롬프트 조립 — 고정부·상수 주입·manifest 파생, TBD 유지, 하드코딩 아님 |
| `test_contract.mjs` | 프롬프트 JSON 골격 ↔ `direct_tokens` 경로 정합 (프롬프트와 generate 의 이음매) |
| `test_hours.mjs` | 시수 안내가 표에서 파생되는지, 옛 시수 공식이 프롬프트에 남지 않는지 |
| `test_principle.mjs` | 제0원칙 위치·문구, 배점 규칙이 서버 검증기와 일치, 규정 한계선이 `regulation-2026.json` 에서 파생 |
| `test_terms.mjs` | 사이트 명칭·용어 가드 (옛 용어가 되살아나면 실패) |
| `test_marker.mjs` | `===PLAN_READY===` 파서 (코드펜스·END 누락·깨진 JSON), **서버와 화면이 같은 파서를 쓰는지**(chat.js 가 계승 참조를 펼치며 이 블록을 다시 쓴다) |
| `test_gate.mjs` | D20 승인 게이트 (chat) — **미승인이면 Claude API 를 호출하지 않는지** |
| `test_routing.py` | 양식 라우팅 — 학년 × 시험 횟수 → 양식 6종, 한도·성취수준을 token-map 에서 세는지, 없는 조합 처리, 정보·진로 안내가 해당 교과에만 뜨는지 |
| `test_exam_methods.py` | 정기시험 3분류 — 회차 100점 = 선택형+단답형·완성형+서·논술형, **30% 산입은 서·논술형만**, 현행 양식에 칸 없는 배점의 누락 안내 |
| `test_count_set.py` | 횟수 세트(시험 0→수행 3 / 1→2 / 2→1~2) — 세트 밖은 **막지 않고 안내**, 작년과 달라진 조합의 전환 안내, 양식 v2 목표치가 현재 한도로 새지 않는지 |
| `test_regulation.py` | 학업성적관리규정 V01~V18 — 규칙별 위반/통과 한 쌍, 유형 A~D 판정, ERROR 는 생성 차단, WARN·FLAG 는 통과 후 안내, `check_only` 응답 |
| `test_prefill.py` | 작년 값을 그대로 물려받았을 때의 확인 안내(`%` 표기 없던 칸), **서·논술형 칸을 전부 세는지**(파서 v1 첫-칸-만 버그 회귀), 정기시험 있는 전 교과의 작년 실적이 30% 이상인지 |
| `test_prefill.mjs` | prefill 주입 — 교과·학년 **한 건만** 선택, 작년 값 중 그대로 쓰면 안 되는 것(시험 시기·시수·3분류·2022 성취기준), `_warnings`·보정 내역 노출, ●▲✗ 3분기 + 교과 DB 한정 주입, 수행 [유지/변경/신규], **1학년 자유학기 팩**(월 표기·작년 성취수준 원문 계승·활동 3분기·활동 미검출 처리), 팩 없으면 백지 모드, **교과명 표기 정규화**(공백·가운뎃점·밑줄), **성취기준 DB 밖 교과의 정직 경로** |
| `test_carry.mjs` · `.py` | **작년 그대로 계승 = 참조** (504 대응) — 펼친 값이 작년 원문과 **글자 하나까지 같은지**(계승 diff 0), 출력이 교과 크기와 무관해지는지, 못 펼친 참조를 조용히 버리지 않는지, `perf_plans` 는 계승 대상이 아님, generate 는 펼쳐지지 않은 `carry` 를 막음, 양식 한도를 넘는 칸(사회 1학년 성취수준 8칸 → 양식 4칸)을 **말없이 자르지 않음** |
| `test_smoke_subjects.mjs` · `.py` | **전 교과 스모크** — prefill 색인 35건 전부를 대화 시작(chat 핸들러)부터 hwpx 생성 완료까지 돌려 **크래시 0** 확인. 교과 하나가 특이한 경로를 타는 것을 사람이 먼저 발견하지 않게 한다 (2026-08-26 디지털 리터러시) |
| `test_api_errors.mjs` | **fetch 공통 에러 처리** — 서버가 JSON 이 아닌 오류 페이지를 돌려줘도 `Unexpected token 'A'…` 가 교사 화면에 새지 않는다. 상태 코드는 문장에 남겨 504(시간 초과)/500(크래시)을 가른다. JSON 으로 온 실패(400·403·409)는 그대로 호출부로 |
| `test_conversations.mjs` | 대화 저장(004) — 제목 자동 생성(참고자료 오염 방지·plan 우선), 목록 화면, **RLS personal(admin 열람 경로 없음)**, 저장 실패가 대화를 끊지 않는지 |
| `test_examples.mjs` | 배포용 예시 3종 — 원본과 배포본 sha 동일(수정 금지), 화면 링크 ↔ 실제 파일 일치, 학년 표기 |
| `test_school_days.mjs` | 수업일수·시수 파생 — official 경계, 5행 고정·1월 흡수, 누계 산식, **기존 고정표 재현**(감산 규칙 반영 시 자산과 일치), **자산 stale 대조**(KNOWN_DIFF 밖의 차이면 실패), 깨진 입력 방어, 화면 렌더 |
| `test_visibility.mjs` | 모듈 공개 범위 — 역할별 메뉴 노출, **URL 직접 접근 차단**(라우트 미등록), 신규 모듈 기본값 superadmin, 실사용 화면(평가계획서·제출)이 이전과 동일한지 |
| `test_calendar.mjs` | 학사일정·공유 캘린더(006) — **파생 계산은 official 만**(shared 의 no_class 는 안 센다), 월간 격자·KST 날짜, soft delete·복구, 라벨 자동완성, RLS 정책 대조 + 정책을 흉내 낸 CRUD 흐름, 시드 SQL |
| `test_submissions.mjs` | 제출·수합(005) — 파일 규칙(hwpx·30MB)·storage 경로 규약, 파일명에서 교과·학년 제안, 재제출은 지우지 않고 `replaced`, 현황 매트릭스, **RLS(교사 본인 / 담당자 전체·삭제 경로 없음)**, prefill 목록과 catalog 동기화 |
| `test_embed.mjs` | users↔departments embed 모호성 — FK 가 2개라 `대상!FK이름` 으로 명시해야 한다 |
| `test_workhub_tasks.mjs` | 개인 업무 RPC 어댑터 — 입력 정규화·응답 학교/소유자/업무 ID·잘못된 충돌 본문·계정 변경·미확정 저장 처리 |
| `test_workhub_tasks_database.mjs` | 개인 업무 추가 SQL — 회원/함수/권한 보존, RLS·타인 거부·직접 쓰기 금지·원자적 감사/접수·실제 어댑터와 DB 왕복 |

개인 업무 화면의 실제 브라우저 검증은 `node tests/browser/workhub-tasks.mjs`, 앱 내 연결 회귀는 `node tests/browser/workhub-connection.mjs`로 실행한다. Playwright 경로는 `PLAYWRIGHT_MODULE`로 지정할 수 있다. 합성 전송 계층을 사용하며 실제 학교 서버에 접속하지 않는다. 독립 PostgreSQL 16 연결의 일정·개인 업무 경합 11개는 CI의 `npm run test:workhub:postgres`에서 실행하며, [전용 DB 실행 조건](../docs/workhub/07-postgres-verification.md)을 먼저 확인한다.

## 신축 공통 구조 검증

기본 회귀에 다음 파일이 자동 포함된다.

| 파일 | 확인하는 계약 |
|---|---|
| `test_workhub_browser_launcher.mjs` | 로컬 Chrome·CI 고정 Chromium·명시한 Edge 선택과 잘못된 채널 거부 |
| `test_workhub_shell.mjs` | 연결 모드별 메뉴, 모바일 더보기, 현재 위치·본문 접근, 오류 안내의 SSR 구조 |
| `test_workhub_navigation.mjs` | 허용 화면·주소 정규화, 학교 맥락, 클릭 분류, 이력·이동 차단, 보관 중 내부 이동과 외부 이탈 구분 |
| `test_workhub_calendar_views.mjs` | 다일 겹침·월/주 범위·검색·추천·건수와 홈 7일 요약 |
| `test_workhub_calendar_import.mjs` | CSV/TSV 인용·행 번호·한도·열 매핑·날짜/시간·중복·개인 공개 초안·깨진 입력 |
| `test_workhub_calendar_import_ui.mjs` | 실제 가져오기/편집기의 SSR·고유 ID·초안 이관·문자열 이스케이프·저장 호출 없음 |
| `test_workhub_preview_tasks.mjs` | 합성 store와 실제 TaskPanel 계약의 멱등·충돌·격리·Unicode·원자적 실패 |
| `test_workhub_task_summary.mjs` | 미완료 업무의 기한 분류·4건 요약·메모·조회 실패 표시 |
| `test_workhub_collection_summary.mjs` | 제출·공동작성·검토·대기의 구분, 복수 보완 기한, 정확한 원본·목록 선택 |
| `test_workhub_search_sources.mjs` | 현재 학교·소유자 범위, 수합 초안 비공개, 한글 검색·중복·정렬 |
| `test_workhub_search_ui.mjs` | 검색 SSR, 부분 실패·재시도·지연 응답 폐기·50건 제한·본문 노출 범위 |
| `test_workhub_collection_workbench.mjs` | 제출 단위의 현재판·완료판·보완 분류, 허용 범위 집계·요청 찾기·진행 표 |
| `test_workhub_student_workspace.mjs` | 학생 찾기·본인 기록의 범위/기간/종류/상태, 조회 실패 구분·출력 범위 |
| `test_workhub_collection_entry.mjs` | 수합 요청·게시 전 점검, 응답 필수 입력과 준비 상태 안내 |
| `test_workhub_student_entry.mjs` | 학생 관찰·정정 입력 확인, 작성 대상과 활동 연결의 일치 |
| `test_workhub_editor_accessibility.mjs` | 반복 일정 편집기의 고유 ID와 제목·폼·대상 안내 연결 |
| `test_workhub_collection_accessibility.mjs` | 반복 수합 필드·단위 이름·표 머리글·상태·초점 대상의 SSR 연결 |
| `test_workhub_student_accessibility.mjs` | 학생 관찰·철회·활동의 반복 폼 이름과 오류·설명 연결 |
| `test_workhub_list_window.mjs` | 공통 20개 표시 범위·쪽 경계·목록 축소·깨진 입력·원본 비변경·페이지 SSR 안내 |
| `test_workhub_collection_paging.mjs` | 1,000요청/100단위의 제한 렌더·전체 집계·직접 원본·접힌 이력·깨진 조회 |
| `test_workhub_student_paging.mjs` | 1,000관찰의 제한 렌더·전체 근거·접힌 이력·소속 종료·깨진 전체 조회 |

다음은 실제 브라우저가 필요한 별도 시험이다. Playwright는 루트 개발 의존성에 정확한 버전으로 고정되어 `npm ci`로 설치된다. `launch-browser.mjs`가 실행 브라우저를 한곳에서 고른다. 기본은 설치된 Chrome이며 `PLAYWRIGHT_CHANNEL=chromium`은 Playwright에 맞는 Chromium을 사용한다. 필요한 경우 기존처럼 `PLAYWRIGHT_MODULE`로 별도 설치 경로를 지정할 수 있다. 합성 자료만 쓰며 운영 서버에 접속하지 않는다.

```bash
npx playwright install chromium
PLAYWRIGHT_CHANNEL=chromium npm run test:workhub:browser
npm run test:workhub:browser -- --list        # 실행 대상 파일 확인
npm run test:workhub:browser -- student      # 학생 영역만 선택 (로컬 기본 Chrome)
```

Windows PowerShell에서는 환경 변수를 별도로 지정한다.

```powershell
npx playwright install chromium
$env:PLAYWRIGHT_CHANNEL = 'chromium'
npm run test:workhub:browser
```

러너는 목록에 명시한 브라우저 파일을 순서대로 실행하고 실패한 파일도 결과에 남긴다. 실제 앱 스킨 검사용 Vite는 별도 `127.0.0.1:5187` 포트에서 직접 시작·종료하며, 이미 점유된 서버를 임의로 재사용하지 않는다. 오프라인 HTML도 전용 임시 폴더에 새로 생성한다. 과거 커밋을 전제로 하는 `workhub-scale-baseline.mjs`는 수동 성능 비교용이라 자동 회귀에서 제외한다.

CI에서는 기존 필수 `test` job 안에 **실제 브라우저 회귀 검사** 단계가 있다. 화면·공통 앱·브라우저 시험·공통 시험 도우미·의존성·워크플로가 바뀌면 고정 Chromium과 한글 글꼴을 설치하고 같은 러너를 실행한다. 문서만 바뀐 경우에는 이 단계만 생략하며 `npm test`는 그대로 실행한다. 변경 경로 판정에 실패하면 브라우저 검사를 실행하는 쪽으로 처리한다. 브라우저 실패도 전체 `test` 실패이며, 화면·JSON·콘솔 결과를 `workhub-browser-results` 아티팩트에 7일간 보관한다.

개별 파일은 계속 직접 실행할 수 있다. `workhub-appearance.mjs`만 직접 실행할 때에는 별도 Vite와 `WORKHUB_QA_URL`이 필요하고, 아래 오프라인 시험은 HTML을 먼저 생성해야 한다.

```bash
node tests/browser/workhub-navigation.mjs       # 실제 BrowserRouter의 앞/뒤 이동·기존 링크
node tests/browser/workhub-calendar-views.mjs   # 월·주·목록·검색·키보드·모바일
node tests/browser/workhub-calendar-recovery.mjs # 실제 접수 뒤 응답만 유실·같은 요청 재확인
node tests/browser/workhub-request-recovery.mjs # 대기 요청 보관·이동·재확인·권한/소속 경계
node tests/browser/workhub-calendar-import.mjs  # 표 검사→행 검토→기존 편집기·중복 재비교·읽기 취소·저장 복구
node tests/browser/workhub.mjs                  # 개인 업무·수합·학생의 전체 흐름
node tests/browser/workhub-foundation.mjs        # 실제 PreviewApp의 주소·입력 보호·오류 격리
node tests/browser/workhub-home-search.mjs       # 실제 홈→검색→원본·학교 변경·연결 모드
node tests/browser/workhub-task-navigation.mjs   # 완료 업무 원본·지연 응답·소속 전환
node tests/browser/workhub-collection-workbench.mjs # 수합 요청 찾기·진행 표·필터·단위 이동
node tests/browser/workhub-student-workspace.mjs # 학생 선택·기록 필터·입력 보호·출력 최신판
node tests/browser/workhub-collection-entry.mjs # 수합 작성 미리보기·게시 점검·응답 입력
node tests/browser/workhub-student-entry.mjs     # 관찰/정정·대상 유지·연결 확정·저장 확인
node tests/browser/workhub-accessibility.mjs   # 일반/Shadow DOM의 업무·일정·메뉴 초점과 모바일
node tests/browser/workhub-collection-accessibility.mjs # 수합 작성·응답·검토·표의 키보드/필드 연결
node tests/browser/workhub-student-accessibility.mjs # 정정·철회·채택·복구 초점과 긴 이력 줄바꿈
node tests/browser/workhub-task-paging.mjs       # 1000업무·쪽 이동·원본·편집/재시도 잠금
node tests/browser/workhub-collection-paging.mjs # 1000요청/100단위·전체집계·표와 상세·입력 보호
node tests/browser/workhub-student-paging.mjs    # 각1000기록/활동·화면밖 근거검증·조회실패후 같은쪽 복귀
node tests/browser/workhub-scale-baseline.mjs   # 137a871과 현재의 같은 합성자료 DOM 비교
node scripts/export-workhub-preview.mjs         # 기본 출력: dist/workhub-preview.html
node tests/browser/workhub-offline.mjs          # file:// 파일·스타일·저장·외부 요청 0
node tests/browser/workhub-appearance.mjs       # 실제 Vite 앱의 스킨·사용자 설정·반응형
```

내보내기와 오프라인 시험은 첫 번째 인자로 원하는 HTML 절대 경로를 받을 수 있다. `WORKHUB_QA_OUTPUT`을 지정하면 브라우저 러너는 파일별 하위 폴더에 화면·JSON·콘솔 로그를 저장하고 최상위 `summary.json`에 파일별 성공·실패와 실행 시간을 기록한다. 미지정 시 전용 임시 폴더를 사용하고 경로를 출력한다. 결과 이미지는 추적 소스로 커밋하지 않는다. `npm test`의 검사 수와 별도 브라우저 파일/시나리오 수를 구분해 보고한다.

## 가상교사 AI 연습실

`assistant/practice/`는 검증한 시간표 시드의 가상교사 18명에 가상교사 18명을 추가한 학교별 36명·9학급 연습 자료를 사용한다. 다른 가상학교의 ID와 대화도 별도로 구분한다. 실제 `AssistantPanel`과 응답 parser를 사용하지만 DB·AI 응답·예산은 브라우저 메모리의 합성 자료다. **실제 API·DB·로그인·유료 AI 호출은 0건**이며, 실제 회원 연결이나 모델 성능을 검증한 결과가 아니다.

```bash
node tests/test_workhub_assistant_practice.mjs
PLAYWRIGHT_CHANNEL=chromium npm run test:workhub:browser -- assistant-practice
```

Windows PowerShell:

```powershell
$env:PLAYWRIGHT_CHANNEL = 'chromium'
npm run test:workhub:browser -- assistant-practice
```

- 정상 기본 답변→명시 정밀 검토, 학생 초안의 Sonnet 표시, 예산 부족, 완료 응답 유실, 시작 전 요청 닫기, 닫기 응답 유실을 확인한다.
- 학교·교사 전환 때 대화를 분리하고, 입력·미확정 요청 중에는 전환과 초기화를 막는다. 확인 후 연습 초기화가 운영 입력·키 저장 복구 데이터에 영향을 주지 않는지도 확인한다.
- ShadowDOM·320px·키보드 이동을 실제 브라우저로 검사한다. 외부 요청이 발생하거나 페이지 오류가 나면 실패한다. `WORKHUB_QA_OUTPUT`을 지정하면 데스크톱·모바일 화면도 저장한다.
- 연습 자료는 현재 연습실 메모리 안에만 있고, 연습실을 닫거나 새로고침하면 사라진다. 실제 키를 입력하는 화면이나 운영 자료 저장 기능은 제공하지 않는다.

## 작성 원칙

- **실제로 돌려서 확인한다.** 빌드 통과나 정적 검사로 대신하지 않는다.
  hwpx 는 진짜로 만들어 열어 보고, 화면은 `react-dom/server` 로 렌더해 문구를 본다.
- **깨진 입력을 함께 넣는다.** AI 응답은 언제든 형식이 어긋날 수 있으므로
  배열 자리에 문자열/null 이 와도 화면이 죽지 않는지까지 확인한다.
- **자산과 코드의 이음매를 고정한다.** manifest·상수·고정표가 바뀌면 프롬프트·검증·화면이
  따라가야 하고, 따라가지 않으면 테스트가 깨져야 한다.
- 테스트가 깨지면 **먼저 어느 쪽이 틀렸는지 판단한다** — 규약이 바뀐 것이라면 테스트를
  갱신하고, 아니면 코드를 고친다. (지금까지 실제로 양쪽 모두 있었다)

홈 정보량·모바일 전용 회귀: `workhub-home-layout.mjs`는 첫 3개 요약/펼침·영역 순서·실패 격리·중요 수합 상태를, `workhub-mobile-navigation.mjs`는 일반 DOM과 ShadowRoot의 하단 메뉴·더보기·설정 전환·초점·입력 보호를 검사한다.

## 연결 화면의 날짜 전환

test_workhub_school_day.mjs는 한국 날짜 경계·숨김 복귀·제한된 재확인·정리를 검사하며 npm test에 포함된다. node tests/browser/workhub-day-refresh.mjs는 실제 연결 컴포넌트에 합성 전송을 주입하고 Playwright 시계를 제어해 자정·초안 보존·저장 복구·계정 변경·소속 종료·동시 신호 순차 처리를 확인한다. 전체 브라우저 러너에도 포함된다. 기기 시간으로 서버 날짜를 바꾸거나 실제 학교 서버를 호출하지 않는다.

## PR #24 입력 복구 회귀

- `test_workhub_edit_drafts.mjs`: 재확인 전 접근 차단·동일 범위 복구·폐기 후 늦은 콜백·슬롯 분리·이탈 경고 8개.
- `tests/browser/workhub-draft-recovery.mjs`: 실제 연결/폼을 합성 RPC로 실행한다. 명부/조회 실패·원본 재검증·충돌·미확정 저장·폐기 후 재등장 방지를 검증하며 전체 브라우저 러너에 포함된다.
- `workhub-calendar-import.mjs`의 연결 복구 시험은 부분 완료 행과 미확정 저장 요청의 중복 등록 방지를 함께 검증한다.
- 자세한 재현 순서는 [재검토 기록](../docs/workhub/23-review-draft-recovery.md)을 참고한다. 실제 운영 DB에는 접속하지 않는다.

## 연결 오류 화면의 이동·폐기 회귀

- `test_workhub_connection_exit_ui.mjs`: 입력/미확정 요청별 안내와 접근성·새 탭 링크의 SSR 4건.
- `tests/browser/workhub-connection-exit.mjs`: 바깥 BrowserRouter 링크·뒤로가기, 오류/로딩, 폐기 취소·확정, 미확정 요청·혼합 상태, 새 탭, 권한 회수, 모바일 키보드와 실제 WorkhubPage의 메뉴 주소·라우터 기준 경로 전달까지 12건. 전체 러너에 포함한다. 경로 보완은 [후속 검토 기록](../docs/workhub/25-task-view-refactor.md)에 있다.
- 재현 절차와 Linux/PowerShell 명령은 [검토 기록](../docs/workhub/24-connection-exit.md)에 있다. 합성 RPC를 사용하며 실제 운영 서버에는 접속하지 않는다.

## 기본 파일형 문서 수합

- `test_workhub_file_pdf.py`: 실제 일반/압축 xref·객체 스트림·PNG predictor·페이지·JPEG·본문·원본 길이·확장량·내부 시작 보기·스크립트/첨부/외부 실행 차단 **197건**. `helpers/pdf_fixture.py`로 독립 PDF 원문을 만든다.
- `test_workhub_file_hwp.py`: 실제 합성 CFB/HWP의 FAT/MiniFAT·레코드·압축·스크립트·이미지·빈 연결 옵션·평문 헤더·명시된 5.1 세 버전·ID/부모/번호 구조·미지원/예외 처리 **148건**. `helpers/hwp_fixture.py`는 시험용이며 실제 파일 변환기가 아니다.
- `test_workhub_file_inspection.py`: 실제 ZIP/XML 파싱·압축 확장량/CRC·경로/관계·DTD/암호화·PDF/HWP 연결·제한된 HWPX 기본 스크립트·보호 HWPX 6종 읽기 전용 검사 **118건**.
- `test_workhub_file_verification.py`: 실물 크기/SHA-256·정책·임대·스캐너 상태/결과 결합·응답 유실·위조 접수 차단, PDF 압축/시작 보기·HWP 5.0/5.1·HWPX의 파서→접수 연결 **76건**.
- `test_workhub_document_corpus.py`: 공개 원본 재현 도구의 누락·크기·해시·명세/경로 오류·종료 코드·미지원 집계 구분 **8건**. 실제 공개 파일은 [별도 재현 안내](fixtures/README.md)에 따라 검사하며 CI에서 다운로드하지 않는다.
- `test_workhub_file_cleanup.py`: 기본 후보 조회·typed 참조/hold/진행 작업/보존기간·영구 차단 티켓·실물 변경/부재·응답 유실/재확인·임대/취소 **48건**.
- 위 Python 시험은 `npm test`에 자동 포함된다. `npm test -- workhub_file_pdf` / `workhub_file_hwp` / `workhub_file_inspection` / `workhub_file_verification` / `workhub_file_cleanup` 필터로 각각 실행할 수 있다. `workers/requirements.txt` 의존성이 필요하다. **원장·Storage·스캐너는 대역**이며 실제 SQL/서비스 권한·물리 삭제·악성 탐지 자체를 검증하지 않는다. [실행 안내](../workers/collection_files/README.md), [처리 코어 인계](../docs/workhub/36-collection-file-workers.md), [최신 형식 지원과 실제 파일 실측](../docs/workhub/37-document-format-support.md)을 참고한다. 공개 HWP 원본 7개는 아직 미지원이며 합성 HWP 통과를 일반 문서 호환 완료로 계산하지 않는다.

- `test_workhub_collection_export.mjs`: 실제 연결용 ZIP 계획·전체 단위 대조·완료/현재판 선택·원문/CSV·511개 경계·권한/판 변경·실패 재시도·취소 36건.
- `test_workhub_collection_export_parts.mjs`: 파일·CSV 용량과 항목 상한을 유지하는 분할, 전체 지문·묶음 판·이름·해시, 실패 재시도·폐기 14건. `tests/browser/workhub-collection-export-parts.mjs`는 가상 교사 36명의 파일 540개를 실제 ZIP 두 개로 받아 대조하는 등 5건을 확인한다.
- `test_workhub_collection_export_ui.mjs`: 접힌 화면·정확한 선택기 라벨·준비 전 다운로드 차단·범위/한도 안내 SSR 4건.
- `workhub-collection-export.mjs`: 실제 연결 화면의 ZIP 다운로드·파일 내용 대조·누락 응답·오류/재시도·직전 권한 확인·계정 전환·관리 입력·320px/키보드 13개. 전체 브라우저 러너에 포함하며 [ZIP 인계](../docs/workhub/35-collection-server-export.md)에 보장 범위를 기록한다.
- `test_workhub_collection_server.mjs`: 실제 연결 어댑터의 봉투/학교/판 검증, 미확정 접수, 파일 예약·원문·다운로드 권한 재확인.
- `test_workhub_collection_recovery.mjs`: 수합 명령의 동일 키·본문 보존, 다른 기능과의 복구 분리, 동일 소속 입력 복원.
- `test_workhub_collection_conflict.mjs`: 수합 설정 11항목·답변 3항목의 세 버전 비교, 최신 변경 보존·명시 선택·파일/교사 교체 감지, 손상 입력·SSR 접근성 26건.
- `test_workhub_collection_server_ui.mjs`: 서버 확인 전 정적 렌더링이 조회·빈 목록·작성 성공을 만들지 않는지, 상위 화면과 제목·본문 영역이 겹치지 않는지 확인한다.
- `test_workhub_collection_units_editor.mjs`: 개인/공동 단위 입력 보존·중복 이름·현재 명부·역할 선택과 깨진 입력·SSR를 확인한다.
- `test_workhub_collection_submission_summary.mjs`: 현재판/완료본·보완·철회·정확한 과거 파일 부모와 검토자 이름·이력 지연 렌더링을 확인한다.
- `test_workhub_collection_storage.mjs`: 기존 실제 인증 연결·SDK 래퍼에 합성 전송을 주입하여 권한 회수·계정 변경·업로드 응답 유실·다운로드 원문 검사를 확인한다.
- `workhub-collection-server.mjs`: 비동기 수합 작성·파일 대기·제출·오류 복구, 공동 단위 설정·철회/정정·대상판 고정·과거 이력·상세 실패 이탈·전체 항목 충돌 병합·미확정 요청 보관/재개를 합성 서버로 브라우저 검증한다. 전체 브라우저 러너에 포함된다.
- `workhub-connection.mjs`는 실제 연결 셸에서 R1 함수 부재와 파일 검사 미준비를 빈 목록/성공으로 표시하지 않는지도 확인한다.
- [서버 연결 인계](../docs/workhub/33-collection-server-connection.md), [Claude R1 SQL 요청서](../docs/workhub/32-collection-server-sql-request.md). 이 시험이 실제 Supabase/Storage 구축과 서버 파일 검사를 대신하지 않는다.

- test_workhub_file_lifecycle.mjs: 미저장 파일 회수·용량 재사용·저장 실패·양식/공동 초안/과거 접수 결과 보호·초기화와 늦은 검사 응답 9개 시나리오.
- workhub-file-controls 브라우저 검사는 개발 StrictMode에서도 선택·제거·교체·화면 종료의 수명을 확인한다.

- test_workhub_collection_files.mjs: 실물·정책·취소/시간초과·메모리 회수·ZIP 원본/CRC 19건.
- test_workhub_file_workflow.mjs: 기존 응답 호환·파일 초안/제출·읽기 경계·영구 저장 제외 20건.
- test_workhub_file_controls.mjs: 깨진 입력·안내·접근성·파일 교체 SSR 12건.
- test_workhub_file_export.mjs: 완료본/최신본·판 변경·CSV·권한·SSR 13건.
- 고정 브라우저 러너에 workhub-file-controls, workhub-file-collections, workhub-file-persistence를 포함한다. 실제 파일 선택/다운로드·공동 작성·ZIP·PreviewApp 저장/새로고침을 합성 자료로 검사한다.
- [파일 수합 인계](../docs/workhub/29-file-collections.md)에 한계와 재현 순서를 기록한다.

## 수합 대상 일괄 추가·검토 이력·파일 교체

- test_workhub_collection_recipients.mjs: 유효 소속·중복·기존 단위 보존·한도·이름·SSR 17건.
- test_workhub_collection_review_history.mjs: 현재판 의견·남은 보완·철회 이력·판/학교 분리·SSR 14건.
- workhub-collection-followup.mjs: 실제 수합 작성→게시→보완→재제출→완료, 키보드·390px·학교 전환 9시나리오.
- workhub-file-controls.mjs: 기존 11개에 최대 개수에서 교체·오류/중복·취소·외부 목록 변경 4시나리오 추가.
- [수합 사용성 보완 인계](../docs/workhub/30-collection-followup.md)에 재검토 순서와 서버 연결 전 한계를 기록한다.

## 학교 초기 설정 준비

- `test_workhub_school_setup.mjs`: 초안 파일·기간·학기·조직·학급 계약 25개.
- `test_workhub_school_setup_ui.mjs`: 실제 폼 SSR의 고유 ID/설명 연결과 운영 미반영 안내.
- `workhub-school-setup.mjs`: 실제 브라우저의 입력→검사→파일 왕복, 실패 시 보존, 이동 보호, 모바일/키보드. 전체 러너에 포함한다.
- 모듈 공개와 하위 경로 현재 메뉴 표시는 `test_visibility.mjs`에서 실제 Layout으로 확인한다.
- [사용·검토 절차](../docs/workhub/26-school-setup-preparation.md). 실제 회원이나 운영 DB를 쓰지 않는다.

## 공개 배포 연결 조사 도구

`test_workhub_deployment_audit.mjs`는 외부 네트워크를 차단한 mock HTTP 시험이다. 배포 자산 출처·GET 범위·익명 키의 대상 일치·리디렉션 차단·크기/시간 제한·키/본문 비출력과 익명 결과의 해석을 검증하며 `npm test`에 자동 포함된다.

실제 공개 배포를 조사할 때만 `node scripts/check-workhub-deployment.mjs --site https://daedong-school.vercel.app/`를 별도로 실행한다. 이 명령은 DB 전체 준비·로그인 계정·SQL 적용 여부를 검증하지 않는다. 대상 비교·파일 출력·종료 코드·Claude Web 조사 인계는 [운영 연결 조사](../docs/workhub/28-connection-audit-handoff.md)를 따른다. 일반 회귀/CI에는 실제 배포 조회를 넣지 않는다.

## 2차 통합 회귀와 원본 SQL 검증

`npm run check:workhub:integration:r2`는 #26~#42의 고정 SHA, 1차 이력, 보류 #3/#5, R0/R1 원문과 기존 인증/자산/메뉴 공개 범위를 검사한다. 전체 Git 이력이 필요하며, 1차 가드는 당시 통합 후보 재현용으로 유지한다. `test_workhub_integration_r2.mjs`는 임시 Git 저장소를 변조해 누락·SQL 변경·공개 확대·보류 기능·예약 실행·미해결 충돌을 실제로 거부하는지 22건을 확인한다.

`npm run test:workhub:r2-sql`은 Linux 일반 사용자, PostgreSQL 17, psql, Python worker 의존성·psycopg2-binary와 `npm ci`가 필요하다. 전용 로컬 합성 DB에서 R0 전체 → R1 전체 → 실제 worker 연결을 실행하고 끝에 서버를 정지한다. `R0_WORK`는 `workhub-r2-r0-verify`로 시작하는 전용 폴더, `R0_PG_BIN`은 PG17 bin, `R0_PSQL`은 psql 절대 경로를 지정한다. 기존 원본 SQL·시험 파일은 수정하지 않는다. 환경·결과·미검증 범위는 [2차 통합 검증](../docs/workhub/integration-r2/verification.md)을 참고한다.


## DB 적용 전 공통 복구·일정 표시

- `test_workhub_calendar_time.mjs`: 여러 날 일정의 시작·진행·종료 표시와 단일일·종일·연도/윤일·자정 경계 8건.
- `workhub-module-loading.mjs`: 실제 React 지연 모듈의 명시적 재시도, 정상 화면 입력·원래 요청 번호 보존, 자동 쓰기/재시도/새로고침 없음 10건. 실제 Chromium의 같은 URL 동적 가져오기 실패 캐시도 구분한다.
- `workhub-knowledge-assistant.mjs`: 원문 전달 실패·권한 재조회 실패·늦은 전달 응답을 포함한 20건. `workhub-calendar-views.mjs`는 홈·주·월·상세의 여러 날 표시를 함께 확인한다.
- 실행: `npm run test:workhub:browser -- workhub-module-loading workhub-knowledge-assistant workhub-calendar workhub-home-layout`. 공통 러너에 등록했으며 운영 DB/Storage/AI에 접속하지 않는다.
- [수정 범위·검증 경계](../docs/workhub/deployment-preparation/pre-db-completion.md).

## 질문형 HWPX 생성부터 수합 ZIP까지

- `test_workhub_document_collection_pipeline.mjs`: 가상 교사 36명·9학급, 실제 생성 HWPX 37개와 기존 확정 양식 사본 6개, 원본 보존·정정판 선택·ZIP 내부 해시/본문·응답 유실·부분 재시도·변조를 확인한다. 실제 Python 생성기와 최소 검사기를 사용하며 저장은 메모리 연습 저장소다.
- `test_workhub_guided_storage.mjs`: 실제 문서 전송 서비스에서 파일·신원 조회 지연, 제한시간 이후 새 RPC·예약 등록 금지, 원키 복구, 원본 변조와 학교·계정·역할 변경을 확인한다.
- `test_workhub_knowledge_storage.mjs`: 같은 공통 제한시간을 사용하는 학교 HWPX 원문의 준비·업로드·추출·다운로드 25건. `tests/browser/workhub-knowledge-import.mjs`는 기존 8건에 실제 서비스·합성 전송 지연 3건을 더한다. 실제 서버 처리 취소를 주장하지 않고 원래 요청으로만 복구한다.
- `tests/browser/workhub-document-review.mjs`: 저장판 비교·인쇄 15건과 TXT 판/권한 재조회·입력 보존·응답 지연·실패 복구 12건. 다운로드는 실제 브라우저 파일 내용을 읽어 확인한다.
- `workhub-document-collection-flow.mjs`: 실제 연결 셸에서 답변→생성→파일 확인→수합 첨부→기본 검사→초안→최종 제출→담당자 ZIP, 재진입 복구·학교 변경·320px·키보드를 실행한다. 생성 파일과 ZIP은 실제 바이트로 검사하며 HTTP/RPC/Storage 경계만 합성한다.
- `PYTHON`에 `lxml`이 설치된 실행 파일을 지정할 수 있다. `node tests/test_workhub_document_collection_pipeline.mjs`, `node tests/test_workhub_guided_storage.mjs`, `node tests/browser/run.mjs workhub-document-collection-flow`로 실행한다. 브라우저 파일은 전체 러너에도 등록했다.
- 운영 SQL·Storage·유료 API·실제 회원·한글 화면은 사용하지 않는다. [전체 흐름과 남은 연결](../docs/workhub/ai-school-policy/document-collection-pipeline.md).

## 서버 문서 수합 사용성 후속

- `test_workhub_collection_submission_guidance.mjs`: 필수 파일·글·숫자/0·저장판 비교·공동 작성·재제출/보완·깨진 입력·SSR 17건.
- `workhub-collection-usability.mjs`: 실제 서버 패널의 일반 DOM/ShadowRoot 초점 이동·복귀, 320px/20단위/긴 파일명, 지연 조회 중 사용자 초점 유지, 메모·선택 범위 보존, 첨부 제한 설명, 초안 저장→최종 제출 명령 구분 11건. 전체 브라우저 러너에 등록했다.
- `npm run test:workhub:browser -- workhub-collection-usability workhub-collection-server workhub-collection-hwpx workhub-collection-export`로 관련 4개 파일을 실행한다. 실제 운영 DB나 Storage를 사용하지 않는다. [검증·인계](../docs/workhub/44-collection-usability.md).


## C1·C4·C5 앱 계약 후속 회귀

- `test_workhub_cooperation.mjs`: 새 인계 이력의 처리자·이전/이후 수신자·상태·버전, 혼합 응답 거부와 구형 무인계 호환 43건.
- `test_workhub_calendar_batch_audience.mjs`: 대상 집합 정렬, 실제 격리 PostgreSQL C 정렬식 대조, 지문 변조·원본 비변경·기존 미확정 commit 보존 9건.
- `test_workhub_messaging_files.mjs`: 파일 준비·완료·상태·다운로드와 prepare 전용 종료 판정, 복구 원본 메타데이터 대조 27건.
- `workhub-cooperation-handover.mjs`: 인계·재인계, 배경 상세 실패 중 입력·요청 보존, 320px 화면 등 15개 브라우저 동선.
- `workhub-cooperation-batch.mjs`: 협업·일괄 13개 동선. C4 대상 입력은 합성하고 실제 어댑터 결과와 보관 비교 화면을 연결한다. 제품에 CSV 대상 선택칸을 추가한 것은 아니다.
- `workhub-messaging.mjs`: 기존 전송·복구와 소속 전환 비노출 18개 동선.
- `workhub-messaging-file-recovery.mjs`: 실제 첨부 컴포넌트·어댑터로 알려진/미상 ID, 거절·만료·응답 유실, 접수 전 실패·읽기 전용 복구·늦은 응답 14개 동선. 전체 브라우저 러너에 포함한다.

`npm run test:workhub:browser -- cooperation messaging`로 관련 파일을 선택할 수 있다. 시험은 운영 DB·Storage를 호출하지 않으며 [수정·검증·인계](../docs/workhub/pilot-completion/app-contract-fixes.md)에 실제 서비스 검증 경계를 적었다.

## 학생 출력·스킨·관계 목록·홈 메시지

- `test_workhub_record_export.mjs`: 기존 읽기 어댑터의 학생/작성자 범위, 전체 페이지·중복·기술 한도, 과거 평가 기준과 점수, 재조회, CSV 수식 보호를 검증한다.
- `workhub-record-export.mjs`: 실제 수업 화면과 출력 패널에서 미리보기→범위 확인→CSV/인쇄, 출력 전 자료/명부/학교/권한 변경, 늦은 응답과 인쇄 창 정리, 세 스킨·키보드·320px를 확인한다.
- `test_workhub_relations_list.mjs`: 유효기간 경계, 검색 정규화, 수강/학적 상태 구분, 전체 1,000명 검색과 20개 표시, SSR/권한을 확인한다.
- `workhub-relations-list.mjs`: 독립 검색·필터·페이지 보정·선택/사유 유지·원래 요청 복구·세 스킨·모바일 동선을 확인한다.
- `workhub-home-message.mjs`: 실제 연결 셸과 메시지 어댑터로 목록 밖 대화 열기, 권한/없는 대화/조회 실패, 입력·전송 번호 보존, 자동 읽음/쓰기 없음과 모바일을 확인한다.
- `workhub-document-appearance.mjs`: 문서함·질문형 양식의 세 스킨, 활성 텍스트 대비, 긴 내용, 200% 문자 확대 모사와 320px에서 입력/선택 보존·키보드를 확인한다.

네 브라우저 파일은 전체 러너에 등록했다. `npm run test:workhub:browser -- workhub-record-export workhub-relations-list workhub-home-message workhub-document-appearance`로 이 묶음만 실행할 수 있다. React/어댑터/브라우저는 실제 코드이며 서버 응답은 합성이다. 운영 DB에 접속하지 않는다. [구현·검증·실서비스 경계](../docs/workhub/pilot-completion/usability-completion.md).

## C8 기존 인계와 원요청 복구

- `test_workhub_school_transitions.mjs`: 총 34건. 구/신 목록의 협업·수합 인수·반려, 공식 담당 보호, 다음 페이지 기록, 반복 커서·기술 한도, 모듈 중지·목록 실패·목록 밖 기록에서 원키·원문 복구, 다른 내용/위조 접수증 거부를 확인한다.
- `workhub-school-transitions.mjs`: 총 42개 브라우저 시나리오. 실제 React·어댑터에서 C8 수정 전 사라진 인수 버튼을 재현하고, 입력·기존 요청 번호 보존, 응답 유실 뒤 한 번 접수된 결과의 재조회, 공식 담당 보호와 학교·권한·판 변경을 확인한다.
- `npm test -- workhub_school_transitions`, `npm run test:workhub:browser -- workhub-school-transitions`로 개별 실행한다. 브라우저의 요청 원장은 합성 서버이며 실제 DB 원자성·PostgREST 연결을 증명하지 않는다.
- SQL 대조 도구에서도 새 명령(`mutate`)과 원요청 복구(`recover`)를 분리한다. [수정·검증·Claude 재검토](../docs/workhub/pilot-completion/transition-c8-fix.md).

## 시간표 준비 엑셀·순차 저장·점검표

- `test_workhub_timetable_setup_workbook.mjs`: 원본 대조·편집 범위·행/열 오류·명시 ID·미정 정원·원문/배열 보존·XLSX 문자열 출력 77건.
- `test_workhub_timetable_setup_batch.mjs`: 항목별 승인·접수·부분 성공·중지·같은 키 복구·늦은 요청·범위 변경·학생 겹침 해소 45건.
- `test_workhub_timetable_setup_checklist.mjs`: 서버 진단 보존·분모·바로가기·점검표·SSR 17건.
- `workhub-timetable-setup.mjs`: 기존 단독/준비/실제 메뉴와 일괄 연결을 포함한 27개 시나리오.
- `workhub-timetable-setup-batch.mjs`: 실제 XLSX 파일·화면·어댑터와 합성 RPC로 13개 시나리오. 전체 브라우저 러너에 등록했다.
- 실행: `npm test -- workhub_timetable_setup`, `npm run test:workhub:browser -- timetable-setup timetable-preparation timetable-connected`.
- 실제 Supabase·Excel 편집 시험은 포함하지 않는다. [구현·검증 경계](../docs/workhub/timetable/setup-batch-implementation.md).

## 시간표 주당 시수 일괄 입력·누락 점검 (#69 추가)

- `test_workhub_timetable_preparation_hours_workbook.mjs`: 92건. 전체 원본/초안 대조, 공식 시수 보호, 숫자·행·식별자 검사, 선택/변조/순서 보존.
- `test_workhub_timetable_preparation_progress.mjs`: 27건. 누락·합계·미정 시수·동명 식별·페이지 전체 집계와 React SSR.
- `workhub-timetable-preparation-hours.mjs`: 실제 XLSX·React 14건. 미반영 입력·파일 재검사·늦은 응답·범위/권한 변경·검색/선택·모바일.
- `workhub-timetable-preparation-hours-connected.mjs`: 실제 준비 화면과 전송 어댑터 9건. 로컬 반영/서버 저장 분리, 판 충돌, 미반영 파일 보관, 기존 요청 복구, 정확한 수업 이동·교사 합계.
- 두 브라우저 파일은 전체 러너에 등록했다. RPC 응답은 합성이며 실제 Supabase/Excel 편집 성공을 의미하지 않는다.

## 메신저·수합·내 업무 입력 화면

- `workhub-workflow-ui.mjs`: 실제 React와 합성 전송을 사용하는 5개 시나리오. 메시지 확인 전 미전송, 크기 변경 시 입력 보존, 내 업무 저장 명령, 검색 후 수합 대상 보존, 초안·공개 분리, 저장된 선택 설정 재표시, 320px·큰 글씨·어두운 화면을 확인한다.
- `node tests/browser/run.mjs workhub-workflow-ui`로 실행하며 전체 브라우저 러너에도 포함된다.
- 기존 `workhub-messaging*`, `workhub-collection-*`, `workhub-tasks`, `workhub-task-navigation`, `workhub-cross-module`의 요청 복구·권한·첨부 회귀를 함께 실행한다.
- 운영 DB·실제 회원·유료 AI는 호출하지 않는다. [화면·검증 기록](../docs/workhub/workflow-ui/README.md).

## 일정·협업·인계 화면

- `workhub-coordination-ui.mjs`: 실제 React와 합성 전송을 사용한 7개 시나리오. 일정 공유 범위·대상 보존, 일괄 입력 단계, 협업 목록/상세·선택 업무 연결·재확인, 인계 미리보기/제외 자료·입력 변경, 같은 요청 복구, 320px·큰 글씨·다크 모드를 확인한다.
- `node tests/browser/run.mjs workhub-coordination-ui`로 실행하며 전체 러너에 포함한다.
- 기존 `workhub-calendar-*`, `workhub-cooperation-*`, `workhub-school-transitions`, `workhub-request-recovery`의 전송·권한·충돌·다중 페이지 검증을 함께 실행한다.
- 서버 계약과 DB를 바꾸지 않는다. [화면·검증 기록](../docs/workhub/coordination-ui/README.md).


## AI 답변·근거·개인 기억·관리자 설정 화면

- `workhub-assistant-ui.mjs`: 실제 React·기존 합성 fixture를 이용한 25개 시나리오. 넓은 화면/AI 옆자리 순서, 인용 판·줄바꿈·원문 ID, 명시 Sonnet 검토, 기억 선택/편집 확인, 키 입력 접기와 원요청 복구, 권한별 키 UI, 예약 주의·진단을 확인한다.
- 320px·두 배 글씨·키보드·실제 세 스킨의 주요 텍스트 대비를 검사하고 외부 호출을 차단한다.
- `node tests/browser/workhub-assistant-ui.mjs`로 실행하며 전체 브라우저 러너에 등록했다. 기존 AI·기억·운영·질문형·평가계획서·교차 모듈 회귀를 함께 검사한다.
- [화면·검증 기록](../docs/workhub/assistant-ui/README.md).

## 공통 메뉴·검색·알림·상태 안내

- `workhub-navigation-ui.mjs`: 실제 React·합성 응답 23건. 메뉴 범위/현재 위치, 검색 원본 ID·판/부분 실패/이동 잠금, 알림 원본 이동·읽음 분리, 복구·연결 안내를 검사한다.
- 320px·두 배 글씨·세 스킨의 글자 대비·키보드 복귀와 외부 요청 0건을 확인한다. 기존 메시지/파일·검색·복구·모바일 회귀 17파일과 함께 실행한다.
- 전체 브라우저 러너에 등록. `node tests/browser/run.mjs workhub-navigation-ui`로 실행한다. [화면·검증 기록](../docs/workhub/navigation-ui/README.md).


## 기존 업무와 업무실 전체 화면 마감

- `site-ui-finish.mjs`: 실제 기존 React 화면에 합성 회원·제출·대화를 넣은 16건. 허용 메뉴 일치, 화면 안 이동의 입력·파일 보존, 실패 안내, 키보드·초점, 320px·2배 확대, 긴 자료·표 스크롤·대화 제목·읽기 대비를 검증한다.
- 전체 브라우저 러너에 등록. `node tests/browser/run.mjs site-ui-finish`로 실행한다.
- 기존 `email-login`, `doc-ai-school-policy`, `workhub-shell-layout`, 교차 모듈·검색·알림·시간표·문서·모바일 회귀와 함께 확인한다. [화면·검증 기록](../docs/workhub/site-ui-finish/README.md).

### 연간 피드백의 승인된 인증 연결 개선 (2026-10-30)

`node tests/test_workhub_identity.mjs`는 실제 `createSupabaseConnection`에 제어 가능한 세션/프로필 응답을 넣어 첫 INITIAL_SESSION, 동시 조회 공유, 완료/실패 후 비캐시, 계정·세대 분리, 로그아웃·승인/역할 철회, 쓰기 전후 세션·권한 검증을 확인한다. 공용 인증 이벤트의 기존 첫 인자도 검증한다. 운영 서비스나 실제 계정은 사용하지 않는다.

`node tests/browser/run.mjs workhub-connection workhub-draft-recovery workhub-day-refresh workhub-request-recovery workhub-messaging-pilot email-login`은 관련 실제 화면 7개 파일을 검사한다. `workhub-connection`은 느린 프로필과 첫 세션 이벤트가 겹쳐도 기존 연결을 무효화하지 않는지 확인하며, 기존 초안·권한 철회·계정 변경 시험을 유지한다.
