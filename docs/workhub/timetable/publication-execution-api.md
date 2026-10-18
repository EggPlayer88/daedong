# 학기 전체 시간표 확정 계약 — timetable-publication.v1

2026-10-17. 앱 구현·합성 회귀 기준의 SQL 인계 명세다. SQL 설치, 운영 DB 연결, 교사 공개 완료를 뜻하지 않는다. 기존 `timetable-operations.v1` 확정 경로와 `timetable-operations.next.v1` 읽기 전용 명세·상세 조회는 바꾸지 않는다. SQL 확정본은 Claude가 작성하고 사용자가 적용한다.

## 1. 교사가 사용하는 순서

저장 초안과 적용 기간 선택 → **학기 전체 시간표 확인·확정** → 전체 변경 목록 확인 → 필요하면 상세 쪽 확인 → 전체 변경 자동 검증 → 적용 기간과 변경 건수 확인 체크 → 검증한 학기 시간표 확정.

개별 상세 몇 쪽을 읽은 것과 전체 검증 완료를 구분한다. 기존 12,000행 v1 제한을 풀어 학기 전체 자료를 응답 하나에 담지 않는다. 새 경로는 `operations-next-limits.json`에 정한 최대 100,000건, 쪽당 200건, 최대 500쪽을 검증한다. K-5 지연 측정에 따라 한도를 낮췄으며, 한도를 넘으면 공개 날짜 범위를 줄여 새 명세를 만든다. 신원 재확인과 최대 15분 수명은 유지한다. 전체 자료는 화면에 펼치거나 탭 메모리에 모두 쌓지 않는다.

읽는 동안 다른 확정·교환·학사 변경·탭 전환을 잠그며, 취소 버튼은 현재 검증을 중단한다. 이미 전송된 읽기 요청이 늦게 끝나도 그 결과는 버리고 다음 쪽은 요청하지 않는다. 취소나 오류 후에는 전체 검증을 다시 시작해야 한다. 입력·초안 판·학교 조회 기준이 바뀌면 이전 명세와 확인 체크를 폐기한다. 작성한 기간과 초안 선택은 기존 탭 메모리에 보존한다.

## 2. 전체 검증

`verifyPublicationChanges`는 서버가 내려 준 명세를 다시 파싱한 뒤 0쪽부터 마지막 쪽까지 순차 조회한다. 각 쪽의 `previewId`, `manifestHash`, `index`, `pageHash`, 행 수, 실제 내용의 SHA-256을 검사한다. 페이지마다 정상인 자료도 수업 ID가 다른 페이지에 중복되면 거부한다. 전체 수업 수가 `totalChanges`와 같아야 명령을 만든다. 페이지 누락·이전 페이지 재전송·내용 변조·도중 만료는 확정 불가다.

원래 명세는 입력 기간, 초안 판, 기준 지문, 만료 시각, 전체 쪽 해시 및 보존 조건을 포함한다. `manifestHash`는 해시 필드 자체를 제외한 전체 명세의 canonical JSON SHA-256이다. 기존 명세·쪽 parser를 재사용한다. canonical JSON은 객체 키를 사전식 정렬하고 배열 순서를 보존하며 UTF-8로 해시한다.

클라이언트 전체 검증은 교사가 본 결과와 보관 문맥을 일치시키는 검사이며 권한의 근거가 아니다. SQL은 클라이언트의 “검증 완료” 주장이나 건수만 믿고 저장하지 않아야 한다.

## 3. 로컬 명령과 전송 명령

로컬 `PublicationCommitCommand`:

```ts
{ kind: 'publish_manifest', manifest: PublicationManifest }
```

이 명령 전체와 원래 요청 번호를 공통 `timetableOperations` pending 저장소에 보관한다. 수업 상세 100,000행은 보관하지 않는다. 브라우저 저장소·로그·URL에도 넣지 않는다. 탭 종료나 새로고침 이후의 복구를 약속하지 않는다.

RPC는 `workhub_timetable_publication_execute` 하나를 사용한다. 인자 키를 정확히 맞춘다.

```json
{
  "p_member_id": "현재-학교-소속-id",
  "p_request_key": "원래-요청-번호",
  "p_recover_only": false,
  "p_command": {
    "kind": "publish_manifest",
    "previewId": "고정-명세-id",
    "previewHash": "64자리 sha256",
    "manifestHash": "64자리 sha256",
    "basisFingerprint": "64자리 sha256",
    "input": { "draftId": "저장-초안-id", "draftVersion": 2, "from": "2026-10-19", "until": "2027-01-01" },
    "expiresAt": "2026-10-18T00:10:00.000Z",
    "totalChanges": 13001
  }
}
```

날짜는 계약 형태 설명을 위한 합성 예시다. 실제 학교 값은 담당자가 선택한다. `until`은 포함하지 않는 끝 날짜다. `pageHashes`와 전체 `manifest`를 RPC로 다시 보내지 않는다. 서버는 저장해 둔 명세 ID와 해시로 원문을 찾는다. `commandHash = SHA256(canonical(p_command))`이며 로컬 래퍼 객체의 해시가 아니다.

## 4. 응답과 일관된 접수증

