-- ============================================================================
-- Negotiator-Core / GOtiator — Complete Email-Loop Schema
-- ----------------------------------------------------------------------------
-- Safe to run repeatedly. Creates the tables if missing AND patches existing
-- tables with any columns the code uses but the original migration never added.
-- Run in the Supabase SQL editor against the Command Center project.
--
-- This reconciles the schema with what the functions actually read/write:
--   send_status, scheduled_send_at, in_reply_to, message_id, claimed_by,
--   counterparty_intel, counterparty_profile, thread_state, our_position,
--   position_confirmed, thread_type
-- (none of which existed in supabase_email_migration.sql)
-- ============================================================================

-- ── sessions ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sessions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  domain          text,
  transcript      jsonb DEFAULT '[]'::jsonb,
  config_snapshot jsonb DEFAULT '{}'::jsonb,
  created_at      timestamptz DEFAULT now()
);

-- ── email_threads ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS email_threads (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject             text,
  counterparty_email  text NOT NULL,
  our_email           text DEFAULT 'jdquist2025@gmail.com',
  domain              text DEFAULT 'Email Negotiation',
  session_id          uuid REFERENCES sessions(id),
  status              text DEFAULT 'active',
  mode                text DEFAULT 'coached',
  created_at          timestamptz DEFAULT now(),
  updated_at          timestamptz DEFAULT now()
);

-- Patch columns added after the original migration
ALTER TABLE email_threads ADD COLUMN IF NOT EXISTS thread_type          text;
ALTER TABLE email_threads ADD COLUMN IF NOT EXISTS counterparty_intel   jsonb   DEFAULT '{}'::jsonb;
ALTER TABLE email_threads ADD COLUMN IF NOT EXISTS counterparty_profile jsonb   DEFAULT '{}'::jsonb;
ALTER TABLE email_threads ADD COLUMN IF NOT EXISTS thread_state         jsonb   DEFAULT '{}'::jsonb;
ALTER TABLE email_threads ADD COLUMN IF NOT EXISTS our_position         jsonb;
ALTER TABLE email_threads ADD COLUMN IF NOT EXISTS position_confirmed   boolean DEFAULT false;

-- ── emails ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS emails (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id       uuid REFERENCES email_threads(id) ON DELETE CASCADE,
  direction       text NOT NULL,                 -- 'inbound' | 'outbound'
  from_email      text,
  to_email        text,
  subject         text,
  body            text,
  drafted_reply   text,
  claude_analysis jsonb,
  status          text DEFAULT 'pending',
  sent_at         timestamptz,
  created_at      timestamptz DEFAULT now()
);

-- Patch columns the send/poll/inbound logic depends on
ALTER TABLE emails ADD COLUMN IF NOT EXISTS send_status       text;        -- pending_approval | scheduled | sending | sent | failed | paused:*
ALTER TABLE emails ADD COLUMN IF NOT EXISTS scheduled_send_at timestamptz; -- when the cron should send an outbound reply
ALTER TABLE emails ADD COLUMN IF NOT EXISTS message_id        text;        -- RFC Message-ID (ours on send, theirs on receive)
ALTER TABLE emails ADD COLUMN IF NOT EXISTS in_reply_to       text;        -- parent Message-ID for threading
ALTER TABLE emails ADD COLUMN IF NOT EXISTS claimed_by        text;        -- cron run id holding the send lock

-- ── learned_patterns (Knowledge Library) ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS learned_patterns (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_type      text,        -- 'own_negotiation' | 'historical' | 'research'
  domain           text,
  situation_type   text,
  tactic_used      text,
  what_worked      text,
  what_failed      text,
  lesson           text,
  outcome_type     text,
  confidence_score float DEFAULT 0.5,
  created_at       timestamptz DEFAULT now()
);

-- ── Indexes (match the hot query paths) ───────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_emails_message_id        ON emails (message_id);                 -- thread match on inbound In-Reply-To/References
CREATE INDEX IF NOT EXISTS idx_emails_thread_id         ON emails (thread_id);
CREATE INDEX IF NOT EXISTS idx_emails_send_due          ON emails (send_status, scheduled_send_at); -- cron claim
CREATE INDEX IF NOT EXISTS idx_threads_counterparty     ON email_threads (counterparty_email);
CREATE INDEX IF NOT EXISTS idx_threads_updated_at       ON email_threads (updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_patterns_confidence      ON learned_patterns (confidence_score DESC);

-- ── Row Level Security ────────────────────────────────────────────────────────
-- Functions use the service-role key and bypass RLS. The anon policies below let the
-- browser client read/write during Phase 1 (no auth yet). NOTE: 'anon ALL USING (true)'
-- means anyone with the public anon key can read every thread — fine for a single-operator
-- prototype, but tighten this (per-agent ownership) before any real multi-user rollout.
ALTER TABLE sessions         ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_threads    ENABLE ROW LEVEL SECURITY;
ALTER TABLE emails           ENABLE ROW LEVEL SECURITY;
ALTER TABLE learned_patterns ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='sessions' AND policyname='anon_all_sessions') THEN
    CREATE POLICY "anon_all_sessions" ON sessions FOR ALL TO anon USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='email_threads' AND policyname='anon_all_email_threads') THEN
    CREATE POLICY "anon_all_email_threads" ON email_threads FOR ALL TO anon USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='emails' AND policyname='anon_all_emails') THEN
    CREATE POLICY "anon_all_emails" ON emails FOR ALL TO anon USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='learned_patterns' AND policyname='anon_all_learned_patterns') THEN
    CREATE POLICY "anon_all_learned_patterns" ON learned_patterns FOR ALL TO anon USING (true) WITH CHECK (true);
  END IF;
END $$;
