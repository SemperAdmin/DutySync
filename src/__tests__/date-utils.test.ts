import { describe, it, expect } from "vitest";
import {
  formatDateToString,
  isHoliday,
  isWeekend,
  parseLocalDate,
  normalizeToLocalMidnight,
  isHolidayStr,
  isWeekendStr,
  addDaysToDateString,
  compareDateStrings,
  isDateInRange,
  generateDateStrings,
  formatDateForDisplay,
  getDayOfWeek,
  getMonth,
  getYear,
  getDayOfMonth,
  isValidDateString,
} from "@/lib/date-utils";

describe("date-utils", () => {
  describe("formatDateToString", () => {
    it("should format a date as YYYY-MM-DD", () => {
      const date = new Date(2025, 0, 15); // January 15, 2025
      expect(formatDateToString(date)).toBe("2025-01-15");
    });

    it("should pad single-digit months and days", () => {
      const date = new Date(2025, 0, 5); // January 5, 2025
      expect(formatDateToString(date)).toBe("2025-01-05");
    });

    it("should handle December correctly", () => {
      const date = new Date(2025, 11, 31); // December 31, 2025
      expect(formatDateToString(date)).toBe("2025-12-31");
    });
  });

  describe("parseLocalDate", () => {
    it("should parse YYYY-MM-DD to local midnight", () => {
      const date = parseLocalDate("2025-06-15");
      expect(date.getFullYear()).toBe(2025);
      expect(date.getMonth()).toBe(5); // June is month 5 (0-indexed)
      expect(date.getDate()).toBe(15);
      expect(date.getHours()).toBe(0);
      expect(date.getMinutes()).toBe(0);
    });

    it("should round-trip correctly with formatDateToString", () => {
      const originalStr = "2025-12-25";
      const date = parseLocalDate(originalStr);
      expect(formatDateToString(date)).toBe(originalStr);
    });
  });

  describe("normalizeToLocalMidnight", () => {
    it("should strip time component", () => {
      const date = new Date(2025, 5, 15, 14, 30, 45);
      const normalized = normalizeToLocalMidnight(date);
      expect(normalized.getHours()).toBe(0);
      expect(normalized.getMinutes()).toBe(0);
      expect(normalized.getSeconds()).toBe(0);
      expect(normalized.getDate()).toBe(15);
    });
  });

  describe("isHoliday / isHolidayStr", () => {
    it("should return true for Christmas 2025", () => {
      const date = parseLocalDate("2025-12-25");
      expect(isHoliday(date)).toBe(true);
      expect(isHolidayStr("2025-12-25")).toBe(true);
    });

    it("should return true for Independence Day 2025", () => {
      expect(isHolidayStr("2025-07-04")).toBe(true);
    });

    it("should return true for New Year's Day 2025", () => {
      expect(isHolidayStr("2025-01-01")).toBe(true);
    });

    it("should return false for a regular day", () => {
      const date = parseLocalDate("2025-03-15");
      expect(isHoliday(date)).toBe(false);
      expect(isHolidayStr("2025-03-15")).toBe(false);
    });

    it("should return true for MLK Day 2026", () => {
      expect(isHolidayStr("2026-01-19")).toBe(true);
    });
  });

  describe("isWeekend / isWeekendStr", () => {
    it("should return true for Saturday", () => {
      // January 18, 2025 is a Saturday
      const date = parseLocalDate("2025-01-18");
      expect(isWeekend(date)).toBe(true);
      expect(isWeekendStr("2025-01-18")).toBe(true);
    });

    it("should return true for Sunday", () => {
      // January 19, 2025 is a Sunday
      expect(isWeekendStr("2025-01-19")).toBe(true);
    });

    it("should return false for Monday", () => {
      // January 20, 2025 is a Monday
      expect(isWeekendStr("2025-01-20")).toBe(false);
    });

    it("should return false for Friday", () => {
      // January 17, 2025 is a Friday
      expect(isWeekendStr("2025-01-17")).toBe(false);
    });
  });

  describe("addDaysToDateString", () => {
    it("should add days correctly", () => {
      expect(addDaysToDateString("2025-01-15", 5)).toBe("2025-01-20");
    });

    it("should handle month boundary", () => {
      expect(addDaysToDateString("2025-01-30", 5)).toBe("2025-02-04");
    });

    it("should handle year boundary", () => {
      expect(addDaysToDateString("2025-12-30", 5)).toBe("2026-01-04");
    });

    it("should subtract days with negative value", () => {
      expect(addDaysToDateString("2025-01-15", -5)).toBe("2025-01-10");
    });
  });

  describe("compareDateStrings", () => {
    it("should return negative when first date is earlier", () => {
      expect(compareDateStrings("2025-01-15", "2025-01-20")).toBeLessThan(0);
    });

    it("should return positive when first date is later", () => {
      expect(compareDateStrings("2025-01-20", "2025-01-15")).toBeGreaterThan(0);
    });

    it("should return zero for equal dates", () => {
      expect(compareDateStrings("2025-01-15", "2025-01-15")).toBe(0);
    });
  });

  describe("isDateInRange", () => {
    it("should return true for date within range", () => {
      expect(isDateInRange("2025-01-15", "2025-01-10", "2025-01-20")).toBe(true);
    });

    it("should return true for date at start of range", () => {
      expect(isDateInRange("2025-01-10", "2025-01-10", "2025-01-20")).toBe(true);
    });

    it("should return true for date at end of range", () => {
      expect(isDateInRange("2025-01-20", "2025-01-10", "2025-01-20")).toBe(true);
    });

    it("should return false for date before range", () => {
      expect(isDateInRange("2025-01-05", "2025-01-10", "2025-01-20")).toBe(false);
    });

    it("should return false for date after range", () => {
      expect(isDateInRange("2025-01-25", "2025-01-10", "2025-01-20")).toBe(false);
    });
  });

  describe("generateDateStrings", () => {
    it("should generate array of consecutive dates", () => {
      const dates = generateDateStrings("2025-01-10", "2025-01-13");
      expect(dates).toEqual([
        "2025-01-10",
        "2025-01-11",
        "2025-01-12",
        "2025-01-13",
      ]);
    });

    it("should return single date for same start and end", () => {
      const dates = generateDateStrings("2025-01-15", "2025-01-15");
      expect(dates).toEqual(["2025-01-15"]);
    });

    it("should return empty array when start is after end", () => {
      const dates = generateDateStrings("2025-01-20", "2025-01-15");
      expect(dates).toEqual([]);
    });
  });

  describe("formatDateForDisplay", () => {
    it("should format as short by default", () => {
      const result = formatDateForDisplay("2025-12-25");
      expect(result).toMatch(/Dec\s+25/);
    });

    it("should format as medium with year", () => {
      const result = formatDateForDisplay("2025-12-25", "medium");
      expect(result).toMatch(/Dec\s+25,?\s*2025/);
    });

    it("should format as long with full month name", () => {
      const result = formatDateForDisplay("2025-12-25", "long");
      expect(result).toMatch(/December\s+25,?\s*2025/);
    });

    it("should format with weekday", () => {
      const result = formatDateForDisplay("2025-12-25", "weekday");
      expect(result).toMatch(/Thu.*Dec\s+25/);
    });
  });

  describe("getDayOfWeek", () => {
    it("should return 0 for Sunday", () => {
      expect(getDayOfWeek("2025-01-19")).toBe(0);
    });

    it("should return 6 for Saturday", () => {
      expect(getDayOfWeek("2025-01-18")).toBe(6);
    });

    it("should return 1 for Monday", () => {
      expect(getDayOfWeek("2025-01-20")).toBe(1);
    });
  });

  describe("getMonth", () => {
    it("should return 1 for January", () => {
      expect(getMonth("2025-01-15")).toBe(1);
    });

    it("should return 12 for December", () => {
      expect(getMonth("2025-12-25")).toBe(12);
    });
  });

  describe("getYear", () => {
    it("should return the year", () => {
      expect(getYear("2025-06-15")).toBe(2025);
    });
  });

  describe("getDayOfMonth", () => {
    it("should return the day", () => {
      expect(getDayOfMonth("2025-06-15")).toBe(15);
    });

    it("should return single digit days correctly", () => {
      expect(getDayOfMonth("2025-06-05")).toBe(5);
    });
  });

  describe("isValidDateString", () => {
    it("should return true for valid date string", () => {
      expect(isValidDateString("2025-06-15")).toBe(true);
    });

    it("should return false for invalid format", () => {
      expect(isValidDateString("06-15-2025")).toBe(false);
      expect(isValidDateString("2025/06/15")).toBe(false);
      expect(isValidDateString("June 15, 2025")).toBe(false);
    });

    it("should return false for invalid date values", () => {
      expect(isValidDateString("2025-13-15")).toBe(false); // Invalid month
      expect(isValidDateString("2025-06-32")).toBe(false); // Invalid day
    });

    it("should return false for non-date strings", () => {
      expect(isValidDateString("not a date")).toBe(false);
      expect(isValidDateString("")).toBe(false);
    });
  });
});
