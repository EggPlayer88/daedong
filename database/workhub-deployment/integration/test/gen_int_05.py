"""기존 확정 점검은 보존하고 모든 구축 증분의 정확한 단계별 읽기 전용 목록을 만든다."""
from pathlib import Path
import os,sys
ROOT=Path(__file__).resolve().parents[4]
HERE=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/"database/workhub-school-data/integration/test"))
import gen_int_04 as previous
g=previous.g
EXTRA_STAGES=[
 ("P10-AI-01","database/workhub-ai-policy/p10","P10-01",["P6"]),
 ("P10-AI-02","database/workhub-ai-policy/p10","P10-02",["P10-AI-01"]),
 ("P10-AI-03","database/workhub-ai-policy/p10","P10-03",["P10-AI-02"]),
 ("P10-AI-09","database/workhub-ai-policy/p10","P10-09",["P10-AI-03"]),
 ("P10-AI-10","database/workhub-ai-policy/p10","P10-10",["P10-AI-09"]),
 ("K1","database/workhub-knowledge-history/k1","K1-01",["P4"]),
 ("M1-01","database/workhub-ai-memory/m1","M1-01",["P6"]),
]
for stage,folder,prefix,deps in EXTRA_STAGES:
 g.T1_STAGES.append((stage,[previous.stage_file(folder,prefix)],deps))
def record(stage):
 if stage=="K1":return "  ('K1', NULL, ARRAY['K1'])"
 table="p10_ai" if stage.startswith("P10-AI-") else stage.split("-")[0].lower()
 return f"  ('{stage}', 'workhub_private.{table}_installs', ARRAY['{stage}'])"
