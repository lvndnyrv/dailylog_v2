-- ============================================
-- Add medical profile columns to children table
-- ============================================
-- Run this in Supabase SQL Editor

-- Allergies (array of strings)
ALTER TABLE children ADD COLUMN IF NOT EXISTS allergies text[] DEFAULT '{}';

-- Medical notes (free text)
ALTER TABLE children ADD COLUMN IF NOT EXISTS medical_notes text;

-- Emergency contacts (JSON array of {name, relation, phone})
ALTER TABLE children ADD COLUMN IF NOT EXISTS emergency_contacts jsonb DEFAULT '[]';

-- Profile photo path (storage reference)
ALTER TABLE children ADD COLUMN IF NOT EXISTS photo_url text;

-- Soft-delete (archiving a child hides them from roster but keeps history)
ALTER TABLE children ADD COLUMN IF NOT EXISTS archived_at timestamptz;

