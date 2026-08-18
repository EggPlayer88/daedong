# tests/ — 검증 스크립트

의존성 없는 순수 스크립트다 (테스트 프레임워크를 쓰지 않는다).
각 파일은 단독 실행 가능하고, 성공하면 `✓` 줄과 `전부 통과`, 실패하면 `✗` 와 종료코드 1.

```bash
npm test                 # 전체
npm test -- hours        # 파일명에 'hours' 가 든 것만
node tests/test_gate.mjs # 단독 실행
```

## Python 테스트 준비 (1회)

`generate.py` / `extract.py` 는 `lxml` 이 필요하다.

```bash
python3 -m venv tests/.venv
tests/.venv/bin/pip install lxml
```

러너는 `$PYTHON` → `tests/.venv` → `.venv` → `python3` 순으로 lxml 이 있는
인터프리터를 찾는다. 못 찾으면 **Python 몫을 건너뛰고 그 사실을 출력한다**
(조용히 통과시키지 않는다).

## 무엇을 지키는 테스트인가

| 파일 | 지키는 것 |
|---|---|
| `test_v4.py` | 실제 양식 6종으로 hwpx 생성 전 구간. **token-map 전수 대조**(맵 ≠ 양식 → 실패), 모르는 토큰은 즉시 실패, short=0 항 생략, 3학년 성취수준 부재, 자유학기 활동 블록, 프롬프트 골격 ↔ 치환 경로 이음매, 양식 sha256 불변 |
| `test_scales.py` | 배점 정합성 — 회차 100점 / 수행 합 100점 / 반영비율 100%, 만점 표기 `N점(M%)` 서버 계산, 한도 초과 시 거부 대신 안내 |
| `test_hours.py` | 시수/누계 고정표 주입, `hours_manual` 보존, 범위 밖 처리, 표 자체 무결성(누계 단조·합계·ok) |
| `test_extract.py` | 참고자료 hwpx 추출, 표→마크다운, 길이 상한, 거부 5종 |
| `test_gate_py.py` | D20 승인 게이트 (generate·extract) — 실패 시 **대기로 판정**하는지 |
| `test_chat_v2.mjs` | 시스템 프롬프트 조립 — 고정부·상수 주입·manifest 파생, TBD 유지, 하드코딩 아님 |
| `test_contract.mjs` | 프롬프트 JSON 골격 ↔ `direct_tokens` 경로 정합 (프롬프트와 generate 의 이음매) |
| `test_hours.mjs` | 시수 안내가 표에서 파생되는지, 옛 시수 공식이 프롬프트에 남지 않는지 |
| `test_principle.mjs` | 제0원칙 위치·문구, 배점 규칙이 서버 검증기와 일치, 규정 한계선이 `regulation-2026.json` 에서 파생 |
| `test_terms.mjs` | 사이트 명칭·용어 가드 (옛 용어가 되살아나면 실패) |
| `test_marker.mjs` | `===PLAN_READY===` 파서 (코드펜스·END 누락·깨진 JSON) |
| `test_gate.mjs` | D20 승인 게이트 (chat) — **미승인이면 Claude API 를 호출하지 않는지** |
| `test_routing.py` | 양식 라우팅 — 학년 × 시험 횟수 → 양식 6종, 한도·성취수준을 token-map 에서 세는지, 없는 조합 처리, 정보·진로 안내가 해당 교과에만 뜨는지 |
| `test_exam_methods.py` | 정기시험 3분류 — 회차 100점 = 선택형+단답형·완성형+서·논술형, **30% 산입은 서·논술형만**, 현행 양식에 칸 없는 배점의 누락 안내 |
| `test_count_set.py` | 횟수 세트(시험 0→수행 3 / 1→2 / 2→1~2) — 세트 밖은 **막지 않고 안내**, 작년과 달라진 조합의 전환 안내, 양식 v2 목표치가 현재 한도로 새지 않는지 |
| `test_regulation.py` | 학업성적관리규정 V01~V18 — 규칙별 위반/통과 한 쌍, 유형 A~D 판정, ERROR 는 생성 차단, WARN·FLAG 는 통과 후 안내, `check_only` 응답 |
| `test_prefill.py` | 작년 값을 그대로 물려받았을 때의 확인 안내(`%` 표기 없던 칸), **서·논술형 칸을 전부 세는지**(파서 v1 첫-칸-만 버그 회귀), 정기시험 있는 전 교과의 작년 실적이 30% 이상인지 |
| `test_prefill.mjs` | prefill 주입 — 교과·학년 **한 건만** 선택, 작년 값 중 그대로 쓰면 안 되는 것(시험 시기·시수·3분류·2022 성취기준), `_warnings`·보정 내역 노출, ●▲✗ 3분기 + 교과 DB 한정 주입, 수행 [유지/변경/신규], 팩 없으면 백지 모드 |
| `test_conversations.mjs` | 대화 저장(004) — 제목 자동 생성(참고자료 오염 방지·plan 우선), 목록 화면, **RLS personal(admin 열람 경로 없음)**, 저장 실패가 대화를 끊지 않는지 |
| `test_embed.mjs` | users↔departments embed 모호성 — FK 가 2개라 `대상!FK이름` 으로 명시해야 한다 |

## 작성 원칙

- **실제로 돌려서 확인한다.** 빌드 통과나 정적 검사로 대신하지 않는다.
  hwpx 는 진짜로 만들어 열어 보고, 화면은 `react-dom/server` 로 렌더해 문구를 본다.
- **깨진 입력을 함께 넣는다.** AI 응답은 언제든 형식이 어긋날 수 있으므로
  배열 자리에 문자열/null 이 와도 화면이 죽지 않는지까지 확인한다.
- **자산과 코드의 이음매를 고정한다.** manifest·상수·고정표가 바뀌면 프롬프트·검증·화면이
  따라가야 하고, 따라가지 않으면 테스트가 깨져야 한다.
- 테스트가 깨지면 **먼저 어느 쪽이 틀렸는지 판단한다** — 규약이 바뀐 것이라면 테스트를
  갱신하고, 아니면 코드를 고친다. (지금까지 실제로 양쪽 모두 있었다)