g.T1_REC=",\n".join(record(stage) for stage,_,_ in g.T1_STAGES)
EXTRA_CATALOG=r"""
 UNION ALL
 SELECT 'table',n.nspname||'.'||c.relname,
  jsonb_build_object('kind',c.relkind,'persistence',c.relpersistence,'rls',c.relrowsecurity,'forceRls',c.relforcerowsecurity,
    'owner',pg_get_userbyid(c.relowner),
    'api',coalesce((SELECT string_agg(r.role||':'||p.privilege,' ' ORDER BY r.role,p.privilege)
      FROM unnest(ARRAY['anon','authenticated','service_role']) r(role)
      CROSS JOIN unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p(privilege)
      WHERE has_table_privilege(r.role,c.oid,p.privilege)),'')),NULL
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname IN ('workhub','workhub_private','workhub_storage') AND c.relkind IN ('r','p','v','m')
 UNION ALL
 SELECT 'column',n.nspname||'.'||c.relname||'.'||a.attname,
  jsonb_build_object('position',a.attnum,'type',format_type(a.atttypid,a.atttypmod),'notNull',a.attnotnull,
   'identity',a.attidentity,'generated',a.attgenerated,'default',coalesce(pg_get_expr(d.adbin,d.adrelid),''),
   'api',coalesce((SELECT string_agg(r.role||':'||p.privilege,' ' ORDER BY r.role,p.privilege)
    FROM unnest(ARRAY['anon','authenticated','service_role']) r(role)
    CROSS JOIN unnest(ARRAY['SELECT','INSERT','UPDATE','REFERENCES']) p(privilege)
    WHERE has_column_privilege(r.role,c.oid,a.attnum,p.privilege)),'')),NULL
 FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
 LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
 WHERE n.nspname IN ('workhub','workhub_private','workhub_storage') AND c.relkind IN ('r','p','v','m') AND a.attnum>0 AND NOT a.attisdropped
 UNION ALL
 SELECT 'index',n.nspname||'.'||t.relname||'.'||c.relname,
  jsonb_build_object('definition',pg_get_indexdef(c.oid),'valid',i.indisvalid,'ready',i.indisready),NULL
 FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid JOIN pg_class t ON t.oid=i.indrelid JOIN pg_namespace n ON n.oid=t.relnamespace
 WHERE n.nspname IN ('workhub','workhub_private','workhub_storage')
 UNION ALL
 SELECT 'schema',n.nspname,
  jsonb_build_object('owner',pg_get_userbyid(n.nspowner),'api',coalesce((SELECT string_agg(r.role||':'||p.privilege,' ' ORDER BY r.role,p.privilege)
    FROM unnest(ARRAY['anon','authenticated','service_role']) r(role) CROSS JOIN unnest(ARRAY['USAGE','CREATE']) p(privilege)
    WHERE has_schema_privilege(r.role,n.oid,p.privilege)),'')),NULL
 FROM pg_namespace n WHERE n.nspname IN ('workhub','workhub_private','workhub_storage')
 UNION ALL
 SELECT 'enum',n.nspname||'.'||t.typname,
  jsonb_build_object('values',(SELECT jsonb_agg(e.enumlabel ORDER BY e.enumsortorder) FROM pg_enum e WHERE e.enumtypid=t.oid)),NULL
 FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname IN ('workhub','workhub_private','workhub_storage') AND t.typtype='e'
"""
g.gm.CATALOG_SQL+=EXTRA_CATALOG
HEADER="""-- INT-05 전체 구축 통합 점검 — 읽기 전용. 운영 적용·활성화·회원 연결을 수행하지 않는다.
-- R0~T2와 학교 P9/P10·시간표 T3/T4·학교 AI P10·K1·M1의 단계별 정의를 대조한다.
-- 같은 P10 이름은 설치 기록 P10-xx(학교 자료), P10-AI-xx(학교 AI)로 구분한다.
-- 기존 함수·제약·정책·트리거 비교에 표/RLS/소유자/실효 권한·열/기본값·인덱스·스키마 권한·enum을 더한다.
-- 목록은 test/gen_int_05.py가 격리 PostgreSQL 17에서 원본 SQL을 순차 적용해 만든다. 손으로 수정하지 않는다.
-- 신규 단계 이전·일부 설치 상태에서도 현재 설치 기록에 맞는 판을 비교한다.
-- K1은 별도 설치 기록이 없어 정확한 공개 함수 2개의 존재로 상태를 판정한다.
-- 설치 기록/객체 구조만 확인한다. Storage 파일 본문·운영 자료 의미·실제 서비스 왕복은 검증하지 않는다.
"""
def render(manifest):
 out=g.render(manifest)
 out=out[out.index("WITH m("):].replace("'T1-06-","'INT-05-")
 out=out.replace("WHEN to_regclass(rec.tbl) IS NULL THEN 0",
  "WHEN s.stage = 'K1' THEN (to_regprocedure('public.workhub_knowledge_get(text,text,integer)') IS NOT NULL)::int + (to_regprocedure('public.workhub_knowledge_history(text,text,integer)') IS NOT NULL)::int\n              WHEN to_regclass(rec.tbl) IS NULL THEN 0")
 out=out.replace("CASE WHEN s.stage = 'R0' THEN 2 ELSE cardinality(rec.batches) END",
  "CASE WHEN s.stage IN ('R0','K1') THEN 2 ELSE cardinality(rec.batches) END")
 out=out.replace("('11', 'policy', 'Storage · 표 정책')","('11', 'policy', 'Storage · 표 정책'), ('14', 'table', '표 · RLS · 소유자 · 실효 권한'), ('15', 'column', '열 · 기본값 · 실효 권한'), ('16', 'index', '인덱스'), ('17', 'schema', '스키마 · 실효 권한'), ('18', 'enum', '열거형')")
 return HEADER+out
def generate():
 result=render(g.build())
 target=HERE/"INT-05_전체구축_통합점검.sql"
 if os.environ.get("WORKHUB_WRITE_INT05")=="1":target.write_text(result,encoding="utf-8",newline="\n")
 elif not target.exists() or target.read_text(encoding="utf-8")!=result:raise RuntimeError("INT-05 예상 목록이 현재 SQL과 다릅니다. 검토용 생성이 필요합니다.")
 return result
