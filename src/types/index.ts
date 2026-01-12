// Core Types for Duty Sync MVP
// Based on the PRD Data Model

export type UUID = string;

// Date string type for timezone-agnostic dates (YYYY-MM-DD format)
// These dates are static and don't shift with timezone conversions
export type DateString = string;

// Hierarchy levels for unit_sections
// Unit > Company > Section > Work Section
export type HierarchyLevel = 'unit' | 'company' | 'section' | 'work_section' | 'ruc' | 'battalion';

// User roles for RBAC
// Manager roles are scoped - they can only see personnel within their assigned unit scope
export type RoleName =
  | 'App Admin'
  | 'Unit Admin'
  | 'Unit Manager'
  | 'Company Manager'
  | 'Section Manager'
  | 'Work Section Manager'
  | 'Standard User';

// Unit Section (military hierarchy)
export interface UnitSection {
  id: UUID;
  parent_id: UUID | null;
  organization_id?: UUID; // Organization this unit belongs to (added during data loading)
  unit_name: string;
  unit_code?: string; // Short code (e.g., "02301", "H", "S1DV", "CUST")
  hierarchy_level: HierarchyLevel;
  description?: string;
  ruc?: string; // RUC code this unit belongs to (added during data loading)
  created_at: Date;
  updated_at: Date;
}

// Personnel (core military data)
export interface Personnel {
  id: UUID;
  service_id: string; // Unique military ID
  unit_section_id: UUID;
  first_name: string;
  last_name: string;
  rank: string;
  phone_number: string | null; // Contact phone number
  current_duty_score: number;
  created_at: Date;
  updated_at: Date;
}

// User (authentication)
export interface User {
  id: UUID;
  personnel_id: UUID | null; // Links to personnel table
  edipi: string; // 10-digit Electronic Data Interchange Personal Identifier
  email: string;
  password_hash: string;
  created_at: Date;
  updated_at: Date;
}

// User Role (RBAC)
export interface UserRole {
  id: UUID;
  user_id: UUID;
  role_name: RoleName;
  scope_unit_id: UUID | null; // Defines role's authority scope
  created_at: Date;
}

// Filter mode for duty type filters
// 'none' represents no filtering (equivalent to null, but stored as string in some cases)
export type FilterMode = 'none' | 'include' | 'exclude';

// Supernumerary period type presets
// Defines how supernumerary coverage periods are divided within a month
export type SupernumeraryPeriodType = 'full_month' | 'half_month' | 'weekly' | 'bi_weekly';

// Helper to get period days from period type
export const SUPERNUMERARY_PERIOD_DAYS: Record<SupernumeraryPeriodType, number> = {
  full_month: 31,  // Entire month
  half_month: 15,  // ~15 days (1st-15th, 16th-end)
  weekly: 7,       // 7 days
  bi_weekly: 14,   // 14 days
};

// Display labels for period types
export const SUPERNUMERARY_PERIOD_LABELS: Record<SupernumeraryPeriodType, string> = {
  full_month: 'Full Month',
  half_month: 'Half Month (1st-15th, 16th-End)',
  weekly: 'Weekly',
  bi_weekly: 'Bi-Weekly (Every 2 Weeks)',
};

// Duty Type
export interface DutyType {
  id: UUID;
  unit_section_id: UUID;
  duty_name: string;
  description: string | null;
  notes: string | null;  // Free-form notes about this duty type
  slots_needed: number;
  required_rank_min: string | null;  // Deprecated - kept for backwards compatibility
  required_rank_max: string | null;  // Deprecated - kept for backwards compatibility
  is_active: boolean;
  // Personnel filtering options
  rank_filter_mode: FilterMode | null;  // null = any rank
  rank_filter_values: string[] | null;  // Selected ranks
  section_filter_mode: FilterMode | null;  // null = any section
  section_filter_values: string[] | null;  // Selected section IDs
  // Supernumerary configuration
  requires_supernumerary: boolean;  // Whether this duty type needs supernumerary coverage
  supernumerary_count: number;  // How many supernumerary slots needed per period (e.g., 2)
  supernumerary_period_type: SupernumeraryPeriodType;  // Period type preset (full_month, half_month, weekly, bi_weekly)
  supernumerary_period_days: number;  // Coverage period in days - derived from period_type, kept for backwards compat
  supernumerary_value: number;  // Duty score value for being on standby (e.g., 0.5)
  created_at: Date;
  updated_at: Date;
}

