// Core Types for Duty Sync MVP
// Based on the PRD Data Model

export type UUID = string;

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
export type FilterMode = 'include' | 'exclude';

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

// Duty Slot (the resulting schedule)
export interface DutySlot {
  id: UUID;
  duty_type_id: UUID;
  personnel_id: UUID;
  date_assigned: Date;
  assigned_by: UUID; // User who assigned
  duty_points_earned: number;
  status: 'scheduled' | 'completed' | 'cancelled';
  created_at: Date;
  updated_at: Date;
}

// Non-Availability (duty exemptions)
export interface NonAvailability {
  id: UUID;
  personnel_id: UUID;
  start_date: Date;
  end_date: Date;
  reason: string;
  status: 'pending' | 'recommended' | 'approved' | 'rejected';
  recommended_by: UUID | null; // Manager who recommended (for chain of command)
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
  date_earned: Date;
  roster_month: string;       // Format: YYYY-MM (which approval period)
  approved_by: UUID | null;
  created_at: Date;
}

// Blocked Duty (Unit Admin can block specific duties on specific days)
export interface BlockedDuty {
  id: UUID;
  duty_type_id: UUID;
  unit_section_id: UUID; // The unit scope for this block
  start_date: Date;
  end_date: Date;
  reason: string | null;
  blocked_by: UUID; // User ID who created the block
  created_at: Date;
}

// Duty Change Request (swap duties between personnel after roster approval)
// Approval tracking for each step in the swap approval workflow
export interface SwapApproval {
  approver_type: 'target_person' | 'work_section_manager' | 'section_manager' | 'company_manager';
  for_personnel: 'original' | 'target' | 'both'; // Which personnel's chain this approval is for
  scope_unit_id: string | null; // The unit scope for manager approvals
  status: 'pending' | 'approved' | 'rejected';
  approved_by: string | null;
  approved_at: Date | null;
  rejection_reason: string | null;
}

// Recommendation from managers not in the direct approval chain
export interface SwapRecommendation {
  recommender_id: string; // User ID of the recommender
  recommender_name: string; // Display name
  role_name: string; // Their role (e.g., "Work Section Manager")
  recommendation: 'recommend' | 'not_recommend';
  comment: string;
  created_at: Date;
}

export interface DutyChangeRequest {
  id: UUID;
  // The requester (could be duty holder or manager acting on their behalf)
  requester_id: UUID; // User ID
  requester_personnel_id: UUID | null; // Personnel ID if applicable

  // Original duty assignment (the one being given up)
  original_slot_id: UUID;
  original_personnel_id: UUID; // Person currently assigned
  original_duty_date: Date;
  original_duty_type_id: UUID;

  // Target duty assignment (the one being received in exchange)
  target_slot_id: UUID;
  target_personnel_id: UUID; // Person to swap with
  target_duty_date: Date;
  target_duty_type_id: UUID;

  // Request details
  reason: string;
  status: 'pending' | 'approved' | 'rejected';

  // Multi-level approval tracking
  required_approver_level: 'work_section' | 'section' | 'company'; // Highest common level needed
  approvals: SwapApproval[]; // All required approvals for this swap
  recommendations: SwapRecommendation[]; // Recommendations from managers not in approval chain

  // Legacy fields for backwards compatibility
  approved_by: UUID | null;
  approved_at: Date | null;
  rejection_reason: string | null;

  created_at: Date;
  updated_at: Date;
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
