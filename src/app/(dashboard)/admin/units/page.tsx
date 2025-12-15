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
import { useAuth } from "@/lib/client-auth";
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
  type RucEntry,
} from "@/lib/client-stores";
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

  const fetchData = useCallback(async () => {
    try {
      const data = await loadRucs();
      setRucs(data);

      // Build personnel lookup map by EDIPI for O(1) lookups
      const personnelList = getAllPersonnel();
      const personnelByEdipi = new Map(
        personnelList.map((p) => [p.service_id, p])
      );

      // Load users to show Unit Admins with personnel data
      const usersData = getAllUsers();
      setUsers(usersData.map(u => {
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
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setIsLoading(false);
    }
  }, []);

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

  const handleSaveRucName = (rucCode: string, name: string | null) => {
    const success = updateRucName(rucCode, name);
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

      {/* Edit RUC Name Modal */}
      {editingRuc && (
        <RucEditModal
          ruc={editingRuc}
          onClose={() => setEditingRuc(null)}
          onSave={handleSaveRucName}
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
                    const admins = unitAdminsByRuc.get(ruc.ruc) || [];
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
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingUnit, setEditingUnit] = useState<UnitSection | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [addingLevel, setAddingLevel] = useState<HierarchyLevel | null>(null);

  const fetchData = useCallback(() => {
    try {
      const unitsData = getUnitSections();

      // Find the top-level unit for this RUC scope
      const topUnit = unitsData.find(u => u.unit_code === scopeRuc && u.hierarchy_level === "battalion");

      if (!topUnit) {
        // If no battalion found, try to find any unit with this code
        const anyUnit = unitsData.find(u => u.unit_code === scopeRuc);
        if (anyUnit) {
          // Get all descendants of this unit
          const getDescendants = (parentId: string): UnitSection[] => {
            const children = unitsData.filter(u => u.parent_id === parentId);
            return [
              ...children,
              ...children.flatMap(child => getDescendants(child.id))
            ];
          };
          const scopedUnits = [anyUnit, ...getDescendants(anyUnit.id)];
          setUnits(scopedUnits);
        } else {
          setUnits([]);
        }
      } else {
        // Get all descendants of the top-level unit
        const getDescendants = (parentId: string): UnitSection[] => {
          const children = unitsData.filter(u => u.parent_id === parentId);
          return [
            ...children,
            ...children.flatMap(child => getDescendants(child.id))
          ];
        };
        const scopedUnits = [topUnit, ...getDescendants(topUnit.id)];
        setUnits(scopedUnits);
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

  // Get parent name lookup
  const getParentName = (parentId: string | null) => {
    if (!parentId) return null;
    const parent = units.find(u => u.id === parentId);
    return parent?.unit_name || "Unknown";
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
          Manage organizational structure for RUC: <span className="font-mono font-medium">{scopeRuc}</span>
        </p>
      </div>

      {error && (
        <div className="p-4 rounded-lg bg-error/10 border border-error/20 text-error">
          {error}
          <button onClick={() => setError(null)} className="ml-2 text-error hover:underline">Dismiss</button>
        </div>
      )}

      {/* Add/Edit Modal */}
      {showAddModal && (
        <UnitFormModal
          unit={editingUnit}
          level={addingLevel}
          units={units}
          scopeRuc={scopeRuc}
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
          units={unitsByLevel.company}
          allUnits={units}
          getParentName={getParentName}
          onAdd={() => handleAddUnit("company")}
          onEdit={handleEditUnit}
          onDelete={handleDeleteUnit}
        />

        {/* Sections */}
        <UnitLevelCard
          title="Sections"
          level="section"
          units={unitsByLevel.section}
          allUnits={units}
          getParentName={getParentName}
          onAdd={() => handleAddUnit("section")}
          onEdit={handleEditUnit}
          onDelete={handleDeleteUnit}
        />

        {/* Work Sections */}
        <UnitLevelCard
          title="Work Sections"
          level="work_section"
          units={unitsByLevel.work_section}
          allUnits={units}
          getParentName={getParentName}
          onAdd={() => handleAddUnit("work_section")}
          onEdit={handleEditUnit}
          onDelete={handleDeleteUnit}
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
}: {
  title: string;
  level: HierarchyLevel;
  units: UnitSection[];
  allUnits: UnitSection[];
  getParentName: (parentId: string | null) => string | null;
  onAdd: () => void;
  onEdit: (unit: UnitSection) => void;
  onDelete: (id: string, name: string) => void;
}) {
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
            {units.map((unit) => (
              <div
                key={unit.id}
                className="flex items-center justify-between p-3 rounded-lg bg-surface-elevated border border-border hover:border-border-light transition-colors"
              >
                <div>
                  <h3 className="font-medium text-foreground">{unit.unit_name}</h3>
                  {unit.parent_id && (
                    <p className="text-sm text-foreground-muted">
                      Parent: {getParentName(unit.parent_id)}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Button variant="ghost" size="sm" onClick={() => onEdit(unit)}>
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                    </svg>
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onDelete(unit.id, unit.unit_name)}
                    className="text-error hover:bg-error/10"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </Button>
                </div>
              </div>
            ))}
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
  scopeRuc,
  onClose,
  onSave,
}: {
  unit: UnitSection | null;
  level: HierarchyLevel | null;
  units: UnitSection[];
  scopeRuc: string;
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
            {isEditing ? "Update unit information" : `Create a new unit for RUC ${scopeRuc}`}
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

// RUC Name Edit Modal
function RucEditModal({
  ruc,
  onClose,
  onSave,
}: {
  ruc: RucEntry;
  onClose: () => void;
  onSave: (rucCode: string, name: string | null) => void;
}) {
  const [name, setName] = useState(ruc.name || "");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(ruc.ruc, name.trim() || null);
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <Card variant="elevated" className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Edit RUC Name</CardTitle>
          <CardDescription>Set a display name for RUC {ruc.ruc}</CardDescription>
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