// Qualification
export interface Qualification {
  personnel_id: UUID;
  qual_name: string;
  granted_at: Date;
}

// Duty Requirement
export interface DutyRequirement {
  duty_type_id: UUID;
  required_qual_name: string;
}

// Duty Values (for fairness calculation)
export interface DutyValue {
  id: UUID;
  duty_type_id: UUID;
  base_weight: number;
  weekend_multiplier: number;
  holiday_multiplier: number;
}

// Supernumerary Assignment (standby personnel for a duty type)
export interface SupernumeraryAssignment {
  id: UUID;
  duty_type_id: UUID;  // Which duty type they're covering
  personnel_id: UUID;  // Who is assigned as supernumerary
  organization_id: UUID;  // Organization scope
  period_start: DateString;  // Start of coverage period (YYYY-MM-DD)
  period_end: DateString;  // End of coverage period (YYYY-MM-DD)
  activation_count: number;  // How many times activated (for tracking, score uses duty_slot)
  created_at: Date;
  updated_at: Date;
}

// Duty Slot (the resulting schedule)
export interface DutySlot {
  id: UUID;
  duty_type_id: UUID;
  personnel_id: UUID;
  date_assigned: DateString; // Static date string (YYYY-MM-DD) - timezone agnostic
  assigned_by: UUID; // User who assigned
  points: number; // Calculated duty score (base_weight * multipliers)
  status: 'scheduled' | 'approved' | 'completed' | 'missed' | 'swapped';
  // Swap tracking fields
  swapped_at: Date | null; // When the swap was executed (timestamp)
  swapped_from_personnel_id: UUID | null; // Original personnel before swap
  swap_pair_id: UUID | null; // Link to the swap request pair
  created_at: Date;
  updated_at: Date;
}

// Non-Availability (duty exemptions)
export interface NonAvailability {
  id: UUID;
  personnel_id: UUID;
  start_date: DateString; // Static date string (YYYY-MM-DD) - timezone agnostic
  end_date: DateString; // Static date string (YYYY-MM-DD) - timezone agnostic
  reason: string;
  status: 'pending' | 'recommended' | 'approved' | 'rejected';
  submitted_by: UUID | null; // User who submitted the request
  recommended_by: UUID | null; // Manager who recommended (for chain of command)
  recommended_at: Date | null; // When recommendation was made (timestamp)
  approved_by: UUID | null;
  created_at: Date;
}

// Historic Roster (snapshot backup)
export interface HistoricRoster {
  id: UUID;
  roster_month: string; // Format: YYYY-MM
  unit_id: UUID;
  roster_data_json: Record<string, unknown>;
  created_at: Date;
}

// Duty Score Event (historical duty point tracking)
// Tracks individual duty assignments and points earned for fairness calculations
export interface DutyScoreEvent {
  id: UUID;
  personnel_id: UUID;
  duty_slot_id: UUID | null;  // May be null if slot was deleted
  unit_section_id: UUID;
  duty_type_name: string;     // Denormalized for history
  points: number;
  date_earned: DateString;    // Static date string (YYYY-MM-DD) - timezone agnostic
  roster_month: string;       // Format: YYYY-MM (which approval period)
  approved_by: UUID | null;
  created_at: Date;
}

// Blocked Duty (Unit Admin can block specific duties on specific days)
export interface BlockedDuty {
  id: UUID;
  duty_type_id: UUID;
  unit_section_id: UUID; // The unit scope for this block
  start_date: DateString; // Static date string (YYYY-MM-DD) - timezone agnostic
  end_date: DateString; // Static date string (YYYY-MM-DD) - timezone agnostic
  reason: string | null;
  blocked_by: UUID; // User ID who created the block
  created_at: Date;
}

