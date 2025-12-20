"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import Button from "@/components/ui/Button";
import type { NonAvailability, Personnel, RoleName } from "@/types";
import {
  getAllPersonnel,
  getEnrichedNonAvailability,
  createNonAvailability,
  updateNonAvailability,
  deleteNonAvailability as deleteNonAvailabilityFn,
  type EnrichedNonAvailability,
  getUnitSectionById,
  getUnitSections,
  getPersonnelByEdipi,
  getChildUnits,
} from "@/lib/client-stores";
import { useAuth } from "@/lib/supabase-auth";
import {
  VIEW_MODE_KEY,
  VIEW_MODE_CHANGE_EVENT,
  VIEW_MODE_ADMIN,
  VIEW_MODE_UNIT_ADMIN,
  VIEW_MODE_USER,
  type ViewMode,
} from "@/lib/constants";
import { useSyncRefresh } from "@/hooks/useSync";

// Manager role names
const MANAGER_ROLES: RoleName[] = [
  "Unit Manager",
  "Company Manager",
  "Section Manager",
  "Work Section Manager",
];

// Admin roles that can see all
const ADMIN_ROLES: RoleName[] = ["App Admin", "Unit Admin"];

export default function NonAvailabilityAdminPage() {
  const { user } = useAuth();
  const [requests, setRequests] = useState<EnrichedNonAvailability[]>([]);
  const [personnel, setPersonnel] = useState<Personnel[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>("pending");
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"self" | "scope">("scope"); // Default to scope for managers/admins
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

  // Computed view mode booleans
  const isAdminView = currentViewMode === VIEW_MODE_ADMIN;
  const isUnitAdminView = currentViewMode === VIEW_MODE_UNIT_ADMIN;

  // Get the current user's personnel record
  const currentUserPersonnel = useMemo(() => {
    if (!user?.edipi) return null;
    return getPersonnelByEdipi(user.edipi) || null;
  }, [user?.edipi]);

  // Determine user's role capabilities (actual role checks)
  const isAppAdmin = user?.roles?.some((r) => r.role_name === "App Admin");
  const hasUnitAdminRole = user?.roles?.some((r) => r.role_name === "Unit Admin");
  const isManager = user?.roles?.some((r) => MANAGER_ROLES.includes(r.role_name as RoleName));

  // Effective admin status - respects view mode toggle
  // Admin View: App Admin sees everything
  // Unit Admin View: Unit Admin sees their unit scope
  // User View: Manager role scope applies
  const effectiveIsAppAdmin = isAppAdmin && isAdminView;
  const effectiveIsUnitAdmin = hasUnitAdminRole && isUnitAdminView;

  const isManagerWithApproval = user?.can_approve_non_availability && isManager;

  // User has elevated access if admin, unit admin, or manager
  const hasElevatedAccess = isAppAdmin || hasUnitAdminRole || isManager;

  // User can approve if effective admin, effective unit admin, or manager with approval permission
  const canApprove = effectiveIsAppAdmin || effectiveIsUnitAdmin || isManagerWithApproval;

  // Managers can recommend (chain of command) - this is separate from approve
  const canRecommend = isManager && !effectiveIsAppAdmin && !effectiveIsUnitAdmin;

  // Get user's scoped unit ID based on view mode
  const userScopeUnitId = useMemo(() => {
    if (!user?.roles) return null;

    const unitAdminRole = user.roles.find(r =>
      r.role_name === "Unit Admin" && r.scope_unit_id
    );
    const managerRole = user.roles.find(r =>
      MANAGER_ROLES.includes(r.role_name as RoleName) && r.scope_unit_id
    );

    // In Admin View, App Admin sees everything (handled by effectiveIsAppAdmin)
    // In Unit Admin View, use Unit Admin scope
    if (isUnitAdminView && unitAdminRole?.scope_unit_id) {
      return unitAdminRole.scope_unit_id;
    }

    // In User View, prioritize manager role scope for user experience
    if (!isAdminView && !isUnitAdminView && managerRole?.scope_unit_id) {
      return managerRole.scope_unit_id;
    }

    // Fall back: Unit Admin scope if in Admin View with Unit Admin role
    if (isAdminView && unitAdminRole?.scope_unit_id) return unitAdminRole.scope_unit_id;

    // Final fall back to manager role scope
    return managerRole?.scope_unit_id || null;
  }, [user?.roles, isAdminView, isUnitAdminView]);

  // Check if a personnel is within user's scope
  const isInUserScope = (personnelUnitId: string): boolean => {
    if (effectiveIsAppAdmin) return true; // Effective App Admin can see all

    if (!userScopeUnitId) return false;

    // Direct match
    if (personnelUnitId === userScopeUnitId) return true;

    // Check if personnel's unit is a descendant of the scope unit
    const allUnits = getUnitSections();
    let currentUnit = allUnits.find((u) => u.id === personnelUnitId);
    while (currentUnit?.parent_id) {
      if (currentUnit.parent_id === userScopeUnitId) return true;
      currentUnit = allUnits.find((u) => u.id === currentUnit?.parent_id);
    }

    return false;
  };

  // Get all unit IDs within scope (recursive)
  const getUnitsInScope = (scopeUnitId: string): string[] => {
    const result: string[] = [scopeUnitId];
    const children = getChildUnits(scopeUnitId);
    for (const child of children) {
      result.push(...getUnitsInScope(child.id));
    }
    return result;
  };

  // Get personnel filtered by scope (for managers) or all (for admins)
  const scopeFilteredPersonnel = useMemo(() => {
    // App Admins and Unit Admins (when in admin views) can see all personnel
    if (effectiveIsAppAdmin || effectiveIsUnitAdmin) {
      return personnel;
    }

    // Managers can only see personnel in their scope
    if (isManager && userScopeUnitId) {
      const scopeUnitIds = getUnitsInScope(userScopeUnitId);
      return personnel.filter(p => scopeUnitIds.includes(p.unit_section_id));
    }

    // Regular users can only submit for themselves (handled separately)
    return [];
  }, [personnel, effectiveIsAppAdmin, effectiveIsUnitAdmin, isManager, userScopeUnitId]);

  // Filter to check if user can approve this specific request
  const canApproveRequest = (request: EnrichedNonAvailability): boolean => {
    if (!canApprove) return false;
    if (effectiveIsAppAdmin) return true;
    if (!request.personnel) return false;
    return isInUserScope(request.personnel.unit_section_id);
  };

  // Filter to check if user can recommend this specific request
  const canRecommendRequest = (request: EnrichedNonAvailability): boolean => {
    if (!canRecommend) return false;
    if (!request.personnel) return false;
    return isInUserScope(request.personnel.unit_section_id);
  };

  // Add request modal
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [formData, setFormData] = useState({
    personnel_id: "",
    start_date: "",
    end_date: "",
    reason: "",
    approveImmediately: false, // Only applies if user has approval permission
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const fetchData = useCallback(() => {
    try {
      setLoading(true);

      // Fetch personnel for the add modal
      const personnelData = getAllPersonnel();
      setPersonnel(personnelData);

      // Fetch requests with status filter
      const requestsData = getEnrichedNonAvailability(statusFilter || undefined);
      setRequests(requestsData);
    } catch (err) {
      console.error("Error fetching data:", err);
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Auto-refresh when sync service detects data changes
  useSyncRefresh(["personnel", "nonAvailability", "units"], fetchData);

  function handleStatusChange(requestId: string, newStatus: "approved" | "rejected") {
    setProcessingId(requestId);

    try {
      updateNonAvailability(requestId, {
        status: newStatus,
        approved_by: newStatus === "approved" ? (user?.id || "admin") : null,
      });
      fetchData();
    } catch (err) {
      console.error("Error updating request:", err);
    } finally {
      setProcessingId(null);
    }
  }

  function handleRecommend(requestId: string) {
    setProcessingId(requestId);

    try {
      updateNonAvailability(requestId, {
        status: "recommended",
        recommended_by: user?.id || null,
        recommended_at: new Date(),
      });
      fetchData();
    } catch (err) {
      console.error("Error recommending request:", err);
    } finally {
      setProcessingId(null);
    }
  }

  function handleDelete(requestId: string) {
    if (!confirm("Are you sure you want to delete this request?")) return;

    setProcessingId(requestId);

    try {
      deleteNonAvailabilityFn(requestId);
      fetchData();
    } catch (err) {
      console.error("Error deleting request:", err);
    } finally {
      setProcessingId(null);
    }
  }

  function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError("");

    try {
      // Standard users can only submit for themselves
      const personnelId = hasElevatedAccess ? formData.personnel_id : currentUserPersonnel?.id;

      if (!personnelId) {
        setError("Unable to determine personnel. Please contact support.");
        setSubmitting(false);
        return;
      }

      // Determine if this request should be approved immediately
      // Only users with approval permission who check the "approve immediately" box
      const shouldApprove = canApprove && formData.approveImmediately;

      // Parse dates as local dates (add T12:00 to avoid timezone shifts)
      const startDate = new Date(`${formData.start_date}T12:00:00`);
      const endDate = new Date(`${formData.end_date}T12:00:00`);

      const newRequest: NonAvailability = {
        id: crypto.randomUUID(),
        personnel_id: personnelId,
        start_date: startDate,
        end_date: endDate,
        reason: formData.reason,
        // Default to pending, only approve if user has permission AND checked the box
        status: shouldApprove ? "approved" : "pending",
        submitted_by: user?.id || null, // Track who submitted the request
        recommended_by: null, // New requests are not recommended yet
        recommended_at: null,
        approved_by: shouldApprove ? (user?.id || "admin") : null,
        created_at: new Date(),
      };

      createNonAvailability(newRequest);

      setIsAddModalOpen(false);
      setFormData({ personnel_id: "", start_date: "", end_date: "", reason: "", approveImmediately: false });
      fetchData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create request");
    } finally {
      setSubmitting(false);
    }
  }

  function formatDate(date: string | Date): string {
    return new Date(date).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  }

  function getStatusBadge(status: string): string {
    switch (status) {
      case "approved":
        return "bg-green-500/20 text-green-400";
      case "recommended":
        return "bg-blue-500/20 text-blue-400";
      case "rejected":
        return "bg-red-500/20 text-red-400";
      default:
        return "bg-yellow-500/20 text-yellow-400";
    }
  }

  // Filter requests based on view mode and scope
  const filteredRequests = useMemo(() => {
    return requests.filter((r) => {
      // In "self" mode, only show the current user's requests
      if (viewMode === "self") {
        if (!currentUserPersonnel) return false;
        return r.personnel_id === currentUserPersonnel.id;
      }

      // In "scope" mode, effective admins see all, others see their scope
      if (effectiveIsAppAdmin || effectiveIsUnitAdmin) return true;

      // For managers, only show requests within their scope
      if (!r.personnel) return false;
      return isInUserScope(r.personnel.unit_section_id);
    });
  }, [requests, viewMode, currentUserPersonnel, effectiveIsAppAdmin, effectiveIsUnitAdmin, isInUserScope]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-foreground-muted">Loading requests...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Non-Availability Requests</h1>
          <p className="text-foreground-muted mt-1">
            {effectiveIsAppAdmin || effectiveIsUnitAdmin
              ? "Manage duty exemption requests from personnel"
              : hasElevatedAccess
              ? "View and manage requests within your scope"
              : "View your duty exemption requests"}
          </p>
        </div>
        {/* All users can add requests - standard users submit for themselves */}
        <Button onClick={() => {
          // For standard users, auto-fill their own personnel ID
          if (!hasElevatedAccess && currentUserPersonnel) {
            setFormData(prev => ({ ...prev, personnel_id: currentUserPersonnel.id }));
          }
          setIsAddModalOpen(true);
        }}>+ Add Request</Button>
      </div>

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
              My Requests
            </button>
            <button
              onClick={() => setViewMode("scope")}
              className={`px-4 py-2 text-sm font-medium transition-colors ${
                viewMode === "scope"
                  ? "bg-primary text-white"
                  : "bg-surface text-foreground-muted hover:bg-surface-elevated"
              }`}
            >
              {effectiveIsAppAdmin || effectiveIsUnitAdmin ? "All Requests" : "My Scope"}
            </button>
          </div>
        </div>
      )}

      {/* Status Filters - only show in scope mode for managers/admins */}
      {(viewMode === "scope" || !hasElevatedAccess) && (
        <div className="flex gap-4 items-center flex-wrap">
          <label className="text-sm text-foreground-muted">Filter by status:</label>
          <div className="flex gap-2 flex-wrap">
            {["pending", "recommended", "approved", "rejected", ""].map((status) => (
              <button
                key={status || "all"}
                onClick={() => setStatusFilter(status)}
                className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
                  statusFilter === status
                    ? "bg-primary text-white"
                    : "bg-surface border border-border text-foreground-muted hover:text-foreground"
                }`}
              >
                {status ? status.charAt(0).toUpperCase() + status.slice(1) : "All"}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Stats */}
      <div className="grid gap-4 md:grid-cols-5">
        <div className="bg-surface rounded-lg border border-border p-4">
          <div className="text-2xl font-bold text-yellow-400">
            {filteredRequests.filter((r) => r.status === "pending").length}
          </div>
          <div className="text-sm text-foreground-muted">Pending</div>
        </div>
        <div className="bg-surface rounded-lg border border-border p-4">
          <div className="text-2xl font-bold text-blue-400">
            {filteredRequests.filter((r) => r.status === "recommended").length}
          </div>
          <div className="text-sm text-foreground-muted">Recommended</div>
        </div>
        <div className="bg-surface rounded-lg border border-border p-4">
          <div className="text-2xl font-bold text-green-400">
            {filteredRequests.filter((r) => r.status === "approved").length}
          </div>
          <div className="text-sm text-foreground-muted">Approved</div>
        </div>
        <div className="bg-surface rounded-lg border border-border p-4">
          <div className="text-2xl font-bold text-red-400">
            {filteredRequests.filter((r) => r.status === "rejected").length}
          </div>
          <div className="text-sm text-foreground-muted">Rejected</div>
        </div>
        <div className="bg-surface rounded-lg border border-border p-4">
          <div className="text-2xl font-bold text-foreground">{filteredRequests.length}</div>
          <div className="text-sm text-foreground-muted">Total Shown</div>
        </div>
      </div>

      {/* Requests Table */}
      {filteredRequests.length === 0 ? (
        <div className="text-center py-12 bg-surface rounded-lg border border-border">
          <p className="text-foreground-muted">
            {viewMode === "self" ? "You have no requests" : `No ${statusFilter || ""} requests found`}
          </p>
        </div>
      ) : (
        <div className="bg-surface rounded-lg border border-border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border bg-surface-elevated">
                  <th className="text-left px-4 py-3 text-sm font-medium text-foreground">
                    Personnel
                  </th>
                  <th className="text-left px-4 py-3 text-sm font-medium text-foreground">
                    Date Range
                  </th>
                  <th className="text-left px-4 py-3 text-sm font-medium text-foreground">
                    Reason
                  </th>
                  <th className="text-left px-4 py-3 text-sm font-medium text-foreground">
                    Status
                  </th>
                  <th className="text-left px-4 py-3 text-sm font-medium text-foreground">
                    Submitted
                  </th>
                  <th className="text-right px-4 py-3 text-sm font-medium text-foreground">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {filteredRequests.map((request) => (
                  <tr key={request.id} className="border-b border-border last:border-0">
                    <td className="px-4 py-3">
                      {request.personnel ? (
                        <div>
                          <div className="font-medium text-foreground">
                            {request.personnel.rank} {request.personnel.last_name}
                          </div>
                          <div className="text-sm text-foreground-muted">
                            {request.personnel.first_name}
                          </div>
                        </div>
                      ) : (
                        <span className="text-foreground-muted">Unknown</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-foreground">
                      {formatDate(request.start_date)} - {formatDate(request.end_date)}
                    </td>
                    <td className="px-4 py-3 text-foreground max-w-[200px] truncate">
                      {request.reason}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`px-2 py-1 text-xs font-medium rounded-full ${getStatusBadge(
                          request.status
                        )}`}
                      >
                        {request.status.charAt(0).toUpperCase() + request.status.slice(1)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-foreground-muted">
                      {formatDate(request.created_at)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-2">
                        {/* Pending requests - show recommend/reject for managers, approve for those with permission */}
                        {request.status === "pending" && (
                          <>
                            {/* Approve button - only for admins or managers with approval permission */}
                            {canApproveRequest(request) && (
                              <Button
                                size="sm"
                                variant="secondary"
                                onClick={() => handleStatusChange(request.id, "approved")}
                                disabled={processingId === request.id}
                              >
                                Approve
                              </Button>
                            )}
                            {/* Recommend button - for managers in chain of command */}
                            {canRecommendRequest(request) && (
                              <Button
                                size="sm"
                                variant="secondary"
                                onClick={() => handleRecommend(request.id)}
                                disabled={processingId === request.id}
                                className="bg-blue-500/20 hover:bg-blue-500/30 text-blue-400 border-blue-500/30"
                              >
                                Recommend
                              </Button>
                            )}
                            {/* Reject button - for managers and approvers */}
                            {(canApproveRequest(request) || canRecommendRequest(request)) && (
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => handleStatusChange(request.id, "rejected")}
                                disabled={processingId === request.id}
                              >
                                Reject
                              </Button>
                            )}
                          </>
                        )}
                        {/* Recommended requests - only approvers can approve/reject */}
                        {request.status === "recommended" && canApproveRequest(request) && (
                          <>
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => handleStatusChange(request.id, "approved")}
                              disabled={processingId === request.id}
                            >
                              Approve
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => handleStatusChange(request.id, "rejected")}
                              disabled={processingId === request.id}
                            >
                              Reject
                            </Button>
                          </>
                        )}
                        {(effectiveIsAppAdmin || effectiveIsUnitAdmin) && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleDelete(request.id)}
                            disabled={processingId === request.id}
                          >
                            Delete
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Add Request Modal */}
      {isAddModalOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-surface rounded-lg border border-border w-full max-w-md">
            <div className="p-4 border-b border-border">
              <h2 className="text-lg font-semibold text-foreground">
                Add Non-Availability Request
              </h2>
            </div>
            <form onSubmit={handleCreate} className="p-4 space-y-4">
              {error && (
                <div className="p-3 bg-accent/20 text-accent rounded-lg text-sm">{error}</div>
              )}

              {/* Only show personnel dropdown for managers/admins (filtered by scope) */}
              {hasElevatedAccess ? (
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">
                    Personnel *
                  </label>
                  <select
                    value={formData.personnel_id}
                    onChange={(e) =>
                      setFormData({ ...formData, personnel_id: e.target.value })
                    }
                    required
                    className="w-full px-3 py-2 bg-background border border-border rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                  >
                    <option value="">Select Personnel</option>
                    {scopeFilteredPersonnel.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.rank} {p.last_name}, {p.first_name}
                      </option>
                    ))}
                  </select>
                </div>
              ) : (
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">
                    Personnel
                  </label>
                  <div className="w-full px-3 py-2 bg-surface border border-border rounded-lg text-foreground">
                    {currentUserPersonnel
                      ? `${currentUserPersonnel.rank} ${currentUserPersonnel.last_name}, ${currentUserPersonnel.first_name}`
                      : "Your personnel record"}
                  </div>
                </div>
              )}

              <div className="grid gap-4 grid-cols-2">
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">
                    Start Date *
                  </label>
                  <input
                    type="date"
                    value={formData.start_date}
                    onChange={(e) =>
                      setFormData({ ...formData, start_date: e.target.value })
                    }
                    required
                    className="w-full px-3 py-2 bg-background border border-border rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">
                    End Date *
                  </label>
                  <input
                    type="date"
                    value={formData.end_date}
                    onChange={(e) =>
                      setFormData({ ...formData, end_date: e.target.value })
                    }
                    required
                    className="w-full px-3 py-2 bg-background border border-border rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-foreground mb-1">
                  Reason *
                </label>
                <textarea
                  value={formData.reason}
                  onChange={(e) => setFormData({ ...formData, reason: e.target.value })}
                  required
                  rows={3}
                  placeholder="e.g., Leave, TDY, Medical appointment, Training"
                  className="w-full px-3 py-2 bg-background border border-border rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>

              {/* Approve Immediately checkbox - only for users with approval permission */}
              {canApprove && (
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="approveImmediately"
                    checked={formData.approveImmediately}
                    onChange={(e) => setFormData({ ...formData, approveImmediately: e.target.checked })}
                    className="w-4 h-4 rounded border-border bg-background text-primary focus:ring-primary"
                  />
                  <label htmlFor="approveImmediately" className="text-sm text-foreground">
                    Approve immediately
                  </label>
                </div>
              )}

              <p className="text-xs text-foreground-muted">
                {canApprove
                  ? formData.approveImmediately
                    ? "This request will be created as approved."
                    : "This request will be created as pending and require separate approval."
                  : "Your request will be submitted for approval by your manager."}
              </p>

              <div className="flex justify-end gap-3 pt-4 border-t border-border">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setIsAddModalOpen(false)}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={submitting}>
                  {submitting
                    ? "Submitting..."
                    : canApprove && formData.approveImmediately
                      ? "Create & Approve"
                      : "Submit Request"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
