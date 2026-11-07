# 나이스 연결 검증 기록 — 2026-11-08

기준: main 426c69ba (#114), 작업 브랜치 feat/neis-school-data-connection. 운영 DB·권한·Vercel 설정은 변경하지 않았다. 나이스 공식 서버에는 읽기 전용 요청만 보냈다.

## 검증 결과

| 검증 | 결과 | 경계 |
|---|---:|---|
| 앱 계약·SSR·HTTP·지연 신원·CSV | 10 통과 | 합성 세션·RPC |
| 실제 R0 일정 저장 + N1 격리 DB | 18 통과 | PGlite PostgreSQL, 운영 DB 아님 |
| 서버·공식 API 형태·누락·헤더·예약 인증 | 11 통과 | 합성 HTTP/DB |
| 대동여중 공개 원본 초기 적재·앱 parser | 5 통과 | 실제 받은 공개 자료, 격리 DB |
| INT-11 전체 기반 + N1 + INT-12 재생성·훼손 | 34 통과 / 0 실패 | 새 localhost PostgreSQL17 |
| 나이스 화면 브라우저 | 9 통과 | 실제 React·Chromium, 합성 서버 |
| 기존 학교 관리 브라우저 | 13 통과 | 기존 회귀 |
| 기존 홈 2×2·핵심 업무 브라우저 | 4 + 7 통과 | 기존 회귀 |
| 타입 검사, 운영 앱·업무실 빌드 | 통과 | 큰 기존 번들 경고는 남음 |
| 저장소 전체 npm test | 5,425 통과 / 0 실패 | Python 포함, 생략 없음 |
| 마지막 누락 보류 보완 뒤 나이스 회귀 재실행 | 44 통과 / 0 실패 | 위 전체 실행 후 추가한 SQL 회귀 1건 포함 |

실제 새 Python Provider와 사용자 발급 키로 공식 서버를 다시 조회했다. 급식20·학사일정184·학급9·시간표612건이 모두 정상이며 키·요청 URL·외부 오류 원문은 출력하지 않았다.

## 발견 후 고친 것

1. 기존 R0 학교 전체 일정은 audience.all=true를 요구한다. 원본 제안과 SQL을 동일하게 맞췄다.
2. 원본의 완전히 동일한 중복 행은 합치되, 받은 총 행 수는 원본 건수와 따로 대조한다. 충돌 중복·페이지 중복은 거절한다.
3. 동일 내용의 기존 일정 연결 시 불필요한 충돌이 나던 SQL을 수정했다. 이름/날짜 변경 후 원래 이름으로 돌아온 원본도 다시 비교한다.
4. 실제 나이스는 Accept: application/json 헤더에 HTTP500, Accept: */*에 HTTP200을 반환했다. 요청 헤더만 맞추고 본문 JSON·학교·연도·건수 검사는 유지했다.
5. 시각·장소·관련 대상·사이트 단독 편집을 보존하고, 긴 원문은 잘라 저장하지 않는다.
6. 결과 미상 요청은 원문·번호로 복구한다. 닫기는 원 반영과 같은 학교 잠금 아래에서 이미 처리됨/닫힘 중 하나만 확정한다.
7. 시간초과 뒤 신원 조회가 늦게 끝나도 새 호출을 시작하지 않는다. CSV의 수식 시작 문자를 문자열로 보존한다.

## 검증하지 않은 운영 경계

- 실제 Supabase PostgREST를 통한 새 N1 RPC 왕복
- Vercel Production의 나이스 키·예약 비밀값·일일 실행
- 실제 관리자 선택으로 학교 일정 184건 중 필요한 항목 반영
- 공개 시간표와 기존 교사·수업·학급·교시 시각의 실자료 연결

이 경계가 끝나기 전에는 ‘운영 등록 완료’ 또는 ‘운영 시간표 확정 완료’라고 판단하지 않는다. 초기 SQL은 원본 캐시만 저장한다.

## 다시 실행

```text
npm test
npm run check:workhub
npm run build
npm run build:workhub
node tests/browser/workhub-neis.mjs
node tests/browser/workhub-school-admin.mjs
node tests/browser/workhub-home-grid.mjs
node tests/browser/workhub-home-overview.mjs
python database/workhub-neis/n1/build_checks.py
```

마지막 명령은 WORKHUB_DEPLOYMENT_PG_BIN에 PostgreSQL17 bin을 지정한다. 외부 DSN·운영 DB는 받지 않는다. CI test에 새 브라우저 파일과 INT-12 검증을 포함했다. 실제 API 호출은 자동 CI에서 실행하지 않는다.