// Duty Change Request (swap duties between personnel after roster approval)
// Two-Row Model: Each swap creates two linked rows - one for each person's side
// Both rows share the same swap_pair_id and must both be approved for the swap to execute

// Approval tracking for each step in the swap approval workflow
// Stored in separate swap_approvals table, linked by duty_change_request_id
export interface SwapApproval {
  id: UUID;
  duty_change_request_id: UUID; // Links to the specific person's request row
  approval_order: number; // Sequence in the approval chain (1, 2, 3...)
  approver_type: 'work_section_manager' | 'section_manager' | 'company_manager';
  scope_unit_id: string | null; // The unit scope for manager approvals
  is_approver: boolean; // true = can approve, false = can only recommend
  status: 'pending' | 'approved' | 'rejected';
  approved_by: string | null;
  approved_at: Date | null;
  rejection_reason: string | null;
  created_at: Date;
}

// Recommendation from managers not in the direct approval chain
// Stored in separate swap_recommendations table
export interface SwapRecommendation {
  id: UUID;
  duty_change_request_id: UUID; // Links to the specific request row
  recommender_id: string; // User ID of the recommender
  recommendation: 'recommend' | 'not_recommend';
  comment: string | null;
  created_at: Date;
}

// Each DutyChangeRequest row represents ONE person's side of a swap
// Two rows are created per swap, linked by swap_pair_id
export interface DutyChangeRequest {
  id: UUID;
  swap_pair_id: UUID; // Links the two rows of a swap together

  // This person's side of the swap
  personnel_id: UUID; // The person this row is for
  giving_slot_id: UUID; // The duty slot they are giving up
  receiving_slot_id: UUID; // The duty slot they are receiving

  // The swap partner
  swap_partner_id: UUID; // The other person in the swap

  // Request details
  requester_id: UUID; // User ID who initiated the swap request
  reason: string;
  status: 'pending' | 'approved' | 'rejected';

  // Partner acceptance (the other party must accept before manager approvals begin)
  partner_accepted: boolean;
  partner_accepted_at: Date | null;
  partner_accepted_by: string | null; // User ID who accepted

  // Rejection info
  rejection_reason: string | null;

  created_at: Date;
  updated_at: Date;
}

// Enriched types with related data for UI display
export interface DutyChangeRequestWithApprovals extends DutyChangeRequest {
  approvals: SwapApproval[];
  recommendations: SwapRecommendation[];
}

// Represents both sides of a swap for combined display
export interface SwapPair {
  swap_pair_id: UUID;
  requester_id: UUID;
  reason: string;
  status: 'pending' | 'approved' | 'rejected'; // Overall status (rejected if either rejected, approved if both approved)
  created_at: Date;

  // Person A's side
  personA: {
    request: DutyChangeRequest;
    personnel_id: UUID;
    giving_slot_id: UUID;
    receiving_slot_id: UUID;
    approvals: SwapApproval[];
    partner_accepted: boolean;
  };

  // Person B's side
  personB: {
    request: DutyChangeRequest;
    personnel_id: UUID;
    giving_slot_id: UUID;
    receiving_slot_id: UUID;
    approvals: SwapApproval[];
    partner_accepted: boolean;
  };
}

// Session user for Auth.js
export interface SessionUser {
  id: string;
  edipi: string; // 10-digit Electronic Data Interchange Personal Identifier
  email: string;
  personnel_id: string | null;
  roles: UserRole[];
  // Permission flags
  can_approve_non_availability?: boolean; // Allows manager to approve/reject non-availability requests within their scope
  // Display info from personnel record (populated on login if EDIPI matches)
  displayName?: string; // e.g., "SGT SMITH"
  rank?: string;
  firstName?: string;
  lastName?: string;
  unitId?: string;
  unitName?: string;
}