성공 envelope는 `contract`, `schoolId`, `memberId`, `data`의 정확한 네 키다. `contract`는 `timetable-publication.v1`이다. 다른 학교/소속/계약이나 추가 키를 거부한다. 오류는 `data` 대신 `error: { code }`를 사용하고 scoped RPC의 기존 오류 집합을 따른다.

```ts
data: {
  requestKey: string,
  commandHash: string,
  kind: 'publish_manifest',
  entityId: string,
  version: number,
  status: 'published',
  recordedAt: string,
  manifestHash: string,
  basisFingerprint: string,
  changedCount: number
}
```

- `entityId`와 `version`은 해당 확정 결과의 ID와 **양의 정수 판**이다. 기존 확정본을 갱신하는 정책도 표현할 수 있게 1판으로 고정하지 않는다.
- `requestKey`, `commandHash`, `manifestHash`, `basisFingerprint`, `changedCount`는 원래 명령과 정확히 같아야 한다. `changedCount`는 명세의 전체 변경 수다.
- `recordedAt`은 명세 작성 시각 이상·만료 시각 미만이며 현재 시각의 허용 오차보다 미래일 수 없다. UTC 밀리초 ISO 문자열이다. 만료 이후 접수증을 복구해도 만료 전에 기록된 원래 결과만 인정한다.
- 전체 `changedLessons`를 반환하지 않는다. 전체 결과를 한 트랜잭션에 반영한 단일 접수증이다. 부분 성공을 `published`로 표현하지 않는다.
- 어댑터는 동일 요청의 접수증을 다시 받았을 때 ID·판·시각·건수 중 무엇이든 바뀌면 거부한다. 서버는 접수증을 재계산하지 않고 원장 원문을 그대로 반환해야 한다.

## 5. 신규 확정과 원래 결과 복구

`execute(memberId, command, key)`는 현재 유효한 명세만 `p_recover_only:false`로 보낸다. 명세의 blocker가 0이며 기존 변경 보존이 `retained`인 경우만 가능하다. 화면은 현재 확정 권한과 저장 초안 판도 확인한다. SQL은 아래를 같은 잠금/트랜잭션에서 확인해야 한다.

1. 인증·학교·소속·담당 권한과 모듈 상태를 확인한다.
2. 요청 번호 원장과 명령 해시를 대조한다. 같은 요청 번호·다른 내용은 `IDEMPOTENCY_CONFLICT`다.
3. 명세 소유 학교/담당 범위, 초안 판, 유효 기간, 명세 해시와 기준 지문을 확인한다.
4. 서버가 보관한 모든 쪽과 전체 건수, 수업 자원 충돌, 과거 수업/기간 밖/기존 교환 보존을 다시 검증한다.
5. 전체 변경과 확정판·감사·접수증을 원자적으로 반영한다. 중간 쪽까지만 저장하지 않는다.

`recover(memberId, command, key)`는 목록·현재 초안·새 명세를 조회하지 않고 **원래 compact 명령과 키 그대로** `p_recover_only:true`를 보낸다. 명세 기한이 지났어도 명세 자체의 해시·구조는 검사한 뒤 원장만 읽는다. 모듈 중지나 현재판 변화가 과거 접수증을 없애는 근거가 되면 안 된다. 현재 본인 학교/소속에 대한 안전한 조회 권한은 서버가 검증한다.

`p_recover_only:true`에서 원장이 없으면 확정적으로 `NOT_FOUND`를 반환한다. 새 확정, 명세 재생성, 접수증 재계산, 새 요청 번호 발급은 금지한다. 다른 일시 오류를 `NOT_FOUND`로 바꾸지 않는다. 명시적 `NOT_FOUND`일 때만 화면이 미상 요청을 해제하고 입력은 보존한다.

전송 후 응답 단절·깨진 접수증·시각 초과는 `RESULT_UNKNOWN`이며 공통 pending에서 원래 명세와 키를 보존한다. 이때 다른 시간표 쓰기를 잠근다. `FORBIDDEN`이나 현재 목록 조회 실패만으로 과거 요청을 지우지 않는다.

## 6. 검증 범위와 남은 연결

- `tests/test_workhub_timetable_publication_commit.mjs`: 순차 전체 검증, 13,001회차 66쪽, 누락·중복·변조·취소·만료·한도, compact 전송, 접수증 변조, 원키 복구·동일접수증·소속 변경.
- `tests/browser/workhub-timetable-publication-commit.mjs`: 실제 React·실제 어댑터에 합성 RPC를 연결하여 명시 확인, 진행·취소, 타 작업 잠금, 늦은 응답, 입력 보존, 만료/목록 실패/재마운트 후 복구, 320px 확인.
- 운영 PostgreSQL·PostgREST·Storage를 사용한 시간표 확정 시험이 아니다. 이 문서의 새 RPC와 서버 고정 명세/단일 접수증 SQL은 별도 구현·검토·적용이 필요하다. 기존 R0/R1/P1~P8 SQL은 수정하지 않았다.

판단해서 정한 것: 대형 명세 경로를 기존 v1 응답의 상한 확대로 섞지 않았다. 누락을 확인할 수 있는 쪽별 검증과 작은 단일 접수증을 별도 계약에 두어 기존 교환·확정 경로를 유지한다. 되돌리려면 이 확정 콜백 연결만 해제하면 읽기 전용 명세 조회는 남는다.
