-- Duty Sync Database Schema
-- PostgreSQL (Neon Serverless) / Hasura Compatible
-- Version: 1.0.0 MVP

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================
-- SECTION 1: CORE ENTITIES
-- ============================================

-- Unit Sections (Military Hierarchy)
-- Defines Battalion -> Company -> Platoon -> Section structure
CREATE TABLE unit_sections (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    parent_id UUID REFERENCES unit_sections(id) ON DELETE SET NULL,
    unit_name VARCHAR(255) NOT NULL,
    hierarchy_level VARCHAR(50) NOT NULL CHECK (
        hierarchy_level IN ('battalion', 'company', 'platoon', 'section')
    ),
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for hierarchy queries
CREATE INDEX idx_unit_sections_parent ON unit_sections(parent_id);
CREATE INDEX idx_unit_sections_level ON unit_sections(hierarchy_level);

-- Personnel (Core military data)
CREATE TABLE personnel (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    service_id VARCHAR(50) UNIQUE NOT NULL,
    unit_section_id UUID NOT NULL REFERENCES unit_sections(id) ON DELETE RESTRICT,
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    rank VARCHAR(50) NOT NULL,
    current_duty_score NUMERIC(10, 2) DEFAULT 0.00,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for personnel queries
CREATE INDEX idx_personnel_unit ON personnel(unit_section_id);
CREATE INDEX idx_personnel_service_id ON personnel(service_id);
CREATE INDEX idx_personnel_rank ON personnel(rank);
CREATE INDEX idx_personnel_duty_score ON personnel(current_duty_score);

-- Users (Authentication via Auth.js)
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    personnel_id UUID UNIQUE REFERENCES personnel(id) ON DELETE SET NULL,
    username VARCHAR(100) UNIQUE NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    email_verified TIMESTAMPTZ,
    is_active BOOLEAN DEFAULT TRUE,
    last_login TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for user lookups
CREATE INDEX idx_users_username ON users(username);
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_personnel ON users(personnel_id);

-- User Roles (RBAC)
CREATE TABLE user_roles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role_name VARCHAR(50) NOT NULL CHECK (
        role_name IN ('App Admin', 'Unit Admin', 'Standard User')
    ),
    scope_unit_id UUID REFERENCES unit_sections(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW(),

    -- Constraint: Only one role per user per unit scope (or global for App Admin)
    UNIQUE (user_id, role_name, scope_unit_id)
);

-- Index for role queries
CREATE INDEX idx_user_roles_user ON user_roles(user_id);
CREATE INDEX idx_user_roles_unit ON user_roles(scope_unit_id);

-- ============================================
-- SECTION 2: DUTY & REQUIREMENT LOGIC
-- ============================================

-- Duty Types (Configurable duty definitions)
CREATE TABLE duty_types (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    unit_section_id UUID NOT NULL REFERENCES unit_sections(id) ON DELETE CASCADE,
    duty_name VARCHAR(255) NOT NULL,
    description TEXT,
    slots_needed INTEGER NOT NULL DEFAULT 1 CHECK (slots_needed >= 1),
    required_rank_min VARCHAR(50),
    required_rank_max VARCHAR(50),
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    -- Unique duty name per unit
    UNIQUE (unit_section_id, duty_name)
);

-- Index for duty queries
CREATE INDEX idx_duty_types_unit ON duty_types(unit_section_id);
CREATE INDEX idx_duty_types_active ON duty_types(is_active) WHERE is_active = TRUE;

-- Qualifications (Personnel certifications/skills)
CREATE TABLE qualifications (
    personnel_id UUID NOT NULL REFERENCES personnel(id) ON DELETE CASCADE,
    qual_name VARCHAR(255) NOT NULL,
    granted_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ,
    granted_by UUID REFERENCES users(id),

    PRIMARY KEY (personnel_id, qual_name)
);

-- Index for qualification lookups
CREATE INDEX idx_qualifications_name ON qualifications(qual_name);

-- Duty Requirements (What qualifications a duty needs)
CREATE TABLE duty_requirements (
    duty_type_id UUID NOT NULL REFERENCES duty_types(id) ON DELETE CASCADE,
    required_qual_name VARCHAR(255) NOT NULL,

    PRIMARY KEY (duty_type_id, required_qual_name)
);

-- Duty Values (Point system for fairness)
CREATE TABLE duty_values (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    duty_type_id UUID UNIQUE NOT NULL REFERENCES duty_types(id) ON DELETE CASCADE,
    base_weight NUMERIC(5, 2) NOT NULL DEFAULT 1.00,
    weekend_multiplier NUMERIC(4, 2) NOT NULL DEFAULT 1.50,
    holiday_multiplier NUMERIC(4, 2) NOT NULL DEFAULT 2.00,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- SECTION 3: ROSTER & TRACKING
-- ============================================

-- Duty Slots (The resulting schedule)
CREATE TABLE duty_slots (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    duty_type_id UUID NOT NULL REFERENCES duty_types(id) ON DELETE RESTRICT,
    personnel_id UUID NOT NULL REFERENCES personnel(id) ON DELETE RESTRICT,
    date_assigned DATE NOT NULL,
    assigned_by UUID REFERENCES users(id),
    points NUMERIC(10, 2) DEFAULT 0.00,  -- Calculated duty score (base_weight * multipliers)
    status VARCHAR(50) NOT NULL DEFAULT 'scheduled' CHECK (
        status IN ('scheduled', 'approved', 'completed', 'missed', 'swapped')
    ),
    notes TEXT,
    -- Swap tracking fields
    swapped_at TIMESTAMPTZ,  -- When the swap was executed
    swapped_from_personnel_id UUID REFERENCES personnel(id),  -- Original personnel before swap
    swap_pair_id UUID,  -- Reference to the swap_pair_id that caused this swap
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    -- Constraint: One person can't have multiple duties on same date
    UNIQUE (personnel_id, date_assigned)
);

-- Indexes for roster queries
CREATE INDEX idx_duty_slots_date ON duty_slots(date_assigned);
CREATE INDEX idx_duty_slots_personnel ON duty_slots(personnel_id);
CREATE INDEX idx_duty_slots_duty_type ON duty_slots(duty_type_id);
CREATE INDEX idx_duty_slots_status ON duty_slots(status);
CREATE INDEX idx_duty_slots_date_range ON duty_slots(date_assigned, status);
CREATE INDEX idx_duty_slots_swap_pair ON duty_slots(swap_pair_id) WHERE swap_pair_id IS NOT NULL;
CREATE INDEX idx_duty_slots_swapped_from ON duty_slots(swapped_from_personnel_id) WHERE swapped_from_personnel_id IS NOT NULL;

-- Non-Availability (Duty exemptions)
CREATE TABLE non_availability (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    personnel_id UUID NOT NULL REFERENCES personnel(id) ON DELETE CASCADE,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    reason TEXT NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'pending' CHECK (
        status IN ('pending', 'approved', 'rejected')
    ),
    approved_by UUID REFERENCES users(id),
    approved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),

    -- Constraint: End date must be >= start date
    CHECK (end_date >= start_date)
);

-- Indexes for availability queries
CREATE INDEX idx_non_availability_personnel ON non_availability(personnel_id);
CREATE INDEX idx_non_availability_dates ON non_availability(start_date, end_date);
CREATE INDEX idx_non_availability_status ON non_availability(status);

-- Historic Rosters (Snapshot backup)
CREATE TABLE historic_rosters (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    roster_month VARCHAR(7) NOT NULL, -- Format: YYYY-MM
    unit_id UUID NOT NULL REFERENCES unit_sections(id) ON DELETE CASCADE,
    roster_data_json JSONB NOT NULL,
    generated_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),

    -- One snapshot per unit per month
    UNIQUE (roster_month, unit_id)
);

-- Index for historic roster queries
CREATE INDEX idx_historic_rosters_unit ON historic_rosters(unit_id);
CREATE INDEX idx_historic_rosters_month ON historic_rosters(roster_month);

-- Duty Score Events (Historical duty point tracking)
-- Tracks individual duty assignments and points earned for fairness calculations
CREATE TABLE duty_score_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    personnel_id UUID NOT NULL REFERENCES personnel(id) ON DELETE CASCADE,
    duty_slot_id UUID REFERENCES duty_slots(id) ON DELETE SET NULL,
    unit_section_id UUID NOT NULL REFERENCES unit_sections(id) ON DELETE CASCADE,
    duty_type_name VARCHAR(255) NOT NULL,  -- Denormalized for history
    points NUMERIC(10, 2) NOT NULL,
    date_earned DATE NOT NULL,
    roster_month VARCHAR(7) NOT NULL,      -- Format: YYYY-MM (which approval period)
    approved_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for score queries
CREATE INDEX idx_score_events_personnel ON duty_score_events(personnel_id);
CREATE INDEX idx_score_events_date ON duty_score_events(date_earned);
CREATE INDEX idx_score_events_personnel_date ON duty_score_events(personnel_id, date_earned);
CREATE INDEX idx_score_events_unit ON duty_score_events(unit_section_id);
CREATE INDEX idx_score_events_roster_month ON duty_score_events(roster_month);

-- ============================================
-- SECTION 4: AUDIT LOGGING
-- ============================================

-- Audit Log (Track important changes)
CREATE TABLE audit_log (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id),
    action VARCHAR(100) NOT NULL,
    table_name VARCHAR(100) NOT NULL,
    record_id UUID,
    old_values JSONB,
    new_values JSONB,
    ip_address INET,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for audit queries
CREATE INDEX idx_audit_log_user ON audit_log(user_id);
CREATE INDEX idx_audit_log_table ON audit_log(table_name);
CREATE INDEX idx_audit_log_date ON audit_log(created_at);

-- ============================================
-- SECTION 4.5: DUTY CHANGE REQUESTS (SWAPS)
-- Two-Row Model: Each swap creates two linked rows - one for each person's side
-- Both rows share the same swap_pair_id and must both be approved for the swap to execute
-- ============================================

-- Duty Change Requests (swap duties between personnel after roster approval)
CREATE TABLE duty_change_requests (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
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
CREATE INDEX idx_duty_change_requests_swap_pair ON duty_change_requests(swap_pair_id);
CREATE INDEX idx_duty_change_requests_personnel ON duty_change_requests(personnel_id);
CREATE INDEX idx_duty_change_requests_partner ON duty_change_requests(swap_partner_id);
CREATE INDEX idx_duty_change_requests_status ON duty_change_requests(status);
CREATE INDEX idx_duty_change_requests_giving_slot ON duty_change_requests(giving_slot_id);
CREATE INDEX idx_duty_change_requests_receiving_slot ON duty_change_requests(receiving_slot_id);

-- Swap Approvals (approval chain for each person's side)
CREATE TABLE swap_approvals (
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
CREATE INDEX idx_swap_approvals_request ON swap_approvals(duty_change_request_id);
CREATE INDEX idx_swap_approvals_status ON swap_approvals(status);
CREATE INDEX idx_swap_approvals_scope_unit ON swap_approvals(scope_unit_id);
CREATE INDEX idx_swap_approvals_approver ON swap_approvals(approved_by);

-- Swap Recommendations (from managers not in the direct approval chain)
CREATE TABLE swap_recommendations (
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
CREATE INDEX idx_swap_recommendations_request ON swap_recommendations(duty_change_request_id);
CREATE INDEX idx_swap_recommendations_recommender ON swap_recommendations(recommender_id);

-- ============================================
-- SECTION 5: FUNCTIONS & TRIGGERS
-- ============================================

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Apply updated_at trigger to relevant tables
CREATE TRIGGER update_unit_sections_updated_at
    BEFORE UPDATE ON unit_sections
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_personnel_updated_at
    BEFORE UPDATE ON personnel
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_duty_types_updated_at
    BEFORE UPDATE ON duty_types
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_duty_values_updated_at
    BEFORE UPDATE ON duty_values
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_duty_slots_updated_at
    BEFORE UPDATE ON duty_slots
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_duty_change_requests_updated_at
    BEFORE UPDATE ON duty_change_requests
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Function to update personnel duty score after assignment
-- NOTE: This is a backup mechanism. Primary score updates happen in the application
-- when rosters are approved (see approveRoster in client-stores.ts).
-- The trigger fires on 'approved' or 'completed' status to catch direct DB updates.
CREATE OR REPLACE FUNCTION update_duty_score_after_assignment()
RETURNS TRIGGER AS $$
BEGIN
    -- Only add points when status changes to approved or completed
    -- and only if points > 0 to avoid duplicate additions
    IF NEW.points > 0 AND
       (OLD IS NULL OR OLD.status NOT IN ('approved', 'completed')) AND
       NEW.status IN ('approved', 'completed') THEN
        UPDATE personnel
        SET current_duty_score = current_duty_score + NEW.points,
            updated_at = NOW()
        WHERE id = NEW.personnel_id;
    END IF;
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_duty_score_on_approval
    AFTER INSERT OR UPDATE ON duty_slots
    FOR EACH ROW
    WHEN (NEW.status IN ('approved', 'completed'))
    EXECUTE FUNCTION update_duty_score_after_assignment();

-- ============================================
-- SECTION 6: VIEWS FOR HASURA
-- ============================================

-- View: Personnel with unit info
CREATE OR REPLACE VIEW personnel_with_unit AS
SELECT
    p.*,
    u.unit_name,
    u.hierarchy_level,
    u.parent_id as unit_parent_id
FROM personnel p
JOIN unit_sections u ON p.unit_section_id = u.id;

-- View: Users with roles
CREATE OR REPLACE VIEW users_with_roles AS
SELECT
    u.id,
    u.username,
    u.email,
    u.personnel_id,
    u.is_active,
    u.last_login,
    COALESCE(json_agg(
        json_build_object(
            'id', ur.id,
            'role_name', ur.role_name,
            'scope_unit_id', ur.scope_unit_id
        )
    ) FILTER (WHERE ur.id IS NOT NULL), '[]') as roles
FROM users u
LEFT JOIN user_roles ur ON u.id = ur.user_id
GROUP BY u.id;

-- View: Duty assignments with all related info
CREATE OR REPLACE VIEW duty_assignments_view AS
SELECT
    ds.id,
    ds.date_assigned,
    ds.status,
    ds.points,
    ds.notes,
    dt.duty_name,
    dt.slots_needed,
    p.first_name,
    p.last_name,
    p.rank,
    p.service_id,
    us.unit_name
FROM duty_slots ds
JOIN duty_types dt ON ds.duty_type_id = dt.id
JOIN personnel p ON ds.personnel_id = p.id
JOIN unit_sections us ON p.unit_section_id = us.id;

-- ============================================
-- SECTION 7: SEED DATA (Optional - for testing)
-- ============================================

-- Uncomment to seed initial data for testing

/*
-- Insert a test battalion
INSERT INTO unit_sections (id, unit_name, hierarchy_level) VALUES
('00000000-0000-0000-0000-000000000001', '1st Battalion', 'battalion');

-- Insert a test company
INSERT INTO unit_sections (id, parent_id, unit_name, hierarchy_level) VALUES
('00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', 'Alpha Company', 'company');

-- Insert test admin user (password: admin123)
INSERT INTO users (id, username, email, password_hash) VALUES
('00000000-0000-0000-0000-000000000001', 'admin', 'admin@dutysync.mil', '$2a$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/X4.FJQP4/K8XJe7fK');

-- Assign App Admin role
INSERT INTO user_roles (user_id, role_name) VALUES
('00000000-0000-0000-0000-000000000001', 'App Admin');
*/

-- ============================================
-- HASURA PERMISSIONS NOTES
-- ============================================

/*
Configure these permissions in Hasura Console:

1. App Admin Role:
   - Full CRUD access to all tables
   - No row-level restrictions

2. Unit Admin Role:
   - Read: All unit_sections, personnel in their scope_unit_id hierarchy
   - Write: personnel, duty_types, duty_slots for their unit scope
   - Cannot modify user_roles or other units

3. Standard User Role:
   - Read: Their own personnel record, duty_slots
   - Write: non_availability (their own records only)
   - Cannot access admin tables

JWT Claims Structure:
{
  "https://hasura.io/jwt/claims": {
    "x-hasura-default-role": "standard_user",
    "x-hasura-allowed-roles": ["app_admin", "unit_admin", "standard_user"],
    "x-hasura-user-id": "{{user.id}}",
    "x-hasura-personnel-id": "{{user.personnel_id}}",
    "x-hasura-unit-ids": ["{{role.scope_unit_id}}"]
  }
}
*/
