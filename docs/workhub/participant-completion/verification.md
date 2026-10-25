# 이번 작업의 확인 범위

2026-10-26. 사용자의 요청으로 실제 기능 시험은 보류한다.

| 확인 | 상태 | 범위 |
|---|---|---|
| 기존 main 동기화 | 완료 | PR #82 병합 `f4ed481`에서 작업 브랜치 생성 |
| OP1 SQL 컴파일 | 완료 | 새 로컬 PostgreSQL 17.6에 선행 설치와 OP1 적용, 업무 요청/계정 허용 없음 |
| 사후/통합 점검 생성 | 완료 | OP1-02 8행, INT-10 18행의 컴파일 환경 결과 FAIL 없음 |
| 기존 공통 gate 보존 | 완료 | `legacy_gate`, `member_actor`, `p2_member_reachable` 원문·권한 전후 동일 |
| TypeScript | 통과 | `npm run check:workhub`, 이후 최종 workhub 빌드의 `tsc --noEmit`도 통과 |
| 배포 빌드 | 통과 | `npm run build`, `npm run build:workhub`. main의 500kB 초과 묶음 크기 경고는 남음 |
| 신규 회귀 코드 | 작성 | 계약 거부 경계·전용 context, 기존 MP1 fallback 합성 응답 |
| 전체 단위/브라우저 기능 시험 | 이번 로컬 실행 보류 | 사용자 요청. PR의 기존 자동 CI는 별도 결과 |
| 실제 서버 시험 | 미실행 | 운영 DB·파일·메시지·AI 요청 없음 |
| 운영 SQL/참여 활성화 | 미실행 | 새 승인 양식은 미확인 값으로 실행되지 않음 |

SQL 설치와 카탈로그 컴파일 통과는 RPC 권한·동시성·업무 동작 성공을 증명하지 않는다. OP1-03/05/80의 승인·변경·중지 동작, 기간 경계, 계정 전환, 독립 승인, 첨부 Storage, 기존 미확정 요청 복구는 후속 기능 시험에 포함한다. 특히 코드 배포만으로 역할·학교 데이터가 채워지거나 모든 모듈이 활성화되지는 않는다.

검토/실행 SQL 8개의 UTF-8·LF SHA-256 목록은 `database/workhub-participation/op1/sql-package.json`에 있다. `package.py`는 실제 파일과 목록을 대조하며, CI에서도 점검 파일 재생성 후 대조한다. 설치문은 약 97kB, INT-10은 약 613kB다.
