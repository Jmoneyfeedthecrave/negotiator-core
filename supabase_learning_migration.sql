-- Self-Improvement Loop Tables
-- Run in Supabase SQL editor

-- 1. Negotiation outcomes — one row per closed thread
CREATE TABLE IF NOT EXISTS negotiation_outcomes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id uuid REFERENCES email_threads(id) ON DELETE CASCADE,
  outcome text NOT NULL CHECK (outcome IN ('win', 'partial', 'loss')),
  deal_value numeric,
  notes text,
  reflected boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

-- 2. Knowledge sources — raw articles / case studies pasted in by user
CREATE TABLE IF NOT EXISTS knowledge_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  source_type text NOT NULL CHECK (source_type IN ('historical', 'research', 'case_study')),
  domain_tags text[] DEFAULT '{}',
  content_text text NOT NULL,
  processed boolean DEFAULT false,
  pattern_count integer DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

-- 3. Learned patterns — unified store from all three sources
CREATE TABLE IF NOT EXISTS learned_patterns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_type text NOT NULL CHECK (source_type IN ('own_negotiation', 'historical', 'research')),
  domain text,
  situation_type text,
  tactic_used text,
  what_worked text,
  what_failed text,
  lesson text NOT NULL,
  outcome_type text,
  source_thread_id uuid REFERENCES email_threads(id) ON DELETE SET NULL,
  source_knowledge_id uuid REFERENCES knowledge_sources(id) ON DELETE SET NULL,
  confidence_score numeric DEFAULT 0.7,
  created_at timestamptz DEFAULT now()
);

-- Enable RLS
ALTER TABLE negotiation_outcomes ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE learned_patterns ENABLE ROW LEVEL SECURITY;

-- Open policies (anon access, same as existing tables)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'negotiation_outcomes' AND policyname = 'anon_all_negotiation_outcomes') THEN
    CREATE POLICY "anon_all_negotiation_outcomes" ON negotiation_outcomes FOR ALL TO anon USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'knowledge_sources' AND policyname = 'anon_all_knowledge_sources') THEN
    CREATE POLICY "anon_all_knowledge_sources" ON knowledge_sources FOR ALL TO anon USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'learned_patterns' AND policyname = 'anon_all_learned_patterns') THEN
    CREATE POLICY "anon_all_learned_patterns" ON learned_patterns FOR ALL TO anon USING (true) WITH CHECK (true);
  END IF;
END $$;
