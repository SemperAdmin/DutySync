/**
 * Supabase Database Types
 * Auto-generated types for the DutySync database schema
 */

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

// Enum types matching the database
export type HierarchyLevel = "unit" | "company" | "section" | "work_section";
export type RoleName =
  | "App Admin"
  | "Unit Admin"
  | "Unit Manager"
  | "Company Manager"
  | "Section Manager"
  | "Work Section Manager"
  | "Standard User";
export type FilterMode = "include" | "exclude" | "none";
export type DutySlotStatus = "scheduled" | "approved" | "completed" | "missed" | "swapped";
export type RequestStatus = "pending" | "recommended" | "approved" | "rejected";
export type SwapApproverType = "work_section_manager" | "section_manager" | "company_manager";
export type SwapRecommendationType = "recommend" | "not_recommend";

export interface Database {
  public: {
    Tables: {
      organizations: {
        Row: {
          id: string;
          ruc_code: string;
          name: string | null;
          description: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          ruc_code: string;
          name?: string | null;
          description?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          ruc_code?: string;
          name?: string | null;
          description?: string | null;
          created_at?: string;
          updated_at?: string;
        };
      };
      units: {
        Row: {
          id: string;
          organization_id: string;
          parent_id: string | null;
          unit_name: string;
          unit_code: string | null;
          hierarchy_level: HierarchyLevel;
          description: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          parent_id?: string | null;
          unit_name: string;
          unit_code?: string | null;
          hierarchy_level: HierarchyLevel;
          description?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          parent_id?: string | null;
          unit_name?: string;
          unit_code?: string | null;
          hierarchy_level?: HierarchyLevel;
          description?: string | null;
          created_at?: string;
          updated_at?: string;
        };
      };
      personnel: {
        Row: {
          id: string;
          organization_id: string;
          unit_id: string;
          service_id: string;
          first_name: string;
          last_name: string;
          rank: string;
          current_duty_score: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          unit_id: string;
          service_id: string;
          first_name: string;
          last_name: string;
          rank: string;
          current_duty_score?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          unit_id?: string;
          service_id?: string;
          first_name?: string;
          last_name?: string;
          rank?: string;
          current_duty_score?: number;
          created_at?: string;
          updated_at?: string;
        };
      };
      users: {
        Row: {
          id: string;
          edipi: string;
          email: string;
          password_hash: string;
          personnel_id: string | null;
          can_approve_non_availability: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          edipi: string;
          email: string;
          password_hash: string;
          personnel_id?: string | null;
          can_approve_non_availability?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          edipi?: string;
          email?: string;
          password_hash?: string;
          personnel_id?: string | null;
          can_approve_non_availability?: boolean;
          created_at?: string;
          updated_at?: string;
        };
      };
      roles: {
        Row: {
          id: string;
          name: RoleName;
          description: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          name: RoleName;
          description?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          name?: RoleName;
          description?: string | null;
          created_at?: string;
        };
      };
      user_roles: {
        Row: {
          id: string;
          user_id: string;
          role_id: string;
          scope_unit_id: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          role_id: string;
          scope_unit_id?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          role_id?: string;
          scope_unit_id?: string | null;
          created_at?: string;
        };
      };
      qualifications: {
        Row: {
          id: string;
          organization_id: string;
          name: string;
          description: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          name: string;
          description?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          name?: string;
          description?: string | null;
          created_at?: string;
          updated_at?: string;
        };
      };
      personnel_qualifications: {
        Row: {
          id: string;
          personnel_id: string;
          qualification_id: string;
          earned_date: string | null;
          expiration_date: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          personnel_id: string;
          qualification_id: string;
          earned_date?: string | null;
          expiration_date?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          personnel_id?: string;
          qualification_id?: string;
          earned_date?: string | null;
          expiration_date?: string | null;
          created_at?: string;
        };
      };
      duty_types: {
        Row: {
          id: string;
          organization_id: string;
          unit_id: string;
          name: string;
          description: string | null;
          personnel_required: number;
          rank_filter_mode: FilterMode;
          rank_filter_values: string[] | null;
          section_filter_mode: FilterMode;
          section_filter_values: string[] | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          unit_id: string;
          name: string;
          description?: string | null;
          personnel_required?: number;
          rank_filter_mode?: FilterMode;
          rank_filter_values?: string[] | null;
          section_filter_mode?: FilterMode;
          section_filter_values?: string[] | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          unit_id?: string;
          name?: string;
          description?: string | null;
          personnel_required?: number;
          rank_filter_mode?: FilterMode;
          rank_filter_values?: string[] | null;
          section_filter_mode?: FilterMode;
          section_filter_values?: string[] | null;
          created_at?: string;
          updated_at?: string;
        };
      };
      duty_values: {
        Row: {
          id: string;
          duty_type_id: string;
          base_weight: number;
          weekend_multiplier: number;
          holiday_multiplier: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          duty_type_id: string;
          base_weight?: number;
          weekend_multiplier?: number;
          holiday_multiplier?: number;
          created_at?: string;
        };
        Update: {
          id?: string;
          duty_type_id?: string;
          base_weight?: number;
          weekend_multiplier?: number;
          holiday_multiplier?: number;
          created_at?: string;
        };
      };
      duty_requirements: {
        Row: {
          id: string;
          duty_type_id: string;
          qualification_id: string;
          is_required: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          duty_type_id: string;
          qualification_id: string;
          is_required?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          duty_type_id?: string;
          qualification_id?: string;
          is_required?: boolean;
          created_at?: string;
        };
      };
      duty_slots: {
        Row: {
          id: string;
          organization_id: string;
          duty_type_id: string;
          personnel_id: string;
          date_assigned: string;
          status: DutySlotStatus;
          points: number | null;
          assigned_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          duty_type_id: string;
          personnel_id: string;
          date_assigned: string;
          status?: DutySlotStatus;
          points?: number | null;
          assigned_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          duty_type_id?: string;
          personnel_id?: string;
          date_assigned?: string;
          status?: DutySlotStatus;
          points?: number | null;
          assigned_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
      };
      non_availability: {
        Row: {
          id: string;
          organization_id: string;
          personnel_id: string;
          start_date: string;
          end_date: string;
          reason: string | null;
          status: RequestStatus;
          submitted_by: string | null;
          recommended_by: string | null;
          recommended_at: string | null;
          approved_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          personnel_id: string;
          start_date: string;
          end_date: string;
          reason?: string | null;
          status?: RequestStatus;
          submitted_by?: string | null;
          recommended_by?: string | null;
          recommended_at?: string | null;
          approved_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          personnel_id?: string;
          start_date?: string;
          end_date?: string;
          reason?: string | null;
          status?: RequestStatus;
          submitted_by?: string | null;
          recommended_by?: string | null;
          recommended_at?: string | null;
          approved_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
      };
      duty_change_requests: {
        Row: {
          id: string;
          organization_id: string;
          swap_pair_id: string;
          personnel_id: string;
          giving_slot_id: string;
          receiving_slot_id: string;
          swap_partner_id: string;
          status: RequestStatus;
          partner_accepted: boolean;
          partner_accepted_at: string | null;
          partner_accepted_by: string | null;
          requested_by: string | null;
          reason: string | null;
          rejection_reason: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          swap_pair_id: string;
          personnel_id: string;
          giving_slot_id: string;
          receiving_slot_id: string;
          swap_partner_id: string;
          status?: RequestStatus;
          partner_accepted?: boolean;
          partner_accepted_at?: string | null;
          partner_accepted_by?: string | null;
          requested_by?: string | null;
          reason?: string | null;
          rejection_reason?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          swap_pair_id?: string;
          personnel_id?: string;
          giving_slot_id?: string;
          receiving_slot_id?: string;
          swap_partner_id?: string;
          status?: RequestStatus;
          partner_accepted?: boolean;
          partner_accepted_at?: string | null;
          partner_accepted_by?: string | null;
          requested_by?: string | null;
          reason?: string | null;
          rejection_reason?: string | null;
          created_at?: string;
          updated_at?: string;
        };
      };
      swap_approvals: {
        Row: {
          id: string;
          duty_change_request_id: string;
          approval_order: number;
          approver_type: SwapApproverType;
          scope_unit_id: string | null;
          is_approver: boolean;
          status: RequestStatus;
          approved_by: string | null;
          approved_at: string | null;
          rejection_reason: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          duty_change_request_id: string;
          approval_order: number;
          approver_type: SwapApproverType;
          scope_unit_id?: string | null;
          is_approver?: boolean;
          status?: RequestStatus;
          approved_by?: string | null;
          approved_at?: string | null;
          rejection_reason?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          duty_change_request_id?: string;
          approval_order?: number;
          approver_type?: SwapApproverType;
          scope_unit_id?: string | null;
          is_approver?: boolean;
          status?: RequestStatus;
          approved_by?: string | null;
          approved_at?: string | null;
          rejection_reason?: string | null;
          created_at?: string;
        };
      };
      swap_recommendations: {
        Row: {
          id: string;
          duty_change_request_id: string;
          recommender_id: string;
          recommendation: SwapRecommendationType;
          comment: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          duty_change_request_id: string;
          recommender_id: string;
          recommendation: SwapRecommendationType;
          comment?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          duty_change_request_id?: string;
          recommender_id?: string;
          recommendation?: SwapRecommendationType;
          comment?: string | null;
          created_at?: string;
        };
      };
      duty_score_events: {
        Row: {
          id: string;
          personnel_id: string;
          duty_slot_id: string | null;
          unit_section_id: string;
          duty_type_name: string;
          points: number;
          date_earned: string;
          roster_month: string;
          approved_by: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          personnel_id: string;
          duty_slot_id?: string | null;
          unit_section_id: string;
          duty_type_name: string;
          points: number;
          date_earned: string;
          roster_month: string;
          approved_by?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          personnel_id?: string;
          duty_slot_id?: string | null;
          unit_section_id?: string;
          duty_type_name?: string;
          points?: number;
          date_earned?: string;
          roster_month?: string;
          approved_by?: string | null;
          created_at?: string;
        };
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      get_descendant_unit_ids: {
        Args: {
          parent_unit_id: string;
        };
        Returns: string[];
      };
      is_app_admin: {
        Args: {
          user_uuid: string;
        };
        Returns: boolean;
      };
      get_user_organization_ids: {
        Args: {
          user_uuid: string;
        };
        Returns: string[];
      };
    };
    Enums: {
      hierarchy_level: HierarchyLevel;
      role_name: RoleName;
      filter_mode: FilterMode;
      duty_slot_status: DutySlotStatus;
      request_status: RequestStatus;
      swap_approver_type: SwapApproverType;
      swap_recommendation_type: SwapRecommendationType;
    };
  };
}

// Convenience type aliases for table rows
export type Organization = Database["public"]["Tables"]["organizations"]["Row"];
export type Unit = Database["public"]["Tables"]["units"]["Row"];
export type Personnel = Database["public"]["Tables"]["personnel"]["Row"];
export type User = Database["public"]["Tables"]["users"]["Row"];
export type Role = Database["public"]["Tables"]["roles"]["Row"];
export type UserRole = Database["public"]["Tables"]["user_roles"]["Row"];
export type Qualification = Database["public"]["Tables"]["qualifications"]["Row"];
export type PersonnelQualification = Database["public"]["Tables"]["personnel_qualifications"]["Row"];
export type DutyType = Database["public"]["Tables"]["duty_types"]["Row"];
export type DutyValue = Database["public"]["Tables"]["duty_values"]["Row"];
export type DutyRequirement = Database["public"]["Tables"]["duty_requirements"]["Row"];
export type DutySlot = Database["public"]["Tables"]["duty_slots"]["Row"];
export type NonAvailability = Database["public"]["Tables"]["non_availability"]["Row"];
export type DutyChangeRequest = Database["public"]["Tables"]["duty_change_requests"]["Row"];
export type SwapApproval = Database["public"]["Tables"]["swap_approvals"]["Row"];
export type SwapRecommendation = Database["public"]["Tables"]["swap_recommendations"]["Row"];
export type DutyScoreEvent = Database["public"]["Tables"]["duty_score_events"]["Row"];

// Insert types
export type OrganizationInsert = Database["public"]["Tables"]["organizations"]["Insert"];
export type UnitInsert = Database["public"]["Tables"]["units"]["Insert"];
export type PersonnelInsert = Database["public"]["Tables"]["personnel"]["Insert"];
export type UserInsert = Database["public"]["Tables"]["users"]["Insert"];
export type UserRoleInsert = Database["public"]["Tables"]["user_roles"]["Insert"];
export type DutySlotInsert = Database["public"]["Tables"]["duty_slots"]["Insert"];
export type NonAvailabilityInsert = Database["public"]["Tables"]["non_availability"]["Insert"];
export type DutyChangeRequestInsert = Database["public"]["Tables"]["duty_change_requests"]["Insert"];
export type SwapApprovalInsert = Database["public"]["Tables"]["swap_approvals"]["Insert"];
export type SwapRecommendationInsert = Database["public"]["Tables"]["swap_recommendations"]["Insert"];
export type DutyScoreEventInsert = Database["public"]["Tables"]["duty_score_events"]["Insert"];
