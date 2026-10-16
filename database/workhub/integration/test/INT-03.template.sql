-- ============================================================================
-- INT-03  통합 사후 점검 (읽기 전용 — 아무것도 바꾸지 않는다. 언제 실행해도 된다)
--
-- ▣ 무엇을 보나: 지금 DB 에 적용된 단계 조합(R0 · R1 · R1S · P1~P7 · P7-05)을 적용 기록으로 알아내고,
--   그 조합이면 있어야 할 함수(workhub · workhub_private · workhub_storage 스키마 전부와 public.workhub_*) · 트리거 · 제약 · Storage 정책을 "정확히" 비교한다.
--     함수: 이름 · 인자 · 반환형 · 언어 · SECURITY DEFINER · search_path · API 역할 실행 권한(PUBLIC · anon · authenticated · service_role)
--           (직접 부여와 상속 포함 실효 권한 둘 다) · 본문 지문 · 소유자(허용표 own), 그리고 목록에 없는 함수 · 같은 이름 다른 인자(오버로드)
--     트리거 · 제약 · 정책: 정의 지문, 빠진 것 · 목록에 없는 것
--   이름 접두어 개수를 세지 않는다. 각 단계가 만든 · 바꾼 객체를 한 줄씩 목록으로 갖고 있다(아래 m).
-- ▣ 왜 필요한가: R1-04 의 03 · 04 · 09 행은 R1S · P7 뒤에 FAIL 로 보인다(이름 접두어 개수 · R1S 가 넓힌 작업 목록 CHECK).
--   확정 R1 원본(R1-04)은 고치지 않는다. 대신 이 점검이 R1 함수 하나하나의 권한 · search_path 까지 대조하므로,
--   R1-04 의 그 세 행이 FAIL 이어도 이 점검의 FAIL 이 0 이면 정상이다(INT-03-13 이 그 세 행이 FAIL 인 까닭을 보여 준다).
-- ▣ 읽는 법: status 가 FAIL 인 행이 없어야 한다. value 에 다른 것이 최대 5개까지 나온다.
--   FAIL 이면 그 단계의 다음 파일을 적용하지 말고 결과를 그대로 알려 주세요(되돌리기 전에 상의).
-- ▣ 목록 판: 항목 {{COUNT}}개 — 단계별 {{SUMMARY}}
--   목록은 integration/test/gen_manifest.py 가 시험 DB 에 SQL 파일을 차례로 적용하며 기계로 만든다(손으로 고치지 않는다).
-- ============================================================================
WITH m(stage, kind, key, attrs) AS (VALUES
{{MANIFEST}}
),
s(stage, ord, deps) AS (VALUES
{{STAGES}}
),
rec(stage, tbl, batches) AS (VALUES
  ('R1', 'workhub_private.batch_installs', ARRAY['R1-01','R1-02','R1-03']),
  ('R1S', 'workhub_private.r1s_installs', ARRAY['R1S-01','R1S-02']),
  ('P1', 'workhub_private.p1_installs', ARRAY['P1-01','P1-02']),
  ('P2', 'workhub_private.p2_installs', ARRAY['P2-01','P2-02']),
  ('P3', 'workhub_private.p3_installs', ARRAY['P3-01','P3-02']),
  ('P4', 'workhub_private.p4_installs', ARRAY['P4-01','P4-02']),
  ('P5', 'workhub_private.p5_installs', ARRAY['P5-01','P5-02']),
  ('P6', 'workhub_private.p6_installs', ARRAY['P6-01','P6-02']),
  ('P7', 'workhub_private.p7_installs', ARRAY['P7-01','P7-02']),
  ('P7-05', 'workhub_private.p7_installs', ARRAY['P7-05'])
),
-- 함수 소유자 허용표: 단계 SQL 을 실행한 승인된 설치 역할. Supabase SQL Editor 는 postgres 로 실행한다.
-- "가장 많은 소유자"와 비교하지 않는다 — 전부가 한꺼번에 다른 역할로 바뀌면 그 역할이 기준이 되어 놓치기 때문.
-- 운영 기준선(통합_실행안내 0-1)에서 다른 역할이 나오면 여기 값을 고치지 말고 멈춘 뒤 원인부터 확인한다.
own(role) AS (VALUES ('postgres')),
st AS (
  SELECT s.stage, s.ord, s.deps,
         CASE WHEN s.stage = 'R0' THEN (to_regclass('workhub.schools') IS NOT NULL)::int + (to_regclass('workhub.tasks') IS NOT NULL)::int
              WHEN to_regclass(rec.tbl) IS NULL THEN 0
              ELSE (xpath('/row/n/text()', query_to_xml(format('SELECT count(*) AS n FROM %s WHERE batch = ANY (%L)', rec.tbl, rec.batches), false, true, '')))[1]::text::int
         END AS n,
         CASE WHEN s.stage = 'R0' THEN 2 ELSE cardinality(rec.batches) END AS total
    FROM s LEFT JOIN rec ON rec.stage = s.stage
),
inst AS (SELECT stage, ord, deps, n = total AS installed, n > 0 AND n < total AS partial FROM st),
exp AS (
  SELECT DISTINCT ON (m.kind, m.key) m.kind, m.key, m.attrs::jsonb AS attrs, m.stage
    FROM m JOIN inst i ON i.stage = m.stage AND i.installed
   ORDER BY m.kind, m.key, i.ord DESC
),
want AS (SELECT kind, key, attrs, stage FROM exp WHERE attrs IS NOT NULL),
got AS (
{{CATALOG}}
),
miss AS (SELECT w.kind, w.key FROM want w WHERE NOT EXISTS (SELECT 1 FROM got g WHERE g.kind = w.kind AND g.key = w.key)),
extra AS (SELECT g.kind, g.key FROM got g WHERE NOT EXISTS (SELECT 1 FROM want w WHERE w.kind = g.kind AND w.key = g.key)),
diff AS (SELECT w.kind, w.key, w.attrs AS want, g.attrs AS got FROM want w JOIN got g ON g.kind = w.kind AND g.key = w.key WHERE w.attrs <> g.attrs),
fdiff(item, key, detail) AS (
  SELECT f.item, d.key, (d.want ->> f.field) || ' → ' || (d.got ->> f.field)
    FROM diff d CROSS JOIN (VALUES ('exec', 'exec'), ('exec', 'eff'), ('sec', 'secdef'), ('sec', 'config'), ('sig', 'result'), ('sig', 'lang'), ('body', 'body')) f(item, field)
   WHERE d.kind = 'function' AND (d.want -> f.field) IS DISTINCT FROM (d.got -> f.field)
)
SELECT 'INT-03-01' AS no, '적용된 단계 조합(부분 적용 · 선행 단계 없이 적용 없음)' AS item,
       CASE WHEN bool_or(partial) OR bool_or(installed AND EXISTS (SELECT 1 FROM unnest(string_to_array(deps, ' ')) d
                                                             WHERE NOT (SELECT x.installed FROM inst x WHERE x.stage = d)))
            THEN 'FAIL' ELSE 'ok' END AS status,
       COALESCE(string_agg(stage || CASE WHEN partial THEN '(부분 적용!)' ELSE '' END, ' · ' ORDER BY ord) FILTER (WHERE installed OR partial), '(없음)') AS value
  FROM inst
