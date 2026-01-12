"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import Card, {
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import type { Personnel, UnitSection, RoleName } from "@/types";
import { useAuth } from "@/lib/supabase-auth";
import {
  parseManpowerTsv,
  exportUnitStructure,
  exportUnitMembers,
  createPersonnel,
  updatePersonnel,
} from "@/lib/client-stores";
import {
  getAllPersonnel,
  getUnitSections,
  loadPersonnel,
  loadUnits,
  loadDutySlots,
  getOrganizationByRuc,
  importManpowerToSupabase,
  getPersonnelByEdipi,
  invalidateCache,
  type ManpowerRecord,
} from "@/lib/data-layer";
import type { DutySlot } from "@/types";
import { useSyncRefresh } from "@/hooks/useSync";
import {
  isGitHubConfigured,
  getGitHubSettings,
  saveGitHubSettings,
  pushSeedFilesToGitHub,
  testGitHubConnection,
  type GitHubSettings,
} from "@/lib/github-api";
import {
  VIEW_MODE_KEY,
  VIEW_MODE_CHANGE_EVENT,
  VIEW_MODE_ADMIN,
  VIEW_MODE_UNIT_ADMIN,
  VIEW_MODE_USER,
  type ViewMode,
  MANAGER_ROLES,
  ADMIN_ROLES,
  hasAnyRole,
  isAppAdmin as checkIsAppAdmin,
  isUnitAdmin as checkIsUnitAdmin,
  isManager as checkIsManager,
} from "@/lib/constants";
import { buildHierarchicalUnitOptions, formatUnitOptionLabel } from "@/lib/unit-hierarchy";

// Pagination constants
const ITEMS_PER_PAGE = 50;

