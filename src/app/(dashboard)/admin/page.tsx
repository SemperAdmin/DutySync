"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import Card, { CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import { useAuth } from "@/lib/client-auth";
import type { UnitSection, HierarchyLevel, RoleName, Personnel } from "@/types";
import {
  getUnitSections,
  createUnitSection,
  updateUnitSection,
  deleteUnitSection,
  getAllUsers,
  getAllPersonnel,
  assignUserRole,
  removeUserRole,
  deleteUser,
  loadRucs,
  getAllRucs,
  updateRucName,
  getSeedUserByEdipi,
  type RucEntry,
} from "@/lib/client-stores";
import {
  isGitHubConfigured,
  triggerUpdateUserRolesWorkflow,
  triggerDeleteUserWorkflow,
} from "@/lib/github-api";

// Manager role names - a user can only have one of these at a time
const MANAGER_ROLES: RoleName[] = [
  "Unit Manager",
  "Company Manager",
  "Platoon Manager",
  "Section Manager",
];
import { levelColors } from "@/lib/unit-constants";
import { VIEW_MODE_KEY, VIEW_MODE_CHANGE_EVENT } from "@/lib/constants";
import UserDashboard from "@/components/dashboard/UserDashboard";

type PageSize = 10 | 25 | 50 | 100;
const PAGE_SIZES: PageSize[] = [10, 25, 50, 100];

interface RucEditModalProps {
  ruc: RucEntry;
  onClose: () => void;
  onSave: (rucCode: string, name: string | null) => void;
}

interface UserData {
  id: string;
  edipi: string;
  email: string;
  personnel_id: string | null;
  roles: Array<{
    id?: string;
    role_name: RoleName;
    scope_unit_id: string | null;
  }>;
}

export default function AdminDashboard() {
  const { user } = useAuth();
  const isAppAdmin = user?.roles?.some((role) => role.role_name === "App Admin");
  const [activeTab, setActiveTab] = useState<"units" | "users">("units");
  const [isAdminView, setIsAdminView] = useState(true);

  // Sync with view mode from localStorage (set by DashboardLayout)
  useEffect(() => {
    const checkViewMode = () => {
      const stored = localStorage.getItem(VIEW_MODE_KEY);
      setIsAdminView(stored !== "user");
    };

    // Check on mount
    checkViewMode();

    // Listen for storage changes (cross-tab updates)
    window.addEventListener("storage", checkViewMode);

    // Listen for custom viewModeChange event (same-tab updates)
    window.addEventListener(VIEW_MODE_CHANGE_EVENT, checkViewMode);

    return () => {
      window.removeEventListener("storage", checkViewMode);
      window.removeEventListener(VIEW_MODE_CHANGE_EVENT, checkViewMode);
    };
  }, []);

  // If App Admin in admin view mode, show App Admin Dashboard
  // Otherwise, show UserDashboard (ManagerDashboard is on its own route /admin/manager)
  if (!isAppAdmin || !isAdminView) {
    return <UserDashboard />;
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-foreground">App Admin Dashboard</h1>
        <p className="text-foreground-muted mt-1">
          Manage all units and users across the application
        </p>
      </div>

      {/* Tabs */}
      <div className="border-b border-border">
        <nav className="flex gap-4" aria-label="Tabs">
          <button
            onClick={() => setActiveTab("units")}
            className={`py-3 px-1 border-b-2 font-medium text-sm transition-colors ${
              activeTab === "units"
                ? "border-primary text-primary"
                : "border-transparent text-foreground-muted hover:text-foreground hover:border-border"
            }`}
          >
            <div className="flex items-center gap-2">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
              </svg>
              All Units
            </div>
          </button>
          <button
            onClick={() => setActiveTab("users")}
            className={`py-3 px-1 border-b-2 font-medium text-sm transition-colors ${
              activeTab === "users"
                ? "border-primary text-primary"
                : "border-transparent text-foreground-muted hover:text-foreground hover:border-border"
            }`}
          >
            <div className="flex items-center gap-2">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
              </svg>
              All Users
            </div>
          </button>
        </nav>
      </div>

      {/* Tab Content */}
      {activeTab === "units" && <UnitsTab />}
      {activeTab === "users" && <UsersTab />}
    </div>
  );
}

