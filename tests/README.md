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
| `test_v2.py` | 실제 `template.hwpx` 로 hwpx 생성 전 구간. 시험 2/1/0회, 수행 2/1개, PP2 블록 삭제, 잔여 `{{` 0, `verify_hwpx`, **계약 섹션이 doc-ai-template FINAL 원문과 동일**, template.hwpx sha256 불변 |
| `test_scales.py` | 배점 정합성 — 회차 100점 / 수행 합 100점 / 반영비율 100%, 만점 표기 `N점(M%)` 서버 계산, 한도 초과 시 거부 대신 안내 |
| `test_hours.py` | 시수/누계 고정표 주입, `hours_manual` 보존, 범위 밖 처리, 표 자체 무결성(누계 단조·합계·ok) |
| `test_extract.py` | 참고자료 hwpx 추출, 표→마크다운, 길이 상한, 거부 5종 |
| `test_gate_py.py` | D20 승인 게이트 (generate·extract) — 실패 시 **대기로 판정**하는지 |
| `test_chat_v2.mjs` | 시스템 프롬프트 조립 — 고정부·상수 주입·manifest 파생, TBD 유지, 하드코딩 아님 |
| `test_contract.mjs` | 프롬프트 JSON 골격 ↔ `direct_tokens` 경로 정합 (프롬프트와 generate 의 이음매) |
| `test_hours.mjs` | 시수 안내가 표에서 파생되는지, 옛 시수 공식이 프롬프트에 남지 않는지 |
| `test_principle.mjs` | 제0원칙 위치·문구, 배점 규칙이 서버 검증기와 일치 |
| `test_terms.mjs` | 사이트 명칭·용어 가드 (옛 용어가 되살아나면 실패) |
| `test_marker.mjs` | `===PLAN_READY===` 파서 (코드펜스·END 누락·깨진 JSON) |
| `test_gate.mjs` | D20 승인 게이트 (chat) — **미승인이면 Claude API 를 호출하지 않는지** |

## 작성 원칙

- **실제로 돌려서 확인한다.** 빌드 통과나 정적 검사로 대신하지 않는다.
  hwpx 는 진짜로 만들어 열어 보고, 화면은 `react-dom/server` 로 렌더해 문구를 본다.
- **깨진 입력을 함께 넣는다.** AI 응답은 언제든 형식이 어긋날 수 있으므로
  배열 자리에 문자열/null 이 와도 화면이 죽지 않는지까지 확인한다.
- **자산과 코드의 이음매를 고정한다.** manifest·상수·고정표가 바뀌면 프롬프트·검증·화면이
  따라가야 하고, 따라가지 않으면 테스트가 깨져야 한다.
- 테스트가 깨지면 **먼저 어느 쪽이 틀렸는지 판단한다** — 규약이 바뀐 것이라면 테스트를
  갱신하고, 아니면 코드를 고친다. (지금까지 실제로 양쪽 모두 있었다)
