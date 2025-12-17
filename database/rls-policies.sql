-- DutySync Row Level Security (RLS) Policies
-- Run this in Supabase SQL Editor to enable data access

-- ============================================================================
-- ORGANIZATIONS TABLE - RUC codes
-- ============================================================================

-- Enable RLS on organizations table
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;

-- Allow all users to read organizations
DROP POLICY IF EXISTS "Allow read access to organizations" ON organizations;
CREATE POLICY "Allow read access to organizations" ON organizations
    FOR SELECT
    TO anon, authenticated
    USING (true);

-- Allow authenticated users to insert organizations
DROP POLICY IF EXISTS "Allow insert access to organizations" ON organizations;
CREATE POLICY "Allow insert access to organizations" ON organizations
    FOR INSERT
    TO anon, authenticated
    WITH CHECK (true);

-- Allow authenticated users to update organizations
DROP POLICY IF EXISTS "Allow update access to organizations" ON organizations;
CREATE POLICY "Allow update access to organizations" ON organizations
    FOR UPDATE
    TO anon, authenticated
    USING (true)
    WITH CHECK (true);

-- ============================================================================
-- UNITS TABLE
-- ============================================================================

-- Enable RLS on units table
ALTER TABLE units ENABLE ROW LEVEL SECURITY;

-- Allow all users to read units
DROP POLICY IF EXISTS "Allow read access to units" ON units;
CREATE POLICY "Allow read access to units" ON units
    FOR SELECT
    TO anon, authenticated
    USING (true);

-- Allow authenticated users to insert units
DROP POLICY IF EXISTS "Allow insert access to units" ON units;
CREATE POLICY "Allow insert access to units" ON units
    FOR INSERT
    TO anon, authenticated
    WITH CHECK (true);

-- Allow authenticated users to update units
DROP POLICY IF EXISTS "Allow update access to units" ON units;
CREATE POLICY "Allow update access to units" ON units
    FOR UPDATE
    TO anon, authenticated
    USING (true)
    WITH CHECK (true);

-- Allow authenticated users to delete units
DROP POLICY IF EXISTS "Allow delete access to units" ON units;
CREATE POLICY "Allow delete access to units" ON units
    FOR DELETE
    TO anon, authenticated
    USING (true);

-- ============================================================================
-- PERSONNEL TABLE
-- ============================================================================

-- Enable RLS on personnel table
ALTER TABLE personnel ENABLE ROW LEVEL SECURITY;

-- Allow all users to read personnel
DROP POLICY IF EXISTS "Allow read access to personnel" ON personnel;
CREATE POLICY "Allow read access to personnel" ON personnel
    FOR SELECT
    TO anon, authenticated
    USING (true);

-- Allow authenticated users to insert personnel
DROP POLICY IF EXISTS "Allow insert access to personnel" ON personnel;
CREATE POLICY "Allow insert access to personnel" ON personnel
    FOR INSERT
    TO anon, authenticated
    WITH CHECK (true);

-- Allow authenticated users to update personnel
DROP POLICY IF EXISTS "Allow update access to personnel" ON personnel;
CREATE POLICY "Allow update access to personnel" ON personnel
    FOR UPDATE
    TO anon, authenticated
    USING (true)
    WITH CHECK (true);

-- Allow authenticated users to delete personnel
DROP POLICY IF EXISTS "Allow delete access to personnel" ON personnel;
CREATE POLICY "Allow delete access to personnel" ON personnel
    FOR DELETE
    TO anon, authenticated
    USING (true);

-- ============================================================================
-- USERS TABLE
-- ============================================================================

-- Enable RLS on users table
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

-- Allow all users to read users
DROP POLICY IF EXISTS "Allow read access to users" ON users;
CREATE POLICY "Allow read access to users" ON users
    FOR SELECT
    TO anon, authenticated
    USING (true);

-- Allow authenticated users to insert users
DROP POLICY IF EXISTS "Allow insert access to users" ON users;
CREATE POLICY "Allow insert access to users" ON users
    FOR INSERT
    TO anon, authenticated
    WITH CHECK (true);

-- Allow authenticated users to update users
DROP POLICY IF EXISTS "Allow update access to users" ON users;
CREATE POLICY "Allow update access to users" ON users
    FOR UPDATE
    TO anon, authenticated
    USING (true)
    WITH CHECK (true);

-- Allow authenticated users to delete users
DROP POLICY IF EXISTS "Allow delete access to users" ON users;
CREATE POLICY "Allow delete access to users" ON users
    FOR DELETE
    TO anon, authenticated
    USING (true);

-- ============================================================================
-- ROLES TABLE
-- ============================================================================