export default function PersonnelPage() {
  const { user, selectedRuc, availableRucs } = useAuth();
  const [personnel, setPersonnel] = useState<Personnel[]>([]);
  const [units, setUnits] = useState<UnitSection[]>([]);
  const [dutySlots, setDutySlots] = useState<DutySlot[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showImportModal, setShowImportModal] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editingPersonnel, setEditingPersonnel] = useState<Personnel | null>(null);
  const [filterUnit, setFilterUnit] = useState<string>("");
  const [searchTerm, setSearchTerm] = useState("");
  const [viewMode, setViewMode] = useState<"self" | "scope">("scope"); // Default to scope for managers/admins
  const [currentViewMode, setCurrentViewMode] = useState<ViewMode>(VIEW_MODE_USER);
  const [currentPage, setCurrentPage] = useState(1);

  const fetchData = useCallback(async () => {
    try {
      // Load data from Supabase in parallel
      const [personnelData, unitsData, slotsData] = await Promise.all([
        loadPersonnel(),
        loadUnits(),
        loadDutySlots(),
      ]);

      setPersonnel(personnelData);
      setUnits(unitsData);
      setDutySlots(slotsData);
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Listen for sync updates to personnel/units data and refresh automatically
  useSyncRefresh(["personnel", "units"], fetchData);

  // Load and listen for view mode toggle changes
  useEffect(() => {
    // Load initial value from localStorage
    const stored = localStorage.getItem(VIEW_MODE_KEY) as ViewMode | null;
    if (stored && [VIEW_MODE_ADMIN, VIEW_MODE_UNIT_ADMIN, VIEW_MODE_USER].includes(stored)) {
      setCurrentViewMode(stored);
    }

    // Listen for changes from the header toggle
    const handleViewModeChange = () => {
      const stored = localStorage.getItem(VIEW_MODE_KEY) as ViewMode | null;
      if (stored && [VIEW_MODE_ADMIN, VIEW_MODE_UNIT_ADMIN, VIEW_MODE_USER].includes(stored)) {
        setCurrentViewMode(stored);
      }
    };

    window.addEventListener(VIEW_MODE_CHANGE_EVENT, handleViewModeChange);
    // Also listen for storage events from other tabs
    window.addEventListener("storage", handleViewModeChange);

    return () => {
      window.removeEventListener(VIEW_MODE_CHANGE_EVENT, handleViewModeChange);
      window.removeEventListener("storage", handleViewModeChange);
    };
  }, []);

  // Computed view mode booleans
  const isAdminView = currentViewMode === VIEW_MODE_ADMIN;
  const isUnitAdminView = currentViewMode === VIEW_MODE_UNIT_ADMIN;

  // Create a Map of units for O(1) lookups
  const unitMap = useMemo(() => new Map(units.map(u => [u.id, u])), [units]);

  // Build hierarchical unit options for dropdowns
  const hierarchicalUnits = useMemo(() => {
    return buildHierarchicalUnitOptions(units);
  }, [units]);

  // Create a Map of parent_id to child unit IDs for O(1) children lookup
  const childrenMap = useMemo(() => {
    const map = new Map<string, string[]>();
    units.forEach(u => {
      if (u.parent_id) {
        const children = map.get(u.parent_id) || [];
        children.push(u.id);
        map.set(u.parent_id, children);
      }
    });
    return map;
  }, [units]);

  // Pre-compute full hierarchy for each unit ID (major performance optimization)
  // This avoids walking the tree 3-6 times per row during render
  const unitHierarchyMap = useMemo(() => {
    const map = new Map<string, { company: string; section: string; workSection: string }>();

    // Helper to walk up the tree and find parent at level
    const findParentAtLevel = (
      unitId: string,
      level: "company" | "section" | "work_section"
    ): string => {
      let currentUnit = unitMap.get(unitId);
      while (currentUnit) {
        if (currentUnit.hierarchy_level === level) {
          return currentUnit.unit_name;
        }
        currentUnit = currentUnit.parent_id
          ? unitMap.get(currentUnit.parent_id)
          : undefined;
      }
      return "-";
    };

    // Pre-compute hierarchy for all units
    for (const unit of units) {
      map.set(unit.id, {
        company: findParentAtLevel(unit.id, "company"),
        section: findParentAtLevel(unit.id, "section"),
        // Only show work section if unit is actually a work_section level
        workSection: unit.hierarchy_level === "work_section" ? unit.unit_name : "-",
      });
    }

    return map;
  }, [units, unitMap]);

  // Pre-compute duty scores for all personnel (O(1) lookup instead of O(n) per row)
  // This is a MAJOR performance optimization - reduces O(n*m) to O(n+m)
  const dutyScoreMap = useMemo(() => {
    const scores = new Map<string, number>();

    // Initialize all personnel with 0
    personnel.forEach(p => scores.set(p.id, 0));

    // Aggregate scores from duty slots
    dutySlots
      .filter(slot =>
        slot.status === "scheduled" ||
        slot.status === "approved" ||
        slot.status === "completed"
      )
      .forEach(slot => {
        const currentScore = scores.get(slot.personnel_id) || 0;
        scores.set(slot.personnel_id, currentScore + (slot.points || 0));
      });

    return scores;
  }, [personnel, dutySlots]);

  // Get the current user's personnel record
  const currentUserPersonnel = useMemo(() => {
    if (!user?.edipi) return null;
    return getPersonnelByEdipi(user.edipi) || null;
  }, [user?.edipi]);

  // Check actual role status (not affected by view mode)
  const isAppAdmin = useMemo(() => {
    if (!user?.roles) return false;
    return user.roles.some(r => r.role_name === "App Admin");
  }, [user?.roles]);

  const hasUnitAdminRole = useMemo(() => {
    if (!user?.roles) return false;
    return user.roles.some(r => r.role_name === "Unit Admin");
  }, [user?.roles]);

  // Effective admin status - respects the view mode toggle
  // Admin View: App Admin sees everything
  // Unit Admin View: Unit Admin sees their unit scope
  // User View: Manager role scope applies
  const effectiveIsAppAdmin = isAppAdmin && isAdminView;
  const effectiveIsUnitAdmin = hasUnitAdminRole && isUnitAdminView;

  // Get the organization ID for the currently selected RUC
  const selectedRucOrganizationId = useMemo(() => {
    if (!selectedRuc || availableRucs.length === 0) return null;
    const rucInfo = availableRucs.find(r => r.ruc === selectedRuc);
    return rucInfo?.organizationId || null;
  }, [selectedRuc, availableRucs]);

  // Get the user's scope unit ID based on their role, view mode, and selected RUC
  const userScopeUnitId = useMemo(() => {
    if (!user?.roles) return null;

    // Find both types of scoped roles
    const unitAdminRoles = user.roles.filter(r =>
      r.role_name === "Unit Admin" && r.scope_unit_id
    );
    const managerRole = user.roles.find(r =>
      MANAGER_ROLES.includes(r.role_name as RoleName) && r.scope_unit_id
    );

    // In Admin View, App Admin sees everything (handled by effectiveIsAppAdmin)
    // In Unit Admin View, use Unit Admin scope for the selected RUC
    if (isUnitAdminView && unitAdminRoles.length > 0) {
      // If we have a selected RUC organization ID, find the matching Unit Admin role
      if (selectedRucOrganizationId) {
        for (const role of unitAdminRoles) {
          if (!role.scope_unit_id) continue;
          const scopeUnit = units.find(u => u.id === role.scope_unit_id);
          if (scopeUnit?.organization_id === selectedRucOrganizationId) {
            return role.scope_unit_id;
          }
        }
      }
      // Fallback to first Unit Admin role
      return unitAdminRoles[0]?.scope_unit_id || null;
    }

    // In User View, prioritize manager role scope for user experience
    if (!isAdminView && !isUnitAdminView && managerRole?.scope_unit_id) {
      return managerRole.scope_unit_id;
    }

    // Fall back: Unit Admin scope if in Admin View with Unit Admin role
    if (isAdminView && unitAdminRoles.length > 0) {
      // If we have a selected RUC organization ID, find the matching Unit Admin role
      if (selectedRucOrganizationId) {
        for (const role of unitAdminRoles) {
          if (!role.scope_unit_id) continue;
          const scopeUnit = units.find(u => u.id === role.scope_unit_id);
          if (scopeUnit?.organization_id === selectedRucOrganizationId) {
            return role.scope_unit_id;
          }
        }
      }
      return unitAdminRoles[0]?.scope_unit_id || null;
    }

    // Final fall back to manager role scope
    return managerRole?.scope_unit_id || null;
  }, [user?.roles, isAdminView, isUnitAdminView, selectedRucOrganizationId, units]);

  // Determine if user has elevated access (effective admin or has a scoped role)
  const hasElevatedAccess = effectiveIsAppAdmin || effectiveIsUnitAdmin || !!userScopeUnitId;

  // Get all descendant unit IDs for the user's scope
  const scopeUnitIds = useMemo(() => {
    if (effectiveIsAppAdmin) {
      // Effective App Admins (in admin view) can see all units
      return new Set(units.map(u => u.id));
    }
    if (!userScopeUnitId) return new Set<string>();

    // For Unit Admin view, include ALL units in the organization
    // This handles cases where unit hierarchies may not be properly connected
    if (effectiveIsUnitAdmin) {
      const scopeUnit = unitMap.get(userScopeUnitId);
      if (scopeUnit) {
        // Get organization_id from the scope unit (it's stored in the extended type)
        const orgId = (scopeUnit as UnitSection & { organization_id?: string }).organization_id;
        if (orgId) {
          // Include all units for this organization
          return new Set(
            units
              .filter(u => (u as UnitSection & { organization_id?: string }).organization_id === orgId)
              .map(u => u.id)
          );
        }
      }
    }

    // For manager roles, walk the hierarchy tree
    const ids = new Set<string>([userScopeUnitId]);
    const queue = [userScopeUnitId];

    for (let i = 0; i < queue.length; i++) {
      const currentId = queue[i];
      const children = childrenMap.get(currentId) || [];
      for (const childId of children) {
        if (!ids.has(childId)) {
          ids.add(childId);
          queue.push(childId);
        }
      }
    }

    return ids;
  }, [effectiveIsAppAdmin, effectiveIsUnitAdmin, userScopeUnitId, childrenMap, units, unitMap]);

  // Get units within the user's scope for the filter dropdown, sorted by hierarchy
  const unitsInScope = useMemo(() => {
    const levelOrder: Record<string, number> = {
      ruc: 0, battalion: 0, unit: 0,
      company: 1,
      section: 2,
      work_section: 3,
    };

    let scopedUnits: typeof units;
    if (effectiveIsAppAdmin) {
      scopedUnits = units;
    } else if (scopeUnitIds.size === 0) {
      scopedUnits = [];
    } else {
      scopedUnits = units.filter(u => scopeUnitIds.has(u.id));
    }

    // Sort by hierarchy level then by name
    return scopedUnits.sort((a, b) => {
      const levelDiff = (levelOrder[a.hierarchy_level] ?? 99) - (levelOrder[b.hierarchy_level] ?? 99);
      if (levelDiff !== 0) return levelDiff;
      return a.unit_name.localeCompare(b.unit_name);
    });
  }, [effectiveIsAppAdmin, units, scopeUnitIds]);

  // Build hierarchical unit options for the filter dropdown (scoped units only)
  const hierarchicalUnitsInScope = useMemo(() => {
    return buildHierarchicalUnitOptions(unitsInScope);
  }, [unitsInScope]);

  // Get hierarchy level display label
  const getHierarchyLabel = (level: string): string => {
    switch (level) {
      case "company": return "Company";
      case "section": return "Section";
      case "work_section": return "Work Section";
      default: return "";
    }
  };

  const getUnitName = (unitId: string) => {
    const unit = unitMap.get(unitId);
    return unit?.unit_name || "Unknown";
  };

  // Build full unit path (e.g., "H Company > S1DV > CUST")
  const getFullUnitPath = (unitId: string): string => {
    const path: string[] = [];
    let currentUnit = unitMap.get(unitId);

    while (currentUnit) {
      // Skip RUC level for cleaner display
      if (currentUnit.hierarchy_level !== "ruc") {
        path.unshift(currentUnit.unit_name);
      }
      currentUnit = currentUnit.parent_id
        ? unitMap.get(currentUnit.parent_id)
        : undefined;
    }

    return path.join(" > ") || "Unknown";
  };

  // Get parent unit at specific level
  const getParentAtLevel = (
    unitId: string,
    level: "company" | "section" | "platoon" | "work_section"
  ): string => {
    let currentUnit = unitMap.get(unitId);

    while (currentUnit) {
      if (currentUnit.hierarchy_level === level) {
        return currentUnit.unit_name;
      }
      currentUnit = currentUnit.parent_id
        ? unitMap.get(currentUnit.parent_id)
        : undefined;
    }

    return "-";
  };

  // Check if unitId is the filterUnit OR is a descendant of filterUnit
  const isUnitInFilterPath = (unitId: string): boolean => {
    if (!filterUnit) return true;
    if (unitId === filterUnit) return true;

    // Walk up the hierarchy to see if filterUnit is an ancestor
    let currentUnit = unitMap.get(unitId);
    while (currentUnit?.parent_id) {
      if (currentUnit.parent_id === filterUnit) {
        return true;
      }
      currentUnit = unitMap.get(currentUnit.parent_id);
    }
    return false;
  };

  // Filter and search personnel based on view mode and scope
  const filteredPersonnel = useMemo(() => {
    return personnel.filter((p) => {
      // In "self" mode, only show the current user's record
      if (viewMode === "self") {
        if (!currentUserPersonnel) return false;
        return p.id === currentUserPersonnel.id;
      }

      // In "scope" mode, filter by scope and unit filter
      // First check if personnel is within the user's scope
      if (!effectiveIsAppAdmin && !scopeUnitIds.has(p.unit_section_id)) {
        return false;
      }

      // Then apply the unit filter
      const matchesUnit = isUnitInFilterPath(p.unit_section_id);
      const matchesSearch =
        !searchTerm ||
        p.first_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        p.last_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        p.service_id.toLowerCase().includes(searchTerm.toLowerCase()) ||
        p.rank.toLowerCase().includes(searchTerm.toLowerCase());
      return matchesUnit && matchesSearch;
    });
  }, [personnel, viewMode, currentUserPersonnel, effectiveIsAppAdmin, scopeUnitIds, filterUnit, searchTerm, isUnitInFilterPath]);

  // Pagination: compute total pages and current page items
  const totalPages = Math.ceil(filteredPersonnel.length / ITEMS_PER_PAGE);
  const paginatedPersonnel = useMemo(() => {
    const start = (currentPage - 1) * ITEMS_PER_PAGE;
    return filteredPersonnel.slice(start, start + ITEMS_PER_PAGE);
  }, [filteredPersonnel, currentPage]);

  // Reset to page 1 when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [filterUnit, searchTerm, viewMode]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Personnel</h1>
          <p className="text-foreground-muted mt-1">
            {effectiveIsUnitAdmin
              ? "Manage service members and import roster data"
              : hasElevatedAccess
              ? "View personnel within your scope"
              : "View your personnel record"}
          </p>
        </div>
        {/* Only show import/add buttons for Unit Admins in Unit Admin View mode */}
        {effectiveIsUnitAdmin && (
          <div className="flex gap-3">
            <Button variant="secondary" onClick={() => setShowImportModal(true)}>
              <svg
                className="w-5 h-5 mr-2"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"
                />
              </svg>
              Import CSV
            </Button>
            <Button variant="accent" onClick={() => setShowAddModal(true)}>
              <svg
                className="w-5 h-5 mr-2"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 6v6m0 0v6m0-6h6m-6 0H6"
                />
              </svg>
              Add Personnel
            </Button>
          </div>
        )}
      </div>

      {/* Error Alert */}
      {error && (
        <div className="p-4 rounded-lg bg-error/10 border border-error/20 text-error">
          {error}
          <button
            onClick={() => setError(null)}
            className="ml-2 text-error hover:underline"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Import Modal */}
      {showImportModal && (
        <ImportModal
          units={units}
          onClose={() => setShowImportModal(false)}
          onSuccess={() => {
            setShowImportModal(false);
            fetchData();
          }}
        />
      )}

      {/* Add Modal */}
      {showAddModal && (
        <AddPersonnelModal
          units={units}
          onClose={() => setShowAddModal(false)}
          onSuccess={() => {
            setShowAddModal(false);
            fetchData();
          }}
        />
      )}

      {/* Edit Phone Number Modal */}
      {showEditModal && editingPersonnel && (
        <EditPersonnelModal
          personnel={editingPersonnel}
          onClose={() => {
            setShowEditModal(false);
            setEditingPersonnel(null);
          }}
          onSuccess={() => {
            setShowEditModal(false);
            setEditingPersonnel(null);
            fetchData();
          }}
        />
      )}

      {/* Filters */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-col gap-4">
            {/* View Mode Toggle - only show if user has elevated access */}
            {hasElevatedAccess && (
              <div className="flex items-center gap-2">
                <span className="text-sm text-foreground-muted">View:</span>
                <div className="flex rounded-lg border border-border overflow-hidden">
                  <button
                    onClick={() => setViewMode("self")}
                    className={`px-4 py-2 text-sm font-medium transition-colors ${
                      viewMode === "self"
                        ? "bg-primary text-white"
                        : "bg-surface text-foreground-muted hover:bg-surface-elevated"
                    }`}
                  >
                    My Record
                  </button>
                  <button
                    onClick={() => setViewMode("scope")}
                    className={`px-4 py-2 text-sm font-medium transition-colors ${
                      viewMode === "scope"
                        ? "bg-primary text-white"
                        : "bg-surface text-foreground-muted hover:bg-surface-elevated"
                    }`}
                  >
                    {effectiveIsAppAdmin ? "All Personnel" : "My Scope"}
                  </button>
                </div>
              </div>
            )}

            {/* Search and Unit Filter - only show in scope mode */}
            {viewMode === "scope" && hasElevatedAccess && (
              <div className="flex flex-col md:flex-row gap-4">
                <div className="flex-1">
                  <Input
                    placeholder="Search by name, service ID, or rank..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                  />
                </div>
                <div className="w-full md:w-64">
                  <select
                    className="w-full px-4 py-2.5 rounded-lg bg-surface border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-primary font-mono"
                    value={filterUnit}
                    onChange={(e) => setFilterUnit(e.target.value)}
                  >
                    <option value="">{effectiveIsAppAdmin ? "All Sections" : "All in My Scope"}</option>
                    {hierarchicalUnitsInScope.map((option) => (
                      <option key={option.id} value={option.id}>
                        {formatUnitOptionLabel(option, true)}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Personnel Table */}
      <Card>
        <CardHeader>
          <CardTitle>
            Personnel Roster
            <span className="text-foreground-muted text-sm font-normal ml-2">
              ({filteredPersonnel.length} of {personnel.length})
            </span>
          </CardTitle>
          <CardDescription>
            Service members available for duty assignment
          </CardDescription>
        </CardHeader>
        <CardContent>
          {personnel.length === 0 ? (
            <div className="text-center py-12">
              <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-primary/20 flex items-center justify-center">
                <svg
                  className="w-8 h-8 text-highlight"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z"
                  />
                </svg>
              </div>
              <h2 className="text-xl font-semibold text-foreground mb-2">
                No Personnel Records
              </h2>
              <p className="text-foreground-muted mb-6 max-w-md mx-auto">
                Import your unit roster via CSV or add personnel manually to get started.
              </p>
              <div className="flex justify-center gap-3">
                <Button variant="accent" onClick={() => setShowImportModal(true)}>
                  Import CSV
                </Button>
                <Button variant="secondary" onClick={() => setShowAddModal(true)}>
                  Add Manually
                </Button>
              </div>
            </div>
          ) : filteredPersonnel.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-foreground-muted">No personnel match your search criteria</p>
            </div>
          ) : (
            <>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left py-3 px-4 text-sm font-medium text-foreground-muted">
                      Name
                    </th>
                    <th className="text-left py-3 px-4 text-sm font-medium text-foreground-muted">
                      Rank
                    </th>
                    <th className="text-left py-3 px-4 text-sm font-medium text-foreground-muted">
                      Company
                    </th>
                    <th className="text-left py-3 px-4 text-sm font-medium text-foreground-muted">
                      Section
                    </th>
                    <th className="text-left py-3 px-4 text-sm font-medium text-foreground-muted">
                      Work Section
                    </th>
                    <th className="text-left py-3 px-4 text-sm font-medium text-foreground-muted">
                      Duty Score
                    </th>
                    <th className="text-left py-3 px-4 text-sm font-medium text-foreground-muted">
                      Phone
                    </th>
                    <th className="text-left py-3 px-4 text-sm font-medium text-foreground-muted">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedPersonnel.map((person) => {
                    // Use pre-computed hierarchy (O(1) lookup instead of tree traversal)
                    const hierarchy = unitHierarchyMap.get(person.unit_section_id);
                    return (
                      <tr
                        key={person.id}
                        className="border-b border-border hover:bg-surface-elevated"
                      >
                        <td className="py-3 px-4">
                          <span className="font-medium text-foreground">
                            {person.last_name}, {person.first_name}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-foreground-muted">
                          {person.rank}
                        </td>
                        <td className="py-3 px-4 text-foreground-muted">
                          {hierarchy?.company ?? "-"}
                        </td>
                        <td className="py-3 px-4 text-foreground-muted">
                          {hierarchy?.section ?? "-"}
                        </td>
                        <td className="py-3 px-4 text-foreground-muted">
                          {hierarchy?.workSection ?? "-"}
                        </td>
                        <td className="py-3 px-4">
                          <span className="text-highlight font-medium">
                            {(dutyScoreMap.get(person.id) || 0).toFixed(1)}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-foreground-muted">
                          {person.phone_number || "-"}
                        </td>
                        <td className="py-3 px-4">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setEditingPersonnel(person);
                              setShowEditModal(true);
                            }}
                          >
                            <svg
                              className="w-4 h-4 mr-1"
                              fill="none"
                              stroke="currentColor"
                              viewBox="0 0 24 24"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2}
                                d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"
                              />
                            </svg>
                            Edit Phone
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Pagination Controls */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between mt-4 pt-4 border-t border-border">
                <div className="text-sm text-foreground-muted">
                  Showing {((currentPage - 1) * ITEMS_PER_PAGE) + 1} to{" "}
                  {Math.min(currentPage * ITEMS_PER_PAGE, filteredPersonnel.length)} of{" "}
                  {filteredPersonnel.length} personnel
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setCurrentPage(1)}
                    disabled={currentPage === 1}
                  >
                    First
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                    disabled={currentPage === 1}
                  >
                    Previous
                  </Button>
                  <span className="px-3 py-1 text-sm text-foreground">
                    Page {currentPage} of {totalPages}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                    disabled={currentPage === totalPages}
                  >
                    Next
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setCurrentPage(totalPages)}
                    disabled={currentPage === totalPages}
                  >
                    Last
                  </Button>
                </div>
              </div>
            )}
          </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function ImportModal({
  units,
  onClose,
  onSuccess,
}: {
  units: UnitSection[];
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    personnel: { created: number; updated: number };
    units?: { created: number };
    nonAvailability?: { created: number };
    errors: string[];
  } | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // GitHub sync state
  const [gitHubStatus, setGitHubStatus] = useState<"idle" | "pushing" | "success" | "error">("idle");
  const [gitHubMessage, setGitHubMessage] = useState<string>("");
  const [settings] = useState<GitHubSettings>(() => {
    const saved = getGitHubSettings();
    return saved || {
      owner: "",
      repo: "",
      branch: "main",
      token: "",
      unitPath: "public/data/unit/02301",
    };
  });

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setSelectedFile(file);
      setError(null);
      setResult(null);
      setGitHubStatus("idle");
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file && (file.name.endsWith('.csv') || file.name.endsWith('.txt'))) {
      setSelectedFile(file);
      setError(null);
      setResult(null);
      setGitHubStatus("idle");
    } else {
      setError("Please drop a CSV or TXT file");
    }
  };

  const handleSubmit = async () => {
    if (!selectedFile) {
      setError("Please select a file");
      return;
    }

    setIsSubmitting(true);
    setError(null);
    setGitHubStatus("idle");

    try {
      const text = await selectedFile.text();

      // Parse Morning Report format (supports both CSV and TSV)
      const records = parseManpowerTsv(text);

      if (records.length === 0) {
        throw new Error("No valid records found in file. Make sure it contains Rank, Name, EDIPI columns.");
      }

      // Extract RUC from first record's unit code
      const firstUnit = records[0]?.unit;
      const rucMatch = firstUnit?.match(/^(\d{5})/);
      const ruc = rucMatch ? rucMatch[1] : null;

      if (!ruc) {
        throw new Error("Could not determine RUC from unit codes. Make sure unit codes start with a 5-digit RUC.");
      }

      // Get organization ID from RUC
      const org = await getOrganizationByRuc(ruc);
      if (!org) {
        throw new Error(`Organization not found for RUC ${ruc}. Please create the organization first.`);
      }

      // Convert parsed records to ManpowerRecord format
      const manpowerRecords: ManpowerRecord[] = records.map(r => ({
        edipi: r.edipi,
        name: r.name,
        rank: r.rank,
        unit: r.unit,
        category: r.category,
        dutyStatus: r.dutyStatus,
        location: r.location,
        startDate: r.startDate,
        endDate: r.endDate,
      }));

      // Import to Supabase
      const data = await importManpowerToSupabase(org.id, manpowerRecords);

      setResult({
        personnel: data.personnel,
        units: { created: data.units.created },
        nonAvailability: { created: 0 },
        errors: [...data.units.errors, ...data.personnel.errors],
      });

      if (data.personnel.created > 0 || data.personnel.updated > 0) {
        setTimeout(() => {
          onSuccess();
        }, 3000);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <Card variant="elevated" className="w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <CardHeader>
          <div>
            <CardTitle>Import Morning Report</CardTitle>
            <CardDescription>
              Upload a Morning Report to replace the current roster
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {error && (
            <div className="p-3 rounded-lg bg-error/10 border border-error/20 text-error text-sm">
              {error}
            </div>
          )}

          {result && (
            <div
              className={`p-3 rounded-lg border text-sm ${
                result.personnel.created > 0 || result.personnel.updated > 0
                  ? "bg-success/10 border-success/20 text-success"
                  : "bg-warning/10 border-warning/20 text-warning"
              }`}
            >
              <p className="font-medium">Import Results:</p>
              <ul className="mt-1 space-y-1">
                <li>Personnel Created: {result.personnel.created}</li>
                <li>Personnel Updated: {result.personnel.updated}</li>
                {result.units && result.units.created > 0 && (
                  <li>Units Created: {result.units.created}</li>
                )}
                {result.nonAvailability && result.nonAvailability.created > 0 && (
                  <li>Non-Availability Records: {result.nonAvailability.created}</li>
                )}
                {result.errors.length > 0 && (
                  <li className="text-error">
                    Errors: {result.errors.length}
                    <ul className="ml-4 mt-1 text-xs">
                      {result.errors.slice(0, 5).map((err, i) => (
                        <li key={i}>{err}</li>
                      ))}
                      {result.errors.length > 5 && (
                        <li>...and {result.errors.length - 5} more</li>
                      )}
                    </ul>
                  </li>
                )}
              </ul>

              {/* GitHub Sync Status */}
              {(result.personnel.created > 0 || result.units?.created) && (
                <div className="mt-3 pt-3 border-t border-success/20">
                  {!isGitHubConfigured() ? (
                    <p className="text-xs text-foreground-muted">
                      Configure GitHub settings to auto-sync changes to the repository.
                    </p>
                  ) : gitHubStatus === "pushing" ? (
                    <div className="flex items-center gap-2 text-foreground-muted">
                      <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                      <span className="text-xs">{gitHubMessage}</span>
                    </div>
                  ) : gitHubStatus === "success" ? (
                    <div className="flex items-center gap-2 text-success">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                      <span className="text-xs">{gitHubMessage}</span>
                    </div>
                  ) : gitHubStatus === "error" ? (
                    <div className="flex items-center gap-2 text-error">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                      <span className="text-xs">{gitHubMessage}</span>
                    </div>
                  ) : null}
                </div>
              )}
            </div>
          )}

          {/* File Upload */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-1.5">
              Morning Report File
            </label>
            <div
              className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors ${
                selectedFile
                  ? "border-success bg-success/5"
                  : isDragging
                  ? "border-primary bg-primary/10"
                  : "border-border hover:border-primary"
              }`}
              onClick={() => fileInputRef.current?.click()}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,.txt"
                onChange={handleFileChange}
                className="hidden"
              />
              {selectedFile ? (
                <div>
                  <svg
                    className="w-8 h-8 mx-auto text-success mb-2"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                    />
                  </svg>
                  <p className="text-foreground font-medium">{selectedFile.name}</p>
                  <p className="text-sm text-foreground-muted mt-1">
                    Click to change file
                  </p>
                </div>
              ) : (
                <div>
                  <svg
                    className="w-8 h-8 mx-auto text-foreground-muted mb-2"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
                    />
                  </svg>
                  <p className="text-foreground-muted">
                    Click to select or drag and drop
                  </p>
                  <p className="text-sm text-foreground-muted mt-1">
                    CSV or TXT file
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Format Help */}
          <div className="p-3 rounded-lg bg-surface-elevated border border-border">
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-medium text-foreground">
                Morning Report Format:
              </p>
              {isGitHubConfigured() && (
                <span className="flex items-center gap-1 text-xs text-success">
                  <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
                  </svg>
                  Auto-sync enabled
                </span>
              )}
            </div>
            <ul className="text-xs text-foreground-muted space-y-1">
              <li>• CSV or tab-separated file</li>
              <li>• Auto-detects header row with Rank, Name, EDIPI</li>
              <li>• Auto-creates Company, Section, Work Section units</li>
              <li>• Creates Leave/TAD non-availability records</li>
              <li>• <span className="text-warning">Replaces all existing personnel</span></li>
            </ul>
          </div>

          <div className="flex gap-3 pt-4">
            <Button
              type="button"
              variant="secondary"
              onClick={onClose}
              disabled={isSubmitting || gitHubStatus === "pushing"}
              className="flex-1"
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="accent"
              onClick={handleSubmit}
              isLoading={isSubmitting}
              disabled={isSubmitting || !selectedFile || gitHubStatus === "pushing"}
              className="flex-1"
            >
              Import
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function AddPersonnelModal({
  units,
  onClose,
  onSuccess,
}: {
  units: UnitSection[];
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    service_id: "",
    first_name: "",
    last_name: "",
    rank: "",
    phone_number: "",
    unit_section_id: "",
  });

  // Build hierarchical unit options for the dropdown
  const hierarchicalUnits = useMemo(() => {
    return buildHierarchicalUnitOptions(units);
  }, [units]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError(null);

    try {
      const newPerson: Personnel = {
        id: crypto.randomUUID(),
        service_id: formData.service_id,
        first_name: formData.first_name,
        last_name: formData.last_name,
        rank: formData.rank,
        phone_number: formData.phone_number || null,
        unit_section_id: formData.unit_section_id,
        current_duty_score: 0,
        created_at: new Date(),
        updated_at: new Date(),
      };

      createPersonnel(newPerson);
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <Card variant="elevated" className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Add Personnel</CardTitle>
          <CardDescription>
            Manually add a new service member to the roster
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="p-3 rounded-lg bg-error/10 border border-error/20 text-error text-sm">
                {error}
              </div>
            )}

            <Input
              label="Service ID"
              placeholder="e.g., 123456789"
              value={formData.service_id}
              onChange={(e) =>
                setFormData({ ...formData, service_id: e.target.value })
              }
              required
              disabled={isSubmitting}
            />

            <div className="grid grid-cols-2 gap-4">
              <Input
                label="First Name"
                placeholder="John"
                value={formData.first_name}
                onChange={(e) =>
                  setFormData({ ...formData, first_name: e.target.value })
                }
                required
                disabled={isSubmitting}
              />
              <Input
                label="Last Name"
                placeholder="Doe"
                value={formData.last_name}
                onChange={(e) =>
                  setFormData({ ...formData, last_name: e.target.value })
                }
                required
                disabled={isSubmitting}
              />
            </div>

            <Input
              label="Rank"
              placeholder="e.g., SGT, CPL, PFC"
              value={formData.rank}
              onChange={(e) =>
                setFormData({ ...formData, rank: e.target.value.toUpperCase() })
              }
              required
              disabled={isSubmitting}
            />

            <Input
              label="Phone Number"
              placeholder="e.g., (555) 123-4567"
              value={formData.phone_number}
              onChange={(e) =>
                setFormData({ ...formData, phone_number: e.target.value })
              }
              disabled={isSubmitting}
            />

            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">
                Unit
              </label>
              <select
                className="w-full px-4 py-2.5 rounded-lg bg-surface border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50 font-mono"
                value={formData.unit_section_id}
                onChange={(e) =>
                  setFormData({ ...formData, unit_section_id: e.target.value })
                }
                required
                disabled={isSubmitting}
              >
                <option value="">Select a unit...</option>
                {hierarchicalUnits.map((option) => (
                  <option key={option.id} value={option.id}>
                    {formatUnitOptionLabel(option)}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex gap-3 pt-4">
              <Button
                type="button"
                variant="secondary"
                onClick={onClose}
                disabled={isSubmitting}
                className="flex-1"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                variant="accent"
                isLoading={isSubmitting}
                disabled={isSubmitting}
                className="flex-1"
              >
                Add Personnel
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

function EditPersonnelModal({
  personnel,
  onClose,
  onSuccess,
}: {
  personnel: Personnel;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [phoneNumber, setPhoneNumber] = useState(personnel.phone_number || "");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError(null);

    try {
      await updatePersonnel(personnel.id, {
        phone_number: phoneNumber || null,
      });
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <Card variant="elevated" className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Edit Phone Number</CardTitle>
          <CardDescription>
            {personnel.rank} {personnel.last_name}, {personnel.first_name}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="p-3 rounded-lg bg-error/10 border border-error/20 text-error text-sm">
                {error}
              </div>
            )}

            <Input
              label="Phone Number"
              placeholder="e.g., (555) 123-4567"
              value={phoneNumber}
              onChange={(e) => setPhoneNumber(e.target.value)}
              disabled={isSubmitting}
              autoFocus
            />

            <div className="flex gap-3 pt-2">
              <Button
                type="button"
                variant="secondary"
                onClick={onClose}
                disabled={isSubmitting}
                className="flex-1"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                variant="accent"
                isLoading={isSubmitting}
                disabled={isSubmitting}
                className="flex-1"
              >
                Save
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
