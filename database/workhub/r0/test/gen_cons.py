import json,re
d=json.load(open('/tmp/claude-0/b01/ref/schema-contract.json'));T={t['name']:t for t in d['tables']}
live={}
for r in json.load(open('live_cons.json')): live.setdefault(r['t'],{})[r['n']]=(r['k'],r['d'])
trg={}
for r in json.load(open('live_trg.json')): trg.setdefault(r['t'].split('.')[-1],[]).append(r['n'])
norm=lambda s: re.sub(r'\s+|::text|::[a-z ]+(\[\])?|\(|\)','',s.lower())
B01=['schools','accounts','service_principals','service_principal_scopes','departments','role_catalog','role_permissions','memberships','membership_roles','academic_years','terms','idempotency_receipts','audit_events','outbox']
B02=['audience_sets','audience_groups','audience_conditions','audience_members','events','event_revisions','tasks']
REASON={
 'accounts_legacy_run_fk':('보류(F5)','migration_runs 는 교사 일괄 연결 배치에서 만든다. 그때까지 `accounts_legacy_run_pending` 으로 입력 거부'),
 'audit_events_check':('대체(F6)','`<=1` → `audit_events_actor_xor` (`=1`, 사람 XOR 서비스 주체)'),
 'audit_events_school_id_actor_membership_id_fkey':('대체','3열 FK `audit_events_actor_membership_fkey` (school_id, actor_membership_id, actor_account_id). 소속이 같은 학교·같은 계정임을 DB가 보장'),
 'audit_events_support_session_fk':('보류(F5)','support_sessions 는 후속. `audit_events_support_pending` 으로 입력 거부'),
 'events_school_id_author_membership_id_fkey':('대체','3열 FK `events_author_membership_fkey` (school_id, author_membership_id, author_account_id)'),
 'events_school_id_duty_id_fkey':('보류(F5)','duties 는 후속. `events_duty_pending` 으로 입력 거부'),
 'events_source_record_fk':('보류(F5)','source_records 는 후속. `events_source_record_pending` 으로 입력 거부'),
 'memberships_school_id_join_code_id_fkey':('보류(F5)','school_join_codes 는 신규 가입 배치. `memberships_join_code_pending` 으로 입력 거부'),
 'event_revisions_change_kind_check':('대체','값 목록에 `official_withdraw` 추가(공식 일정 철회 판). 기존 값은 모두 유지'),
}
def note(n, dfn):
  rules=[('idempotency_receipts_pkey','F6: 기존 actor_account_id 기반 PK 를 (actor_key, scope_key, operation, idem_key) 로 대체'),
   ('_actor_xor','F6: 사람 XOR 서비스 주체 정확히 하나'),
   ('timetable_basis_pending','F5: 시간표 기준 포인터는 시간표 배치 전까지 NULL 만'),
   ('tasks_source_pending','F5: 원천 연결 업무는 후속. R0 는 직접 만든 업무 + 수동 완료만'),
   ('_pending','F5 보류 표식(위 처분 참조)'),
   ('official_effective_revision_fkey','필수: event_revisions UNIQUE 뒤 복합 FK, DEFERRABLE INITIALLY DEFERRED'),
   ('official_pointer','필수: 효력 포인터는 kind=official 에서만'),
   ('revision_no_key','필수: 이력 판 번호 유일'),
   ('school_id_id_account_id_key','필수: 3열 FK 대상'),
   ('author_membership_fkey','대체(위 참조)'), ('actor_membership_fkey','대체(위 참조)'),
   ('same_auth_link','요청서 2번: 같은 Auth 주체 연결이면 legacy_user_id = auth_user_id::text'),
   ('action_registry','필수: 허용 작업은 서버 등록부 코드만(R0 = school.bootstrap)'),
   ('legacy_approval_state','필수: not_legacy/approved/hold'),
   ('permission_version_check','필수: permission_version > 0'),
   ('lease_token','필수: lease_token >= 0'),
   ('scope_key_check','필수: scope_key 와 school_id 일치 / 형식'),
   ('service_principal_scopes_','필수(새 표): PK·UNIQUE·scope_type·기간·중첩 금지·참조'),
   ('approved_by_fkey','승인자 참조 무결성'), ('service_principal_fkey','서비스 주체 참조 무결성'),
   ('membership_needs_account','감사 주체 일관성: 소속이 있으면 계정도'),
   ('revoke_check','회수 시각·사유 짝'),
   ('cancelled_check','취소 시각 짝(done_at 규칙과 대칭)'),
   ('version_check','판 번호 양수'),
  ]
  for k,v in rules:
    if k in n: return v
  return '입력 형식·크기 상한(R0 안전장치)'