-- Enable RLS on roles table
ALTER TABLE roles ENABLE ROW LEVEL SECURITY;

-- Allow all users to read roles
DROP POLICY IF EXISTS "Allow read access to roles" ON roles;
CREATE POLICY "Allow read access to roles" ON roles
    FOR SELECT
    TO anon, authenticated
    USING (true);

-- ============================================================================
-- USER_ROLES TABLE
-- ============================================================================

-- Enable RLS on user_roles table
ALTER TABLE user_roles ENABLE ROW LEVEL SECURITY;

-- Allow all users to read user_roles
DROP POLICY IF EXISTS "Allow read access to user_roles" ON user_roles;
CREATE POLICY "Allow read access to user_roles" ON user_roles
    FOR SELECT
    TO anon, authenticated
    USING (true);

-- Allow authenticated users to insert user_roles
DROP POLICY IF EXISTS "Allow insert access to user_roles" ON user_roles;
CREATE POLICY "Allow insert access to user_roles" ON user_roles
    FOR INSERT
    TO anon, authenticated
    WITH CHECK (true);

-- Allow authenticated users to delete user_roles
DROP POLICY IF EXISTS "Allow delete access to user_roles" ON user_roles;
CREATE POLICY "Allow delete access to user_roles" ON user_roles
    FOR DELETE
    TO anon, authenticated
    USING (true);

-- ============================================================================
-- QUALIFICATIONS TABLE
-- ============================================================================

-- Enable RLS on qualifications table
ALTER TABLE qualifications ENABLE ROW LEVEL SECURITY;

-- Allow all users to read qualifications
DROP POLICY IF EXISTS "Allow read access to qualifications" ON qualifications;
CREATE POLICY "Allow read access to qualifications" ON qualifications
    FOR SELECT
    TO anon, authenticated
    USING (true);

-- Allow authenticated users to insert qualifications
DROP POLICY IF EXISTS "Allow insert access to qualifications" ON qualifications;
CREATE POLICY "Allow insert access to qualifications" ON qualifications
    FOR INSERT
    TO anon, authenticated
    WITH CHECK (true);

-- ============================================================================
-- PERSONNEL_QUALIFICATIONS TABLE (if exists)
-- ============================================================================

DO $$
BEGIN
    IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'personnel_qualifications') THEN
        ALTER TABLE personnel_qualifications ENABLE ROW LEVEL SECURITY;

        DROP POLICY IF EXISTS "Allow read access to personnel_qualifications" ON personnel_qualifications;
        CREATE POLICY "Allow read access to personnel_qualifications" ON personnel_qualifications
            FOR SELECT TO anon, authenticated USING (true);

        DROP POLICY IF EXISTS "Allow insert access to personnel_qualifications" ON personnel_qualifications;
        CREATE POLICY "Allow insert access to personnel_qualifications" ON personnel_qualifications
            FOR INSERT TO anon, authenticated WITH CHECK (true);
    END IF;
END $$;

-- ============================================================================
-- DUTY_TYPES TABLE
-- ============================================================================

-- Enable RLS on duty_types table
ALTER TABLE duty_types ENABLE ROW LEVEL SECURITY;

-- Allow all users to read duty_types
DROP POLICY IF EXISTS "Allow read access to duty_types" ON duty_types;
CREATE POLICY "Allow read access to duty_types" ON duty_types
    FOR SELECT
    TO anon, authenticated
    USING (true);

-- Allow authenticated users to insert duty_types
DROP POLICY IF EXISTS "Allow insert access to duty_types" ON duty_types;
CREATE POLICY "Allow insert access to duty_types" ON duty_types
    FOR INSERT
    TO anon, authenticated
    WITH CHECK (true);

-- Allow authenticated users to update duty_types
DROP POLICY IF EXISTS "Allow update access to duty_types" ON duty_types;
CREATE POLICY "Allow update access to duty_types" ON duty_types
    FOR UPDATE
    TO anon, authenticated
    USING (true)
    WITH CHECK (true);

-- Allow authenticated users to delete duty_types
DROP POLICY IF EXISTS "Allow delete access to duty_types" ON duty_types;
CREATE POLICY "Allow delete access to duty_types" ON duty_types
    FOR DELETE
    TO anon, authenticated
    USING (true);

-- ============================================================================
-- DUTY_VALUES TABLE
-- ============================================================================

-- Enable RLS on duty_values table
ALTER TABLE duty_values ENABLE ROW LEVEL SECURITY;

-- Allow all users to read duty_values
DROP POLICY IF EXISTS "Allow read access to duty_values" ON duty_values;
CREATE POLICY "Allow read access to duty_values" ON duty_values
    FOR SELECT
    TO anon, authenticated
    USING (true);

