/**
 * Duty Thruster - Automated Fair Duty Scheduling Algorithm
 *
 * Core principles:
 * 1. Fairness: Personnel with lowest duty scores get assigned first
 * 2. Qualifications: Only assign personnel who meet duty requirements
 * 3. Availability: Respect non-availability periods
 * 4. Point calculation: Apply multipliers for weekends and holidays
 *
 * Performance optimizations:
 * - Pre-fetches all duty slots once and indexes by date for O(1) lookups
 * - Caches personnel data and assignments to avoid N+1 queries
 * - Uses Map structures for efficient membership checks
 */

import type { DutySlot, DutyType, Personnel, DutyValue } from "@/types";
import {
  getDutyTypesByUnit,
  getPersonnelByUnitWithDescendants,
  getDutyRequirements,
  getDutyValueByDutyType,
  getActiveNonAvailability,
  hasQualification,
  getAllDutySlots,
  createDutySlot,
  updatePersonnel,
  clearDutySlotsInRange,
} from "./client-stores";
import { DEFAULT_WEEKEND_MULTIPLIER, DEFAULT_HOLIDAY_MULTIPLIER } from "@/lib/constants";
import { isHoliday, isWeekend } from "@/lib/date-utils";

// ============ Performance Optimization: Indexed Data Structures ============

/**
 * Pre-computed data structures for fast lookups during scheduling
 */
interface SchedulingContext {
  // All duty slots indexed by date string (YYYY-MM-DD)
  slotsByDate: Map<string, DutySlot[]>;
  // Personnel assignments by date: Map<dateString, Set<personnelId>>
  assignmentsByDate: Map<string, Set<string>>;
  // All slots for recent duty counting
  allSlots: DutySlot[];
}

/**
 * Build scheduling context by pre-fetching and indexing all required data
 * This eliminates N+1 queries by fetching data once
 */
function buildSchedulingContext(): SchedulingContext {
  const allSlots = getAllDutySlots();
  const slotsByDate = new Map<string, DutySlot[]>();
  const assignmentsByDate = new Map<string, Set<string>>();

  // Index all slots by date for O(1) lookups
  for (const slot of allSlots) {
    const dateStr = new Date(slot.date_assigned).toISOString().split("T")[0];

    // Add to slotsByDate
    if (!slotsByDate.has(dateStr)) {
      slotsByDate.set(dateStr, []);
    }
    slotsByDate.get(dateStr)!.push(slot);

    // Add to assignmentsByDate
    if (slot.personnel_id) {
      if (!assignmentsByDate.has(dateStr)) {
        assignmentsByDate.set(dateStr, new Set());
      }
      assignmentsByDate.get(dateStr)!.add(slot.personnel_id);
    }
  }

  return { slotsByDate, assignmentsByDate, allSlots };
}

/**
 * Get slots for a specific date from the pre-indexed context (O(1))
 */
function getSlotsByDateFromContext(ctx: SchedulingContext, date: Date): DutySlot[] {
  const dateStr = date.toISOString().split("T")[0];
  return ctx.slotsByDate.get(dateStr) || [];
}

/**
 * Check if personnel is already assigned on date using indexed context (O(1))
 */
function isAlreadyAssignedFromContext(ctx: SchedulingContext, personnelId: string, date: Date): boolean {
  const dateStr = date.toISOString().split("T")[0];
  const assigned = ctx.assignmentsByDate.get(dateStr);
  return assigned ? assigned.has(personnelId) : false;
}

/**
 * Get recent duty count using pre-indexed context
 * Avoids fetching slots 7 times per personnel
 */
function getRecentDutyCountFromContext(ctx: SchedulingContext, personnelId: string, referenceDate: Date): number {
  let count = 0;
  const refDateStr = referenceDate.toISOString().split("T")[0];

  for (let i = 1; i <= 7; i++) {
    const checkDate = new Date(referenceDate);
    checkDate.setDate(checkDate.getDate() - i);
    const dateStr = checkDate.toISOString().split("T")[0];

    // Skip if checking a date at or after reference
    if (dateStr >= refDateStr) continue;

    const assigned = ctx.assignmentsByDate.get(dateStr);
    if (assigned?.has(personnelId)) {
      count++;
    }
  }
  return count;
}

/**
 * Add an assignment to the context (for tracking during scheduling)
 */
function addAssignmentToContext(ctx: SchedulingContext, personnelId: string, date: Date): void {
  const dateStr = date.toISOString().split("T")[0];
  if (!ctx.assignmentsByDate.has(dateStr)) {
    ctx.assignmentsByDate.set(dateStr, new Set());
  }
  ctx.assignmentsByDate.get(dateStr)!.add(personnelId);
}

