-- Migration: Alter duty_change_requests for two-row swap model
-- Version: 002
-- Description: Updates existing duty_change_requests table schema and creates swap_approvals table
--
-- IMPORTANT: This migration transforms the single-row swap model to a two-row model
-- Run this on existing Supabase databases that have the old schema

-- ============================================
-- SECTION 1: BACKUP EXISTING DATA (Optional)
-- ============================================

-- Create backup of existing data before migration
-- CREATE TABLE duty_change_requests_backup AS SELECT * FROM duty_change_requests;

-- ============================================
-- SECTION 2: ALTER duty_change_requests TABLE
-- ============================================

-- First, drop existing data since schema is incompatible with new model
-- The old single-row model cannot be converted to two-row model automatically
TRUNCATE TABLE duty_change_requests CASCADE;

-- Drop old columns that don't exist in new schema
ALTER TABLE duty_change_requests
    DROP COLUMN IF EXISTS original_slot_id,
    DROP COLUMN IF EXISTS original_personnel_id,
    DROP COLUMN IF EXISTS target_slot_id,
    DROP COLUMN IF EXISTS target_personnel_id,
    DROP COLUMN IF EXISTS approved_by,
    DROP COLUMN IF EXISTS approved_at;

-- Add new columns for two-row swap model
ALTER TABLE duty_change_requests
    ADD COLUMN IF NOT EXISTS swap_pair_id UUID NOT NULL DEFAULT uuid_generate_v4(),
    ADD COLUMN IF NOT EXISTS personnel_id UUID,
    ADD COLUMN IF NOT EXISTS giving_slot_id UUID,
    ADD COLUMN IF NOT EXISTS receiving_slot_id UUID,
    ADD COLUMN IF NOT EXISTS swap_partner_id UUID,
    ADD COLUMN IF NOT EXISTS requester_id UUID,
    ADD COLUMN IF NOT EXISTS partner_accepted BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS partner_accepted_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS partner_accepted_by UUID,
    ADD COLUMN IF NOT EXISTS rejection_reason TEXT;

-- Add column constraints (can't add NOT NULL with ADD COLUMN IF NOT EXISTS if column might exist)
-- We'll handle this separately

-- Add foreign key constraints
ALTER TABLE duty_change_requests
    DROP CONSTRAINT IF EXISTS duty_change_requests_personnel_id_fkey,
    DROP CONSTRAINT IF EXISTS duty_change_requests_giving_slot_id_fkey,
    DROP CONSTRAINT IF EXISTS duty_change_requests_receiving_slot_id_fkey,
    DROP CONSTRAINT IF EXISTS duty_change_requests_swap_partner_id_fkey,
    DROP CONSTRAINT IF EXISTS duty_change_requests_requester_id_fkey,
    DROP CONSTRAINT IF EXISTS duty_change_requests_partner_accepted_by_fkey;

ALTER TABLE duty_change_requests
    ADD CONSTRAINT duty_change_requests_personnel_id_fkey
        FOREIGN KEY (personnel_id) REFERENCES personnel(id) ON DELETE RESTRICT,
    ADD CONSTRAINT duty_change_requests_giving_slot_id_fkey
        FOREIGN KEY (giving_slot_id) REFERENCES duty_slots(id) ON DELETE RESTRICT,
    ADD CONSTRAINT duty_change_requests_receiving_slot_id_fkey
        FOREIGN KEY (receiving_slot_id) REFERENCES duty_slots(id) ON DELETE RESTRICT,
    ADD CONSTRAINT duty_change_requests_swap_partner_id_fkey
        FOREIGN KEY (swap_partner_id) REFERENCES personnel(id) ON DELETE RESTRICT,
    ADD CONSTRAINT duty_change_requests_requester_id_fkey
        FOREIGN KEY (requester_id) REFERENCES users(id) ON DELETE RESTRICT,
    ADD CONSTRAINT duty_change_requests_partner_accepted_by_fkey
        FOREIGN KEY (partner_accepted_by) REFERENCES users(id);

-- Create indexes for new columns
CREATE INDEX IF NOT EXISTS idx_duty_change_requests_swap_pair ON duty_change_requests(swap_pair_id);
CREATE INDEX IF NOT EXISTS idx_duty_change_requests_personnel ON duty_change_requests(personnel_id);
CREATE INDEX IF NOT EXISTS idx_duty_change_requests_partner ON duty_change_requests(swap_partner_id);
CREATE INDEX IF NOT EXISTS idx_duty_change_requests_status ON duty_change_requests(status);
CREATE INDEX IF NOT EXISTS idx_duty_change_requests_giving_slot ON duty_change_requests(giving_slot_id);
CREATE INDEX IF NOT EXISTS idx_duty_change_requests_receiving_slot ON duty_change_requests(receiving_slot_id);

-- ============================================
-- SECTION 3: CREATE swap_approvals TABLE
-- ============================================

CREATE TABLE IF NOT EXISTS swap_approvals (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    duty_change_request_id UUID NOT NULL REFERENCES duty_change_requests(id) ON DELETE CASCADE,
    approval_order INTEGER NOT NULL,
    approver_type VARCHAR(50) NOT NULL CHECK (
        approver_type IN ('work_section_manager', 'section_manager', 'company_manager')
    ),
    scope_unit_id UUID REFERENCES unit_sections(id),
    is_approver BOOLEAN NOT NULL DEFAULT FALSE,
    status VARCHAR(50) NOT NULL DEFAULT 'pending' CHECK (
        status IN ('pending', 'approved', 'rejected')
    ),
    approved_by UUID REFERENCES users(id),
    approved_at TIMESTAMPTZ,
    rejection_reason TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE (duty_change_request_id, approval_order)
);

-- Indexes for swap_approvals
CREATE INDEX IF NOT EXISTS idx_swap_approvals_request ON swap_approvals(duty_change_request_id);
CREATE INDEX IF NOT EXISTS idx_swap_approvals_status ON swap_approvals(status);
CREATE INDEX IF NOT EXISTS idx_swap_approvals_scope_unit ON swap_approvals(scope_unit_id);
CREATE INDEX IF NOT EXISTS idx_swap_approvals_approver ON swap_approvals(approved_by);

-- ============================================
-- SECTION 4: CREATE swap_recommendations TABLE
-- ============================================

CREATE TABLE IF NOT EXISTS swap_recommendations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    duty_change_request_id UUID NOT NULL REFERENCES duty_change_requests(id) ON DELETE CASCADE,
    recommender_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    recommendation VARCHAR(50) NOT NULL CHECK (
        recommendation IN ('recommend', 'not_recommend')
    ),
    comment TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE (duty_change_request_id, recommender_id)
);

