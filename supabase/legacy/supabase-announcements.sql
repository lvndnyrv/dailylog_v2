-- ============================================
-- DailyLog — Announcements Table
-- ============================================
-- Creates the announcements table used by the
-- AnnouncementsScreen for daycare-wide or per-room broadcasts.
-- ============================================

CREATE TABLE IF NOT EXISTS announcements (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  daycare_id uuid NOT NULL REFERENCES daycares(id) ON DELETE CASCADE,
  classroom_id uuid REFERENCES classrooms(id) ON DELETE SET NULL,
  author_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
  title text NOT NULL,
  body text NOT NULL,
  pinned boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS announcements_daycare_idx ON announcements (daycare_id, created_at DESC);

ALTER TABLE announcements ENABLE ROW LEVEL SECURITY;

-- Staff (educators + admins) can create announcements in their daycare
DROP POLICY IF EXISTS "Staff can create announcements" ON announcements;
CREATE POLICY "Staff can create announcements"
  ON announcements FOR INSERT
  WITH CHECK (
    get_my_role() IN ('educator', 'admin')
    AND daycare_id = get_my_daycare_id()
    AND author_id = auth.uid()
  );

-- Staff can delete their daycare's announcements
DROP POLICY IF EXISTS "Staff can delete announcements" ON announcements;
CREATE POLICY "Staff can delete announcements"
  ON announcements FOR DELETE
  USING (
    get_my_role() IN ('educator', 'admin')
    AND daycare_id = get_my_daycare_id()
  );

-- Everyone in the daycare can read announcements
-- (educators, admins, and parents whose child is in the daycare)
DROP POLICY IF EXISTS "Daycare members can read announcements" ON announcements;
CREATE POLICY "Daycare members can read announcements"
  ON announcements FOR SELECT
  USING (
    daycare_id = get_my_daycare_id()
    OR (
      get_my_role() = 'parent'
      AND daycare_id IN (
        SELECT cl.daycare_id FROM parent_children pc
        JOIN children c ON c.id = pc.child_id
        JOIN classrooms cl ON cl.id = c.classroom_id
        WHERE pc.parent_id = auth.uid()
      )
    )
  );

-- ============================================
-- RPC: get push tokens for announcement recipients
-- If classroom_id is provided, only parents of that room's children.
-- If null, all parents in the daycare.
-- ============================================
CREATE OR REPLACE FUNCTION get_announcement_push_tokens(p_daycare_id uuid, p_classroom_id uuid DEFAULT NULL)
RETURNS TABLE(token text, platform text) AS $$
  SELECT DISTINCT pt.token, pt.platform
  FROM push_tokens pt
  JOIN parent_children pc ON pc.parent_id = pt.user_id
  JOIN children c ON c.id = pc.child_id
  JOIN classrooms cl ON cl.id = c.classroom_id
  WHERE cl.daycare_id = p_daycare_id
    AND (p_classroom_id IS NULL OR cl.id = p_classroom_id)
    AND c.archived_at IS NULL
$$ LANGUAGE sql SECURITY DEFINER STABLE;