export interface ScheduleRequest {
  unitId: string;
  startDate: Date;
  endDate: Date;
  assignedBy: string;
  clearExisting?: boolean;
}

export interface ScheduleResult {
  success: boolean;
  slotsCreated: number;
  slotsSkipped: number;
  errors: string[];
  warnings: string[];
  slots: DutySlot[];
}

interface EligiblePersonnel {
  personnel: Personnel;
  score: number;
  recentDutyCount: number;
}

/**
 * Calculate duty points for a given date
 */
function calculateDutyPoints(date: Date, dutyValue: DutyValue | undefined): number {
  const baseWeight = dutyValue?.base_weight ?? 1.0;
  const weekendMultiplier = dutyValue?.weekend_multiplier ?? DEFAULT_WEEKEND_MULTIPLIER;
  const holidayMultiplier = dutyValue?.holiday_multiplier ?? DEFAULT_HOLIDAY_MULTIPLIER;

  if (isHoliday(date)) {
    return baseWeight * holidayMultiplier;
  }
  if (isWeekend(date)) {
    return baseWeight * weekendMultiplier;
  }
  return baseWeight;
}

/**
 * Check if personnel meets the requirements for a duty type
 */
function meetsRequirements(personnelId: string, dutyTypeId: string): boolean {
  const requirements = getDutyRequirements(dutyTypeId);

  // If no requirements, anyone can do it
  if (requirements.length === 0) {
    return true;
  }

  // Check all required qualifications
  return requirements.every((req) =>
    hasQualification(personnelId, req.required_qual_name)
  );
}

/**
 * Helper function to check if a value matches a filter (include/exclude)
 * Returns true if the person passes the filter check
 */
export function matchesFilter(
  mode: 'include' | 'exclude' | null | undefined,
  values: string[] | null | undefined,
  personValue: string
): boolean {
  if (!mode || !values || values.length === 0) {
    return true; // No filter applied, so person is eligible
  }
  const matches = values.includes(personValue);
  return mode === 'include' ? matches : !matches;
}

/**
 * Check if a person is eligible for a duty type on a given date
 * Centralized eligibility logic used by both scheduling and preview
 */
export function isPersonnelEligibleForDuty(
  person: Personnel,
  dutyType: DutyType,
  date: Date,
  additionalAssignedIds?: Set<string>
): boolean {
  // Check availability (not on non-availability)
  if (!isAvailable(person.id, date)) {
    return false;
  }

  // Check if already assigned for this date
  if (isAlreadyAssigned(person.id, date)) {
    return false;
  }

  // Check additional assignments (for preview mode)
  if (additionalAssignedIds?.has(person.id)) {
    return false;
  }

  // Check requirements (qualifications)
  if (!meetsRequirements(person.id, dutyType.id)) {
    return false;
  }

  // Check rank filter criteria from duty type
  if (!matchesFilter(dutyType.rank_filter_mode, dutyType.rank_filter_values, person.rank)) {
    return false;
  }

  // Check section filter criteria from duty type
  if (!matchesFilter(dutyType.section_filter_mode, dutyType.section_filter_values, person.unit_section_id)) {
    return false;
  }

  return true;
}

/**
 * Check if personnel is available on a given date
 */
function isAvailable(personnelId: string, date: Date): boolean {
  const nonAvail = getActiveNonAvailability(personnelId, date);
  return !nonAvail;
}

/**
 * Check if personnel is already assigned on a given date
 * @deprecated Use isAlreadyAssignedFromContext for better performance
 */
function isAlreadyAssigned(personnelId: string, date: Date, ctx?: SchedulingContext): boolean {
  if (ctx) {
    return isAlreadyAssignedFromContext(ctx, personnelId, date);
  }
  // Fallback for compatibility (used by isPersonnelEligibleForDuty in non-scheduling contexts)
  const allSlots = getAllDutySlots();
  const dateStr = date.toISOString().split("T")[0];
  return allSlots.some((slot) => {
    const slotDateStr = new Date(slot.date_assigned).toISOString().split("T")[0];
    return slotDateStr === dateStr && slot.personnel_id === personnelId;
  });
}

/**
 * Get eligible personnel for a duty type on a given date
 * Sorted by duty score (lowest first) for fairness
 * Uses pre-indexed context for O(1) lookups
 */
