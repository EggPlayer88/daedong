# 수합 HWPX 다운로드 호환 보강 S1

수합 초안에 연결된 정상 HWPX가 다운로드되지 않는 문제를 고친다. 운영 DB 적용은 사용자가 한다. 기존 R1/R1S 설치 파일은 수정하지 않는다.

## 원인과 범위

2026-10-22 운영 환경에서 파일의 `ready` 상태, 크기·해시, Storage 객체, 본인 접근 허가는 정상인데 Storage 로그의 `object.get_authenticated_info`가 `NoSuchKey`로 끝나는 것을 확인했다. Supabase 인증 다운로드는 본문 전에 파일 정보를 조회하며, 기존 `workhub_storage.object_readable(text)`는 이 작업 이름을 허용하지 않는다. 같은 본인·경로에서 `object.get_authenticated`는 허용되었다.

[Supabase Storage 접근 제어 문서](https://supabase.com/docs/guides/storage/security/access-control)도 인증 다운로드의 정보 조회와 본문 조회 작업을 구분한다. S1은 기존 함수의 작업 이름 판정 두 곳에 `object.get_authenticated_info`만 더한다. 정보 조회에도 본문과 같은 계정·소속·파일 상태·현재 부모판·만료 전 접근 허가 검사를 적용한다. 목록, 공개·서명 다운로드, 다른 사용자 접근을 허용하지 않는다.

파일이나 수합 초안은 다시 만들 필요가 없다. 회원·제출·Storage 객체·활성화·API 권한은 바꾸지 않는다. 메신저 첨부용 함수는 이번 범위에 포함하지 않는다.

## 적용 순서

1. 대상 Supabase 프로젝트가 `dhaoszbqtbofqftgjfyb`인지 확인한다.
2. SQL Editor의 새 쿼리에 **S1-01_수합_Storage정보조회_호환.sql** 전체를 붙여 실행한다. 별도로 채울 값은 없다. 정상 결과는 `S1-01 / ok` 한 행이다. 오류면 멈추고 메시지를 확인한다. 트랜잭션 안에서 원문·속성·변경 결과를 확인하므로 오류 시 변경을 남기지 않는다.
3. **S1-02_사후점검.sql**을 실행한다. 5행 모두 `ok`여야 한다.
4. **INT-06_SQL편집기용_통합점검.sql**을 실행하고 CSV를 보관한다. 18행, 12·13번은 `info`, 나머지는 `ok`, `FAIL` 0이 정상이다.
5. 기존 본인 대상 수합 초안을 다시 열어 같은 파일의 다운로드를 누른다. 내려받은 HWPX가 한글에서 열리고 선택한 원본과 같은지 확인한다. 공개는 이 확인에 필요하지 않다.
6. 앱 오류 안내 개선은 PR 자동 검사 확인 후 사용자가 병합·운영 배포한다. SQL 보강은 현재 앱에도 적용되므로 다운로드 재확인을 위해 앱 배포를 기다릴 필요는 없다.

이후 전체 점검은 **INT-06**을 쓴다. 기존 INT-05는 이전 함수 원문을 기대하므로 S1 적용 뒤 함수 차이를 보고하는 것이 정상이다. 이를 무시하도록 바꾸지 않고, 승인할 함수 지문 한 개만 갱신한 INT-06으로 전환한다. 나머지 판정식과 목록은 원본 그대로다. 약 595KB로 SQL Editor에 넣을 수 있으며, 목록 압축은 무손실 재생성과 실제 SQL 결과 대조로 검증한다.

S1-01은 LF·CRLF 원본을 모두 인식하고 같은 보강본에 재실행해도 바꾸지 않는다. 알 수 없는 원문이면 자동 덮어쓰지 않는다. 되돌려야 한다면 검토한 별도 증분이 필요하며 R1 전체 설치 파일을 재실행하지 않는다.

## 자동 검증

운영 DB에는 쓰지 않는다. PostgreSQL 17 격리 시험은 기존 전체 설치 시험 위에서 실행한다. 연결 정보는 기존 통합 시험 실행기의 로컬 주소 검사와 임시 DB 생성·정리 규칙을 따른다.

```bash
python database/workhub-storage-download/s1/test/build_check.py
python database/workhub-storage-download/s1/test/run_s1.py
node tests/test_workhub_collection_download.mjs
node tests/test_workhub_collection_server.mjs
node tests/browser/workhub-collection-create.mjs
npm test
npm run build
npm run build:workhub
```

`WORKHUB_DEPLOYMENT_PG_BIN`에 PostgreSQL 17의 bin 경로를 지정한다. Windows도 지원한다. CI에는 S1 SQL 회귀를 별도 단계로 추가했다.

검증 범위:

- 수정 전 정상 본문 권한이 있어도 파일 정보 조회가 거부되는 장애 재현.
- 보강 후 본인 정보·본문 읽기, 다른 교사·학교·익명 및 목록·서명·공개 작업 차단.
- 접근 허가 회수·만료와 수합 판 변경 뒤 과거 허가 차단, 새 허가의 정상 읽기.
- 기존 자료·객체·접근 허가·활성화 및 함수 소유자·권한·실행 속성 보존.
- LF·CRLF 적용, 재실행, 알 수 없는 원문 교체 거부, 함수 훼손 탐지.
- 전체 점검 18행과 이전 INT-05에서 승인 지문 하나만 바꾼 결과의 일치.
- 화면의 전송 실패 안내, 초안·파일 보존과 재시도, 실제 권한 거절 시 상세 비노출.

격리 PostgreSQL은 실제 RLS와 SQL을 실행하지만 Supabase Storage HTTP 서버는 실행하지 않는다. 보강 뒤 운영 Storage 왕복과 내려받은 문서 열기는 사용자 실행 후 별도로 확인한다.

## 판단해서 정한 것

- 기존 다운로드를 유지하고 필요한 정보 조회 작업만 허용한다. SDK 교체나 서버 관리자 권한 우회보다 변경 범위가 작고 기존 접근 통제를 그대로 적용할 수 있다.
- 오류 안내는 권한 거절·판 변경·파일 정보 이상·전송/내용 확인 실패·브라우저 저장 실패로 구분한다. 실제 권한 거절 시 상세를 감추는 동작은 유지하고 원시 서버 오류·내부 경로는 화면에 내보내지 않는다.
- 기존 SQL 원문을 보존하기 위해 새 증분과 새 전체 점검을 만든다. 점검 기준에서 예외를 넓히지 않고 함수 본문 지문 한 개만 교체한다.
