"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import Card, {
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import type { RoleName, UnitSection, HierarchyLevel } from "@/types";
import { useAuth } from "@/lib/supabase-auth";
import {
  getAllUsers,
  getAllPersonnel,
  loadRucs,
  getAllRucs,
  updateRucName,
  getUnitSections,
  createUnitSection,
  updateUnitSection,
  deleteUnitSection,
  invalidateCache,
  loadUnits,
  loadUsers,
  assignUserRole,
  removeUserRole,
  getSeedUserByEdipi,
  type RucEntry,
} from "@/lib/data-layer";
import {
  VIEW_MODE_KEY,
  VIEW_MODE_CHANGE_EVENT,
  VIEW_MODE_ADMIN,
  VIEW_MODE_UNIT_ADMIN,
  VIEW_MODE_USER,
  type ViewMode,
} from "@/lib/constants";
import { levelColors } from "@/lib/unit-constants";

type PageSize = 10 | 25 | 50 | 100;
const PAGE_SIZES: PageSize[] = [10, 25, 50, 100];

interface UserData {
  id: string;
  edipi: string;
  email: string;
  rank?: string;
  firstName?: string;
  lastName?: string;
  roles: Array<{
    id?: string;
    role_name: RoleName;
    scope_unit_id: string | null;
  }>;
}

