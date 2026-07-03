-- ╔══════════════════════════════════════════════════════════════════════════════╗
-- ║ DailyLog — Phase 3 Migration: Educator & Parent UX                        ║
-- ║ Run AFTER supabase-phase0-reconciliation.sql and supabase-phase2-security  ║
-- ╚══════════════════════════════════════════════════════════════════════════════╝

-- ────────────────────────────────────────────────────────────────────────────────
-- 1. Ensure read_at column exists on messages table (for inbox unread tracking)
--    (Phase 2 already adds this column; this is a safe no-op if already present)
-- ────────────────────────────────────────────────────────────────────────────────
ALTER TABLE messages ADD COLUMN IF NOT EXISTS read_at timestamptz DEFAULT NULL;

-- Index for fast unread queries (educator inbox: WHERE read_at IS NULL)
CREATE INDEX IF NOT EXISTS idx_messages_child_unread
  ON messages(child_id, sender_id) WHERE read_at IS NULL;

-- ────────────────────────────────────────────────────────────────────────────────
-- 2. Index for open sleep entries (nap timer: WHERE end_time IS NULL)
-- ────────────────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_sleep_entries_open
  ON sleep_entries(daily_log_id) WHERE end_time IS NULL;

-- ────────────────────────────────────────────────────────────────────────────────
-- 3. Enhanced roster status RPC — now includes log_id and nap_active
-- ────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION get_classroom_log_status(
  p_classroom_id uuid,
  p_date date
)
RETURNS TABLE(
  child_id uuid,
  log_id uuid,
  sent boolean,
  moods text[],
  entry_count bigint,
  nap_active boolean,
  nap_start_time text
)
LANGUAGE sql STABLE
AS $$
  SELECT
    c.id AS child_id,
    dl.id AS log_id,
    COALESCE(dl.sent_to_parents, false) AS sent,
    dl.moods,
    (
      SELECT COUNT(*) FROM (
        SELECT id FROM meal_entries WHERE daily_log_id = dl.id
        UNION ALL
        SELECT id FROM diaper_entries WHERE daily_log_id = dl.id
        UNION ALL
        SELECT id FROM activity_entries WHERE daily_log_id = dl.id
        UNION ALL
        SELECT id FROM sleep_entries WHERE daily_log_id = dl.id
      ) AS combined
    ) AS entry_count,
    EXISTS(
      SELECT 1 FROM sleep_entries se
      WHERE se.daily_log_id = dl.id AND se.end_time IS NULL
    ) AS nap_active,
    (
      SELECT se.start_time::text FROM sleep_entries se
      WHERE se.daily_log_id = dl.id AND se.end_time IS NULL
      LIMIT 1
    ) AS nap_start_time
  FROM children c
  LEFT JOIN daily_logs dl ON dl.child_id = c.id AND dl.log_date = p_date
  WHERE c.classroom_id = p_classroom_id
    AND c.archived_at IS NULL
  ORDER BY c.first_name;
$$;

-- ────────────────────────────────────────────────────────────────────────────────
-- 4. Bulk mood update RPC — single call for BulkLogScreen
-- ────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION bulk_set_moods(
  p_log_ids uuid[],
  p_moods text[]
)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE daily_logs
  SET moods = (
    SELECT ARRAY(SELECT DISTINCT unnest(COALESCE(moods, '{}') || p_moods))
  )
  WHERE id = ANY(p_log_ids);
END;
$$;

-- ────────────────────────────────────────────────────────────────────────────────
-- 5. Mark messages as read RPC — batch update for educator inbox
-- ────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION mark_messages_read(
  p_child_id uuid,
  p_reader_id uuid
)
RETURNS void
LANGUAGE sql
AS $$
  UPDATE messages
  SET read_at = now()
  WHERE child_id = p_child_id
    AND sender_id != p_reader_id
    AND read_at IS NULL;
$$;

-- ────────────────────────────────────────────────────────────────────────────────
-- 6. RLS policy: allow educators to update read_at on messages
-- ────────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE policyname = 'educators_mark_read'
  ) THEN
    EXECUTE 'CREATE POLICY educators_mark_read ON messages
      FOR UPDATE
      USING (
        EXISTS (
          SELECT 1 FROM profiles p
          JOIN children c ON c.classroom_id = p.classroom_id
          WHERE p.id = auth.uid() AND p.role = ''educator'' AND c.id = messages.child_id
        )
      )
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM profiles p
          JOIN children c ON c.classroom_id = p.classroom_id
          WHERE p.id = auth.uid() AND p.role = ''educator'' AND c.id = messages.child_id
        )
      )';
  END IF;
END $$;