UNION ALL
SELECT 'INT-03-02', '함수: 이 조합에 있어야 할 함수가 모두 있음',
       CASE WHEN count(*) = 0 THEN 'ok' ELSE 'FAIL' END,
       count(*)::text || COALESCE(' — ' || (SELECT string_agg(key, ', ') FROM (SELECT key FROM miss WHERE kind = 'function' ORDER BY key LIMIT 5) x), '')
  FROM miss WHERE kind = 'function'
UNION ALL
SELECT 'INT-03-03', '함수: 목록에 없는 함수 · 같은 이름 다른 인자(오버로드) 없음',
       CASE WHEN count(*) = 0 THEN 'ok' ELSE 'FAIL' END,
       count(*)::text || COALESCE(' — ' || (SELECT string_agg(key || CASE WHEN EXISTS (SELECT 1 FROM want w WHERE w.kind = 'function'
                                                AND split_part(w.key, '(', 1) = split_part(x.key, '(', 1)) THEN '(오버로드)' ELSE '' END, ', ')
                                            FROM (SELECT key FROM extra WHERE kind = 'function' ORDER BY key LIMIT 5) x), '')
  FROM extra WHERE kind = 'function'
UNION ALL
SELECT 'INT-03-04', '함수: API 역할 실행 권한이 단계 설계와 같음 — 직접 부여(PUBLIC · anon · authenticated · service_role)와 실효 권한(상속 포함, anon · authenticated · service_role)',
       CASE WHEN count(*) = 0 THEN 'ok' ELSE 'FAIL' END,
       count(*)::text || COALESCE(' — ' || (SELECT string_agg(key || ' [' || detail || ']', ', ') FROM (SELECT * FROM fdiff WHERE item = 'exec' ORDER BY key LIMIT 5) x), '')
  FROM fdiff WHERE item = 'exec'
UNION ALL
SELECT 'INT-03-05', '함수: SECURITY DEFINER · search_path 가 단계 설계와 같음',
       CASE WHEN count(*) = 0 THEN 'ok' ELSE 'FAIL' END,
       count(*)::text || COALESCE(' — ' || (SELECT string_agg(key || ' [' || detail || ']', ', ') FROM (SELECT * FROM fdiff WHERE item = 'sec' ORDER BY key LIMIT 5) x), '')
  FROM fdiff WHERE item = 'sec'
UNION ALL
SELECT 'INT-03-06', '함수: 반환형 · 언어가 같음',
       CASE WHEN count(*) = 0 THEN 'ok' ELSE 'FAIL' END,
       count(*)::text || COALESCE(' — ' || (SELECT string_agg(key || ' [' || detail || ']', ', ') FROM (SELECT * FROM fdiff WHERE item = 'sig' ORDER BY key LIMIT 5) x), '')
  FROM fdiff WHERE item = 'sig'
