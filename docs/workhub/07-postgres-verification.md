# 독립 PostgreSQL 연결의 일정 저장 경쟁 검증

이 문서는 tests/integration/workhub-postgres.mjs의 실행 조건과 판정 기준이다. 기존 PGlite 단일 연결 회귀와 별도로, 실제 PostgreSQL 서버의 독립 backend에서 row lock·advisory lock 대기를 관측한다. 운영 DB·실제 회원·Supabase 설정에 접근하는 시험이 아니다. 제안 SQL의 운영 확정·실행 절차도 대신하지 않는다.

## 1. 실행 환경과 안전 경계

전용 환경변수 두 개가 모두 필요하다.

- WORKHUB_TEST_DATABASE_URL: postgres 또는 postgresql URL. 호스트는 127.0.0.1, localhost, ::1만 허용하며 DB 이름은 정확히 workhub_contract_test여야 한다.
- WORKHUB_TEST_ALLOW_FIXTURES: 정확히 1. 이 실행에서 합성 스키마·역할·자료를 생성한다는 테스트 전용 표지다.

URL의 쿼리와 fragment는 거부한다. URL 원문을 pg의 connectionString에 넘기지 않고 검증한 호스트·DB·사용자·포트를 분리해 전달한다. localhost는 DNS에 의존하지 않도록 127.0.0.1로 연결한다. 접속 후에도 current_database를 확인한다. Docker 서비스의 포트 전달에서는 inet_server_addr가 컨테이너 주소일 수 있으므로 서버 자신의 주소를 loopback으로 강제하지 않는다. 주소 안전 경계는 클라이언트의 접속 endpoint다. 접속 URL·비밀번호·원문 연결 오류는 로그에 출력하지 않는다.

시험은 빈 일회용 PostgreSQL 인스턴스를 요구한다. public의 객체·함수, auth/storage를 포함한 사용자 스키마, authenticated/anon 역할이 이미 있으면 쓰기 전에 거부한다. 시험 계정은 이 빈 인스턴스에서 역할·스키마를 생성할 수 있는 테스트 관리자다. 운영 계정의 권한을 올리거나 기존 역할을 재사용하는 절차는 없다.

loopback 검사는 로컬에 연결된 운영 DB 터널을 스스로 식별하는 장치가 아니다. 반드시 폐기 가능한 테스트 전용 PostgreSQL 서비스를 사용한다. 빈 DB 검사와 전용 이름·플래그를 모두 통과시키기 위해 운영 DB를 비우거나 이름을 바꾸면 안 된다.

실행 명령:

    node tests/integration/workhub-postgres.mjs --check-guard

이 명령은 DB에 접속하지 않고 허용 3개·차단 9개의 주소/설정 조건을 검사한다. 일반 실행은 다음과 같다.

    node tests/integration/workhub-postgres.mjs

WORKHUB_TEST_DATABASE_URL과 WORKHUB_TEST_ALLOW_FIXTURES는 CI 서비스 연결 정보로 주입한다. 예제에 운영 키나 접속 문자열을 복사하지 않는다. 환경변수가 빠지거나 안전 조건을 어기면 실패 종료하며, 테스트 통과 또는 skip으로 처리하지 않는다.

## 2. 실제로 적용하는 범위

빈 인스턴스에 최소 auth/storage mock 스키마와 authenticated/anon 역할을 만든다. auth.uid는 연결별 request.jwt.claim.sub를 읽는다. 이후 원본 migrations/001~007을 파일 그대로 실행하고 database/workhub/001-calendar-foundation.proposed.sql을 적용한다.

회원은 example.invalid 주소의 합성 UUID만 생성한다. 기존 가입 트리거로 생성된 합성 프로필을 테스트 준비 과정에서 승인 superadmin으로 설정한다. 학교 소속 teacher/calendar_manager는 이 합성 회원에 연결한다. workhub_settings의 기본 superadmin 공개 게이트는 유지한다.

관측 연결 하나와 각 경쟁의 두 연결은 각각 new pg.Client로 생성하며 서로 다른 pg_backend_pid인지 확인한다. 모든 경쟁은 READ COMMITTED에서 실행한다. 저장 연결은 SET LOCAL ROLE authenticated와 본인의 합성 auth.uid를 사용하므로 SECURITY DEFINER RPC의 게이트도 실제로 실행된다. 소속 관리·승인 철회 연결은 테스트 관리자다.

이 mock은 Supabase Auth·REST·Storage 서비스 전체를 복제하지 않는다. Google 로그인, JWT 서명 검증, PostgREST 풀링, 실제 파일, 네트워크 단절, 운영 DB의 데이터량은 별도 검증 대상이다.

## 3. 경쟁 조건과 합격 기준

