-- Migration: Add duty swap tables for two-row swap model
-- Version: 001
-- Description: Creates duty_change_requests, swap_approvals, and swap_recommendations tables
--              Also adds swap tracking columns to duty_slots table

-- ============================================
-- SECTION 1: DUTY CHANGE REQUESTS TABLE
-- Two-Row Model: Each swap creates two linked rows - one for each person's side
-- Both rows share the same swap_pair_id and must both be approved for the swap to execute
-- ============================================

CREATE TABLE IF NOT EXISTS duty_change_requests (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    swap_pair_id UUID NOT NULL, -- Links the two rows of a swap together

    -- This person's side of the swap
    personnel_id UUID NOT NULL REFERENCES personnel(id) ON DELETE RESTRICT,
    giving_slot_id UUID NOT NULL REFERENCES duty_slots(id) ON DELETE RESTRICT,
    receiving_slot_id UUID NOT NULL REFERENCES duty_slots(id) ON DELETE RESTRICT,

    -- The swap partner
    swap_partner_id UUID NOT NULL REFERENCES personnel(id) ON DELETE RESTRICT,

    -- Request details
    requester_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    reason TEXT NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'pending' CHECK (
        status IN ('pending', 'approved', 'rejected')
    ),

    -- Partner acceptance (the other party must accept before manager approvals begin)
    partner_accepted BOOLEAN NOT NULL DEFAULT FALSE,
    partner_accepted_at TIMESTAMPTZ,
    partner_accepted_by UUID REFERENCES users(id),

    -- Rejection info
    rejection_reason TEXT,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for duty_change_requests
CREATE INDEX IF NOT EXISTS idx_duty_change_requests_swap_pair ON duty_change_requests(swap_pair_id);
CREATE INDEX IF NOT EXISTS idx_duty_change_requests_personnel ON duty_change_requests(personnel_id);
CREATE INDEX IF NOT EXISTS idx_duty_change_requests_partner ON duty_change_requests(swap_partner_id);
CREATE INDEX IF NOT EXISTS idx_duty_change_requests_status ON duty_change_requests(status);
CREATE INDEX IF NOT EXISTS idx_duty_change_requests_org ON duty_change_requests(organization_id);
CREATE INDEX IF NOT EXISTS idx_duty_change_requests_giving_slot ON duty_change_requests(giving_slot_id);
CREATE INDEX IF NOT EXISTS idx_duty_change_requests_receiving_slot ON duty_change_requests(receiving_slot_id);

-- Trigger for updated_at
CREATE TRIGGER update_duty_change_requests_updated_at
    BEFORE UPDATE ON duty_change_requests
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- SECTION 2: SWAP APPROVALS TABLE
-- Approval tracking for each step in the swap approval workflow
-- ============================================

CREATE TABLE IF NOT EXISTS swap_approvals (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    duty_change_request_id UUID NOT NULL REFERENCES duty_change_requests(id) ON DELETE CASCADE,
    approval_order INTEGER NOT NULL, -- Sequence in the approval chain (1, 2, 3...)
    approver_type VARCHAR(50) NOT NULL CHECK (
        approver_type IN ('work_section_manager', 'section_manager', 'company_manager')
    ),
    scope_unit_id UUID REFERENCES unit_sections(id), -- The unit scope for manager approvals
    is_approver BOOLEAN NOT NULL DEFAULT FALSE, -- true = can approve, false = can only recommend
    status VARCHAR(50) NOT NULL DEFAULT 'pending' CHECK (
        status IN ('pending', 'approved', 'rejected')
    ),
    approved_by UUID REFERENCES users(id),
    approved_at TIMESTAMPTZ,
    rejection_reason TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),

    -- Unique constraint: one approval step per order per request
    UNIQUE (duty_change_request_id, approval_order)
);

-- Indexes for swap_approvals
CREATE INDEX IF NOT EXISTS idx_swap_approvals_request ON swap_approvals(duty_change_request_id);
CREATE INDEX IF NOT EXISTS idx_swap_approvals_status ON swap_approvals(status);
CREATE INDEX IF NOT EXISTS idx_swap_approvals_scope_unit ON swap_approvals(scope_unit_id);
CREATE INDEX IF NOT EXISTS idx_swap_approvals_approver ON swap_approvals(approved_by);

-- ============================================
-- SECTION 3: SWAP RECOMMENDATIONS TABLE
-- Recommendations from managers not in the direct approval chain
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

    -- One recommendation per recommender per request
    UNIQUE (duty_change_request_id, recommender_id)
);

-- Indexes for swap_recommendations
CREATE INDEX IF NOT EXISTS idx_swap_recommendations_request ON swap_recommendations(duty_change_request_id);
CREATE INDEX IF NOT EXISTS idx_swap_recommendations_recommender ON swap_recommendations(recommender_id);

-- ============================================
-- SECTION 4: ADD SWAP TRACKING COLUMNS TO DUTY_SLOTS
-- ============================================

-- Add swap tracking columns to duty_slots if they don't exist
DO $$
BEGIN
    -- Add swapped_at column
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'duty_slots' AND column_name = 'swapped_at'
    ) THEN
        ALTER TABLE duty_slots ADD COLUMN swapped_at TIMESTAMPTZ;
    END IF;

    -- Add swapped_from_personnel_id column
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'duty_slots' AND column_name = 'swapped_from_personnel_id'
    ) THEN
        ALTER TABLE duty_slots ADD COLUMN swapped_from_personnel_id UUID REFERENCES personnel(id);
    END IF;

    -- Add swap_pair_id column
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'duty_slots' AND column_name = 'swap_pair_id'
    ) THEN
        ALTER TABLE duty_slots ADD COLUMN swap_pair_id UUID;
    END IF;
