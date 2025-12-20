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

import type { DutySlot, DutyType, Personnel, DutyValue, DateString } from "@/types";
import {
  getDutyTypesByUnitWithDescendants,
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
import {
  isHolidayStr,
  isWeekendStr,
  formatDateToString,
  addDaysToDateString,
  getTodayString,
} from "@/lib/date-utils";

// ============ Performance Optimization: Indexed Data Structures ============

/**
 * Normalize a date string to DateString (YYYY-MM-DD) format.
 * Handles both ISO timestamps (2025-12-01T00:00:00.000Z) and DateString (2025-12-01) formats.
 * This is critical for slot limit validation - dates must match exactly.
 */
function normalizeDateToDateString(date: string): DateString {
  // If it's already a DateString (YYYY-MM-DD), return as-is
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return date as DateString;
  }
  // Handle ISO timestamp format by extracting the date part
  if (date.includes('T')) {
    return date.split('T')[0] as DateString;
  }
  // Fallback: try to extract YYYY-MM-DD pattern
  const match = date.match(/(\d{4}-\d{2}-\d{2})/);
  if (match) {
    return match[1] as DateString;
  }
  // Last resort: return as-is (will likely fail comparison but won't crash)
  return date as DateString;
}

/**
 * Pre-computed data structures for fast lookups during scheduling
 */
interface SchedulingContext {
  // All duty slots indexed by date string (YYYY-MM-DD)
  slotsByDate: Map<DateString, DutySlot[]>;
  // Personnel assignments by date: Map<dateString, Set<personnelId>>
  assignmentsByDate: Map<DateString, Set<string>>;
  // All slots for recent duty counting
  allSlots: DutySlot[];
}

/**
 * Build scheduling context by pre-fetching and indexing all required data
 * This eliminates N+1 queries by fetching data once
 */