-- Allow authenticated users to insert duty_values
DROP POLICY IF EXISTS "Allow insert access to duty_values" ON duty_values;
CREATE POLICY "Allow insert access to duty_values" ON duty_values
    FOR INSERT
    TO anon, authenticated
    WITH CHECK (true);

-- ============================================================================
-- DUTY_REQUIREMENTS TABLE
-- ============================================================================

-- Enable RLS on duty_requirements table
ALTER TABLE duty_requirements ENABLE ROW LEVEL SECURITY;

-- Allow all users to read duty_requirements
DROP POLICY IF EXISTS "Allow read access to duty_requirements" ON duty_requirements;
CREATE POLICY "Allow read access to duty_requirements" ON duty_requirements
    FOR SELECT
    TO anon, authenticated
    USING (true);

-- Allow authenticated users to insert duty_requirements
DROP POLICY IF EXISTS "Allow insert access to duty_requirements" ON duty_requirements;
CREATE POLICY "Allow insert access to duty_requirements" ON duty_requirements
    FOR INSERT
    TO anon, authenticated
    WITH CHECK (true);

-- ============================================================================
-- DUTY_SLOTS TABLE
-- ============================================================================

-- Enable RLS on duty_slots table
ALTER TABLE duty_slots ENABLE ROW LEVEL SECURITY;

-- Allow all users to read duty_slots
DROP POLICY IF EXISTS "Allow read access to duty_slots" ON duty_slots;
CREATE POLICY "Allow read access to duty_slots" ON duty_slots
    FOR SELECT
    TO anon, authenticated
    USING (true);

-- Allow authenticated users to insert duty_slots
DROP POLICY IF EXISTS "Allow insert access to duty_slots" ON duty_slots;
CREATE POLICY "Allow insert access to duty_slots" ON duty_slots
    FOR INSERT
    TO anon, authenticated
    WITH CHECK (true);

-- Allow authenticated users to update duty_slots
DROP POLICY IF EXISTS "Allow update access to duty_slots" ON duty_slots;
CREATE POLICY "Allow update access to duty_slots" ON duty_slots
    FOR UPDATE
    TO anon, authenticated
    USING (true)
    WITH CHECK (true);

-- Allow authenticated users to delete duty_slots
DROP POLICY IF EXISTS "Allow delete access to duty_slots" ON duty_slots;
CREATE POLICY "Allow delete access to duty_slots" ON duty_slots
    FOR DELETE
    TO anon, authenticated
    USING (true);

-- ============================================================================
-- NON_AVAILABILITY TABLE
-- ============================================================================

-- Enable RLS on non_availability table
ALTER TABLE non_availability ENABLE ROW LEVEL SECURITY;

-- Allow all users to read non_availability
DROP POLICY IF EXISTS "Allow read access to non_availability" ON non_availability;
CREATE POLICY "Allow read access to non_availability" ON non_availability
    FOR SELECT
    TO anon, authenticated
    USING (true);

-- Allow authenticated users to insert non_availability
DROP POLICY IF EXISTS "Allow insert access to non_availability" ON non_availability;
CREATE POLICY "Allow insert access to non_availability" ON non_availability
    FOR INSERT
    TO anon, authenticated
    WITH CHECK (true);

-- Allow authenticated users to update non_availability
DROP POLICY IF EXISTS "Allow update access to non_availability" ON non_availability;
CREATE POLICY "Allow update access to non_availability" ON non_availability
    FOR UPDATE
    TO anon, authenticated
    USING (true)
    WITH CHECK (true);

-- Allow authenticated users to delete non_availability
DROP POLICY IF EXISTS "Allow delete access to non_availability" ON non_availability;
CREATE POLICY "Allow delete access to non_availability" ON non_availability
    FOR DELETE
    TO anon, authenticated
    USING (true);

-- ============================================================================
-- HELPER FUNCTIONS
-- ============================================================================

-- Function to get all descendant unit IDs (recursive)
CREATE OR REPLACE FUNCTION get_descendant_unit_ids(parent_unit_id UUID)
RETURNS TABLE(unit_id UUID) AS $$
WITH RECURSIVE descendants AS (
    -- Base case: start with the parent itself
    SELECT id FROM units WHERE id = parent_unit_id
    UNION ALL
    -- Recursive case: get children
    SELECT u.id
    FROM units u
    INNER JOIN descendants d ON u.parent_id = d.id
)
SELECT id FROM descendants;
$$ LANGUAGE SQL STABLE;

-- ============================================================================
-- VERIFICATION QUERY
-- Run this to confirm policies are in place
-- ============================================================================

SELECT
    schemaname,
    tablename,
    policyname,
    permissive,
    roles,
    cmd
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname;