// ============ Units Tab (RUC Reference Data) ============
function UnitsTab() {
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

      // Load users to show Unit Admins
      const usersData = getAllUsers();
      setUsers(usersData.map(u => ({
        id: u.id,
        edipi: u.edipi,
        email: u.email,
        personnel_id: u.personnel_id || null,
        roles: (u.roles || []).map(r => ({
          id: r.id,
          role_name: r.role_name as RoleName,
          scope_unit_id: r.scope_unit_id,
        })),
      })));
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
    // Show email (most reliable) - could enhance with personnel lookup if needed
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
          <h2 className="text-xl font-semibold text-foreground">RUC Reference Data</h2>
          <p className="text-sm text-foreground-muted">{rucs.length} total RUCs</p>
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
              <CardTitle>Unit Codes</CardTitle>
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

// RUC Name Edit Modal
function RucEditModal({ ruc, onClose, onSave }: RucEditModalProps) {
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

function UnitHierarchyCard({
  title,
  level,
  units,
  allUnits,
  onEdit,
  onDelete,
}: {
  title: string;
  level: HierarchyLevel;
  units: UnitSection[];
  allUnits: UnitSection[];
  onEdit: (unit: UnitSection) => void;
  onDelete: (id: string, name: string) => void;
}) {
  // Memoize parent name lookups for better performance
  const parentNameMap = useMemo(() => {
    return allUnits.reduce((acc, unit) => {
      acc[unit.id] = unit.unit_name;
      return acc;
    }, {} as Record<string, string>);
  }, [allUnits]);

  const getParentName = (parentId: string | null) => {
    if (!parentId) return null;
    return parentNameMap[parentId] || "Unknown";
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-lg">
          <span className={`px-2 py-0.5 text-xs font-medium rounded border ${levelColors[level]}`}>
            {level.toUpperCase()}
          </span>
          {title}
          <span className="text-foreground-muted text-sm font-normal">({units.length})</span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {units.map((unit) => (
            <div key={unit.id} className="flex items-center justify-between p-3 rounded-lg bg-surface-elevated border border-border hover:border-border-light transition-colors">
              <div>
                <h3 className="font-medium text-foreground">{unit.unit_name}</h3>
                {unit.parent_id && <p className="text-sm text-foreground-muted">Parent: {getParentName(unit.parent_id)}</p>}
              </div>
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="sm" onClick={() => onEdit(unit)}>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                  </svg>
                </Button>
                <Button variant="ghost" size="sm" onClick={() => onDelete(unit.id, unit.unit_name)} className="text-error hover:bg-error/10">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </Button>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function UnitForm({ unit, units, onClose, onSuccess }: { unit: UnitSection | null; units: UnitSection[]; onClose: () => void; onSuccess: () => void; }) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    unit_name: unit?.unit_name || "",
    hierarchy_level: unit?.hierarchy_level || "battalion",
    parent_id: unit?.parent_id || "",
  });

  const isEditing = !!unit;

  const getPossibleParents = () => {
    switch (formData.hierarchy_level) {
      case "company": return units.filter((u) => u.hierarchy_level === "battalion");
      case "platoon": return units.filter((u) => u.hierarchy_level === "company");
      case "section": return units.filter((u) => u.hierarchy_level === "platoon");
      default: return [];
    }
  };

  const possibleParents = getPossibleParents();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError(null);

    try {
      const unitData = {
        unit_name: formData.unit_name,
        hierarchy_level: formData.hierarchy_level as HierarchyLevel,
        parent_id: formData.parent_id || null,
      };

      if (isEditing && unit) {
        updateUnitSection(unit.id, unitData);
      } else {
        const newUnit: UnitSection = {
          id: crypto.randomUUID(),
          ...unitData,
          created_at: new Date(),
          updated_at: new Date(),
        };
        createUnitSection(newUnit);
      }
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
          <CardTitle>{isEditing ? "Edit Unit" : "Add New Unit"}</CardTitle>
          <CardDescription>{isEditing ? "Update the unit information" : "Create a new unit"}</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && <div className="p-3 rounded-lg bg-error/10 border border-error/20 text-error text-sm">{error}</div>}
            <Input label="Unit Name" placeholder="e.g., 1st Battalion" value={formData.unit_name} onChange={(e) => setFormData({ ...formData, unit_name: e.target.value })} required disabled={isSubmitting} />
            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">Hierarchy Level</label>
              <select className="w-full px-4 py-2.5 rounded-lg bg-surface border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-primary" value={formData.hierarchy_level} onChange={(e) => setFormData({ ...formData, hierarchy_level: e.target.value as HierarchyLevel, parent_id: "" })} disabled={isSubmitting || isEditing}>
                <option value="battalion">Battalion</option>
                <option value="company">Company</option>
                <option value="platoon">Platoon</option>
                <option value="section">Section</option>
              </select>
            </div>
            {formData.hierarchy_level !== "battalion" && (
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">Parent Unit</label>
                <select className="w-full px-4 py-2.5 rounded-lg bg-surface border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-primary" value={formData.parent_id} onChange={(e) => setFormData({ ...formData, parent_id: e.target.value })} required disabled={isSubmitting}>
                  <option value="">Select parent unit...</option>
                  {possibleParents.map((p) => <option key={p.id} value={p.id}>{p.unit_name}</option>)}
                </select>
              </div>
            )}
            <div className="flex gap-3 pt-4">
              <Button type="button" variant="secondary" onClick={onClose} disabled={isSubmitting} className="flex-1">Cancel</Button>
              <Button type="submit" variant="accent" isLoading={isSubmitting} disabled={isSubmitting || (formData.hierarchy_level !== "battalion" && possibleParents.length === 0)} className="flex-1">{isEditing ? "Save Changes" : "Add Unit"}</Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

// ============ Users Tab ============
function UsersTab() {
  const [users, setUsers] = useState<UserData[]>([]);
  const [units, setUnits] = useState<UnitSection[]>([]);
  const [personnel, setPersonnel] = useState<Personnel[]>([]);
  const [rucs, setRucs] = useState<RucEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingUser, setEditingUser] = useState<UserData | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  const fetchData = useCallback(async () => {
    try {
      const usersData = getAllUsers();
      const unitsData = getUnitSections();
      const personnelData = getAllPersonnel();

      // Load RUCs from the reference file
      const rucsData = await loadRucs();
      setRucs(rucsData);

      setUsers(usersData.map(u => ({
        id: u.id,
        edipi: u.edipi,
        email: u.email,
        personnel_id: u.personnel_id || null,
        roles: (u.roles || []).map(r => ({
          id: r.id,
          role_name: r.role_name as RoleName,
          scope_unit_id: r.scope_unit_id,
        })),
      })));
      setUnits(unitsData);
      setPersonnel(personnelData);
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const getRoleColor = (roleName: RoleName) => {
    switch (roleName) {
      case "App Admin": return "bg-highlight/20 text-highlight border-highlight/30";
      case "Unit Admin": return "bg-primary/20 text-blue-400 border-primary/30";
      default: return "bg-foreground-muted/20 text-foreground-muted border-foreground-muted/30";
    }
  };

  // Create a Map of personnel by EDIPI for O(1) lookups
  const personnelByEdipi = useMemo(() => {
    return new Map(personnel.map(p => [p.service_id, p]));
  }, [personnel]);

  // Get personnel info for a user by their EDIPI
  const getPersonnelInfo = (edipi: string): Personnel | undefined => {
    return personnelByEdipi.get(edipi);
  };

  // Memoize RUC name lookups for better performance
  const rucNameMap = useMemo(() => {
    return rucs.reduce((acc, ruc) => {
      acc[ruc.ruc] = ruc.name ? `${ruc.ruc} - ${ruc.name}` : ruc.ruc;
      return acc;
    }, {} as Record<string, string>);
  }, [rucs]);

  const getRucDisplayName = (rucCode: string | null) => {
    if (!rucCode) return null;
    return rucNameMap[rucCode] || rucCode;
  };

  // Filter users based on search query (EDIPI, name, or email)
  const filteredUsers = useMemo(() => {
    if (!searchQuery.trim()) return users;

    const query = searchQuery.toLowerCase().trim();
    return users.filter(user => {
      // Match EDIPI
      if (user.edipi.toLowerCase().includes(query)) return true;

      // Match email
      if (user.email.toLowerCase().includes(query)) return true;

      // Match personnel name (if linked)
      const person = getPersonnelInfo(user.edipi);
      if (person) {
        const fullName = `${person.rank} ${person.first_name} ${person.last_name}`.toLowerCase();
        if (fullName.includes(query)) return true;
        if (person.last_name.toLowerCase().includes(query)) return true;
        if (person.first_name.toLowerCase().includes(query)) return true;
      }

      return false;
    });
  }, [users, searchQuery, personnelByEdipi]);


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
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-foreground">User Management</h2>
          <p className="text-sm text-foreground-muted">
            {filteredUsers.length === users.length
              ? `${users.length} registered users`
              : `${filteredUsers.length} of ${users.length} users`}
          </p>
        </div>
        <div className="w-full sm:w-72">
          <Input
            type="text"
            placeholder="Search by EDIPI, name, or email..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
      </div>

      {error && (
        <div className="p-4 rounded-lg bg-error/10 border border-error/20 text-error">
          {error}
          <button onClick={() => setError(null)} className="ml-2 text-error hover:underline">Dismiss</button>
        </div>
      )}

      {editingUser && (
        <RoleAssignmentModal
          user={editingUser}
          units={units}
          rucs={rucs}
          onClose={() => setEditingUser(null)}
          onSuccess={() => { setEditingUser(null); fetchData(); }}
        />
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">Registered Users</CardTitle>
          <CardDescription className="text-sm">
            {filteredUsers.length} user{filteredUsers.length !== 1 ? "s" : ""}
            {searchQuery && ` matching "${searchQuery}"`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {filteredUsers.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-foreground-muted">
                {searchQuery ? "No users match your search" : "No users registered yet"}
              </p>
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery("")}
                  className="mt-2 text-sm text-primary hover:underline"
                >
                  Clear search
                </button>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left py-3 px-4 text-sm font-medium text-foreground-muted">EDIPI</th>
                    <th className="text-left py-3 px-4 text-sm font-medium text-foreground-muted">Rank</th>
                    <th className="text-left py-3 px-4 text-sm font-medium text-foreground-muted">Name</th>
                    <th className="text-left py-3 px-4 text-sm font-medium text-foreground-muted">Email</th>
                    <th className="text-left py-3 px-4 text-sm font-medium text-foreground-muted">Roles</th>
                    <th className="text-left py-3 px-4 text-sm font-medium text-foreground-muted">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredUsers.map((user) => {
                    const person = getPersonnelInfo(user.edipi);
                    return (
                      <tr key={user.id} className="border-b border-border hover:bg-surface-elevated">
                        <td className="py-3 px-4">
                          <span className="font-medium text-foreground font-mono">{user.edipi}</span>
                        </td>
                        <td className="py-3 px-4">
                          {person ? (
                            <span className="font-medium text-foreground">
                              {person.rank}
                            </span>
                          ) : (
                            <span className="text-foreground-muted">-</span>
                          )}
                        </td>
                        <td className="py-3 px-4">
                          {person ? (
                            <span className="font-medium text-foreground">
                              {person.last_name}, {person.first_name}
                            </span>
                          ) : (
                            <span className="text-foreground-muted text-sm italic">Not linked</span>
                          )}
                        </td>
                        <td className="py-3 px-4 text-foreground-muted">{user.email}</td>
                        <td className="py-3 px-4">
                          <div className="flex flex-wrap gap-1">
                            {user.roles.map((role, idx) => (
                              <span key={role.id ?? `${idx}-${role.role_name}`} className={`px-2 py-0.5 text-xs font-medium rounded border ${getRoleColor(role.role_name)}`}>
                                {role.role_name}
                                {role.scope_unit_id && <span className="ml-1 opacity-75">({getRucDisplayName(role.scope_unit_id)})</span>}
                              </span>
                            ))}
                          </div>
                        </td>
                        <td className="py-3 px-4">
                          <Button variant="ghost" size="sm" onClick={() => setEditingUser(user)}>
                            <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                            </svg>
                            Edit Roles
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

interface PendingRole {
  role_name: RoleName;
  scope_unit_id: string | null;
}

function RoleAssignmentModal({ user, units, rucs, onClose, onSuccess }: { user: UserData; units: UnitSection[]; rucs: RucEntry[]; onClose: () => void; onSuccess: () => void; }) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedRole, setSelectedRole] = useState<RoleName>("Standard User");
  const [selectedRuc, setSelectedRuc] = useState<string>("");
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  // Track pending changes (roles to add and remove)
  const [pendingAdds, setPendingAdds] = useState<PendingRole[]>([]);
  const [pendingRemoves, setPendingRemoves] = useState<PendingRole[]>([]);

  const isUserAppAdmin = user.roles.some((r) => r.role_name === "App Admin");

  // Check if role requires a unit scope
  const roleRequiresScope = (role: string) => {
    return ["Unit Admin", ...MANAGER_ROLES].includes(role as RoleName);
  };

  // Calculate the effective roles (current - pending removes + pending adds)
  const effectiveRoles = useMemo(() => {
    // Start with current roles minus pending removes
    let roles = user.roles.filter(r =>
      !pendingRemoves.some(pr => pr.role_name === r.role_name && pr.scope_unit_id === r.scope_unit_id)
    );
    // Add pending adds (avoiding duplicates)
    for (const add of pendingAdds) {
      const exists = roles.some(r => r.role_name === add.role_name && r.scope_unit_id === add.scope_unit_id);
      if (!exists) {
        roles.push({ role_name: add.role_name, scope_unit_id: add.scope_unit_id });
      }
    }
    return roles;
  }, [user.roles, pendingAdds, pendingRemoves]);

  // Check if user has a manager role in effective roles
  const existingManagerRole = effectiveRoles.find((r) => MANAGER_ROLES.includes(r.role_name as RoleName));

  // Check if there are unsaved changes
  const hasChanges = pendingAdds.length > 0 || pendingRemoves.length > 0;

  const handleAddRole = () => {
    setError(null);

    const scopeUnitId = roleRequiresScope(selectedRole) ? selectedRuc : null;

    // Check if already exists in effective roles
    const alreadyExists = effectiveRoles.some(r => r.role_name === selectedRole && r.scope_unit_id === scopeUnitId);
    if (alreadyExists) {
      setError("This role is already assigned");
      return;
    }

    // If assigning a manager role and user already has one, mark it for removal
    if (MANAGER_ROLES.includes(selectedRole as RoleName) && existingManagerRole) {
      // Check if it's an original role (not a pending add)
      const isOriginal = user.roles.some(r => r.role_name === existingManagerRole.role_name && r.scope_unit_id === existingManagerRole.scope_unit_id);
      if (isOriginal) {
        setPendingRemoves(prev => {
          const alreadyPending = prev.some(pr => pr.role_name === existingManagerRole.role_name && pr.scope_unit_id === existingManagerRole.scope_unit_id);
          if (alreadyPending) return prev;
          return [...prev, { role_name: existingManagerRole.role_name as RoleName, scope_unit_id: existingManagerRole.scope_unit_id }];
        });
      } else {
        // Remove from pending adds
        setPendingAdds(prev => prev.filter(pa => !(pa.role_name === existingManagerRole.role_name && pa.scope_unit_id === existingManagerRole.scope_unit_id)));
      }
    }

    // Add to pending adds
    setPendingAdds(prev => [...prev, { role_name: selectedRole, scope_unit_id: scopeUnitId }]);

    // Reset selection
    setSelectedRole("Standard User");
    setSelectedRuc("");
  };

  const handleRemoveRole = (roleName: string, scopeUnitId: string | null) => {
    // Check if it's a pending add - just remove from pending adds
    const isPendingAdd = pendingAdds.some(pa => pa.role_name === roleName && pa.scope_unit_id === scopeUnitId);
    if (isPendingAdd) {
      setPendingAdds(prev => prev.filter(pa => !(pa.role_name === roleName && pa.scope_unit_id === scopeUnitId)));
      return;
    }

    // Otherwise add to pending removes
    setPendingRemoves(prev => {
      const alreadyPending = prev.some(pr => pr.role_name === roleName && pr.scope_unit_id === scopeUnitId);
      if (alreadyPending) return prev;
      return [...prev, { role_name: roleName as RoleName, scope_unit_id: scopeUnitId }];
    });
  };

  const handleSave = async () => {
    setIsSubmitting(true);
    setError(null);

    console.log("[RoleAssignment] Starting save...", {
      userId: user.id,
      edipi: user.edipi,
      pendingAdds,
      pendingRemoves,
    });

    try {
      // Process removals first (local cache update)
      for (const remove of pendingRemoves) {
        console.log("[RoleAssignment] Removing role:", remove);
        const success = removeUserRole(user.id, remove.role_name, remove.scope_unit_id);
        console.log("[RoleAssignment] Remove result:", success);
        if (!success) throw new Error(`Failed to remove role: ${remove.role_name}`);
      }

      // Then process adds (local cache update)
      for (const add of pendingAdds) {
        console.log("[RoleAssignment] Adding role:", add);
        const success = assignUserRole(user.id, add.role_name, add.scope_unit_id);
        console.log("[RoleAssignment] Add result:", success);
        if (!success) throw new Error(`Failed to assign role: ${add.role_name}`);
      }

      // Trigger GitHub workflow to persist changes if configured
      const gitHubConfigured = isGitHubConfigured();
      console.log("[RoleAssignment] GitHub configured:", gitHubConfigured);

      if (gitHubConfigured) {
        const updatedUser = getSeedUserByEdipi(user.edipi);
        console.log("[RoleAssignment] Updated user from cache:", updatedUser?.id, "roles:", updatedUser?.roles?.length);

        if (updatedUser && updatedUser.roles) {
          // Build roles array for workflow (just role_name and scope_unit_id)
          const rolesForWorkflow = updatedUser.roles.map(r => ({
            role_name: r.role_name,
            scope_unit_id: r.scope_unit_id,
          }));

          console.log("[RoleAssignment] Triggering workflow with roles:", rolesForWorkflow);
          const workflowResult = await triggerUpdateUserRolesWorkflow(
            user.id,
            rolesForWorkflow,
            updatedUser.can_approve_non_availability
          );
          console.log("[RoleAssignment] Workflow trigger result:", workflowResult);

          if (!workflowResult.success) {
            // Show error to user
            throw new Error(`GitHub sync failed: ${workflowResult.message}`);
          }
        } else {
          console.warn("[RoleAssignment] Could not find updated user in cache");
        }
      }

      onSuccess();
    } catch (err) {
      console.error("[RoleAssignment] Error:", err);
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteUser = async () => {
    setIsSubmitting(true);
    setError(null);

    try {
      // Delete from local cache
      const success = deleteUser(user.id);
      if (!success) throw new Error("Failed to delete user");

      // Trigger GitHub workflow to delete user file if configured
      if (isGitHubConfigured()) {
        console.log("[RoleAssignment] Triggering delete workflow for user:", user.id);
        const deleteResult = await triggerDeleteUserWorkflow(user.id);
        console.log("[RoleAssignment] Delete workflow result:", deleteResult);
        if (!deleteResult.success) {
          // Show error to user
          throw new Error(`GitHub sync failed: ${deleteResult.message}`);
        }
      }

      onSuccess();
    } catch (err) {
      console.error("[RoleAssignment] Delete error:", err);
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setIsSubmitting(false);
    }
  };

  // Get role color for badges
  const getRoleBadgeColor = (roleName: string, isPending: boolean = false) => {
    const baseColor = (() => {
      if (roleName === "App Admin") return "bg-highlight/20 text-highlight border-highlight/30";
      if (roleName === "Unit Admin") return "bg-primary/20 text-blue-400 border-primary/30";
      if (MANAGER_ROLES.includes(roleName as RoleName)) return "bg-success/20 text-success border-success/30";
      return "bg-foreground-muted/20 text-foreground-muted border-foreground-muted/30";
    })();
    return isPending ? `${baseColor} ring-2 ring-warning/50` : baseColor;
  };

  // Get RUC display name
  const getRucDisplayName = (rucCode: string | null) => {
    if (!rucCode) return null;
    const ruc = rucs.find(r => r.ruc === rucCode);
    return ruc?.name ? `${rucCode} - ${ruc.name}` : rucCode;
  };

  // Check if a role is a pending addition
  const isPendingAdd = (roleName: string, scopeUnitId: string | null) => {
    return pendingAdds.some(pa => pa.role_name === roleName && pa.scope_unit_id === scopeUnitId);
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <Card variant="elevated" className="w-full max-w-md max-h-[90vh] overflow-y-auto">
        <CardHeader>
          <CardTitle>Manage Roles - {user.edipi}</CardTitle>
          <CardDescription>Assign or remove user roles</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {error && <div className="p-3 rounded-lg bg-error/10 border border-error/20 text-error text-sm">{error}</div>}

          {/* Current Roles with Remove Buttons */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-2">Current Roles</label>
            <div className="flex flex-wrap gap-2">
              {effectiveRoles.map((role, idx) => {
                const canRemove = role.role_name !== "App Admin" && role.role_name !== "Standard User";
                const pending = isPendingAdd(role.role_name, role.scope_unit_id);
                return (
                  <span
                    key={role.id ?? `${idx}-${role.role_name}-${role.scope_unit_id}`}
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-sm rounded-lg border ${getRoleBadgeColor(role.role_name, pending)}`}
                  >
                    <span>
                      {role.role_name}
                      {role.scope_unit_id && (
                        <span className="ml-1 opacity-75 text-xs">({getRucDisplayName(role.scope_unit_id)})</span>
                      )}
                      {pending && <span className="ml-1 text-xs text-warning">(new)</span>}
                    </span>
                    {canRemove && (
                      <button
                        onClick={() => handleRemoveRole(role.role_name, role.scope_unit_id)}
                        disabled={isSubmitting}
                        className="ml-1 hover:bg-white/20 rounded p-0.5 transition-colors"
                        title={`Remove ${role.role_name}`}
                      >
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    )}
                  </span>
                );
              })}
            </div>
          </div>

          <div className="p-3 rounded-lg bg-surface-elevated border border-border">
            <label className="block text-sm font-medium text-foreground mb-1">EDIPI</label>
            <span className="font-mono text-foreground-muted">{user.edipi}</span>
          </div>

          {!isUserAppAdmin && (
            <div className="space-y-4 pt-4 border-t border-border">
              <h4 className="font-medium text-foreground">Assign New Role</h4>

              {/* Warning if replacing manager role */}
              {existingManagerRole && MANAGER_ROLES.includes(selectedRole as RoleName) && selectedRole !== existingManagerRole.role_name && (
                <div className="p-2 rounded-lg bg-warning/10 border border-warning/20 text-warning text-xs">
                  This will replace the existing {existingManagerRole.role_name} role. Users can only have one manager role.
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">Role Type</label>
                <select className="w-full px-4 py-2.5 rounded-lg bg-surface border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-primary" value={selectedRole} onChange={(e) => setSelectedRole(e.target.value as RoleName)} disabled={isSubmitting}>
                  <option value="Standard User">Standard User</option>
                  <optgroup label="Admin Roles">
                    <option value="Unit Admin">Unit Admin</option>
                  </optgroup>
                  <optgroup label="Manager Roles (one at a time)">
                    <option value="Unit Manager">Unit Manager</option>
                    <option value="Company Manager">Company Manager</option>
                    <option value="Platoon Manager">Platoon Manager</option>
                    <option value="Section Manager">Section Manager</option>
                  </optgroup>
                </select>
              </div>

              {roleRequiresScope(selectedRole) && (
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1.5">Unit Scope (RUC)</label>
                  <select className="w-full px-4 py-2.5 rounded-lg bg-surface border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-primary" value={selectedRuc} onChange={(e) => setSelectedRuc(e.target.value)} disabled={isSubmitting}>
                    <option value="">Select a RUC...</option>
                    {rucs.map((ruc) => <option key={ruc.ruc} value={ruc.ruc}>{ruc.ruc}{ruc.name ? ` - ${ruc.name}` : ""}</option>)}
                  </select>
                </div>
              )}

              <Button variant="secondary" onClick={handleAddRole} disabled={isSubmitting || (roleRequiresScope(selectedRole) && !selectedRuc)} className="w-full">
                {existingManagerRole && MANAGER_ROLES.includes(selectedRole as RoleName) && selectedRole !== existingManagerRole.role_name
                  ? "Add Role (replaces manager)"
                  : "Add Role"}
              </Button>
            </div>
          )}

          {isUserAppAdmin && (
            <div className="p-3 rounded-lg bg-warning/10 border border-warning/20 text-warning text-sm">
              This user is an App Admin (assigned via EDIPI). The App Admin role cannot be removed here.
            </div>
          )}

          {/* Delete Account Section */}
          {!isUserAppAdmin && (
            <div className="pt-4 border-t border-border">
              {!showDeleteConfirm ? (
                <Button
                  variant="ghost"
                  onClick={() => setShowDeleteConfirm(true)}
                  disabled={isSubmitting}
                  className="w-full text-error hover:bg-error/10"
                >
                  <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                  Delete Account
                </Button>
              ) : (
                <div className="space-y-3">
                  <div className="p-3 rounded-lg bg-error/10 border border-error/20 text-error text-sm">
                    Are you sure you want to delete this account? This action cannot be undone.
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="secondary"
                      onClick={() => setShowDeleteConfirm(false)}
                      disabled={isSubmitting}
                      className="flex-1"
                    >
                      Cancel
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={handleDeleteUser}
                      isLoading={isSubmitting}
                      disabled={isSubmitting}
                      className="flex-1 bg-error text-white hover:bg-error/90"
                    >
                      Confirm Delete
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="flex gap-3 pt-4 border-t border-border">
            <Button variant="secondary" onClick={onClose} disabled={isSubmitting} className="flex-1">
              Cancel
            </Button>
            <Button
              variant="accent"
              onClick={handleSave}
              isLoading={isSubmitting}
              disabled={isSubmitting || !hasChanges}
              className="flex-1"
            >
              Save Changes
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