export default function UnitManagementPage() {
  const { user } = useAuth();
  const [currentViewMode, setCurrentViewMode] = useState<ViewMode>(VIEW_MODE_USER);

  // Sync with view mode from localStorage
  useEffect(() => {
    const checkViewMode = () => {
      const stored = localStorage.getItem(VIEW_MODE_KEY) as ViewMode | null;
      if (stored && [VIEW_MODE_ADMIN, VIEW_MODE_UNIT_ADMIN, VIEW_MODE_USER].includes(stored)) {
        setCurrentViewMode(stored);
      }
    };

    checkViewMode();
    window.addEventListener("storage", checkViewMode);
    window.addEventListener(VIEW_MODE_CHANGE_EVENT, checkViewMode);

    return () => {
      window.removeEventListener("storage", checkViewMode);
      window.removeEventListener(VIEW_MODE_CHANGE_EVENT, checkViewMode);
    };
  }, []);

  // Check user roles
  const isAppAdmin = user?.roles?.some((r) => r.role_name === "App Admin");
  const hasUnitAdminRole = user?.roles?.some((r) => r.role_name === "Unit Admin");

  // Computed view mode booleans
  const isAdminView = currentViewMode === VIEW_MODE_ADMIN;
  const isUnitAdminView = currentViewMode === VIEW_MODE_UNIT_ADMIN;

  // Get unit admin scope
  const unitAdminScope = useMemo(() => {
    if (!user?.roles) return null;
    const unitAdminRole = user.roles.find(r => r.role_name === "Unit Admin" && r.scope_unit_id);
    return unitAdminRole?.scope_unit_id || null;
  }, [user?.roles]);

  // Show RUC table for App Admin in Admin View
  // Show Unit Hierarchy for Unit Admin in Unit Admin View
  if (isAppAdmin && isAdminView) {
    return <RucManagementView />;
  }

  if (hasUnitAdminRole && isUnitAdminView && unitAdminScope) {
    return <UnitHierarchyView scopeRuc={unitAdminScope} />;
  }

  // Fallback - show read-only message
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-foreground">Unit Management</h1>
        <p className="text-foreground-muted mt-1">
          Switch to Admin View or Unit Admin View to manage units
        </p>
      </div>
      <Card>
        <CardContent className="py-12 text-center">
          <p className="text-foreground-muted">
            Select Admin View or Unit Admin View from the toggle to access unit management.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

// ============ RUC Management View (App Admin) ============
function RucManagementView() {
  const [rucs, setRucs] = useState<RucEntry[]>([]);
  const [users, setUsers] = useState<UserData[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingRuc, setEditingRuc] = useState<RucEntry | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState<PageSize>(10);
  const [goToPage, setGoToPage] = useState("");

  // Helper to map users data with personnel info
  const mapUsersWithPersonnel = useCallback(() => {
    const personnelList = getAllPersonnel();
    const personnelByEdipi = new Map(
      personnelList.map((p) => [p.service_id, p])
    );
    const usersData = getAllUsers();
    return usersData.map(u => {
      const personnel = personnelByEdipi.get(u.edipi);
      return {
        id: u.id,
        edipi: u.edipi,
        email: u.email,
        rank: personnel?.rank,
        firstName: personnel?.first_name,
        lastName: personnel?.last_name,
        roles: (u.roles || []).map(r => ({
          id: r.id,
          role_name: r.role_name as RoleName,
          scope_unit_id: r.scope_unit_id,
        })),
      };
    });
  }, []);

  const fetchData = useCallback(async () => {
    try {
      // Load both RUCs and users from Supabase
      const [data] = await Promise.all([loadRucs(), loadUsers()]);
      setRucs(data);
      setUsers(mapUsersWithPersonnel());
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setIsLoading(false);
    }
  }, [mapUsersWithPersonnel]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Build map of RUC code -> Unit Admin(s)
  const unitAdminsByRuc = useMemo(() => {
    const map = new Map<string, UserData[]>();
    for (const user of users) {
      for (const role of user.roles) {
        if (role.role_name === "Unit Admin" && role.scope_unit_id) {
          const existing = map.get(role.scope_unit_id) || [];
          existing.push(user);
          map.set(role.scope_unit_id, existing);
        }
      }
    }
    return map;
  }, [users]);

  // Get display name for unit admin
  const getAdminDisplay = (user: UserData) => {
    if (user.rank && user.lastName) {
      return `${user.rank} ${user.lastName}, ${user.firstName || ""}`.trim();
    }
    return user.email;
  };

  // Filter RUCs based on search (case-insensitive)
  const filteredRucs = useMemo(() => {
    if (!searchQuery.trim()) return rucs;
    const q = searchQuery.toLowerCase();
    return rucs.filter(r =>
      r.ruc.toLowerCase().includes(q) ||
      (r.name && r.name.toLowerCase().includes(q))
    );
  }, [rucs, searchQuery]);

  // Pagination calculations
  const totalPages = Math.ceil(filteredRucs.length / pageSize);
  const startIndex = (currentPage - 1) * pageSize;
  const endIndex = startIndex + pageSize;
  const paginatedRucs = filteredRucs.slice(startIndex, endIndex);

  // Reset to page 1 when search or page size changes
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, pageSize]);

  const handleGoToPage = () => {
    const page = parseInt(goToPage, 10);
    if (!isNaN(page) && page >= 1 && page <= totalPages) {
      setCurrentPage(page);
      setGoToPage("");
    }
  };

  const handleSaveRucName = async (rucCode: string, name: string | null) => {
    const success = await updateRucName(rucCode, name);
    if (success) {
      // Refresh from cache (spread to create new array reference for React)
      setRucs([...getAllRucs()]);
      setEditingRuc(null);
    } else {
      setError("Failed to update RUC name");
    }
  };

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
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Unit Management</h1>
          <p className="text-foreground-muted mt-1">
            Manage RUC reference data and unit administrators ({rucs.length} total RUCs)
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Input
            placeholder="Search RUC or name..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-64"
          />
        </div>
      </div>

      {error && (
        <div className="p-4 rounded-lg bg-error/10 border border-error/20 text-error">
          {error}
          <button onClick={() => setError(null)} className="ml-2 text-error hover:underline">Dismiss</button>
        </div>
      )}

      {/* Edit RUC Settings Modal */}
      {editingRuc && (
        <RucEditModal
          ruc={editingRuc}
          currentAdmins={unitAdminsByRuc.get(editingRuc.id) || []}
          onClose={() => setEditingRuc(null)}
          onSave={handleSaveRucName}
          onRefresh={() => setUsers(mapUsersWithPersonnel())}
          getAdminDisplay={getAdminDisplay}
        />
      )}

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>RUC Reference Data</CardTitle>
              <CardDescription>
                {(() => {
                  if (searchQuery.trim()) {
                    return `${filteredRucs.length} results found`;
                  }
                  const startItem = filteredRucs.length > 0 ? startIndex + 1 : 0;
                  const endItem = Math.min(endIndex, filteredRucs.length);
                  return `Showing ${startItem}-${endItem} of ${filteredRucs.length}`;
                })()}
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm text-foreground-muted">Per page:</span>
              <select
                className="px-3 py-1.5 rounded-lg bg-surface border border-border text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                value={pageSize}
                onChange={(e) => setPageSize(Number(e.target.value) as PageSize)}
              >
                {PAGE_SIZES.map(size => (
                  <option key={size} value={size}>{size}</option>
                ))}
              </select>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {paginatedRucs.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-foreground-muted">
                {searchQuery ? "No RUCs match your search" : "No RUCs loaded"}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left py-3 px-4 text-sm font-medium text-foreground-muted w-32">RUC</th>
                    <th className="text-left py-3 px-4 text-sm font-medium text-foreground-muted">Unit Name</th>
                    <th className="text-left py-3 px-4 text-sm font-medium text-foreground-muted">Unit Admin</th>
                    <th className="text-right py-3 px-4 text-sm font-medium text-foreground-muted w-24">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedRucs.map((ruc) => {
                    const admins = unitAdminsByRuc.get(ruc.id) || [];
                    return (
                      <tr key={ruc.ruc} className="border-b border-border hover:bg-surface-elevated">
                        <td className="py-3 px-4">
                          <span className="font-mono text-foreground font-medium">{ruc.ruc}</span>
                        </td>
                        <td className="py-3 px-4">
                          {ruc.name ? (
                            <span className="text-foreground">{ruc.name}</span>
                          ) : (
                            <span className="text-foreground-muted italic">Not set</span>
                          )}
                        </td>
                        <td className="py-3 px-4">
                          {admins.length > 0 ? (
                            <div className="flex flex-col gap-1">
                              {admins.map((admin) => (
                                <span key={admin.id} className="text-sm text-foreground">
                                  {getAdminDisplay(admin)}
                                </span>
                              ))}
                            </div>
                          ) : (
                            <span className="text-foreground-muted italic text-sm">None assigned</span>
                          )}
                        </td>
                        <td className="py-3 px-4 text-right">
                          <Button variant="ghost" size="sm" onClick={() => setEditingRuc(ruc)}>
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                            </svg>
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Pagination Controls */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-4 pt-4 border-t border-border">
              <div className="flex items-center gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setCurrentPage(1)}
                  disabled={currentPage === 1}
                >
                  First
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                >
                  Previous
                </Button>
              </div>

              <div className="flex items-center gap-3">
                <span className="text-sm text-foreground-muted">
                  Page {currentPage} of {totalPages}
                </span>
                <div className="flex items-center gap-2">
                  <Input
                    placeholder="Go to"
                    value={goToPage}
                    onChange={(e) => setGoToPage(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleGoToPage()}
                    className="w-20 text-sm"
                  />
                  <Button variant="secondary" size="sm" onClick={handleGoToPage}>
                    Go
                  </Button>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                  disabled={currentPage === totalPages}
                >
                  Next
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setCurrentPage(totalPages)}
                  disabled={currentPage === totalPages}
                >
                  Last
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ============ Unit Hierarchy View (Unit Admin) ============
function UnitHierarchyView({ scopeRuc }: { scopeRuc: string }) {
  const [units, setUnits] = useState<UnitSection[]>([]);
  const [scopeUnit, setScopeUnit] = useState<UnitSection | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingUnit, setEditingUnit] = useState<UnitSection | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [addingLevel, setAddingLevel] = useState<HierarchyLevel | null>(null);

  // Filter state - track selected unit to filter by
  const [filterUnit, setFilterUnit] = useState<UnitSection | null>(null);

  const fetchData = useCallback(() => {
    // Invalidate cache to ensure we get fresh data
    invalidateCache("dutysync_units");
    try {
      const unitsData = getUnitSections();

      // scopeRuc is actually the unit ID (scope_unit_id from the role)
      // First try to find the unit by ID
      let topUnit = unitsData.find(u => u.id === scopeRuc);

      // If not found by ID, try by unit_code (legacy support)
      if (!topUnit) {
        topUnit = unitsData.find(u => u.unit_code === scopeRuc && u.hierarchy_level === "battalion");
      }
      if (!topUnit) {
        topUnit = unitsData.find(u => u.unit_code === scopeRuc);
      }

      if (topUnit) {
        setScopeUnit(topUnit);
        // Get all descendants of this unit
        const getDescendants = (parentId: string): UnitSection[] => {
          const children = unitsData.filter(u => u.parent_id === parentId);
          return [
            ...children,
            ...children.flatMap(child => getDescendants(child.id))
          ];
        };
        const scopedUnits = [topUnit, ...getDescendants(topUnit.id)];
        setUnits(scopedUnits);
      } else {
        setScopeUnit(null);
        setUnits([]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setIsLoading(false);
    }
  }, [scopeRuc]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Group units by hierarchy level
  const unitsByLevel = useMemo(() => {
    const grouped: Record<HierarchyLevel, UnitSection[]> = {
      unit: [],
      ruc: [],
      battalion: [],
      company: [],
      section: [],
      work_section: [],
    };
    units.forEach(u => {
      if (grouped[u.hierarchy_level]) {
        grouped[u.hierarchy_level].push(u);
      }
    });
    return grouped;
  }, [units]);

  // Get all descendant IDs of a unit (recursive)
  const getDescendantIds = useCallback((parentId: string): Set<string> => {
    const result = new Set<string>();
    const children = units.filter(u => u.parent_id === parentId);
    for (const child of children) {
      result.add(child.id);
      const grandChildren = getDescendantIds(child.id);
      grandChildren.forEach(id => result.add(id));
    }
    return result;
  }, [units]);

  // Filter units based on selected filter
  const filteredUnitsByLevel = useMemo(() => {
    if (!filterUnit) {
      return unitsByLevel;
    }

    // Get all descendants of the filter unit
    const allowedIds = new Set<string>([filterUnit.id]);
    const descendants = getDescendantIds(filterUnit.id);
    descendants.forEach(id => allowedIds.add(id));

    // Filter each level to only show units in the allowed set
    const filtered: Record<HierarchyLevel, UnitSection[]> = {
      unit: [],
      ruc: [],
      battalion: [],
      company: [],
      section: [],
      work_section: [],
    };

    for (const level of Object.keys(filtered) as HierarchyLevel[]) {
      filtered[level] = unitsByLevel[level].filter(u => allowedIds.has(u.id));
    }

    return filtered;
  }, [unitsByLevel, filterUnit, getDescendantIds]);

  // Get parent name lookup
  const getParentName = (parentId: string | null) => {
    if (!parentId) return null;
    const parent = units.find(u => u.id === parentId);
    return parent?.unit_name || "Unknown";
  };

  // Build filter breadcrumb path
  const filterBreadcrumb = useMemo(() => {
    if (!filterUnit) return [];

    const path: UnitSection[] = [filterUnit];
    let current = filterUnit;

    while (current.parent_id) {
      const parent = units.find(u => u.id === current.parent_id);
      if (parent) {
        path.unshift(parent);
        current = parent;
      } else {
        break;
      }
    }

    return path;
  }, [filterUnit, units]);

  // Handle clicking on a unit to filter
  const handleUnitClick = (unit: UnitSection) => {
    // If clicking the same unit, clear the filter
    if (filterUnit?.id === unit.id) {
      setFilterUnit(null);
    } else {
      setFilterUnit(unit);
    }
  };

  // Clear the filter
  const clearFilter = () => {
    setFilterUnit(null);
  };

  const handleAddUnit = (level: HierarchyLevel) => {
    setAddingLevel(level);
    setShowAddModal(true);
  };

  const handleEditUnit = (unit: UnitSection) => {
    setEditingUnit(unit);
    setShowAddModal(true);
  };

  const handleDeleteUnit = (unitId: string, unitName: string) => {
    if (!confirm(`Are you sure you want to delete "${unitName}"? This cannot be undone.`)) {
      return;
    }
    try {
      deleteUnitSection(unitId);
      fetchData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete unit");
    }
  };

  const handleSaveUnit = (data: { unit_name: string; hierarchy_level: HierarchyLevel; parent_id: string | null }) => {
    try {
      if (editingUnit) {
        updateUnitSection(editingUnit.id, data);
      } else {
        const newUnit: UnitSection = {
          id: crypto.randomUUID(),
          ...data,
          created_at: new Date(),
          updated_at: new Date(),
        };
        createUnitSection(newUnit);
      }
      setShowAddModal(false);
      setEditingUnit(null);
      setAddingLevel(null);
      fetchData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save unit");
    }
  };

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
      <div>
        <h1 className="text-3xl font-bold text-foreground">Unit Management</h1>
        <p className="text-foreground-muted mt-1">
          Manage organizational structure for{" "}
          {scopeUnit ? (
            <>
              <span className="font-medium text-foreground">{scopeUnit.unit_name}</span>
              {scopeUnit.unit_code && (
                <span className="text-foreground-muted"> ({scopeUnit.unit_code})</span>
              )}
            </>
          ) : (
            <span className="font-mono font-medium">{scopeRuc}</span>
          )}
        </p>
      </div>

      {error && (
        <div className="p-4 rounded-lg bg-error/10 border border-error/20 text-error">
          {error}
          <button onClick={() => setError(null)} className="ml-2 text-error hover:underline">Dismiss</button>
        </div>
      )}

      {/* Filter Indicator / Breadcrumb */}
      {filterUnit && (
        <div className="bg-primary/10 border border-primary/20 rounded-lg p-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-sm text-foreground-muted">Filtering by:</span>
              <div className="flex items-center gap-1">
                {filterBreadcrumb.map((unit, idx) => (
                  <span key={unit.id} className="flex items-center">
                    {idx > 0 && (
                      <svg className="w-4 h-4 text-foreground-muted mx-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                    )}
                    <button
                      onClick={() => setFilterUnit(unit)}
                      className={`px-2 py-0.5 text-sm rounded transition-colors ${
                        unit.id === filterUnit.id
                          ? "bg-primary text-white font-medium"
                          : "text-foreground hover:bg-primary/20"
                      }`}
                    >
                      {unit.unit_name}
                    </button>
                  </span>
                ))}
              </div>
            </div>
            <Button variant="ghost" size="sm" onClick={clearFilter}>
              <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
              Clear Filter
            </Button>
          </div>
          <p className="text-xs text-foreground-muted mt-2">
            Click on any unit below to drill down further, or click the same unit again to go back up.
          </p>
        </div>
      )}

      {/* Add/Edit Modal */}
      {showAddModal && (
        <UnitFormModal
          unit={editingUnit}
          level={addingLevel}
          units={units}
          scopeUnit={scopeUnit}
          onClose={() => {
            setShowAddModal(false);
            setEditingUnit(null);
            setAddingLevel(null);
          }}
          onSave={handleSaveUnit}
        />
      )}

      {/* Unit Hierarchy Cards */}
      <div className="grid gap-6">
        {/* Companies */}
        <UnitLevelCard
          title="Companies"
          level="company"
          units={filteredUnitsByLevel.company}
          allUnits={units}
          getParentName={getParentName}
          onAdd={() => handleAddUnit("company")}
          onEdit={handleEditUnit}
          onDelete={handleDeleteUnit}
          onSelect={handleUnitClick}
          selectedUnitId={filterUnit?.id || null}
        />

        {/* Sections */}
        <UnitLevelCard
          title="Sections"
          level="section"
          units={filteredUnitsByLevel.section}
          allUnits={units}
          getParentName={getParentName}
          onAdd={() => handleAddUnit("section")}
          onEdit={handleEditUnit}
          onDelete={handleDeleteUnit}
          onSelect={handleUnitClick}
          selectedUnitId={filterUnit?.id || null}
        />

        {/* Work Sections */}
        <UnitLevelCard
          title="Work Sections"
          level="work_section"
          units={filteredUnitsByLevel.work_section}
          allUnits={units}
          getParentName={getParentName}
          onAdd={() => handleAddUnit("work_section")}
          onEdit={handleEditUnit}
          onDelete={handleDeleteUnit}
          onSelect={handleUnitClick}
          selectedUnitId={filterUnit?.id || null}
        />
      </div>
    </div>
  );
}

// Unit Level Card Component
function UnitLevelCard({
  title,
  level,
  units,
  allUnits,
  getParentName,
  onAdd,
  onEdit,
  onDelete,
  onSelect,
  selectedUnitId,
}: {
  title: string;
  level: HierarchyLevel;
  units: UnitSection[];
  allUnits: UnitSection[];
  getParentName: (parentId: string | null) => string | null;
  onAdd: () => void;
  onEdit: (unit: UnitSection) => void;
  onDelete: (id: string, name: string) => void;
  onSelect: (unit: UnitSection) => void;
  selectedUnitId: string | null;
}) {
  // Count children for each unit
  const getChildCount = (unitId: string): number => {
    return allUnits.filter(u => u.parent_id === unitId).length;
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className={`px-2.5 py-1 text-xs font-medium rounded border ${levelColors[level]}`}>
              {level.replace("_", " ").toUpperCase()}
            </span>
            <CardTitle className="text-lg">{title}</CardTitle>
            <span className="text-foreground-muted text-sm">({units.length})</span>
          </div>
          <Button size="sm" onClick={onAdd}>
            <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Add {title.slice(0, -1)}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {units.length === 0 ? (
          <p className="text-foreground-muted text-center py-4">No {title.toLowerCase()} defined yet</p>
        ) : (
          <div className="space-y-2">
            {units.map((unit) => {
              const childCount = getChildCount(unit.id);
              const isSelected = selectedUnitId === unit.id;
              const hasChildren = childCount > 0;

              return (
                <div
                  key={unit.id}
                  className={`flex items-center justify-between p-3 rounded-lg border transition-colors ${
                    isSelected
                      ? "bg-primary/20 border-primary"
                      : "bg-surface-elevated border-border hover:border-border-light"
                  }`}
                >
                  {/* Clickable area for filtering */}
                  <button
                    onClick={() => onSelect(unit)}
                    className="flex-1 text-left flex items-center gap-3"
                  >
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <h3 className="font-medium text-foreground">{unit.unit_name}</h3>
                        {hasChildren && (
                          <span className="px-1.5 py-0.5 text-xs rounded bg-highlight/20 text-highlight">
                            {childCount} {childCount === 1 ? "child" : "children"}
                          </span>
                        )}
                        {isSelected && (
                          <span className="px-1.5 py-0.5 text-xs rounded bg-primary text-white">
                            Filtered
                          </span>
                        )}
                      </div>
                      {unit.parent_id && (
                        <p className="text-sm text-foreground-muted">
                          Parent: {getParentName(unit.parent_id)}
                        </p>
                      )}
                    </div>
                    {hasChildren && !isSelected && (
                      <svg className="w-5 h-5 text-foreground-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                    )}
                  </button>

                  {/* Action buttons */}
                  <div className="flex items-center gap-1 ml-2">
                    <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); onEdit(unit); }}>
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                      </svg>
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={(e) => { e.stopPropagation(); onDelete(unit.id, unit.unit_name); }}
                      className="text-error hover:bg-error/10"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// Unit Form Modal
function UnitFormModal({
  unit,
  level,
  units,
  scopeUnit,
  onClose,
  onSave,
}: {
  unit: UnitSection | null;
  level: HierarchyLevel | null;
  units: UnitSection[];
  scopeUnit: UnitSection | null;
  onClose: () => void;
  onSave: (data: { unit_name: string; hierarchy_level: HierarchyLevel; parent_id: string | null }) => void;
}) {
  const isEditing = !!unit;
  const [formData, setFormData] = useState({
    unit_name: unit?.unit_name || "",
    hierarchy_level: unit?.hierarchy_level || level || "company",
    parent_id: unit?.parent_id || "",
  });

  // Get possible parents based on hierarchy level
  const getPossibleParents = () => {
    switch (formData.hierarchy_level) {
      case "company":
        return []; // Companies have no parent in this simplified view
      case "section":
        return units.filter((u) => u.hierarchy_level === "company");
      case "work_section":
        return units.filter((u) => u.hierarchy_level === "section");
      default:
        return [];
    }
  };

  const possibleParents = getPossibleParents();
  const needsParent = formData.hierarchy_level !== "company" && formData.hierarchy_level !== "battalion";

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave({
      unit_name: formData.unit_name,
      hierarchy_level: formData.hierarchy_level as HierarchyLevel,
      parent_id: formData.parent_id || null,
    });
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <Card variant="elevated" className="w-full max-w-md">
        <CardHeader>
          <CardTitle>{isEditing ? "Edit Unit" : "Add New Unit"}</CardTitle>
          <CardDescription>
            {isEditing
              ? "Update unit information"
              : scopeUnit
                ? `Create a new unit under ${scopeUnit.unit_name}`
                : "Create a new unit"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <Input
              label="Unit Name"
              placeholder="e.g., Alpha Company, S1 Section"
              value={formData.unit_name}
              onChange={(e) => setFormData({ ...formData, unit_name: e.target.value })}
              required
            />

            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">Hierarchy Level</label>
              <select
                className="w-full px-4 py-2.5 rounded-lg bg-surface border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                value={formData.hierarchy_level}
                onChange={(e) => setFormData({ ...formData, hierarchy_level: e.target.value as HierarchyLevel, parent_id: "" })}
                disabled={isEditing}
              >
                <option value="company">Company</option>
                <option value="section">Section</option>
                <option value="work_section">Work Section</option>
              </select>
            </div>

            {needsParent && (
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">Parent Unit</label>
                <select
                  className="w-full px-4 py-2.5 rounded-lg bg-surface border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                  value={formData.parent_id}
                  onChange={(e) => setFormData({ ...formData, parent_id: e.target.value })}
                  required
                >
                  <option value="">Select parent unit...</option>
                  {possibleParents.map((p) => (
                    <option key={p.id} value={p.id}>{p.unit_name}</option>
                  ))}
                </select>
                {possibleParents.length === 0 && (
                  <p className="text-xs text-warning mt-1">
                    Create a {formData.hierarchy_level === "section" ? "Company" : "Section"} first
                  </p>
                )}
              </div>
            )}

            <div className="flex gap-3 pt-4">
              <Button type="button" variant="secondary" onClick={onClose} className="flex-1">
                Cancel
              </Button>
              <Button
                type="submit"
                variant="accent"
                className="flex-1"
                disabled={needsParent && possibleParents.length === 0}
              >
                {isEditing ? "Save Changes" : "Add Unit"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

// Role constant to avoid magic strings
const UNIT_ADMIN_ROLE: RoleName = "Unit Admin";

// RUC Name Edit Modal
function RucEditModal({
  ruc,
  currentAdmins,
  onClose,
  onSave,
  onRefresh,
  getAdminDisplay,
}: {
  ruc: RucEntry;
  currentAdmins: UserData[];
  onClose: () => void;
  onSave: (rucCode: string, name: string | null) => void;
  onRefresh: () => void;
  getAdminDisplay: (user: UserData) => string;
}) {
  const [name, setName] = useState(ruc.name || "");
  const [adminEdipi, setAdminEdipi] = useState("");
  const [adminError, setAdminError] = useState<string | null>(null);
  const [isAssigning, setIsAssigning] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(ruc.ruc, name.trim() || null);
  };

  const handleAssignAdmin = async () => {
    if (!adminEdipi.trim()) {
      setAdminError("Please enter an EDIPI");
      return;
    }

    setIsAssigning(true);
    setAdminError(null);

    try {
      // Look up user by EDIPI
      const user = getSeedUserByEdipi(adminEdipi.trim());
      if (!user) {
        setAdminError("User not found with that EDIPI. User must be registered first.");
        return;
      }

      // Check if user already has Unit Admin role for this RUC
      const existingRole = user.roles.find(
        r => r.role_name === UNIT_ADMIN_ROLE && r.scope_unit_id === ruc.id
      );
      if (existingRole) {
        setAdminError("User is already a Unit Admin for this RUC");
        return;
      }

      // Remove any existing Unit Admin role for other RUCs (a user can only admin one RUC)
      const otherUnitAdminRole = user.roles.find(
        r => r.role_name === UNIT_ADMIN_ROLE && r.scope_unit_id !== ruc.id
      );
      if (otherUnitAdminRole) {
        await removeUserRole(user.id, UNIT_ADMIN_ROLE, otherUnitAdminRole.scope_unit_id);
      }

      // Assign the Unit Admin role
      const success = await assignUserRole(user.id, UNIT_ADMIN_ROLE, ruc.id);
      if (!success) {
        setAdminError("Failed to assign Unit Admin role");
        return;
      }

      // Refresh the user list
      await loadUsers();
      setAdminEdipi("");
      onRefresh();
    } catch (err) {
      setAdminError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setIsAssigning(false);
    }
  };

  const handleRemoveAdmin = async (admin: UserData) => {
    setIsAssigning(true);
    setAdminError(null);

    try {
      const unitAdminRole = admin.roles.find(
        r => r.role_name === UNIT_ADMIN_ROLE && r.scope_unit_id === ruc.id
      );
      if (unitAdminRole) {
        await removeUserRole(admin.id, UNIT_ADMIN_ROLE, ruc.id);
        await loadUsers();
        onRefresh();
      }
    } catch (err) {
      setAdminError(err instanceof Error ? err.message : "Failed to remove admin");
    } finally {
      setIsAssigning(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <Card variant="elevated" className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Edit RUC Settings</CardTitle>
          <CardDescription>Configure RUC {ruc.ruc}</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="p-3 rounded-lg bg-surface-elevated border border-border">
              <label className="block text-sm font-medium text-foreground-muted mb-1">RUC Code</label>
              <span className="font-mono text-lg text-foreground">{ruc.ruc}</span>
            </div>
            <Input
              label="Unit Name"
              placeholder="e.g., 1st Battalion, Alpha Company"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
            />

            {/* Unit Admin Section */}
            <div className="pt-4 border-t border-border">
              <label className="block text-sm font-medium text-foreground mb-2">Unit Administrator</label>

              {/* Current Admins */}
              {currentAdmins.length > 0 ? (
                <div className="space-y-2 mb-3">
                  {currentAdmins.map((admin) => (
                    <div
                      key={admin.id}
                      className="flex items-center justify-between p-2 rounded-lg bg-surface border border-border"
                    >
                      <div>
                        <span className="text-sm text-foreground">
                          {getAdminDisplay(admin)}
                        </span>
                        <span className="text-xs text-foreground-muted ml-2">({admin.edipi})</span>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => handleRemoveAdmin(admin)}
                        disabled={isAssigning}
                        className="text-error hover:bg-error/10"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </Button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-foreground-muted mb-3">No Unit Admin assigned</p>
              )}

              {/* Add Admin by EDIPI */}
              <div className="flex gap-2">
                <Input
                  placeholder="Enter EDIPI..."
                  value={adminEdipi}
                  onChange={(e) => {
                    setAdminEdipi(e.target.value);
                    setAdminError(null);
                  }}
                  className="flex-1"
                />
                <Button
                  type="button"
                  variant="secondary"
                  onClick={handleAssignAdmin}
                  disabled={isAssigning || !adminEdipi.trim()}
                >
                  {isAssigning ? "..." : "Add"}
                </Button>
              </div>
              {adminError && (
                <p className="text-xs text-error mt-1">{adminError}</p>
              )}
              <p className="text-xs text-foreground-muted mt-1">
                Enter the EDIPI of a registered user to assign as Unit Admin
              </p>
            </div>

            <div className="flex gap-3 pt-2">
              <Button type="button" variant="secondary" onClick={onClose} className="flex-1">
                Cancel
              </Button>
              <Button type="submit" variant="accent" className="flex-1">
                Save
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
