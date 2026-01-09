-- Migration: Add Supernumerary Assignments Table
-- Description: Stores standby personnel assignments for duty coverage periods
-- Version: 005

-- ============================================
-- SUPERNUMERARY ASSIGNMENTS TABLE
-- ============================================

-- Supernumerary (standby personnel) assignments for duty coverage
-- Personnel assigned as supernumerary can be activated to cover absences
CREATE TABLE supernumerary_assignments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    duty_type_id UUID NOT NULL REFERENCES duty_types(id) ON DELETE CASCADE,
    personnel_id UUID NOT NULL REFERENCES personnel(id) ON DELETE CASCADE,
    organization_id UUID NOT NULL REFERENCES unit_sections(id) ON DELETE CASCADE,
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    activation_count INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    -- Constraint: End date must be >= start date
    CHECK (period_end >= period_start),

    -- Constraint: Activation count must be non-negative
    CHECK (activation_count >= 0),

    -- Unique constraint: One supernumerary assignment per personnel per duty type per period
    UNIQUE (duty_type_id, personnel_id, period_start, period_end)
);

-- Indexes for supernumerary queries
CREATE INDEX idx_supernumerary_duty_type ON supernumerary_assignments(duty_type_id);
CREATE INDEX idx_supernumerary_personnel ON supernumerary_assignments(personnel_id);
CREATE INDEX idx_supernumerary_organization ON supernumerary_assignments(organization_id);
CREATE INDEX idx_supernumerary_period ON supernumerary_assignments(period_start, period_end);
CREATE INDEX idx_supernumerary_active_period ON supernumerary_assignments(period_start, period_end, duty_type_id);

-- Apply updated_at trigger
CREATE TRIGGER update_supernumerary_assignments_updated_at
    BEFORE UPDATE ON supernumerary_assignments
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- COMMENTS
-- ============================================

COMMENT ON TABLE supernumerary_assignments IS 'Standby personnel assignments for duty coverage periods';
COMMENT ON COLUMN supernumerary_assignments.duty_type_id IS 'The duty type this supernumerary is assigned to cover';
COMMENT ON COLUMN supernumerary_assignments.personnel_id IS 'The personnel assigned as supernumerary';
COMMENT ON COLUMN supernumerary_assignments.organization_id IS 'The unit/organization this assignment belongs to';
COMMENT ON COLUMN supernumerary_assignments.period_start IS 'Start date of the supernumerary coverage period';
COMMENT ON COLUMN supernumerary_assignments.period_end IS 'End date of the supernumerary coverage period';
COMMENT ON COLUMN supernumerary_assignments.activation_count IS 'Number of times this supernumerary has been activated';
