-- Email Negotiator Tables
-- Run this in Supabase SQL editor if migration fails

CREATE TABLE IF NOT EXISTS email_threads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject text,
  counterparty_email text NOT NULL,
  our_email text DEFAULT 'jdquist2025@gmail.com',
  domain text DEFAULT 'Email Negotiation',
  session_id uuid REFERENCES sessions(id),
  status text DEFAULT 'active',
  mode text DEFAULT 'coached',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS emails (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id uuid REFERENCES email_threads(id) ON DELETE CASCADE,
  direction text NOT NULL,
  from_email text,
  to_email text,
  subject text,
  body text,
  claude_analysis jsonb,
  drafted_reply text,
  status text DEFAULT 'pending',
  sent_at timestamptz,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE email_threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE emails ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'email_threads' AND policyname = 'anon_all_email_threads') THEN
    CREATE POLICY "anon_all_email_threads" ON email_threads FOR ALL TO anon USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'emails' AND policyname = 'anon_all_emails') THEN
    CREATE POLICY "anon_all_emails" ON emails FOR ALL TO anon USING (true) WITH CHECK (true);
  END IF;
END $$;
