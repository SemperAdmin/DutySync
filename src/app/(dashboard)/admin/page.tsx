"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import Link from "next/link";
import Card, { CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import { useAuth, updateUserApprovalPermission } from "@/lib/supabase-auth";
import type { UnitSection, HierarchyLevel, RoleName, Personnel, SessionUser } from "@/types";
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
  getPersonnelByUnitWithDescendants,
  getAllDescendantUnitIds,
  getUnitById,
  getRucDisplayName,
  resolveUnitAdminScope,
  canManageUser,
  isAppAdmin,
  getUserOrganizationId,
  getTopLevelUnitForOrganization,
  loadUsers,
  type RucEntry,
} from "@/lib/data-layer";
import { buildHierarchicalUnitOptions, formatUnitOptionLabel } from "@/lib/unit-hierarchy";

// Manager role names - a user can only have one of these at a time
const MANAGER_ROLES: RoleName[] = [
  "Unit Manager",
  "Company Manager",
  "Section Manager",
  "Work Section Manager",
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
  can_approve_non_availability: boolean;
  roles: Array<{
    id?: string;
    role_name: RoleName;
    scope_unit_id: string | null;
  }>;
}

export default function AdminDashboard() {
  const { user } = useAuth();
  const isAppAdmin = user?.roles?.some((role) => role.role_name === "App Admin");
  const isUnitAdmin = user?.roles?.some((role) => role.role_name === "Unit Admin");
  const [viewMode, setViewMode] = useState<string>("user");
  const [stats, setStats] = useState({ users: 0, personnel: 0, units: 0 });
  const [unitAdminRucDisplay, setUnitAdminRucDisplay] = useState<string>("N/A");

  // Get Unit Admin scope - the scope_unit_id where they have Unit Admin role
  // This can be either an organization UUID or a RUC code
  const unitAdminScopeId = useMemo(() => {
    const unitAdminRole = user?.roles?.find((role) => role.role_name === "Unit Admin");
    return unitAdminRole?.scope_unit_id || null;
  }, [user?.roles]);

  // Load the RUC display name asynchronously
  // scope_unit_id can be an organization UUID, unit UUID, or RUC code
  useEffect(() => {
    async function loadRucDisplay() {
      if (!unitAdminScopeId) {
        setUnitAdminRucDisplay("N/A");
        return;
      }

      const { rucDisplay } = await resolveUnitAdminScope(unitAdminScopeId);
      setUnitAdminRucDisplay(rucDisplay);
    }
    loadRucDisplay();
  }, [unitAdminScopeId]);

  // Sync with view mode from localStorage (set by DashboardLayout)
  useEffect(() => {
    const checkViewMode = () => {
      const stored = localStorage.getItem(VIEW_MODE_KEY);
      setViewMode(stored || "user");
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

  // Load stats for admin dashboard
  const loadStats = useCallback(async () => {
    if (viewMode === "admin" && isAppAdmin) {
      // App Admin view - show all data
      const users = getAllUsers();
      const personnel = getAllPersonnel();
      const units = getUnitSections();
      setStats({
        users: users.length,
        personnel: personnel.length,
        units: units.length,
      });
    } else if (viewMode === "unit-admin" && isUnitAdmin && unitAdminScopeId) {
      // Unit Admin view - filter to their organization scope
      // scope_unit_id can be an organization UUID, unit UUID, or RUC code

      const { organization } = await resolveUnitAdminScope(unitAdminScopeId);
      if (!organization) {
        console.warn(`[Unit Admin Dashboard] No organization found for: ${unitAdminScopeId}`);
        setStats({ users: 0, personnel: 0, units: 0 });
        return;
      }

      const allUsers = getAllUsers();
      const allUnits = getUnitSections();
      const allPersonnel = getAllPersonnel();

      // Get all units for this organization (by matching organization_id or ruc)
      // Units loaded for an org all have the same RUC in their ruc field
      const orgUnits = allUnits.filter(u =>
        (u as UnitSection & { organization_id?: string }).organization_id === organization.id ||
        u.ruc === organization.ruc_code
      );
      const orgUnitIds = new Set(orgUnits.map(u => u.id));

      // Get all personnel in those units
      const orgPersonnel = allPersonnel.filter(p => orgUnitIds.has(p.unit_section_id));

      // Filter users who have roles scoped to this organization or its units
      const users = allUsers.filter(u => {
        return u.roles?.some(r => {
          if (!r.scope_unit_id) return false;
          // Match by scope ID or by unit ID within org
          return r.scope_unit_id === unitAdminScopeId ||
                 r.scope_unit_id === organization.id ||
                 orgUnitIds.has(r.scope_unit_id);
        });
      });

      setStats({
        users: users.length,
        personnel: orgPersonnel.length,
        units: orgUnits.length,
      });
    }
  }, [viewMode, isAppAdmin, isUnitAdmin, unitAdminScopeId]);

  useEffect(() => {
    loadStats();
  }, [loadStats]);

  // If in user view mode, show UserDashboard
  if (viewMode === "user") {
    return <UserDashboard />;
  }

  // If in unit-admin view mode but user is not a Unit Admin, show UserDashboard
  if (viewMode === "unit-admin" && !isUnitAdmin) {
    return <UserDashboard />;
  }

  // If in admin view mode but user is not an App Admin, show UserDashboard
  if (viewMode === "admin" && !isAppAdmin) {
    return <UserDashboard />;
  }

  // Determine dashboard title and description based on view mode
  const isUnitAdminView = viewMode === "unit-admin";
  const dashboardTitle = isUnitAdminView ? "Unit Admin Dashboard" : "App Admin Dashboard";
  const dashboardDescription = isUnitAdminView
    ? `Overview of your unit (RUC: ${unitAdminRucDisplay})`
    : "Overview of all units and users across the application";

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-foreground">{dashboardTitle}</h1>
        <p className="text-foreground-muted mt-1">
          {dashboardDescription}
        </p>
      </div>

      {/* Quick Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-4">
              <div className="p-3 rounded-full bg-primary/20">
                <svg className="w-6 h-6 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
                </svg>
              </div>
              <div>
                <p className="text-2xl font-bold text-foreground">{stats.users}</p>
                <p className="text-sm text-foreground-muted">Registered Users</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-4">
              <div className="p-3 rounded-full bg-success/20">
                <svg className="w-6 h-6 text-success" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              </div>
              <div>
                <p className="text-2xl font-bold text-foreground">{stats.personnel}</p>
                <p className="text-sm text-foreground-muted">Personnel Records</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-4">
              <div className="p-3 rounded-full bg-highlight/20">
                <svg className="w-6 h-6 text-highlight" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                </svg>
              </div>
              <div>
                <p className="text-2xl font-bold text-foreground">{stats.units}</p>
                <p className="text-sm text-foreground-muted">Unit Sections</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Quick Actions */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <svg className="w-5 h-5 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
              </svg>
              User Management
            </CardTitle>
            <CardDescription>
              Manage user accounts, assign roles, and configure permissions
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link href="/admin/users">
              <Button variant="secondary" className="w-full">
                <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                </svg>
                Go to User Management
              </Button>
            </Link>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <svg className="w-5 h-5 text-highlight" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
              </svg>
              Unit Management
            </CardTitle>
            <CardDescription>
              Configure unit hierarchy, RUCs, and organizational structure
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link href="/admin/units">
              <Button variant="secondary" className="w-full">
                <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                </svg>
                Go to Unit Management
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
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
        can_approve_non_availability: u.can_approve_non_availability || false,
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
      case "section": return units.filter((u) => u.hierarchy_level === "company");
      case "work_section": return units.filter((u) => u.hierarchy_level === "section");
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
                <option value="section">Section</option>
                <option value="work_section">Work Section</option>
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
  const { user: currentUser } = useAuth();
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
        can_approve_non_availability: u.can_approve_non_availability || false,
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

  // Build the full unit hierarchy path (e.g., "02301 > H Company > S1DV > MPHQ")
  // Note: Uses getUnitSections() directly to ensure we have latest data
  const buildUnitPath = (unitId: string): string => {
    const allUnits = getUnitSections();
    const path: string[] = [];
    let currentUnit = allUnits.find(u => u.id === unitId);

    while (currentUnit) {
      path.unshift(currentUnit.unit_name);
      currentUnit = currentUnit.parent_id
        ? allUnits.find(u => u.id === currentUnit?.parent_id)
        : undefined;
    }

    return path.join(" > ");
  };

  const getUnitDisplayName = (unitId: string | null) => {
    if (!unitId) return null;
    return buildUnitPath(unitId) || "Unknown Unit";
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
          currentUser={currentUser}
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
                                {role.scope_unit_id && <span className="ml-1 opacity-75">({getUnitDisplayName(role.scope_unit_id)})</span>}
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

function RoleAssignmentModal({ user, currentUser, units, rucs, onClose, onSuccess }: { user: UserData; currentUser: SessionUser | null; units: UnitSection[]; rucs: RucEntry[]; onClose: () => void; onSuccess: () => void; }) {
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  // Determine which form to show based on current VIEW MODE (not just user's roles)
  // A user may have both App Admin and Unit Admin roles, but should see the form
  // appropriate for their current view mode
  const [viewMode, setViewMode] = useState<string>(() => {
    // Read from localStorage during initialization to avoid flash
    if (typeof window !== 'undefined') {
      return localStorage.getItem(VIEW_MODE_KEY) || "admin";
    }
    return "admin";
  });

  // Show App Admin form only when in "admin" view mode AND user has App Admin role
  const hasAppAdminRole = currentUser?.roles?.some(r => r.role_name === "App Admin") ?? false;
  const currentUserIsAppAdmin = viewMode === "admin" && hasAppAdminRole;

  // Check authorization on mount
  useEffect(() => {
    async function checkAuth() {
      const authCheck = await canManageUser(currentUser, user.id);
      if (!authCheck.allowed) {
        setAuthError(authCheck.reason || "You are not authorized to manage this user");
      }
    }
    checkAuth();
  }, [currentUser, user.id]);

  // Check if target user is App Admin (cannot be changed via UI)
  const targetIsAppAdmin = user.roles.some((r) => r.role_name === "App Admin");

  // ============================================================================
  // APP ADMIN VIEW: Multi-RUC Unit Admin assignment
  // ============================================================================

  // Get current Unit Admin roles (user can have multiple, one per RUC)
  const currentUnitAdminRoles = user.roles.filter(r => r.role_name === "Unit Admin");

  // Map unit IDs to organization IDs for tracking
  const getOrgIdFromUnitId = useCallback((unitId: string | null): string | null => {
    if (!unitId) return null;
    const unit = units.find(u => u.id === unitId);
    return (unit as UnitSection & { organization_id?: string })?.organization_id || null;
  }, [units]);

  // Get set of organization IDs where user is currently Unit Admin
  const currentUnitAdminOrgIds = useMemo(() => {
    const orgIds = new Set<string>();
    for (const role of currentUnitAdminRoles) {
      const orgId = getOrgIdFromUnitId(role.scope_unit_id);
      if (orgId) orgIds.add(orgId);
    }
    return orgIds;
  }, [currentUnitAdminRoles, getOrgIdFromUnitId]);

  // Track selected RUCs (organization IDs) for App Admin view
  const [selectedRucIds, setSelectedRucIds] = useState<Set<string>>(
    new Set(currentUnitAdminOrgIds)
  );

  // Toggle RUC selection
  const toggleRuc = (orgId: string) => {
    setSelectedRucIds(prev => {
      const next = new Set(prev);
      if (next.has(orgId)) {
        next.delete(orgId);
      } else {
        next.add(orgId);
      }
      return next;
    });
  };

  // ============================================================================
  // UNIT ADMIN VIEW: Manager role assignment within their RUC
  // ============================================================================

  // Get current user's organization ID (for Unit Admin filtering)
  const currentUserOrgId = useMemo(() => {
    if (!currentUser?.roles) return null;
    const unitAdminRole = currentUser.roles.find(r => r.role_name === "Unit Admin");
    if (!unitAdminRole?.scope_unit_id) return null;
    return getOrgIdFromUnitId(unitAdminRole.scope_unit_id);
  }, [currentUser?.roles, getOrgIdFromUnitId]);

  // Get units within the current user's organization (for Unit Admin scope selection)
  const unitsInOrg = useMemo(() => {
    if (!currentUserOrgId) return units;
    return units.filter(u => (u as UnitSection & { organization_id?: string }).organization_id === currentUserOrgId);
  }, [units, currentUserOrgId]);

  // Build hierarchical unit options for manager scope dropdown
  const hierarchicalUnits = useMemo(() => {
    return buildHierarchicalUnitOptions(unitsInOrg);
  }, [unitsInOrg]);

  // Get current manager role for this user
  const currentManagerRole = user.roles.find(r => MANAGER_ROLES.includes(r.role_name as RoleName));

  // Local state for manager role form
  const [managerRole, setManagerRole] = useState<RoleName | "">(currentManagerRole?.role_name || "");
  const [managerScope, setManagerScope] = useState(currentManagerRole?.scope_unit_id || "");

  // Local state for non-availability approval permission
  const [canApproveNA, setCanApproveNA] = useState(user.can_approve_non_availability || false);

  // ============================================================================
  // CHANGE DETECTION
  // ============================================================================

  const hasChanges = useMemo(() => {
    if (currentUserIsAppAdmin) {
      // App Admin view: Check Unit Admin RUC changes
      if (selectedRucIds.size !== currentUnitAdminOrgIds.size) return true;
      for (const orgId of selectedRucIds) {
        if (!currentUnitAdminOrgIds.has(orgId)) return true;
      }
      for (const orgId of currentUnitAdminOrgIds) {
        if (!selectedRucIds.has(orgId)) return true;
      }
      return false;
    } else {
      // Unit Admin view: Check manager role changes AND approval permission
      const originalManagerRole = currentManagerRole?.role_name || "";
      const originalCanApproveNA = user.can_approve_non_availability || false;
      if (canApproveNA !== originalCanApproveNA) return true;
      const originalManagerScope = currentManagerRole?.scope_unit_id || "";
      return managerRole !== originalManagerRole ||
        (managerRole && managerScope !== originalManagerScope);
    }
  }, [currentUserIsAppAdmin, selectedRucIds, currentUnitAdminOrgIds,
      managerRole, managerScope, currentManagerRole, canApproveNA, user.can_approve_non_availability]);

  // ============================================================================
  // SAVE HANDLERS
  // ============================================================================

  const handleSaveChanges = async () => {
    if (authError) {
      setError(authError);
      return;
    }

    setIsSaving(true);
    setError(null);

    try {
      if (currentUserIsAppAdmin) {
        // App Admin: Handle Unit Admin role changes
        const toRemove = [...currentUnitAdminOrgIds].filter(orgId => !selectedRucIds.has(orgId));
        const toAdd = [...selectedRucIds].filter(orgId => !currentUnitAdminOrgIds.has(orgId));

        // Remove Unit Admin roles
        for (const orgId of toRemove) {
          const roleToRemove = currentUnitAdminRoles.find(r => {
            const roleOrgId = getOrgIdFromUnitId(r.scope_unit_id);
            return roleOrgId === orgId;
          });
          if (roleToRemove?.scope_unit_id) {
            const result = await removeUserRole(currentUser, user.id, "Unit Admin", roleToRemove.scope_unit_id);
            if (!result.success) {
              setError(result.error || "Failed to remove Unit Admin role");
              setIsSaving(false);
              return;
            }
          }
        }

        // Add new Unit Admin roles
        for (const orgId of toAdd) {
          const topLevelUnit = await getTopLevelUnitForOrganization(orgId);
          if (!topLevelUnit) {
            const ruc = rucs.find(r => r.id === orgId);
            setError(`No top-level unit found for ${ruc?.ruc || orgId}. Please create a unit first.`);
            setIsSaving(false);
            return;
          }
          const result = await assignUserRole(currentUser, user.id, "Unit Admin", topLevelUnit.id);
          if (!result.success) {
            setError(result.error || "Failed to assign Unit Admin role");
            setIsSaving(false);
            return;
          }
        }

        // Ensure user has Standard User role if no admin roles
        if (selectedRucIds.size === 0 && !targetIsAppAdmin) {
          const hasStandardUser = user.roles.some(r => r.role_name === "Standard User");
          if (!hasStandardUser) {
            const result = await assignUserRole(currentUser, user.id, "Standard User", null);
            if (!result.success) {
              setError(result.error || "Failed to assign Standard User role");
              setIsSaving(false);
              return;
            }
          }
        }
      } else {
        // Unit Admin: Handle manager role changes

        // Validation
        if (managerRole && !managerScope) {
          setError("Please select a unit scope for the manager role");
          setIsSaving(false);
          return;
        }

        // Remove old manager role if it exists
        if (currentManagerRole) {
          const result = await removeUserRole(
            currentUser,
            user.id,
            currentManagerRole.role_name,
            currentManagerRole.scope_unit_id
          );
          if (!result.success) {
            setError(result.error || "Failed to remove manager role");
            setIsSaving(false);
            return;
          }
        }

        // Add new manager role if selected
        if (managerRole && managerScope) {
          const result = await assignUserRole(currentUser, user.id, managerRole, managerScope);
          if (!result.success) {
            setError(result.error || "Failed to assign manager role");
            setIsSaving(false);
            return;
          }
        }

        // Update non-availability approval permission if changed
        const originalCanApproveNA = user.can_approve_non_availability || false;
        if (canApproveNA !== originalCanApproveNA) {
          const result = await updateUserApprovalPermission(user.id, canApproveNA);
          if (!result.success) {
            setError(result.error || "Failed to update approval permission");
            setIsSaving(false);
            return;
          }
        }
      }

      // Refresh user data
      await loadUsers();
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteAccount = async () => {
    if (authError) {
      setError(authError);
      return;
    }

    setIsDeleting(true);
    setError(null);

    try {
      const result = await deleteUser(currentUser, user.id);
      if (!result.success) {
        setError(result.error || "Failed to delete user");
        setIsDeleting(false);
        return;
      }
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setIsDeleting(false);
    }
  };

  // Get RUC display name helper
  const getRucDisplayForScope = (scopeUnitId: string | null) => {
    if (!scopeUnitId) return null;
    const orgId = getOrgIdFromUnitId(scopeUnitId);
    const ruc = rucs.find(r => r.id === orgId);
    return ruc?.ruc ? (ruc.name ? `${ruc.ruc} - ${ruc.name}` : ruc.ruc) : null;
  };

  // Build unit path for display
  const buildUnitPath = (unitId: string): string => {
    const allUnits = getUnitSections();
    const path: string[] = [];
    let currentUnit = allUnits.find(u => u.id === unitId);

    while (currentUnit) {
      path.unshift(currentUnit.unit_name);
      currentUnit = currentUnit.parent_id
        ? allUnits.find(u => u.id === currentUnit?.parent_id)
        : undefined;
    }

    return path.join(" > ");
  };

  const getUnitName = (unitId: string | null) => {
    if (!unitId) return null;
    return buildUnitPath(unitId) || "Unknown Unit";
  };

  // ============================================================================
  // RENDER
  // ============================================================================

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <Card variant="elevated" className="w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <CardHeader>
          <CardTitle>Manage Roles - {user.edipi}</CardTitle>
          <CardDescription>
            {currentUserIsAppAdmin
              ? "Assign Unit Admin access to one or more RUCs"
              : "Assign manager roles within your organization"
            }
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Authorization Error */}
          {authError && (
            <div className="p-3 rounded-lg bg-error/10 border border-error/20 text-error text-sm">
              <div className="flex items-center gap-2">
                <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                <span>{authError}</span>
              </div>
            </div>
          )}

          {error && !authError && (
            <div className="p-3 rounded-lg bg-error/10 border border-error/20 text-error text-sm">
              {error}
            </div>
          )}

          {/* Target User's App Admin Badge (if applicable) */}
          {targetIsAppAdmin && (
            <div className="p-3 rounded-lg bg-highlight/10 border border-highlight/20">
              <div className="flex items-center gap-2">
                <span className="px-2 py-0.5 text-xs font-medium rounded bg-highlight/20 text-highlight border border-highlight/30">
                  App Admin
                </span>
                <span className="text-sm text-foreground-muted">
                  (Assigned via configuration)
                </span>
              </div>
            </div>
          )}

          {/* ============================================================== */}
          {/* APP ADMIN VIEW: Multi-RUC Unit Admin Selection */}
          {/* ============================================================== */}
          {currentUserIsAppAdmin && (
            <div className="space-y-3">
              <div>
                <h4 className="font-medium text-foreground">Unit Admin Access</h4>
                <p className="text-sm text-foreground-muted">
                  Select which RUCs this user can administer
                </p>
              </div>

              <div className="space-y-2 max-h-60 overflow-y-auto">
                {rucs.map((ruc) => {
                  const isSelected = selectedRucIds.has(ruc.id);
                  return (
                    <label
                      key={ruc.id}
                      className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                        isSelected
                          ? "bg-primary/10 border-primary"
                          : "bg-surface border-border hover:border-foreground-muted"
                      } ${isSaving ? "opacity-50 cursor-not-allowed" : ""}`}
                    >
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleRuc(ruc.id)}
                        disabled={isSaving}
                        className="w-4 h-4 rounded border-border text-primary focus:ring-primary"
                      />
                      <div className="flex-1">
                        <span className="font-mono font-medium text-foreground">
                          {ruc.ruc}
                        </span>
                        {ruc.name && (
                          <span className="ml-2 text-foreground-muted">
                            - {ruc.name}
                          </span>
                        )}
                      </div>
                      {isSelected && (
                        <span className="px-2 py-0.5 text-xs font-medium rounded bg-primary/20 text-primary">
                          Unit Admin
                        </span>
                      )}
                    </label>
                  );
                })}
              </div>

              {selectedRucIds.size === 0 && !targetIsAppAdmin && (
                <p className="text-sm text-foreground-muted italic">
                  No Unit Admin roles assigned. User will have Standard User access only.
                </p>
              )}
            </div>
          )}

          {/* ============================================================== */}
          {/* UNIT ADMIN VIEW: Manager Role Assignment */}
          {/* ============================================================== */}
          {!currentUserIsAppAdmin && (
            <div className="space-y-4">
              {/* Show target user's current Unit Admin status if they have any */}
              {currentUnitAdminRoles.length > 0 && (
                <div className="p-3 rounded-lg bg-primary/10 border border-primary/20">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm text-foreground">Unit Admin for:</span>
                    {currentUnitAdminRoles.map((role, idx) => (
                      <span key={idx} className="px-2 py-0.5 text-xs font-medium rounded bg-primary/20 text-primary">
                        {getRucDisplayForScope(role.scope_unit_id) || "Unknown"}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <h4 className="font-medium text-foreground">Manager Role</h4>
                <p className="text-sm text-foreground-muted">
                  Assign a management role for personnel oversight
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">
                  Role
                </label>
                <select
                  className="w-full px-4 py-2.5 rounded-lg bg-surface border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                  value={managerRole}
                  onChange={(e) => {
                    setManagerRole(e.target.value as RoleName | "");
                    if (!e.target.value) setManagerScope("");
                  }}
                  disabled={isSaving}
                >
                  <option value="">None</option>
                  <option value="Unit Manager">Unit Manager</option>
                  <option value="Company Manager">Company Manager</option>
                  <option value="Section Manager">Section Manager</option>
                  <option value="Work Section Manager">Work Section Manager</option>
                </select>
              </div>

              {/* Manager Scope Selector */}
              {managerRole && (
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1.5">
                    Unit Scope
                  </label>
                  <select
                    className="w-full px-4 py-2.5 rounded-lg bg-surface border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-primary font-mono"
                    value={managerScope}
                    onChange={(e) => setManagerScope(e.target.value)}
                    disabled={isSaving}
                  >
                    <option value="">Select a unit...</option>
                    {hierarchicalUnits.map((option) => (
                      <option key={option.id} value={option.id}>
                        {formatUnitOptionLabel(option, true)}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* Current manager role info */}
              {currentManagerRole && (
                <p className="text-sm text-foreground-muted">
                  Currently: <span className="font-medium text-foreground">{currentManagerRole.role_name}</span>
                  {currentManagerRole.scope_unit_id && (
                    <span> for {getUnitName(currentManagerRole.scope_unit_id) || "Unknown unit"}</span>
                  )}
                </p>
              )}

              {/* Non-Availability Approval Permission */}
              <div className="pt-4 border-t border-border">
                <label className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={canApproveNA}
                    onChange={(e) => setCanApproveNA(e.target.checked)}
                    disabled={isSaving}
                    className="w-4 h-4 rounded border-border text-primary focus:ring-primary"
                  />
                  <div>
                    <span className="font-medium text-foreground">Can Approve Non-Availability</span>
                    <p className="text-sm text-foreground-muted">
                      Allow this user to approve non-availability requests
                    </p>
                  </div>
                </label>
              </div>
            </div>
          )}

          {/* Unsaved Changes Indicator */}
          {hasChanges && (
            <div className="p-3 rounded-lg bg-warning/10 border border-warning/20 text-warning text-sm">
              You have unsaved changes. Click &quot;Save Changes&quot; to apply them.
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex flex-col gap-3 pt-4 border-t border-border">
            <Button
              variant="accent"
              onClick={handleSaveChanges}
              isLoading={isSaving}
              disabled={isSaving || isDeleting || !hasChanges || !!authError}
              className="w-full"
            >
              <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              Save Changes
            </Button>

            <div className="flex gap-3">
              <Button
                variant="secondary"
                onClick={onClose}
                disabled={isSaving || isDeleting}
                className="flex-1"
              >
                {authError ? "Close" : hasChanges ? "Cancel" : "Close"}
              </Button>

              {/* Delete Account Button */}
              {!targetIsAppAdmin && !authError && (
                <>
                  {!showDeleteConfirm ? (
                    <Button
                      variant="ghost"
                      onClick={() => setShowDeleteConfirm(true)}
                      disabled={isSaving || isDeleting}
                      className="text-error hover:bg-error/10"
                    >
                      <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                      Delete
                    </Button>
                  ) : (
                    <Button
                      variant="ghost"
                      onClick={handleDeleteAccount}
                      isLoading={isDeleting}
                      disabled={isSaving || isDeleting}
                      className="bg-error/10 text-error hover:bg-error/20"
                    >
                      Confirm Delete
                    </Button>
                  )}
                </>
              )}
            </div>

            {showDeleteConfirm && (
              <p className="text-xs text-error text-center">
                Are you sure? This will permanently delete this user account.
                <button
                  onClick={() => setShowDeleteConfirm(false)}
                  className="ml-2 underline hover:no-underline"
                >
                  Cancel
                </button>
              </p>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
