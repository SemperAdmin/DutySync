import { describe, it, expect } from "vitest";
import {
  ADMIN_ROLES,
  MANAGER_ROLES,
  PERSONNEL_ACCESS_ROLES,
  ORG_SCOPED_ROLES,
  ALL_ROLES,
  hasAnyRole,
  isAppAdmin,
  isUnitAdmin,
  isManager,
  getUserScopeUnitId,
  getRoleColor,
  VIEW_MODE_KEY,
  VIEW_MODE_ADMIN,
  VIEW_MODE_UNIT_ADMIN,
  VIEW_MODE_USER,
  MAX_DUTY_SCORE,
  DEFAULT_WEEKEND_MULTIPLIER,
  DEFAULT_HOLIDAY_MULTIPLIER,
} from "@/lib/constants";
import type { SessionUser, UserRole } from "@/types";

// Helper to create a mock user with roles
function createMockUser(roles: Partial<UserRole>[]): SessionUser {
  return {
    id: "test-user-id",
    edipi: "1234567890",
    firstName: "Test",
    lastName: "User",
    roles: roles.map((r, i) => ({
      id: `role-${i}`,
      role_name: r.role_name || "Standard User",
      scope_unit_id: r.scope_unit_id || null,
      scope_unit_name: r.scope_unit_name || null,
    })) as UserRole[],
  };
}