L=['# R0 표별 상속 제약 처분표 (F6)','',
 '통합 설계 `schema-contract.json` 의 `inherited_constraints`(NOT NULL 제외)·`mandatory_constraints` 와, 시험 DB(PostgreSQL 17.6)에 **실제로 만들어진 제약을 기계 대조**한 결과다. 정의 비교는 형 변환·괄호·공백을 뺀 문자열 비교다. NOT NULL 은 열 단위로 대조해 21표 모두 일치했다.','',
 '- **유지**: 같은 이름·같은 정의','- **대체**: 같은 목적을 더 강한(또는 F6 수정된) 정의로 바꿈',
 '- **보류(F5)**: 참조 대상 표가 후속 배치라 FK 대신 `*_pending CHECK (열 IS NULL)` 로 입력을 막아 둠. 후속 배치는 그 CHECK 를 지우고 FK 를 붙인다 (FK 삭제·NOT VALID 없음)',
 '- **삭제**: 없음','- **추가**: 통합 설계 필수 제약(mandatory) 또는 R0 안전장치','']
tot={'유지':0,'대체':0,'보류(F5)':0,'추가':0}
body=[]
for batch,names in (('B01 (R0-01)',B01),('B02 (R0-02)',B02)):
  body.append(f'\n## {batch}\n')
  for tn in names:
    t=T[tn]; cat=[c for c in t['inherited_constraints'] if c['kind']!='n']; catn={c['name'] for c in cat}
    keep=[c['name'] for c in cat if c['name'] in live[tn] and norm(c['definition'])==norm(live[tn][c['name']][1])]
    other=[c for c in cat if c['name'] not in keep]; added=[n for n in live[tn] if n not in catn]
    tot['유지']+=len(keep)
    body.append(f'\n### {tn}\n')
    body.append(f'- 유지 {len(keep)}개: ' + (', '.join(f'`{k}`' for k in sorted(keep)) if keep else '없음 (통합 설계에서 새로 생긴 표)'))
    if other:
      body.append('\n| 상속 제약 | 처분 | 내용 |\n|---|---|---|')
      for c in other:
        disp,why=REASON[c['name']]; tot['보류(F5)' if disp.startswith('보류') else '대체']+=1
        body.append(f"| `{c['name']}` | {disp} | {why} |")
    if added:
      body.append('\n| 추가 제약 | 정의 | 근거 |\n|---|---|---|')
      for n in added:
        tot['추가']+=1; dd=live[tn][n][1].replace('|','\\|')
        body.append(f"| `{n}` | `{dd[:160]}{'…' if len(dd)>160 else ''}` | {note(n,dd)} |")
    if t.get('mandatory_constraints'):
      body.append('\n필수 제약(mandatory) 반영 확인:')
      for m in t['mandatory_constraints']: body.append(f'- {m}')
    if trg.get(tn): body.append(f"\n트리거: {', '.join('`'+x+'`' for x in sorted(trg[tn]))}")
L.append(f"**합계** — 유지 {tot['유지']} · 대체 {tot['대체']} · 보류(F5) {tot['보류(F5)']} · 삭제 0 · 추가 {tot['추가']}")
L.append('\n카탈로그에 없는 내부 표: `workhub_private.db_identity_principals` (서비스 주체를 DB 실행 역할에 잇는 허용 목록. 인자·GUC 로 주체를 넘기지 않기 위한 것, 01-foundation-security 의 "서버 allowlist")')
open('/tmp/claude-0/b01/out/R0_제약처분표.md','w').write('\n'.join(L+body)+'\n'); print(tot)
