-- ============================================================================
-- 004_doc_ai_conversations.sql
-- daedong-v2 마이그레이션 004 — 문서작성 AI 대화 저장 (이어서 작성 기능)
--
-- 선행: 001~003. 실행: SQL Editor 전체 Run 1회 → README 기록 (P7)
-- RLS: personal 패턴 — 본인 대화만 (admin 열람도 없음: 교사의 작성 중 문서는 사적 공간)
-- ============================================================================

CREATE TABLE public.doc_ai_conversations (
  id         TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id    TEXT NOT NULL REFERENCES public.users(id),
  doc_type   TEXT NOT NULL DEFAULT 'evaluation_plan',
  subject    TEXT,
  grade      INT,
  title      TEXT,                              -- 목록 표시용 (예: "3학년 수학 평가계획")
  messages   JSONB NOT NULL DEFAULT '[]',       -- [{role, content}, ...] 전문
  status     TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','completed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_docai_conv_user ON public.doc_ai_conversations (user_id, updated_at DESC);

CREATE TRIGGER docai_conv_set_updated_at
BEFORE UPDATE ON public.doc_ai_conversations
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.doc_ai_conversations ENABLE ROW LEVEL SECURITY;

CREATE POLICY docai_conv_select ON public.doc_ai_conversations
  FOR SELECT TO authenticated
  USING (user_id = auth.uid()::text);

CREATE POLICY docai_conv_insert ON public.doc_ai_conversations
  FOR INSERT TO authenticated
  WITH CHECK (public.is_approved() AND user_id = auth.uid()::text);

CREATE POLICY docai_conv_update ON public.doc_ai_conversations
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid()::text)
  WITH CHECK (user_id = auth.uid()::text);

CREATE POLICY docai_conv_delete ON public.doc_ai_conversations
  FOR DELETE TO authenticated
  USING (user_id = auth.uid()::text);

REVOKE ALL ON public.doc_ai_conversations FROM anon;

-- [검증]
-- SELECT policyname FROM pg_policies WHERE tablename = 'doc_ai_conversations';  → 4개
-- ============================================================================