-- Indexes for swap_recommendations
CREATE INDEX IF NOT EXISTS idx_swap_recommendations_request ON swap_recommendations(duty_change_request_id);
CREATE INDEX IF NOT EXISTS idx_swap_recommendations_recommender ON swap_recommendations(recommender_id);

-- ============================================
-- SECTION 5: ADD swap tracking columns to duty_slots
-- ============================================

ALTER TABLE duty_slots
    ADD COLUMN IF NOT EXISTS swapped_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS swapped_from_personnel_id UUID REFERENCES personnel(id),
    ADD COLUMN IF NOT EXISTS swap_pair_id UUID;

-- Add 'swapped' to status check constraint if not already there
-- First drop the old constraint, then add the new one
ALTER TABLE duty_slots DROP CONSTRAINT IF EXISTS duty_slots_status_check;
ALTER TABLE duty_slots ADD CONSTRAINT duty_slots_status_check CHECK (
    status IN ('scheduled', 'approved', 'completed', 'missed', 'swapped')
);

-- Indexes for swap tracking
CREATE INDEX IF NOT EXISTS idx_duty_slots_swap_pair ON duty_slots(swap_pair_id) WHERE swap_pair_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_duty_slots_swapped_from ON duty_slots(swapped_from_personnel_id) WHERE swapped_from_personnel_id IS NOT NULL;

-- ============================================
-- SECTION 6: TRIGGERS
-- ============================================

-- Add updated_at trigger for duty_change_requests if not exists
DROP TRIGGER IF EXISTS update_duty_change_requests_updated_at ON duty_change_requests;
CREATE TRIGGER update_duty_change_requests_updated_at
    BEFORE UPDATE ON duty_change_requests
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- SECTION 7: ENABLE RLS
-- ============================================

ALTER TABLE swap_approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE swap_recommendations ENABLE ROW LEVEL SECURITY;

-- ============================================
-- SECTION 8: COMMENTS
-- ============================================

COMMENT ON TABLE duty_change_requests IS 'Two-row model: Each swap creates two linked rows, one for each person. Both rows share the same swap_pair_id.';
COMMENT ON TABLE swap_approvals IS 'Approval chain for swap requests. Each level in the chain is a separate row with approval_order indicating sequence.';
COMMENT ON TABLE swap_recommendations IS 'Recommendations from managers who are not the final approver (LCA). They can recommend or not recommend.';
COMMENT ON COLUMN duty_change_requests.swap_pair_id IS 'Links the two rows of a swap together. Both rows have the same swap_pair_id.';
COMMENT ON COLUMN duty_change_requests.partner_accepted IS 'The swap partner must accept before manager approvals can begin.';
COMMENT ON COLUMN swap_approvals.is_approver IS 'True if this manager is the final approver (LCA), false if they can only recommend.';
COMMENT ON COLUMN duty_slots.swapped_at IS 'Timestamp when a swap was executed on this slot.';
COMMENT ON COLUMN duty_slots.swapped_from_personnel_id IS 'The original personnel_id before the swap was executed.';
COMMENT ON COLUMN duty_slots.swap_pair_id IS 'Reference to the swap_pair_id that caused this swap.';