| 경쟁 | 의도적으로 먼저 잡는 잠금 | 두 번째 연결의 합격 결과 |
|---|---|---|
| 같은 멱등 키·같은 입력 | 첫 저장의 본인 소속 행 잠금 | 같은 일정 ID·버전·응답. 일정·receipt·감사 각각 1건만 증가 |
| 같은 멱등 키·다른 입력 | 첫 저장의 본인 소속 행 잠금 | IDEMPOTENCY_CONFLICT. 최초 입력만 반영되고 각각 1건만 증가 |
| 다른 소속의 같은 일정·expectedVersion | 작성자의 일정 원본 행 잠금 | 담당자의 저장은 CONFLICT. 최신 원본을 반환하고 버전은 1회만 증가 |
| 회원 승인 철회 선행 | is_active=false UPDATE의 회원 행 잠금 | 대기한 저장은 FORBIDDEN. 일정·receipt·감사 증가 없음 |
| 학교 소속 종료 선행 | active=false UPDATE의 소속 행 잠금 | 대기한 저장은 INACTIVE_MEMBERSHIP. 일정·receipt·감사 증가 없음 |
| 같은 학교·회원의 겹친 활성 소속 INSERT | 첫 INSERT의 학교·회원별 advisory lock | OVERLAPPING_MEMBERSHIP. 활성 소속은 1행만 남음 |

각 경쟁에서 첫 트랜잭션은 쓰기를 수행한 후 커밋하지 않는다. 두 번째 요청을 시작하고 관측 연결로 pg_stat_activity.wait_event_type=Lock 및 pg_blocking_pids에 첫 backend가 포함되는지 확인한다. 기간 중첩은 wait_event=advisory까지 확인한다. 이 관측이 성공한 다음 첫 트랜잭션을 커밋한다.

20ms 간격은 관측 query의 호출 빈도를 제한한다. 일정 시간이 지났다는 이유로 잠금이 잡혔다고 가정하지 않는다. 지정 backend의 실제 대기를 7초 내 관측하지 못하거나, 관측 전에 둘째 요청이 끝나면 실패한다. 서버 statement_timeout·lock_timeout과 클라이언트 query_timeout도 유한하게 설정한다.

각 경쟁 후 별도의 관측 query로 일정 버전, receipt 수, 감사 수를 대조한다. receipt의 학교·일정·버전·행위자가 해당 원본과 감사 기록에 연결되는지도 확인한다. 예상한 비즈니스 오류는 SQLSTATE P0001과 정확한 오류명을 함께 검사한다. 잠금 시간 초과·연결 실패를 정상 충돌로 간주하지 않는다.

이 시험은 철회가 먼저 잠금을 획득한 순서를 검증한다. 저장이 먼저 잠금을 획득하고 커밋한 뒤 철회되는 반대 순서를 실패로 정의하지 않는다. 실제 시스템에서 허용되는 직렬화 순서와 구별해야 한다.

## 4. 트랜잭션과 정리

원본 기반 스키마 준비는 트랜잭션으로 실행하고, 신축 제안은 파일에 포함된 BEGIN/COMMIT으로 실행한다. 이후 경쟁별 연결은 명시적 BEGIN과 COMMIT/ROLLBACK을 사용한다. 기대한 거부가 발생하면 해당 트랜잭션을 ROLLBACK한다.

실패하거나 단언이 틀려도 finally에서 열린 경쟁 트랜잭션을 ROLLBACK하고 모든 연결을 닫는다. 첫 연결의 잠금을 먼저 해제한 뒤 둘째 연결을 정리하여 대기 query 뒤의 ROLLBACK이 계속 기다리지 않도록 한다.

성공한 합성 fixture는 이 전용 인스턴스에 남긴다. 스크립트는 DB·스키마·역할을 DROP하거나 기존 내용을 자동 초기화하지 않는다. GitHub Actions의 일회용 PostgreSQL 서비스 종료가 전체 정리 경계다. 재실행에는 새 빈 인스턴스가 필요하며, 기존 fixture가 있는 인스턴스는 선행 검사에서 실패한다.

## 5. 검증 기록과 남은 범위

작성 시점에 JavaScript 구문 검사와 DB 미접속 안전 게이트 12조건을 통과했다. 독립 PostgreSQL 16에서의 여섯 경쟁 실측 결과는 CI 실행 후 해당 실행 링크와 HEAD를 함께 기록해야 한다. 이 문서 작성만으로 통과했다고 주장하지 않는다.

PGlite 38개 회귀는 기존 회원·가입 트리거 보존, RLS·private·대상 범위, malformed 응답, 브라우저 연결 계약 등을 검사한다. 이번 여섯 경쟁은 그중 실제 독립 연결 잠금과 가시성 문제를 보강한다. 둘의 성공을 합쳐도 다음을 자동 승인하지 않는다.

- 제안 SQL의 운영 적용 또는 일반 교사/타학교 공개 확대
- 기존 학교 구분 없는 REST·Storage·API 경로의 전국 격리
- 운영 규모의 지연 시간·처리량·교착 상태 전수 검증
- 실제 회원 보존 비교·실물 파일 복원·OAuth/세션 갱신 종단 검증

판단해서 정한 것: 폐기 가능한 빈 인스턴스만 허용하고 자동 DROP을 배제했다. 경쟁 순서는 실제 잠금 대기로 증명하며, 임의 대기 시간으로 결과를 맞추지 않는다. 환경 가정을 바꾸려면 이 문서와 시험의 접속·빈 DB 게이트를 함께 검토해야 한다.
