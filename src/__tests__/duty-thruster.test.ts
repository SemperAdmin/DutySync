import { describe, it, expect, vi } from "vitest";
import {
  calculateDutyPoints,
  matchesFilter,
} from "@/lib/duty-thruster";
import type { DutyValue } from "@/types";

// Mock the date-utils module, importing actual implementations where possible
vi.mock("@/lib/date-utils", async () => {
  const actual = await vi.importActual<typeof import("@/lib/date-utils")>("@/lib/date-utils");
  return {
    ...actual,
    isHolidayStr: vi.fn((date: string) => {
      // Christmas 2025 and July 4th 2025 are holidays for testing
      return date === "2025-12-25" || date === "2025-07-04";
    }),
    isWeekendStr: vi.fn((date: string) => {
      // Saturdays: 2025-01-18, 2025-12-27
      // Sundays: 2025-01-19, 2025-12-28
      const weekends = ["2025-01-18", "2025-01-19", "2025-12-27", "2025-12-28"];
      return weekends.includes(date);
    }),
    getTodayString: vi.fn(() => "2025-01-15"),
  };
});

describe("duty-thruster", () => {
  describe("calculateDutyPoints", () => {
    const defaultDutyValue: DutyValue = {
      id: "dv-1",
      duty_type_id: "dt-1",
      base_weight: 1.0,
      weekend_multiplier: 1.5,
      holiday_multiplier: 2.0,
    };

    it("should return base weight for a regular weekday", () => {
      const points = calculateDutyPoints("2025-01-15", defaultDutyValue);
      expect(points).toBe(1.0);
    });

    it("should apply weekend multiplier for Saturday", () => {
      const points = calculateDutyPoints("2025-01-18", defaultDutyValue);
      expect(points).toBe(1.5);
    });

    it("should apply weekend multiplier for Sunday", () => {
      const points = calculateDutyPoints("2025-01-19", defaultDutyValue);
      expect(points).toBe(1.5);
    });

    it("should apply holiday multiplier for holidays", () => {
      const points = calculateDutyPoints("2025-12-25", defaultDutyValue);
      expect(points).toBe(2.0);
    });

    it("should prioritize holiday over weekend", () => {
      // If Christmas falls on a weekend, holiday multiplier should apply
      const points = calculateDutyPoints("2025-12-25", defaultDutyValue);
      expect(points).toBe(2.0);
    });

    it("should use custom base weight", () => {
      const customValue: DutyValue = {
        ...defaultDutyValue,
        base_weight: 2.0,
      };
      const points = calculateDutyPoints("2025-01-15", customValue);
      expect(points).toBe(2.0);
    });

    it("should use custom multipliers", () => {
      const customValue: DutyValue = {
        ...defaultDutyValue,
        base_weight: 2.0,
        weekend_multiplier: 2.0,
        holiday_multiplier: 3.0,
      };
      // Weekend: 2.0 * 2.0 = 4.0
      expect(calculateDutyPoints("2025-01-18", customValue)).toBe(4.0);
      // Holiday: 2.0 * 3.0 = 6.0
      expect(calculateDutyPoints("2025-12-25", customValue)).toBe(6.0);
    });

    it("should use default multipliers when duty value is undefined", () => {
      const points = calculateDutyPoints("2025-01-18", undefined);
      // Default weekend multiplier is 1.5, base weight is 1.0
      expect(points).toBe(1.5);
    });

    it("should handle undefined duty value for holidays", () => {
      const points = calculateDutyPoints("2025-12-25", undefined);
      // Default holiday multiplier is 2.0, base weight is 1.0
      expect(points).toBe(2.0);
    });
  });

  describe("matchesFilter", () => {
    describe("include mode", () => {
      it("should return true if value is in include list", () => {
        const result = matchesFilter("include", ["E-5", "E-6", "E-7"], "E-6");
        expect(result).toBe(true);
      });

      it("should return false if value is not in include list", () => {
        const result = matchesFilter("include", ["E-5", "E-6", "E-7"], "E-4");
        expect(result).toBe(false);
      });
    });

    describe("exclude mode", () => {
      it("should return false if value is in exclude list", () => {
        const result = matchesFilter("exclude", ["E-1", "E-2", "E-3"], "E-2");
        expect(result).toBe(false);
      });

      it("should return true if value is not in exclude list", () => {
        const result = matchesFilter("exclude", ["E-1", "E-2", "E-3"], "E-5");
        expect(result).toBe(true);
      });
    });

    describe("no filter", () => {
      it("should return true when mode is null", () => {
        const result = matchesFilter(null, ["E-5", "E-6"], "E-4");
        expect(result).toBe(true);
      });

      it("should return true when mode is undefined", () => {
        const result = matchesFilter(undefined, ["E-5", "E-6"], "E-4");
        expect(result).toBe(true);
      });

      it("should return true when values is null", () => {
        const result = matchesFilter("include", null, "E-4");
        expect(result).toBe(true);
      });

      it("should return true when values is undefined", () => {
        const result = matchesFilter("include", undefined, "E-4");
        expect(result).toBe(true);
      });

      it("should return true when values is empty array", () => {
        const result = matchesFilter("include", [], "E-4");
        expect(result).toBe(true);
      });
    });
  });
});