function getEligiblePersonnel(
  dutyType: DutyType,
  date: Date,
  ctx: SchedulingContext
): EligiblePersonnel[] {
  // Get personnel from the duty type's unit and all its child units
  const personnel = getPersonnelByUnitWithDescendants(dutyType.unit_section_id);

  const eligible: EligiblePersonnel[] = [];

  for (const person of personnel) {
    // Check availability (not on non-availability)
    if (!isAvailable(person.id, date)) {
      continue;
    }

    // Check if already assigned for this date using context (O(1))
    if (isAlreadyAssignedFromContext(ctx, person.id, date)) {
      continue;
    }

    // Check requirements (qualifications)
    if (!meetsRequirements(person.id, dutyType.id)) {
      continue;
    }

    // Check rank filter criteria from duty type
    if (!matchesFilter(dutyType.rank_filter_mode, dutyType.rank_filter_values, person.rank)) {
      continue;
    }

    // Check section filter criteria from duty type
    if (!matchesFilter(dutyType.section_filter_mode, dutyType.section_filter_values, person.unit_section_id)) {
      continue;
    }

    eligible.push({
      personnel: person,
      score: person.current_duty_score,
      // Use context-based recent duty count (O(7) instead of O(7 * n))
      recentDutyCount: getRecentDutyCountFromContext(ctx, person.id, date),
    });
  }

  // Sort by:
  // 1. Current duty score (ascending - lowest first for fairness)
  // 2. Recent duty count (ascending - fewer recent duties first)
  // 3. Random tie-breaker for equal scores
  eligible.sort((a, b) => {
    if (a.score !== b.score) {
      return a.score - b.score;
    }
    if (a.recentDutyCount !== b.recentDutyCount) {
      return a.recentDutyCount - b.recentDutyCount;
    }
    return Math.random() - 0.5;
  });

  return eligible;
}

/**
 * Generate dates between start and end (inclusive)
 */
function* generateDates(startDate: Date, endDate: Date): Generator<Date> {
  const current = new Date(startDate);
  while (current <= endDate) {
    yield new Date(current);
    current.setDate(current.getDate() + 1);
  }
}

/**
 * Main scheduling function - the Duty Thruster algorithm
 * Performance optimized: Pre-fetches all data once and uses indexed lookups
 */
export function generateSchedule(request: ScheduleRequest): ScheduleResult {
  const { unitId, startDate, endDate, assignedBy, clearExisting } = request;
  const result: ScheduleResult = {
    success: true,
    slotsCreated: 0,
    slotsSkipped: 0,
    errors: [],
    warnings: [],
    slots: [],
  };

  // Clear existing slots if requested
  if (clearExisting) {
    const cleared = clearDutySlotsInRange(startDate, endDate, unitId);
    if (cleared > 0) {
      result.warnings.push(`Cleared ${cleared} existing duty slots`);
    }
  }

  // Get all active duty types for this unit
  const dutyTypes = getDutyTypesByUnit(unitId).filter((dt) => dt.is_active);

  if (dutyTypes.length === 0) {
    result.warnings.push("No active duty types found for this unit");
    return result;
  }

  // Build scheduling context ONCE at the start (major performance optimization)
  // This pre-fetches all duty slots and indexes them for O(1) lookups
  const ctx = buildSchedulingContext();

  // Track personnel score updates for this run
  const scoreUpdates: Map<string, number> = new Map();

  // Iterate through each date
  for (const date of generateDates(startDate, endDate)) {
    // Process each duty type
    for (const dutyType of dutyTypes) {
      const dutyValue = getDutyValueByDutyType(dutyType.id);
      const pointsForDay = calculateDutyPoints(date, dutyValue);

      // Fill required slots
      for (let slot = 0; slot < dutyType.slots_needed; slot++) {
        // Get eligible personnel using indexed context (O(1) lookups)
        const eligible = getEligiblePersonnel(dutyType, date, ctx);

        if (eligible.length === 0) {
          result.warnings.push(
            `No eligible personnel for ${dutyType.duty_name} on ${date.toISOString().split("T")[0]} (slot ${slot + 1})`
          );
          result.slotsSkipped++;
          continue;
        }

        // Select the most eligible person (lowest score)
        const selected = eligible[0];
        const now = new Date();

        // Create the duty slot
        const newSlot: DutySlot = {
          id: crypto.randomUUID(),
          duty_type_id: dutyType.id,
          personnel_id: selected.personnel.id,
          date_assigned: date,
          assigned_by: assignedBy,
          duty_points_earned: pointsForDay,
          status: "scheduled",
          created_at: now,
          updated_at: now,
        };

        createDutySlot(newSlot);
        result.slots.push(newSlot);
        result.slotsCreated++;

        // Update context to track this new assignment for subsequent iterations
        addAssignmentToContext(ctx, selected.personnel.id, date);

        // Update personnel's duty score
        const currentScore = scoreUpdates.get(selected.personnel.id) ?? selected.personnel.current_duty_score;
        const newScore = currentScore + pointsForDay;
        scoreUpdates.set(selected.personnel.id, newScore);

        // Update in store immediately so next iteration sees it
        updatePersonnel(selected.personnel.id, {
          current_duty_score: newScore,
        });
      }
    }
  }

  // Generate summary
  if (result.slotsCreated === 0 && result.slotsSkipped > 0) {
    result.success = false;
    result.errors.push("Could not fill any duty slots - check personnel availability and qualifications");
  }

  return result;
}

