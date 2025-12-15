/**
 * Shared date utilities for holiday and weekend calculations
 * Centralized to ensure consistency across the application
 */

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
