-- ============================================
-- SUPABASE MIGRATION: Two-Row Swap Model
-- Run this in Supabase SQL Editor
-- ============================================

-- Step 1: Add swap tracking columns to duty_slots
ALTER TABLE duty_slots
    ADD COLUMN IF NOT EXISTS swapped_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS swapped_from_personnel_id UUID,
    ADD COLUMN IF NOT EXISTS swap_pair_id UUID;

-- Step 2: Update duty_slots status constraint to include 'swapped'
ALTER TABLE duty_slots DROP CONSTRAINT IF EXISTS duty_slots_status_check;
ALTER TABLE duty_slots ADD CONSTRAINT duty_slots_status_check CHECK (
    status IN ('scheduled', 'approved', 'completed', 'missed', 'swapped')
);

-- Step 3: Clear existing swap requests (incompatible schema)
TRUNCATE TABLE duty_change_requests CASCADE;

-- Step 4: Drop old columns from duty_change_requests
ALTER TABLE duty_change_requests
    DROP COLUMN IF EXISTS original_slot_id,
    DROP COLUMN IF EXISTS original_personnel_id,
    DROP COLUMN IF EXISTS target_slot_id,
    DROP COLUMN IF EXISTS target_personnel_id,
    DROP COLUMN IF EXISTS approved_by,
    DROP COLUMN IF EXISTS approved_at;

-- Step 5: Add new columns to duty_change_requests
ALTER TABLE duty_change_requests
    ADD COLUMN IF NOT EXISTS swap_pair_id UUID,
    ADD COLUMN IF NOT EXISTS personnel_id UUID,
    ADD COLUMN IF NOT EXISTS giving_slot_id UUID,
    ADD COLUMN IF NOT EXISTS receiving_slot_id UUID,
    ADD COLUMN IF NOT EXISTS swap_partner_id UUID,
    ADD COLUMN IF NOT EXISTS requester_id UUID,
    ADD COLUMN IF NOT EXISTS partner_accepted BOOLEAN DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS partner_accepted_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS partner_accepted_by UUID,
    ADD COLUMN IF NOT EXISTS rejection_reason TEXT;

-- Step 6: Set default for swap_pair_id on existing rows (if any)
UPDATE duty_change_requests SET swap_pair_id = uuid_generate_v4() WHERE swap_pair_id IS NULL;

-- Step 7: Create swap_approvals table
CREATE TABLE IF NOT EXISTS swap_approvals (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    duty_change_request_id UUID NOT NULL REFERENCES duty_change_requests(id) ON DELETE CASCADE,
    approval_order INTEGER NOT NULL,
    approver_type VARCHAR(50) NOT NULL CHECK (
        approver_type IN ('work_section_manager', 'section_manager', 'company_manager')
    ),
    scope_unit_id UUID,
    is_approver BOOLEAN NOT NULL DEFAULT FALSE,
    status VARCHAR(50) NOT NULL DEFAULT 'pending' CHECK (
        status IN ('pending', 'approved', 'rejected')
    ),
    approved_by UUID,
    approved_at TIMESTAMPTZ,
    rejection_reason TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (duty_change_request_id, approval_order)
);

-- Step 8: Create swap_recommendations table
CREATE TABLE IF NOT EXISTS swap_recommendations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    duty_change_request_id UUID NOT NULL REFERENCES duty_change_requests(id) ON DELETE CASCADE,
    recommender_id UUID NOT NULL,
    recommendation VARCHAR(50) NOT NULL CHECK (
        recommendation IN ('recommend', 'not_recommend')
    ),
    comment TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (duty_change_request_id, recommender_id)
);

-- Step 9: Create indexes (only if they don't exist)
CREATE INDEX IF NOT EXISTS idx_duty_change_requests_swap_pair ON duty_change_requests(swap_pair_id);
CREATE INDEX IF NOT EXISTS idx_duty_change_requests_personnel ON duty_change_requests(personnel_id);
CREATE INDEX IF NOT EXISTS idx_duty_change_requests_partner ON duty_change_requests(swap_partner_id);
CREATE INDEX IF NOT EXISTS idx_duty_change_requests_giving_slot ON duty_change_requests(giving_slot_id);
CREATE INDEX IF NOT EXISTS idx_duty_change_requests_receiving_slot ON duty_change_requests(receiving_slot_id);

CREATE INDEX IF NOT EXISTS idx_swap_approvals_request ON swap_approvals(duty_change_request_id);
CREATE INDEX IF NOT EXISTS idx_swap_approvals_status ON swap_approvals(status);

CREATE INDEX IF NOT EXISTS idx_swap_recommendations_request ON swap_recommendations(duty_change_request_id);

-- Step 10: Enable RLS on new tables
ALTER TABLE swap_approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE swap_recommendations ENABLE ROW LEVEL SECURITY;

-- Step 11: Create permissive policies for now (adjust later for production)
DROP POLICY IF EXISTS swap_approvals_all ON swap_approvals;
CREATE POLICY swap_approvals_all ON swap_approvals FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS swap_recommendations_all ON swap_recommendations;
CREATE POLICY swap_recommendations_all ON swap_recommendations FOR ALL USING (true) WITH CHECK (true);

-- Done!
SELECT 'Migration completed successfully!' as result;
