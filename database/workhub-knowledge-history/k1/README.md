# K1 학교 자료의 과거 판 조회

상태: 앱·증분 SQL 준비. 운영 DB에는 적용하지 않았다. 현재 회원 연결, 메뉴 공개 범위, AI 모델·비용, 기존 P4 SQL을 변경하지 않는다.

## 추가한 기능과 계약

| RPC | 입력 | knowledge.v1의 data |
|---|---|---|
| workhub_knowledge_get | p_member_id, p_source_id, p_source_version(양의 integer) | source(기존 KnowledgeSource), isCurrent(boolean), canManage(boolean) |
| workhub_knowledge_history | p_member_id, p_source_id, p_before_version(integer 또는 null) | sourceId, authorMemberId, items, nextBeforeVersion(integer 또는 null), canManage |

items는 {version,status,title,recordedAt,isCurrent}의 배열이다. 판 번호 내림차순, 페이지당 최대 50건이다. 다음 쪽은 마지막으로 받은 판보다 작은 번호만 읽는다. 더 읽을 판이 있을 때만 nextBeforeVersion을 반환한다. 새 판이 추가되어도 다음 쪽에 중복되지 않는다.

원문은 기존 불변 knowledge_source_revisions에서 읽는다. 제목·본문·근거 위치·적용 기간·상태·기록 시각이 모두 요청한 판의 값이다. 현재 행은 작성자와 최신 여부를 확인할 때만 사용한다. 과거 자료를 최신 자료로 대체하지 않는다.

## 기존 접근 범위 유지

- member_actor(...,false)로 기존 로그인·가입 승인·superadmin 접근·현재 소속 검사를 그대로 통과한다.
- P4 설치 및 해당 학교의 knowledge 활성 상태가 필요하다. 중지되면 과거 조회도 NOT_READY다.
- P4의 p4_kn_rev_sees를 재사용한다. 게시·종료 판은 기존 범위의 학교 구성원, 초안은 원작성자 또는 지식 관리자만 본다.
- 초안 본문뿐 아니라 이력의 초안 제목도 동일 권한으로 걸러진다. 없는 자료·다른 학교·허용되지 않은 판은 NOT_FOUND다.
- 새 표·RLS·활성화·회원 변경 없이 공개 조회 함수 2개만 추가한다. authenticated만 실행하며 PUBLIC·anon·service_role의 직접 실행은 허용하지 않는다.
- HWPX 다운로드는 기존 workhub_knowledge_original_access에 선택한 source ID/판을 넘긴다. 기존 파일 경로·크기·hash·다운로드 전후 권한 대조를 유지한다.

## 화면

학교 자료 카드의 **이전 판 보기**에서 50건씩 과거 이력을 읽고, 선택한 판의 원문과 HWPX를 연다. 비서 답변의 원문 링크와 전체 검색 결과도 같은 정확한 ID·판 조회를 쓴다.

과거 판은 확인용이다. 현재 적용 기간 안의 최신 게시 판만 **이 자료로 질문**을 사용할 수 있다. 학교·계정·권한·자료 갱신 후에는 이전 원문을 즉시 숨기고 늦은 응답을 버린다. 자료 편집과 결과 미상 요청이 있을 때 원문 열기가 입력이나 요청 번호를 덮어쓰지 않는다.

K1 RPC가 아직 없는 환경은 조회 실패 안내를 표시하며, 최신 원문으로 우회하지 않는다. 기존 자료 목록·저장 기능은 독립적으로 유지된다.

## 적용 준비

실제 적용은 사용자가 별도로 진행한다. 파일 순서는 기존 운영 기준선 확인 → K1-01_학교자료_판별조회.sql → K1-02_사후점검.sql이다. 같은 이름 함수가 있으면 K1-01은 덮어쓰기 없이 전체 중단한다.

K1-02는 4행 모두 ok여야 한다. 이 파일은 K1의 함수·권한·기존 판 보호 검사용이며 운영 전체 점검을 대신하지 않는다. 기존 P4-03-05는 함수 개수를 23개로 고정하므로 K1 설치 뒤에는 25개가 되어 FAIL로 보인다. 기존 파일을 수정하거나 이 FAIL을 무시하지 않고, 실제 적용 준비 때 최신 전체 증분 목록을 포함한 통합 지문 점검도 함께 갱신해야 한다. 기존 운영 INT/T 계열 지문도 새 함수 추가를 반영한 기준이 필요하다.

## 자동 검증

test/run_k1.py는 PostgreSQL 17 실행파일과 psycopg2가 필요하다. 운영 DSN을 받지 않으며 새 임시 폴더·127.0.0.1의 높은 포트만 사용한다. 기존 P9 시험의 R0~P8 준비 코드만 재사용한다. 종료 시 시험 서버를 내린다.

PowerShell: K1_PG_BIN 환경 변수에 PostgreSQL 17 bin 절대 경로를 넣고 다음을 실행한다.

    python database/workhub-knowledge-history/k1/test/run_k1.py

Linux에서는 K1_PG_BIN=/path/to/pgsql/bin을 지정하고 python3으로 실행한다. PostgreSQL은 root로 시작하지 않는다.

- 실제 SQL에서 판 57개, 50+7 페이지, 초안·게시·종료 상태, 다른 작성자·다른 학교·모듈 중지, 기존 함수/권한 보존, 원본 파일 접근의 판·권한을 확인한다.
- 실제 SQL 응답을 tests/test_workhub_knowledge_history.mjs의 앱 parser에 넣는다.
- tests/browser/workhub-knowledge-assistant.mjs는 실제 React/어댑터와 합성 응답으로 원문·이력·권한 변경·응답 지연·편집 보존·모바일·다운로드 요청 판을 확인한다.
- 실제 Supabase/PostgREST/Storage·교사 계정·유료 AI 호출은 이 시험에 포함하지 않는다.

2026-10-21 검증: Windows 격리 PostgreSQL 17.6에서 K1 31건 통과, 실패 0. 실제 SQL 응답 8개와 앱 단위 9개를 합친 parser 검증 17건 통과. 학교 자료/인용 브라우저 17건, 기존 학교 자료 브라우저 10건, 기존 지식 단위 10건과 비서 링크 7건도 통과했다. TypeScript 검사 통과. 위 숫자는 실제 운영 연결 성공을 의미하지 않는다.
