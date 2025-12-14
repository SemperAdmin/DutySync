/**
 * Duty Thruster - Automated Fair Duty Scheduling Algorithm
 *
 * Core principles:
 * 1. Fairness: Personnel with lowest duty scores get assigned first
 * 2. Qualifications: Only assign personnel who meet duty requirements
 * 3. Availability: Respect non-availability periods
 * 4. Point calculation: Apply multipliers for weekends and holidays
 */

import type { DutySlot, DutyType, Personnel, DutyValue } from "@/types";
import {
  getDutyTypesByUnit,
  getPersonnelByUnit,
  getDutyRequirements,
  getDutyValueByDutyType,
  getActiveNonAvailability,
  hasQualification,
  getDutySlotsByDate,
  createDutySlot,
  updatePersonnel,
  clearDutySlotsInRange,
} from "./client-stores";

// US Federal Holidays (approximate - would need proper holiday calculation in production)
const FEDERAL_HOLIDAYS_2024 = [
  "2024-01-01", // New Year's Day
  "2024-01-15", // MLK Day
  "2024-02-19", // Presidents Day
  "2024-05-27", // Memorial Day
  "2024-06-19", // Juneteenth
  "2024-07-04", // Independence Day
  "2024-09-02", // Labor Day
  "2024-10-14", // Columbus Day
  "2024-11-11", // Veterans Day
  "2024-11-28", // Thanksgiving
  "2024-12-25", // Christmas
];

const FEDERAL_HOLIDAYS_2025 = [
  "2025-01-01", // New Year's Day
  "2025-01-20", // MLK Day
  "2025-02-17", // Presidents Day
  "2025-05-26", // Memorial Day
  "2025-06-19", // Juneteenth
  "2025-07-04", // Independence Day
  "2025-09-01", // Labor Day
  "2025-10-13", // Columbus Day
  "2025-11-11", // Veterans Day
  "2025-11-27", // Thanksgiving
  "2025-12-25", // Christmas
];

const HOLIDAYS = new Set([...FEDERAL_HOLIDAYS_2024, ...FEDERAL_HOLIDAYS_2025]);

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
 * Check if a date is a weekend (Saturday or Sunday)
 */
function isWeekend(date: Date): boolean {
  const day = date.getDay();
  return day === 0 || day === 6;
}

/**
 * Check if a date is a federal holiday
 */
function isHoliday(date: Date): boolean {
  const dateStr = date.toISOString().split("T")[0];
  return HOLIDAYS.has(dateStr);
}

/**
 * Calculate duty points for a given date
 */
function calculateDutyPoints(date: Date, dutyValue: DutyValue | undefined): number {
  const baseWeight = dutyValue?.base_weight ?? 1.0;
  const weekendMultiplier = dutyValue?.weekend_multiplier ?? 1.5;
  const holidayMultiplier = dutyValue?.holiday_multiplier ?? 2.0;

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
 * Check if personnel is available on a given date
 */
function isAvailable(personnelId: string, date: Date): boolean {
  const nonAvail = getActiveNonAvailability(personnelId, date);
  return !nonAvail;
}

/**
 * Check if personnel is already assigned on a given date
 */
function isAlreadyAssigned(personnelId: string, date: Date): boolean {
  const slots = getDutySlotsByDate(date);
  return slots.some((slot) => slot.personnel_id === personnelId);
}

/**
 * Get recent duty count for a personnel (last 7 days)
 */
function getRecentDutyCount(personnelId: string, referenceDate: Date): number {
  const sevenDaysAgo = new Date(referenceDate);
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  let count = 0;
  for (let d = new Date(sevenDaysAgo); d < referenceDate; d.setDate(d.getDate() + 1)) {
    const slots = getDutySlotsByDate(d);
    if (slots.some((slot) => slot.personnel_id === personnelId)) {
      count++;
    }
  }
  return count;
}

/**
 * Get eligible personnel for a duty type on a given date
 * Sorted by duty score (lowest first) for fairness
 */
function getEligiblePersonnel(
  dutyType: DutyType,
  date: Date
): EligiblePersonnel[] {
  const personnel = getPersonnelByUnit(dutyType.unit_section_id);

  const eligible: EligiblePersonnel[] = [];

  for (const person of personnel) {
    // Check availability
    if (!isAvailable(person.id, date)) {
      continue;
    }

    // Check if already assigned for this date
    if (isAlreadyAssigned(person.id, date)) {
      continue;
    }

    // Check requirements
    if (!meetsRequirements(person.id, dutyType.id)) {
      continue;
    }

    // Check rank requirements
    if (dutyType.required_rank_min || dutyType.required_rank_max) {
      // Simple rank comparison (would need proper rank ordering in production)
      // For now, we skip rank filtering in MVP
    }

    eligible.push({
      personnel: person,
      score: person.current_duty_score,
      recentDutyCount: getRecentDutyCount(person.id, date),
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
        // Get eligible personnel (re-fetch each time to account for updates)
        const eligible = getEligiblePersonnel(dutyType, date);

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

  // Create a temporary score map for preview
  const tempScores: Map<string, number> = new Map();
  const personnel = getPersonnelByUnit(unitId);
  personnel.forEach((p) => tempScores.set(p.id, p.current_duty_score));

  // Track assignments to prevent double-booking in preview
  const previewAssignments: Map<string, Set<string>> = new Map(); // date -> set of personnel IDs

  // Iterate through each date
  for (const date of generateDates(startDate, endDate)) {
    const dateKey = date.toISOString().split("T")[0];
    if (!previewAssignments.has(dateKey)) {
      previewAssignments.set(dateKey, new Set());
    }

    // Process each duty type
    for (const dutyType of dutyTypes) {
      const dutyValue = getDutyValueByDutyType(dutyType.id);
      const pointsForDay = calculateDutyPoints(date, dutyValue);

      // Fill required slots
      for (let slot = 0; slot < dutyType.slots_needed; slot++) {
        // Get eligible personnel with temp scores
        const eligibleList: EligiblePersonnel[] = [];
        const unitPersonnel = getPersonnelByUnit(dutyType.unit_section_id);

        for (const person of unitPersonnel) {
          // Check availability
          if (!isAvailable(person.id, date)) continue;

          // Check if already assigned (real or preview)
          if (isAlreadyAssigned(person.id, date)) continue;
          if (previewAssignments.get(dateKey)?.has(person.id)) continue;

          // Check requirements
          if (!meetsRequirements(person.id, dutyType.id)) continue;

          eligibleList.push({
            personnel: person,
            score: tempScores.get(person.id) ?? person.current_duty_score,
            recentDutyCount: 0, // Simplified for preview
          });
        }

        // Sort by score
        eligibleList.sort((a, b) => a.score - b.score);

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

        // Mark as assigned for this date
        previewAssignments.get(dateKey)?.add(selected.personnel.id);
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