/**
 * Preview schedule without actually creating slots
 * Useful for showing users what the schedule would look like
 * Performance optimized: Uses indexed context for O(1) lookups
 */
export function previewSchedule(request: ScheduleRequest): ScheduleResult {
  const { unitId, startDate, endDate, assignedBy } = request;
  const result: ScheduleResult = {
    success: true,
    slotsCreated: 0,
    slotsSkipped: 0,
    errors: [],
    warnings: [],
    slots: [],
  };

  // Get all active duty types for this unit
  const dutyTypes = getDutyTypesByUnit(unitId).filter((dt) => dt.is_active);

  if (dutyTypes.length === 0) {
    result.warnings.push("No active duty types found for this unit");
    return result;
  }

  // Build scheduling context ONCE (major performance optimization)
  const ctx = buildSchedulingContext();

  // Create a temporary score map for preview
  const tempScores: Map<string, number> = new Map();
  const personnel = getPersonnelByUnitWithDescendants(unitId);
  personnel.forEach((p) => tempScores.set(p.id, p.current_duty_score));

  // Iterate through each date
  for (const date of generateDates(startDate, endDate)) {
    const dateKey = date.toISOString().split("T")[0];

    // Process each duty type
    for (const dutyType of dutyTypes) {
      const dutyValue = getDutyValueByDutyType(dutyType.id);
      const pointsForDay = calculateDutyPoints(date, dutyValue);

      // Get personnel for this duty type's unit ONCE per duty type (not per slot)
      const unitPersonnel = getPersonnelByUnitWithDescendants(dutyType.unit_section_id);

      // Fill required slots
      for (let slot = 0; slot < dutyType.slots_needed; slot++) {
        // Get eligible personnel with temp scores
        const eligibleList: EligiblePersonnel[] = [];

        for (const person of unitPersonnel) {
          // Check availability
          if (!isAvailable(person.id, date)) {
            continue;
          }

          // Check if already assigned using context (O(1))
          if (isAlreadyAssignedFromContext(ctx, person.id, date)) {
            continue;
          }

          // Check requirements
          if (!meetsRequirements(person.id, dutyType.id)) {
            continue;
          }

          // Check filters
          if (!matchesFilter(dutyType.rank_filter_mode, dutyType.rank_filter_values, person.rank)) {
            continue;
          }
          if (!matchesFilter(dutyType.section_filter_mode, dutyType.section_filter_values, person.unit_section_id)) {
            continue;
          }

          eligibleList.push({
            personnel: person,
            score: tempScores.get(person.id) ?? person.current_duty_score,
            recentDutyCount: getRecentDutyCountFromContext(ctx, person.id, date),
          });
        }

        // Sort by score then recent duty count
        eligibleList.sort((a, b) => {
          if (a.score !== b.score) return a.score - b.score;
          return a.recentDutyCount - b.recentDutyCount;
        });

        if (eligibleList.length === 0) {
          result.warnings.push(
            `No eligible personnel for ${dutyType.duty_name} on ${dateKey} (slot ${slot + 1})`
          );
          result.slotsSkipped++;
          continue;
        }

        // Select the most eligible person
        const selected = eligibleList[0];

        // Create preview slot (not saved)
        const previewSlot: DutySlot = {
          id: `preview-${crypto.randomUUID()}`,
          duty_type_id: dutyType.id,
          personnel_id: selected.personnel.id,
          date_assigned: date,
          assigned_by: assignedBy,
          duty_points_earned: pointsForDay,
          status: "scheduled",
          created_at: new Date(),
          updated_at: new Date(),
        };

        result.slots.push(previewSlot);
        result.slotsCreated++;

        // Update temp score
        const currentScore = tempScores.get(selected.personnel.id) ?? 0;
        tempScores.set(selected.personnel.id, currentScore + pointsForDay);

        // Update context to track this preview assignment
        addAssignmentToContext(ctx, selected.personnel.id, date);
      }
    }
  }

  return result;
}

/**
 * Get day type label for display
 */
export function getDayType(date: Date): "weekday" | "weekend" | "holiday" {
  if (isHoliday(date)) return "holiday";
  if (isWeekend(date)) return "weekend";
  return "weekday";
}