UNION ALL
SELECT 'INT-03-07', '함수: 본문이 적용한 SQL 파일과 같음(손으로 바꾼 함수 없음 · 교체는 그 단계 판)',
       CASE WHEN count(*) = 0 THEN 'ok' ELSE 'FAIL' END,
       count(*)::text || COALESCE(' — ' || (SELECT string_agg(key, ', ') FROM (SELECT key FROM fdiff WHERE item = 'body' ORDER BY key LIMIT 5) x), '')
  FROM fdiff WHERE item = 'body'
UNION ALL
SELECT 'INT-03-08', '함수: 소유자가 승인된 설치 역할(own 표)임 — API 역할 · 다른 역할 소유 없음',
       CASE WHEN count(*) = 0 THEN 'ok' ELSE 'FAIL' END,
       count(*)::text || ' (허용: ' || (SELECT string_agg(role, ' · ' ORDER BY role) FROM own) || ')'
       || COALESCE(' — ' || (SELECT string_agg(key || '(' || owner || ')', ', ') FROM (SELECT key, owner FROM got g2 WHERE g2.kind = 'function'
                                         AND g2.owner NOT IN (SELECT role FROM own) ORDER BY key LIMIT 5) x), '')
  FROM got WHERE kind = 'function' AND owner NOT IN (SELECT role FROM own)
UNION ALL
SELECT 'INT-03-' || k.no, k.label || ': 빠짐 · 목록에 없음 · 정의 다름 없음',
       CASE WHEN COALESCE(a.n, 0) + COALESCE(b.n, 0) + COALESCE(c.n, 0) = 0 THEN 'ok' ELSE 'FAIL' END,
       '빠짐 ' || COALESCE(a.n, 0) || ' · 목록에 없음 ' || COALESCE(b.n, 0) || ' · 다름 ' || COALESCE(c.n, 0)
       || COALESCE(' — ' || NULLIF(concat_ws(', ', a.k, b.k, c.k), ''), '')
  FROM (VALUES ('09', 'trigger', '트리거'), ('10', 'constraint', '제약'), ('11', 'policy', 'Storage · 표 정책')) k(no, kind, label)
  LEFT JOIN LATERAL (SELECT count(*) AS n, string_agg('빠짐 ' || key, ', ') FILTER (WHERE rn <= 3) AS k
                       FROM (SELECT key, row_number() OVER (ORDER BY key) rn FROM miss WHERE kind = k.kind) x) a ON true
  LEFT JOIN LATERAL (SELECT count(*) AS n, string_agg('추가 ' || key, ', ') FILTER (WHERE rn <= 3) AS k
                       FROM (SELECT key, row_number() OVER (ORDER BY key) rn FROM extra WHERE kind = k.kind) x) b ON true
  LEFT JOIN LATERAL (SELECT count(*) AS n, string_agg('다름 ' || key, ', ') FILTER (WHERE rn <= 3) AS k
                       FROM (SELECT key, row_number() OVER (ORDER BY key) rn FROM diff WHERE kind = k.kind) x) c ON true
UNION ALL
SELECT 'INT-03-12', '점검한 객체 수(이 조합의 목록 기준)', 'info',
       (SELECT string_agg(kind || ' ' || n, ' · ' ORDER BY kind) FROM (SELECT kind, count(*) AS n FROM want GROUP BY kind) x)
UNION ALL
SELECT 'INT-03-13', 'R1-04 의 03 · 04 · 09 행이 FAIL 로 보이는 까닭(정상 여부는 위 02~10 이 정확한 목록으로 판단)', 'info',
       'R1-04-03·04 가 세는 이름(workhub_collection_% · workhub_file_%)의 공개 함수: '
       || COALESCE((SELECT string_agg(stage || ' ' || n, ' · ' ORDER BY ord) FROM (
            SELECT m0.stage, i.ord, count(*) AS n FROM want w
              JOIN LATERAL (SELECT m.stage FROM m WHERE m.kind = 'function' AND m.key = w.key ORDER BY (SELECT ord FROM s WHERE s.stage = m.stage) LIMIT 1) m0 ON true
              JOIN inst i ON i.stage = m0.stage
             WHERE w.kind = 'function' AND (w.key LIKE 'public.workhub\_collection\_%' OR w.key LIKE 'public.workhub\_file\_%')
             GROUP BY m0.stage, i.ord) x), '없음')
       || ' (R1 만이면 17) · R1-04-09 가 보는 작업 목록 CHECK 를 정의 · 바꾼 단계: '
       || COALESCE((SELECT string_agg(m.stage, ' · ') FROM m JOIN inst i ON i.stage = m.stage AND i.installed
                     WHERE m.kind = 'constraint' AND m.key = 'workhub.service_principals.service_principals_action_registry'), '없음')
ORDER BY 1;
