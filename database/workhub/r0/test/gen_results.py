# R0_시험결과.md 생성: run_all.sh 출력(로그 파일)을 받아 결과 문서를 만든다.
# 사용: bash run_all.sh > "$R0_WORK/run_all.txt"; python3 gen_results.py "$R0_WORK/run_all.txt"
import datetime, os, re, subprocess, sys

log = open(sys.argv[1], encoding='utf-8').read().splitlines()
here = os.path.dirname(os.path.abspath(__file__))
sections, cur = [], None
for line in log:
    s = line.strip()
    if s.startswith('== ') and not s.startswith('== 합계') and not re.match(r'== \d+/\d+ PASS', s) and not s.startswith('== 준비'):
        cur = [s[3:], []]; sections.append(cur)
    elif cur and (s.startswith('PASS ') or s.startswith('FAIL ')):
        cur[1].append((s[:4] == 'PASS', s[5:]))
total = sum(len(x[1]) for x in sections); ok = sum(p for x in sections for p, _ in x[1])
pg = subprocess.run(['bash', '-c', f'. "{here}/env.sh" && $PSQL -U postgres -d r0 -Atc "show server_version"'],
                    capture_output=True, text=True).stdout.strip() or '17'
L = [f'# R0 시험 결과', '',
     f'{datetime.date.today().isoformat()} · 임시 PostgreSQL **{pg}** · Supabase 역할 흉내 · `test/run_all.sh` 출력에서 생성(`test/gen_results.py`)', '',
     '## 시험 환경', '',
     '- superuser 는 `supabase_admin`. 스크립트는 운영 SQL Editor 와 같이 **`postgres` 역할(superuser 아님)** 로 실행했다.',
     '- `anon`·`authenticated`·`service_role`·`authenticator` 역할, `auth.users`(소유자 `supabase_auth_admin`), `auth.uid()`(JWT claims 의 sub), `extensions` schema, public 의 Supabase 기본 권한(새 객체를 API 역할에 자동 부여)을 흉내 냈다.',
     '- 기존 앱 구조는 저장소 `migrations/001~007` 을 그대로 실행해 만들었다.',
     '- 호환 함수 호출은 PostgREST 와 같은 경로: `authenticator` 로그인 → `SET ROLE authenticated` → `request.jwt.claims` 설정.',
     '- **자료 0건 DB**("빈 DB"): 001~007 구조만. **기존 자료 DB**: 회원 6(superadmin 승인 1·승인 대기 superadmin 1·교사 승인 2·승인 대기 1·Auth 없는 프로필 1·프로필 없는 Auth 1), 제출 4건, 파일 4개 (모두 합성).',
     '- R0-03 입력은 `gen_inputs.py` 가 합성 값으로 만든다(학교 이름·날짜는 운영 초기값이 아님).',
     '- 자료 비교(`snapshot.sql`)의 범위: 구조, 회원·Auth 자료 해시, 제출·파일 **행 수**. Storage 파일 본문 바이트는 비교하지 않는다. 구조 지문(R0-00)은 PostgreSQL 내부 트리거를 보지 않는다.',
     '- 다시 돌리는 법: `test/README.md` (깨끗한 checkout 에서 `npm ci` 후 `run_all.sh` 하나로 전부. 실패가 있으면 종료 코드 1)', '',
     f'**총 {total}개 중 {ok}개 통과, 실패 {total - ok}개.**', '', '## 결과', '']
for name, items in sections:
    L.append(f'\n### {name}\n')
    for p, t in items: L.append(f"- {'✅' if p else '❌'} {t}")
    L.append(f"\n**{sum(p for p, _ in items)}/{len(items)} 통과**")
L += ['', '## 요청서·검토 항목 대응', '', '| 항목 | 시험 |', '|---|---|',
      '| 다른 학교 접근 | T06·T06d (맥락에 안 보임), T20~T20e (조회·수정·소속 위장 모두 거부), T37c |',
      '| 승인 대기 계정 | T03 (교사·superadmin 둘 다), T03c, III3 (첫 관리자 지정 거부), T27 (승인 해제 즉시 반영) |',
      '| 같은 요청 두 번 | T12·T12b·T31 (같은 결과, 새로 만들지 않음), T13·T32 (다른 입력이면 IDEMPOTENCY_CONFLICT), T39 (다른 사람은 별개), T50 (동시 2건), T24d0~T24f0 |',
      '| 버전 충돌 | T16·T16b·T35 (CONFLICT + 현재 원본), T51 (동시 수정), A6·A9 (앱이 충돌 원본을 읽음) |',
      '| 응답 유실 후 재시도 | T15 (수정 재시도 시 판이 두 번 오르지 않음), T34 (상태 변경), T12 (생성) |',
      '| 포함·제외 함께 선택 (Codex R1) | T24d~T24g (전체+겹침·조건+겹침·유일한 포함자 제외: 저장, 겹친 교사 열람 차단, 표에는 효력만, 재전송·재조회 동일, 겹침 해제 수정), A11~A13b (앱 normalizeDraft → 저장 → eventResponse·canRead) |',
      '| 기존 public 무변경 | II7·III8 (구조 지문), III9 (회원·Auth 해시, 제출 행 수), VI2 (되돌림 뒤 같은 범위 동일) |',
      '| 되돌림 범위 (Codex 3절) | VI0~VI0c (바깥 객체 참조·R0 이후 표가 있으면 지우기 전에 멈춤), VI1~VI3 |',
      '| 실패 시 원자성 | T41 (outbox 실패 시 일정·이력·접수증·감사 모두 없음), II6 |',
      '| 실패 판정 (Codex R2) | SQL 검증 행 하나를 틀리게 고친 사본 → FAIL 2, 종료 코드 1. 제외 우선 판정을 지운 사본 → FAIL 3, 종료 코드 1. PG 경로 오류 → 종료 코드 2 |',
      '| 재실행 (Codex R3) | 깨끗한 복제본 + `npm ci` + 다른 작업 폴더·포트·비 root 사용자로 `run_all.sh` → 전부 통과, 종료 코드 0 |']
open(os.path.join(here, '..', 'R0_시험결과.md'), 'w', encoding='utf-8').write('\n'.join(L) + '\n')
print(f'{ok}/{total}')