function buildSchedulingContext(): SchedulingContext {
  const allSlots = getAllDutySlots();
  const slotsByDate = new Map<DateString, DutySlot[]>();
  const assignmentsByDate = new Map<DateString, Set<string>>();

  // Index all slots by date for O(1) lookups
  for (const slot of allSlots) {
    // Normalize date to DateString format (handles both ISO timestamps and DateString)
    const dateStr = normalizeDateToDateString(slot.date_assigned);

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
function getSlotsByDateFromContext(ctx: SchedulingContext, dateStr: DateString): DutySlot[] {
  return ctx.slotsByDate.get(dateStr) || [];
}

/**
 * Check if personnel is already assigned on date using indexed context (O(1))
 */
function isAlreadyAssignedFromContext(ctx: SchedulingContext, personnelId: string, dateStr: DateString): boolean {
  const assigned = ctx.assignmentsByDate.get(dateStr);
  return assigned ? assigned.has(personnelId) : false;
}

/**
 * Get recent duty count using pre-indexed context
 * Avoids fetching slots 7 times per personnel
 */
function getRecentDutyCountFromContext(ctx: SchedulingContext, personnelId: string, referenceDateStr: DateString): number {
  let count = 0;

  for (let i = 1; i <= 7; i++) {
    const dateStr = addDaysToDateString(referenceDateStr, -i);

    // Skip if checking a date at or after reference
    if (dateStr >= referenceDateStr) continue;

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
function addAssignmentToContext(ctx: SchedulingContext, personnelId: string, dateStr: DateString): void {
  if (!ctx.assignmentsByDate.has(dateStr)) {
    ctx.assignmentsByDate.set(dateStr, new Set());
  }
  ctx.assignmentsByDate.get(dateStr)!.add(personnelId);
}

/**
 * Get existing slot count for a duty type on a specific date (O(1) lookup)
 */
function getExistingSlotsForDutyType(ctx: SchedulingContext, dutyTypeId: string, dateStr: DateString): number {
  const slotsOnDate = ctx.slotsByDate.get(dateStr) || [];
  return slotsOnDate.filter(slot => slot.duty_type_id === dutyTypeId).length;
}

/**
 * Add a slot to the context for tracking (prevents exceeding slot limits)
 */
function addSlotToContext(ctx: SchedulingContext, slot: DutySlot): void {
  // Normalize date to DateString format (handles both ISO timestamps and DateString)
  const dateStr = normalizeDateToDateString(slot.date_assigned);
  if (!ctx.slotsByDate.has(dateStr)) {
    ctx.slotsByDate.set(dateStr, []);
  }
  ctx.slotsByDate.get(dateStr)!.push(slot);
}

export interface ScheduleRequest {
  unitId: string;
  startDate: DateString;
  endDate: DateString;
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
 * Exported for reuse in other modules
 */
export function calculateDutyPoints(dateStr: DateString, dutyValue: DutyValue | undefined): number {
  const baseWeight = dutyValue?.base_weight ?? 1.0;
  const weekendMultiplier = dutyValue?.weekend_multiplier ?? DEFAULT_WEEKEND_MULTIPLIER;
  const holidayMultiplier = dutyValue?.holiday_multiplier ?? DEFAULT_HOLIDAY_MULTIPLIER;

  if (isHolidayStr(dateStr)) {
    return baseWeight * holidayMultiplier;
  }
  if (isWeekendStr(dateStr)) {
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
  dateStr: DateString,
  additionalAssignedIds?: Set<string>
): boolean {
  // Check availability (not on non-availability)
  if (!isAvailable(person.id, dateStr)) {
    return false;
  }

  // Check if already assigned for this date
  if (isAlreadyAssigned(person.id, dateStr)) {
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
function isAvailable(personnelId: string, dateStr: DateString): boolean {
  const nonAvail = getActiveNonAvailability(personnelId, dateStr);
  return !nonAvail;
}

/**
 * Check if personnel is already assigned on a given date
 * @deprecated Use isAlreadyAssignedFromContext for better performance
 */
function isAlreadyAssigned(personnelId: string, dateStr: DateString, ctx?: SchedulingContext): boolean {
  if (ctx) {
    return isAlreadyAssignedFromContext(ctx, personnelId, dateStr);
  }
  // Fallback for compatibility (used by isPersonnelEligibleForDuty in non-scheduling contexts)
  const allSlots = getAllDutySlots();
  // date_assigned is already a DateString, so just compare directly
  return allSlots.some((slot) => {
    return slot.date_assigned === dateStr && slot.personnel_id === personnelId;
  });
}

/**
 * Get eligible personnel for a duty type on a given date
 * Sorted by duty score (lowest first) for fairness
 * Uses pre-indexed context for O(1) lookups
 */
function getEligiblePersonnel(
  dutyType: DutyType,
  dateStr: DateString,
  ctx: SchedulingContext
): EligiblePersonnel[] {
  // Get personnel from the duty type's unit and all its child units
  const personnel = getPersonnelByUnitWithDescendants(dutyType.unit_section_id);

  const eligible: EligiblePersonnel[] = [];

  for (const person of personnel) {
    // Check availability (not on non-availability)
    if (!isAvailable(person.id, dateStr)) {
      continue;
    }

    // Check if already assigned for this date using context (O(1))
    if (isAlreadyAssignedFromContext(ctx, person.id, dateStr)) {
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
      recentDutyCount: getRecentDutyCountFromContext(ctx, person.id, dateStr),
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
 * Generate date strings between start and end (inclusive)
 * Uses DateString for timezone-safe date iteration
 */
function* generateDateStrings(startDate: DateString, endDate: DateString): Generator<DateString> {
  let current = startDate;

  while (current <= endDate) {
    yield current;
    current = addDaysToDateString(current, 1);
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
  const dutyTypes = getDutyTypesByUnitWithDescendants(unitId).filter((dt) => dt.is_active);

  if (dutyTypes.length === 0) {
    result.warnings.push("No active duty types found for this unit");
    return result;
  }

  // Build scheduling context ONCE at the start (major performance optimization)
  // This pre-fetches all duty slots and indexes them for O(1) lookups
  const ctx = buildSchedulingContext();

  // Track personnel score updates for this run
  const scoreUpdates: Map<string, number> = new Map();

  // Iterate through each date using DateString
  for (const dateStr of generateDateStrings(startDate, endDate)) {
    // Process each duty type
    for (const dutyType of dutyTypes) {
      const dutyValue = getDutyValueByDutyType(dutyType.id);
      const pointsForDay = calculateDutyPoints(dateStr, dutyValue);

      // Check how many slots already exist for this duty type on this date
      const existingSlotCount = getExistingSlotsForDutyType(ctx, dutyType.id, dateStr);
      const slotsToCreate = dutyType.slots_needed - existingSlotCount;

      if (slotsToCreate <= 0) {
        // Already have enough slots for this duty type on this date
        continue;
      }

      // Fill remaining required slots
      for (let slot = 0; slot < slotsToCreate; slot++) {
        // Get eligible personnel using indexed context (O(1) lookups)
        const eligible = getEligiblePersonnel(dutyType, dateStr, ctx);

        if (eligible.length === 0) {
          result.warnings.push(
            `No eligible personnel for ${dutyType.duty_name} on ${dateStr} (slot ${existingSlotCount + slot + 1})`
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
          date_assigned: dateStr, // DateString
          assigned_by: assignedBy,
          points: pointsForDay,
          status: "scheduled",
          swapped_at: null,
          swapped_from_personnel_id: null,
          swap_pair_id: null,
          created_at: now,
          updated_at: now,
        };

        createDutySlot(newSlot);
        result.slots.push(newSlot);
        result.slotsCreated++;

        // Update context to track this new assignment and slot
        addAssignmentToContext(ctx, selected.personnel.id, dateStr);
        addSlotToContext(ctx, newSlot);

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
  const dutyTypes = getDutyTypesByUnitWithDescendants(unitId).filter((dt) => dt.is_active);

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

  // Iterate through each date using DateString
  for (const dateStr of generateDateStrings(startDate, endDate)) {
    // Process each duty type
    for (const dutyType of dutyTypes) {
      const dutyValue = getDutyValueByDutyType(dutyType.id);
      const pointsForDay = calculateDutyPoints(dateStr, dutyValue);

      // Check how many slots already exist for this duty type on this date
      const existingSlotCount = getExistingSlotsForDutyType(ctx, dutyType.id, dateStr);
      const slotsToCreate = dutyType.slots_needed - existingSlotCount;

      if (slotsToCreate <= 0) {
        // Already have enough slots for this duty type on this date
        continue;
      }

      // Get personnel for this duty type's unit ONCE per duty type (not per slot)
      const unitPersonnel = getPersonnelByUnitWithDescendants(dutyType.unit_section_id);

      // Fill remaining required slots
      for (let slot = 0; slot < slotsToCreate; slot++) {
        // Get eligible personnel with temp scores
        const eligibleList: EligiblePersonnel[] = [];

        for (const person of unitPersonnel) {
          // Check availability
          if (!isAvailable(person.id, dateStr)) {
            continue;
          }

          // Check if already assigned using context (O(1))
          if (isAlreadyAssignedFromContext(ctx, person.id, dateStr)) {
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
            recentDutyCount: getRecentDutyCountFromContext(ctx, person.id, dateStr),
          });
        }

        // Sort by score then recent duty count
        eligibleList.sort((a, b) => {
          if (a.score !== b.score) return a.score - b.score;
          return a.recentDutyCount - b.recentDutyCount;
        });

        if (eligibleList.length === 0) {
          result.warnings.push(
            `No eligible personnel for ${dutyType.duty_name} on ${dateStr} (slot ${existingSlotCount + slot + 1})`
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
          date_assigned: dateStr, // DateString
          assigned_by: assignedBy,
          points: pointsForDay,
          status: "scheduled",
          swapped_at: null,
          swapped_from_personnel_id: null,
          swap_pair_id: null,
          created_at: new Date(),
          updated_at: new Date(),
        };

        result.slots.push(previewSlot);
        result.slotsCreated++;

        // Update temp score
        const currentScore = tempScores.get(selected.personnel.id) ?? 0;
        tempScores.set(selected.personnel.id, currentScore + pointsForDay);

        // Update context to track this preview assignment and slot
        addAssignmentToContext(ctx, selected.personnel.id, dateStr);
        addSlotToContext(ctx, previewSlot);
      }
    }
  }

  return result;
}

/**
 * Get day type label for display
 */
export function getDayType(dateStr: DateString): "weekday" | "weekend" | "holiday" {
  if (isHolidayStr(dateStr)) return "holiday";
  if (isWeekendStr(dateStr)) return "weekend";
  return "weekday";
}
