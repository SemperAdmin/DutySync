// Core Types for Duty Sync MVP
// Based on the PRD Data Model

export type UUID = string;

// Hierarchy levels for unit_sections
// RUC > Company > Section > Work Section
export type HierarchyLevel = 'ruc' | 'company' | 'section' | 'work_section' | 'battalion' | 'platoon';

// User roles for RBAC
// Manager roles are scoped - they can only see personnel within their assigned unit scope
export type RoleName =
  | 'App Admin'
  | 'Unit Admin'
  | 'Unit Manager'
  | 'Company Manager'
  | 'Platoon Manager'
  | 'Section Manager'
  | 'Standard User';

// Unit Section (military hierarchy)
export interface UnitSection {
  id: UUID;
  parent_id: UUID | null;
  unit_name: string;
  unit_code?: string; // Short code (e.g., "02301", "H", "S1DV", "CUST")
  hierarchy_level: HierarchyLevel;
  description?: string;
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

// Duty Type
export interface DutyType {
  id: UUID;
  unit_section_id: UUID;
  duty_name: string;
  description: string | null;
  slots_needed: number;
  required_rank_min: string | null;
  required_rank_max: string | null;
  is_active: boolean;
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
  status: 'pending' | 'approved' | 'rejected';
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