describe("constants", () => {
  describe("Role Arrays", () => {
    it("ADMIN_ROLES should contain App Admin and Unit Admin", () => {
      expect(ADMIN_ROLES).toContain("App Admin");
      expect(ADMIN_ROLES).toContain("Unit Admin");
      expect(ADMIN_ROLES).toHaveLength(2);
    });

    it("MANAGER_ROLES should contain all manager types", () => {
      expect(MANAGER_ROLES).toContain("Unit Manager");
      expect(MANAGER_ROLES).toContain("Company Manager");
      expect(MANAGER_ROLES).toContain("Section Manager");
      expect(MANAGER_ROLES).toContain("Work Section Manager");
      expect(MANAGER_ROLES).toHaveLength(4);
    });

    it("PERSONNEL_ACCESS_ROLES should include admins and managers", () => {
      expect(PERSONNEL_ACCESS_ROLES).toContain("App Admin");
      expect(PERSONNEL_ACCESS_ROLES).toContain("Unit Admin");
      expect(PERSONNEL_ACCESS_ROLES).toContain("Unit Manager");
      expect(PERSONNEL_ACCESS_ROLES).toContain("Company Manager");
    });

    it("ORG_SCOPED_ROLES should exclude App Admin", () => {
      expect(ORG_SCOPED_ROLES).not.toContain("App Admin");
      expect(ORG_SCOPED_ROLES).toContain("Unit Admin");
      expect(ORG_SCOPED_ROLES).toContain("Unit Manager");
    });

    it("ALL_ROLES should contain 7 roles", () => {
      expect(ALL_ROLES).toHaveLength(7);
      expect(ALL_ROLES).toContain("Standard User");
    });
  });

  describe("hasAnyRole", () => {
    it("should return false for null user", () => {
      expect(hasAnyRole(null, ["App Admin"])).toBe(false);
    });

    it("should return false for user with no roles", () => {
      const user = createMockUser([]);
      expect(hasAnyRole(user, ["App Admin"])).toBe(false);
    });

    it("should return true when user has matching role", () => {
      const user = createMockUser([{ role_name: "App Admin" }]);
      expect(hasAnyRole(user, ["App Admin"])).toBe(true);
    });

    it("should return true when user has one of multiple roles", () => {
      const user = createMockUser([{ role_name: "Unit Manager" }]);
      expect(hasAnyRole(user, ADMIN_ROLES)).toBe(false);
      expect(hasAnyRole(user, MANAGER_ROLES)).toBe(true);
    });

    it("should return false when user has no matching role", () => {
      const user = createMockUser([{ role_name: "Standard User" }]);
      expect(hasAnyRole(user, ADMIN_ROLES)).toBe(false);
    });
  });

  describe("isAppAdmin", () => {
    it("should return true for App Admin", () => {
      const user = createMockUser([{ role_name: "App Admin" }]);
      expect(isAppAdmin(user)).toBe(true);
    });

    it("should return false for Unit Admin", () => {
      const user = createMockUser([{ role_name: "Unit Admin" }]);
      expect(isAppAdmin(user)).toBe(false);
    });

    it("should return false for null user", () => {
      expect(isAppAdmin(null)).toBe(false);
    });
  });

  describe("isUnitAdmin", () => {
    it("should return true for Unit Admin", () => {
      const user = createMockUser([{ role_name: "Unit Admin" }]);
      expect(isUnitAdmin(user)).toBe(true);
    });

    it("should return false for App Admin", () => {
      const user = createMockUser([{ role_name: "App Admin" }]);
      expect(isUnitAdmin(user)).toBe(false);
    });

    it("should return false for null user", () => {
      expect(isUnitAdmin(null)).toBe(false);
    });
  });

  describe("isManager", () => {
    it("should return true for Unit Manager", () => {
      const user = createMockUser([{ role_name: "Unit Manager" }]);
      expect(isManager(user)).toBe(true);
    });

    it("should return true for Company Manager", () => {
      const user = createMockUser([{ role_name: "Company Manager" }]);
      expect(isManager(user)).toBe(true);
    });

    it("should return true for Section Manager", () => {
      const user = createMockUser([{ role_name: "Section Manager" }]);
      expect(isManager(user)).toBe(true);
    });

    it("should return true for Work Section Manager", () => {
      const user = createMockUser([{ role_name: "Work Section Manager" }]);
      expect(isManager(user)).toBe(true);
    });

    it("should return false for App Admin", () => {
      const user = createMockUser([{ role_name: "App Admin" }]);
      expect(isManager(user)).toBe(false);
    });

    it("should return false for Standard User", () => {
      const user = createMockUser([{ role_name: "Standard User" }]);
      expect(isManager(user)).toBe(false);
    });
  });

  describe("getUserScopeUnitId", () => {
    it("should return null for null user", () => {
      expect(getUserScopeUnitId(null)).toBeNull();
    });

    it("should return null for user with no scoped roles", () => {
      const user = createMockUser([{ role_name: "App Admin" }]);
      expect(getUserScopeUnitId(user)).toBeNull();
    });

    it("should return Unit Admin scope when present", () => {
      const user = createMockUser([
        { role_name: "Unit Admin", scope_unit_id: "unit-123" },
      ]);
      expect(getUserScopeUnitId(user)).toBe("unit-123");
    });

    it("should return manager scope when present", () => {
      const user = createMockUser([
        { role_name: "Company Manager", scope_unit_id: "company-456" },
      ]);
      expect(getUserScopeUnitId(user)).toBe("company-456");
    });

    it("should prioritize Unit Admin scope over manager scope", () => {
      const user = createMockUser([
        { role_name: "Company Manager", scope_unit_id: "company-456" },
        { role_name: "Unit Admin", scope_unit_id: "unit-123" },
      ]);
      expect(getUserScopeUnitId(user)).toBe("unit-123");
    });
  });

  describe("getRoleColor", () => {
    it("should return error color for App Admin", () => {
      expect(getRoleColor("App Admin")).toContain("error");
    });

    it("should return warning color for Unit Admin", () => {
      expect(getRoleColor("Unit Admin")).toContain("warning");
    });

    it("should return primary color for Unit Manager", () => {
      expect(getRoleColor("Unit Manager")).toContain("primary");
    });

    it("should return highlight color for Company Manager", () => {
      expect(getRoleColor("Company Manager")).toContain("highlight");
    });

    it("should return success color for Section Manager", () => {
      expect(getRoleColor("Section Manager")).toContain("success");
    });

    it("should return cyan color for Work Section Manager", () => {
      expect(getRoleColor("Work Section Manager")).toContain("cyan");
    });

    it("should return default color for unknown role", () => {
      expect(getRoleColor("Unknown Role")).toContain("surface");
    });

    it("should return default color for Standard User", () => {
      expect(getRoleColor("Standard User")).toContain("surface");
    });
  });

  describe("View Mode Constants", () => {
    it("VIEW_MODE_KEY should be defined", () => {
      expect(VIEW_MODE_KEY).toBe("dutysync_admin_view_mode");
    });

    it("should have correct view mode values", () => {
      expect(VIEW_MODE_ADMIN).toBe("admin");
      expect(VIEW_MODE_UNIT_ADMIN).toBe("unit-admin");
      expect(VIEW_MODE_USER).toBe("user");
    });
  });

  describe("Duty Score Constants", () => {
    it("MAX_DUTY_SCORE should be 15", () => {
      expect(MAX_DUTY_SCORE).toBe(15);
    });

    it("DEFAULT_WEEKEND_MULTIPLIER should be 1.5", () => {
      expect(DEFAULT_WEEKEND_MULTIPLIER).toBe(1.5);
    });

    it("DEFAULT_HOLIDAY_MULTIPLIER should be 2.0", () => {
      expect(DEFAULT_HOLIDAY_MULTIPLIER).toBe(2.0);
    });
  });
});