END $$;

-- Index for finding swapped slots
CREATE INDEX IF NOT EXISTS idx_duty_slots_swap_pair ON duty_slots(swap_pair_id) WHERE swap_pair_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_duty_slots_swapped_from ON duty_slots(swapped_from_personnel_id) WHERE swapped_from_personnel_id IS NOT NULL;

-- ============================================
-- SECTION 5: VIEWS
-- ============================================

-- View: Swap pairs with both sides and approval status
CREATE OR REPLACE VIEW swap_pairs_view AS
SELECT
    r1.swap_pair_id,
    r1.requester_id,
    r1.reason,
    r1.created_at,
    -- Overall status logic: rejected if either rejected, approved if both approved
    CASE
        WHEN r1.status = 'rejected' OR r2.status = 'rejected' THEN 'rejected'
        WHEN r1.status = 'approved' AND r2.status = 'approved' THEN 'approved'
        ELSE 'pending'
    END as overall_status,
    -- Person A (first alphabetically by personnel_id)
    r1.id as person_a_request_id,
    r1.personnel_id as person_a_id,
    r1.giving_slot_id as person_a_giving_slot,
    r1.receiving_slot_id as person_a_receiving_slot,
    r1.partner_accepted as person_a_partner_accepted,
    r1.status as person_a_status,
    -- Person B
    r2.id as person_b_request_id,
    r2.personnel_id as person_b_id,
    r2.giving_slot_id as person_b_giving_slot,
    r2.receiving_slot_id as person_b_receiving_slot,
    r2.partner_accepted as person_b_partner_accepted,
    r2.status as person_b_status
FROM duty_change_requests r1
JOIN duty_change_requests r2
    ON r1.swap_pair_id = r2.swap_pair_id
    AND r1.personnel_id < r2.personnel_id;

-- ============================================
-- SECTION 6: RLS POLICIES
-- ============================================

-- Enable RLS on new tables
ALTER TABLE duty_change_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE swap_approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE swap_recommendations ENABLE ROW LEVEL SECURITY;

-- Policies for duty_change_requests
-- Users can view their own swap requests
CREATE POLICY duty_change_requests_select_own ON duty_change_requests
    FOR SELECT
    USING (
        personnel_id IN (SELECT personnel_id FROM users WHERE id = auth.uid())
        OR swap_partner_id IN (SELECT personnel_id FROM users WHERE id = auth.uid())
        OR requester_id = auth.uid()
    );

-- Users can insert their own requests (as requester)
CREATE POLICY duty_change_requests_insert_own ON duty_change_requests
    FOR INSERT
    WITH CHECK (requester_id = auth.uid());

-- Users can update their own requests (for partner acceptance)
CREATE POLICY duty_change_requests_update_own ON duty_change_requests
    FOR UPDATE
    USING (
        personnel_id IN (SELECT personnel_id FROM users WHERE id = auth.uid())
        OR requester_id = auth.uid()
    );

-- Policies for swap_approvals
-- Approvers can view and update approvals in their scope
CREATE POLICY swap_approvals_select ON swap_approvals
    FOR SELECT
    USING (TRUE); -- Visible to anyone who can see the parent request

CREATE POLICY swap_approvals_update ON swap_approvals
    FOR UPDATE
    USING (
        -- Manager can update if they have a role scoped to the approval's scope_unit
        EXISTS (
            SELECT 1 FROM user_roles ur
            WHERE ur.user_id = auth.uid()
            AND ur.scope_unit_id = swap_approvals.scope_unit_id
            AND ur.role_name IN ('Work Section Manager', 'Section Manager', 'Company Manager', 'Unit Admin', 'App Admin')
        )
    );

-- Policies for swap_recommendations
CREATE POLICY swap_recommendations_select ON swap_recommendations
    FOR SELECT
    USING (TRUE);

CREATE POLICY swap_recommendations_insert ON swap_recommendations
    FOR INSERT
    WITH CHECK (recommender_id = auth.uid());

COMMENT ON TABLE duty_change_requests IS 'Two-row model: Each swap creates two linked rows, one for each person. Both rows share the same swap_pair_id.';
COMMENT ON TABLE swap_approvals IS 'Approval chain for swap requests. Each level in the chain is a separate row with approval_order indicating sequence.';
COMMENT ON TABLE swap_recommendations IS 'Recommendations from managers who are not the final approver (LCA). They can recommend or not recommend.';
COMMENT ON COLUMN duty_change_requests.swap_pair_id IS 'Links the two rows of a swap together. Both rows have the same swap_pair_id.';
COMMENT ON COLUMN duty_change_requests.partner_accepted IS 'The swap partner must accept before manager approvals can begin.';
COMMENT ON COLUMN swap_approvals.is_approver IS 'True if this manager is the final approver (LCA), false if they can only recommend.';
COMMENT ON COLUMN duty_slots.swapped_at IS 'Timestamp when a swap was executed on this slot.';
COMMENT ON COLUMN duty_slots.swapped_from_personnel_id IS 'The original personnel_id before the swap was executed.';
COMMENT ON COLUMN duty_slots.swap_pair_id IS 'Reference to the swap_pair_id that caused this swap.';
