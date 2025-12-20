-- Migration: Add "recommended" status for non-availability approval workflow
-- This enables a chain-of-command approval process where managers can recommend
-- before a final approval is made by higher authority.

-- Note: In Supabase, you may need to run these as separate statements.
-- If the ENUM type doesn't exist as a custom type, status is likely stored as TEXT.

-- Step 1: Add recommended_by column to non_availability table
ALTER TABLE non_availability
    ADD COLUMN IF NOT EXISTS recommended_by UUID REFERENCES users(id),
    ADD COLUMN IF NOT EXISTS recommended_at TIMESTAMPTZ;

-- Step 2: Add index for efficient queries on recommended status
CREATE INDEX IF NOT EXISTS idx_non_availability_recommended_by
    ON non_availability(recommended_by)
    WHERE recommended_by IS NOT NULL;

-- Step 3: Update the status check constraint to include 'recommended'
-- First, drop the existing constraint if it exists
ALTER TABLE non_availability
    DROP CONSTRAINT IF EXISTS non_availability_status_check;

-- Then add the new constraint with 'recommended' included
ALTER TABLE non_availability
    ADD CONSTRAINT non_availability_status_check
    CHECK (status IN ('pending', 'recommended', 'approved', 'rejected'));

-- Note: If status is stored as an ENUM type in your Supabase setup,
-- you'll need to alter the type instead:
-- ALTER TYPE request_status ADD VALUE IF NOT EXISTS 'recommended' AFTER 'pending';
