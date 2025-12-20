/**
 * Shared date utilities for holiday and weekend calculations
 * Centralized to ensure consistency across the application
 *
 * IMPORTANT: This module uses DateString (YYYY-MM-DD format) for all date-only operations.
 * DateStrings are timezone-agnostic - "2025-12-31" means December 31st everywhere,
 * regardless of the user's timezone. This prevents the common issue where dates
 * shift when parsed as UTC midnight in different timezones.
 */

import type { DateString } from "@/types";

// ============ Federal Holidays ============
// US Federal Holidays for score calculation
// Note: When a holiday falls on Saturday, it's observed on Friday.
// When it falls on Sunday, it's observed on Monday.

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

const FEDERAL_HOLIDAYS_2026 = [
  "2026-01-01", // New Year's Day
  "2026-01-19", // MLK Day (3rd Monday of January)
  "2026-02-16", // Presidents Day (3rd Monday of February)
  "2026-05-25", // Memorial Day (Last Monday of May)
  "2026-06-19", // Juneteenth
  "2026-07-03", // Independence Day (observed, July 4 is Saturday)
  "2026-09-07", // Labor Day (1st Monday of September)
  "2026-10-12", // Columbus Day (2nd Monday of October)
  "2026-11-11", // Veterans Day
  "2026-11-26", // Thanksgiving (4th Thursday of November)
  "2026-12-25", // Christmas
];

const FEDERAL_HOLIDAYS_2027 = [
  "2027-01-01", // New Year's Day
  "2027-01-18", // MLK Day (3rd Monday of January)
  "2027-02-15", // Presidents Day (3rd Monday of February)
  "2027-05-31", // Memorial Day (Last Monday of May)
  "2027-06-18", // Juneteenth (observed, June 19 is Saturday)
  "2027-07-05", // Independence Day (observed, July 4 is Sunday)
  "2027-09-06", // Labor Day (1st Monday of September)
  "2027-10-11", // Columbus Day (2nd Monday of October)
  "2027-11-11", // Veterans Day
  "2027-11-25", // Thanksgiving (4th Thursday of November)
  "2027-12-24", // Christmas (observed, Dec 25 is Saturday)
  "2027-12-31", // New Year's Day 2028 (observed, Jan 1 2028 is Saturday)
];

const FEDERAL_HOLIDAYS_2028 = [
  // New Year's Day 2028 is observed on Dec 31, 2027 (in FEDERAL_HOLIDAYS_2027)
  "2028-01-17", // MLK Day (3rd Monday of January)
  "2028-02-21", // Presidents Day (3rd Monday of February)
  "2028-05-29", // Memorial Day (Last Monday of May)
  "2028-06-19", // Juneteenth
  "2028-07-04", // Independence Day
  "2028-09-04", // Labor Day (1st Monday of September)
  "2028-10-09", // Columbus Day (2nd Monday of October)
  "2028-11-10", // Veterans Day (observed, Nov 11 is Saturday)
  "2028-11-23", // Thanksgiving (4th Thursday of November)
  "2028-12-25", // Christmas
];

const FEDERAL_HOLIDAYS_2029 = [
  "2029-01-01", // New Year's Day
  "2029-01-15", // MLK Day (3rd Monday of January)
  "2029-02-19", // Presidents Day (3rd Monday of February)
  "2029-05-28", // Memorial Day (Last Monday of May)
  "2029-06-19", // Juneteenth
  "2029-07-04", // Independence Day
  "2029-09-03", // Labor Day (1st Monday of September)
  "2029-10-08", // Columbus Day (2nd Monday of October)
  "2029-11-12", // Veterans Day (observed, Nov 11 is Sunday)
  "2029-11-22", // Thanksgiving (4th Thursday of November)
  "2029-12-25", // Christmas
];

const FEDERAL_HOLIDAYS_2030 = [
  "2030-01-01", // New Year's Day
  "2030-01-21", // MLK Day (3rd Monday of January)
  "2030-02-18", // Presidents Day (3rd Monday of February)
  "2030-05-27", // Memorial Day (Last Monday of May)
  "2030-06-19", // Juneteenth
  "2030-07-04", // Independence Day
  "2030-09-02", // Labor Day (1st Monday of September)
  "2030-10-14", // Columbus Day (2nd Monday of October)
  "2030-11-11", // Veterans Day
  "2030-11-28", // Thanksgiving (4th Thursday of November)
  "2030-12-25", // Christmas
];

const FEDERAL_HOLIDAYS = new Set([
  ...FEDERAL_HOLIDAYS_2024,
  ...FEDERAL_HOLIDAYS_2025,
  ...FEDERAL_HOLIDAYS_2026,
  ...FEDERAL_HOLIDAYS_2027,
  ...FEDERAL_HOLIDAYS_2028,
  ...FEDERAL_HOLIDAYS_2029,
  ...FEDERAL_HOLIDAYS_2030,
]);

/**
 * Format a date to YYYY-MM-DD string using local timezone
 * Avoids timezone issues that occur with toISOString()
 */
export function formatDateToString(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Check if a date is a US federal holiday
 */
export function isHoliday(date: Date): boolean {
  const dateStr = formatDateToString(date);
  return FEDERAL_HOLIDAYS.has(dateStr);
}

/**
 * Check if a date is a weekend (Saturday or Sunday)
 */
export function isWeekend(date: Date): boolean {
  const dayOfWeek = date.getDay();
  return dayOfWeek === 0 || dayOfWeek === 6;
}

/**
 * Get all federal holidays as a Set of date strings
 * Useful for bulk operations
 */
export function getFederalHolidaysSet(): Set<string> {
  return FEDERAL_HOLIDAYS;
}

/**
 * Parse a date string (YYYY-MM-DD) as local midnight.
 * This avoids timezone issues that occur with new Date("2025-12-31")
 * which is parsed as UTC midnight and can shift dates in negative UTC offsets.
 *
 * @param dateStr - Date string in YYYY-MM-DD format
 * @returns Date object at local midnight
 */
export function parseLocalDate(dateStr: string): Date {
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(year, month - 1, day);
}

/**
 * Normalize a date to local midnight.
 * Useful for date comparisons where time component should be ignored.
 *
 * @param date - Any Date object
 * @returns Date object at local midnight of the same day
 */
export function normalizeToLocalMidnight(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

// ============ String-Based Date Utilities ============
// These functions work directly with DateString (YYYY-MM-DD) format
// without converting to Date objects, avoiding all timezone issues.

/**
 * Get today's date as a DateString (YYYY-MM-DD)
 * Uses local timezone to determine "today"
 */
export function getTodayString(): DateString {
  return formatDateToString(new Date());
}

/**
 * Check if a DateString is a US federal holiday
 * @param dateStr - Date string in YYYY-MM-DD format
 */
export function isHolidayStr(dateStr: DateString): boolean {
  return FEDERAL_HOLIDAYS.has(dateStr);
}

/**
 * Check if a DateString is a weekend (Saturday or Sunday)
 * @param dateStr - Date string in YYYY-MM-DD format
 */
export function isWeekendStr(dateStr: DateString): boolean {
  // Parse the date string to get the day of week
  // Using parseLocalDate ensures correct day calculation
  const date = parseLocalDate(dateStr);
  const dayOfWeek = date.getDay();
  return dayOfWeek === 0 || dayOfWeek === 6;
}

/**
 * Add days to a DateString and return a new DateString
 * @param dateStr - Date string in YYYY-MM-DD format
 * @param days - Number of days to add (can be negative)
 */
export function addDaysToDateString(dateStr: DateString, days: number): DateString {
  const date = parseLocalDate(dateStr);
  date.setDate(date.getDate() + days);
  return formatDateToString(date);
}

/**
 * Compare two DateStrings
 * @returns negative if a < b, 0 if equal, positive if a > b
 */
export function compareDateStrings(a: DateString, b: DateString): number {
  // String comparison works correctly for YYYY-MM-DD format
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/**
 * Check if a DateString is within a range (inclusive)
 * @param dateStr - Date to check
 * @param startDate - Start of range
 * @param endDate - End of range
 */
export function isDateInRange(dateStr: DateString, startDate: DateString, endDate: DateString): boolean {
  return dateStr >= startDate && dateStr <= endDate;
}

/**
 * Generate an array of DateStrings between start and end (inclusive)
 * @param startDate - Start date string
 * @param endDate - End date string
 */
export function generateDateStrings(startDate: DateString, endDate: DateString): DateString[] {
  const dates: DateString[] = [];
  let current = startDate;

  while (current <= endDate) {
    dates.push(current);
    current = addDaysToDateString(current, 1);
  }

  return dates;
}

/**
 * Generator version of generateDateStrings for memory efficiency with large ranges
 */
export function* generateDateStringsIterator(startDate: DateString, endDate: DateString): Generator<DateString> {
  let current = startDate;

  while (current <= endDate) {
    yield current;
    current = addDaysToDateString(current, 1);
  }
}

/**
 * Format a DateString for display using various formats
 * @param dateStr - Date string in YYYY-MM-DD format
 * @param format - Display format: 'short' (Dec 31), 'medium' (Dec 31, 2024), 'long' (December 31, 2024), 'weekday' (Mon Dec 31)
 */
export function formatDateForDisplay(dateStr: DateString, format: 'short' | 'medium' | 'long' | 'weekday' = 'short'): string {
  const date = parseLocalDate(dateStr);

  switch (format) {
    case 'short':
      return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    case 'medium':
      return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    case 'long':
      return date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
    case 'weekday':
      return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    default:
      return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }
}

/**
 * Get the day of week (0-6, where 0 is Sunday) from a DateString
 */
export function getDayOfWeek(dateStr: DateString): number {
  return parseLocalDate(dateStr).getDay();
}

/**
 * Get the month (1-12) from a DateString
 */
export function getMonth(dateStr: DateString): number {
  return parseInt(dateStr.substring(5, 7), 10);
}

/**
 * Get the year from a DateString
 */
export function getYear(dateStr: DateString): number {
  return parseInt(dateStr.substring(0, 4), 10);
}

/**
 * Get the day of month (1-31) from a DateString
 */
export function getDayOfMonth(dateStr: DateString): number {
  return parseInt(dateStr.substring(8, 10), 10);
}

/**
 * Validate that a string is in YYYY-MM-DD format
 */
export function isValidDateString(str: string): str is DateString {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(str)) {
    return false;
  }
  // Verify it's a valid date
  const date = parseLocalDate(str);
  return !isNaN(date.getTime()) && formatDateToString(date) === str;
}
