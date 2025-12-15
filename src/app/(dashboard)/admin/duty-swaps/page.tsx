"use client";

import { useState, useEffect, useMemo } from "react";
import Button from "@/components/ui/Button";
import type { Personnel, RoleName, DutyType } from "@/types";
import {
  getAllPersonnel,
  getEnrichedDutyChangeRequests,
  createDutyChangeRequest,
  approveDutyChangeRequest,
  rejectDutyChangeRequest,
  deleteDutyChangeRequest,
  determineApproverLevel,
  canApproveChangeRequest,
  type EnrichedDutyChangeRequest,
  getUnitSections,
  getPersonnelByEdipi,
  getChildUnits,
  getAllDutyTypes,
  getEnrichedSlots,
  getDutySlotById,
  type EnrichedSlot,
} from "@/lib/client-stores";
import { useAuth } from "@/lib/client-auth";
import {
  VIEW_MODE_KEY,
  VIEW_MODE_CHANGE_EVENT,
  VIEW_MODE_ADMIN,
  VIEW_MODE_UNIT_ADMIN,
  VIEW_MODE_USER,
  type ViewMode,
} from "@/lib/constants";

// Manager role names
const MANAGER_ROLES: RoleName[] = [
  "Unit Manager",
  "Company Manager",
  "Section Manager",
  "Work Section Manager",
];

// Admin roles
const ADMIN_ROLES: RoleName[] = ["App Admin", "Unit Admin"];

// Format date for display
function formatDate(date: Date | string): string {
  return new Date(date).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

// Get approver level display name
function getApproverLevelName(level: 'work_section' | 'section' | 'company'): string {
  switch (level) {
    case 'work_section': return 'Work Section Manager';
    case 'section': return 'Section Manager';
    case 'company': return 'Company Manager';
  }
}

export default function DutySwapsPage() {
  const { user } = useAuth();
  const [requests, setRequests] = useState<EnrichedDutyChangeRequest[]>([]);
  const [personnel, setPersonnel] = useState<Personnel[]>([]);
  const [dutyTypes, setDutyTypes] = useState<DutyType[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>("pending");
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [currentViewMode, setCurrentViewMode] = useState<ViewMode>(VIEW_MODE_USER);

  // Rejection modal
  const [rejectModal, setRejectModal] = useState<{
    isOpen: boolean;
    requestId: string | null;
    reason: string;
  }>({ isOpen: false, requestId: null, reason: "" });

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

  // Determine user's role capabilities
  const isAppAdmin = user?.roles?.some((r) => r.role_name === "App Admin");
  const hasUnitAdminRole = user?.roles?.some((r) => r.role_name === "Unit Admin");
  const isManager = user?.roles?.some((r) => MANAGER_ROLES.includes(r.role_name as RoleName));

  // Effective admin status - respects view mode toggle
  const effectiveIsAppAdmin = isAppAdmin && isAdminView;
  const effectiveIsUnitAdmin = hasUnitAdminRole && isUnitAdminView;

  // User has elevated access if admin, unit admin, or manager
  const hasElevatedAccess = isAppAdmin || hasUnitAdminRole || isManager;

  // Fetch data
  useEffect(() => {
    async function fetchData() {
      setLoading(true);
      try {
        const personnelData = getAllPersonnel();
        setPersonnel(personnelData);

        const dutyTypesData = getAllDutyTypes();
        setDutyTypes(dutyTypesData);

        const requestsData = getEnrichedDutyChangeRequests(statusFilter === "all" ? undefined : statusFilter);
        setRequests(requestsData);
      } catch (err) {
        console.error("Error fetching duty swap data:", err);
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, [statusFilter]);

  // Check if user can approve a specific request
  const canApproveRequest = (request: EnrichedDutyChangeRequest): boolean => {
    if (!user?.roles) return false;
    if (effectiveIsAppAdmin) return true;

    return canApproveChangeRequest(
      user.roles.map(r => ({ name: r.role_name, scope_unit_id: r.scope_unit_id })),
      request.required_approver_level,
      request.original_personnel_id,
      request.target_personnel_id
    );
  };

  // Filter requests based on user's scope
  const filteredRequests = useMemo(() => {
    if (effectiveIsAppAdmin) return requests;

    // Show requests the user is involved in
    const myRequests = requests.filter(r => {
      // User is the requester
      if (r.requester_id === user?.id) return true;
      // User is one of the personnel involved
      if (currentUserPersonnel && (
        r.original_personnel_id === currentUserPersonnel.id ||
        r.target_personnel_id === currentUserPersonnel.id
      )) return true;
      // User can approve this request
      if (canApproveRequest(r)) return true;
      return false;
    });

    return myRequests;
  }, [requests, effectiveIsAppAdmin, user?.id, currentUserPersonnel]);

  // Handle approve
  async function handleApprove(requestId: string) {
    if (!user) return;
    setProcessingId(requestId);
    try {
      const result = approveDutyChangeRequest(requestId, user.id);
      if (result.success) {
        // Refresh data
        const requestsData = getEnrichedDutyChangeRequests(statusFilter === "all" ? undefined : statusFilter);
        setRequests(requestsData);
      } else {
        alert(result.error || "Failed to approve request");
      }
    } catch (err) {
      console.error("Error approving request:", err);
    } finally {
      setProcessingId(null);
    }
  }

  // Handle reject
  function handleReject(requestId: string) {
    setRejectModal({ isOpen: true, requestId, reason: "" });
  }

  // Confirm rejection
  function confirmReject() {
    if (!rejectModal.requestId || !user || !rejectModal.reason.trim()) {
      alert("Please provide a reason for rejection");
      return;
    }

    setProcessingId(rejectModal.requestId);
    try {
      rejectDutyChangeRequest(rejectModal.requestId, user.id, rejectModal.reason);
      // Refresh data
      const requestsData = getEnrichedDutyChangeRequests(statusFilter === "all" ? undefined : statusFilter);
      setRequests(requestsData);
      setRejectModal({ isOpen: false, requestId: null, reason: "" });
    } catch (err) {
      console.error("Error rejecting request:", err);
    } finally {
      setProcessingId(null);
    }
  }

  // Handle delete (only for pending requests by the requester)
  function handleDelete(requestId: string) {
    if (!confirm("Are you sure you want to delete this request?")) return;

    try {
      deleteDutyChangeRequest(requestId);
      // Refresh data
      const requestsData = getEnrichedDutyChangeRequests(statusFilter === "all" ? undefined : statusFilter);
      setRequests(requestsData);
    } catch (err) {
      console.error("Error deleting request:", err);
    }
  }

  // Get status badge color
  function getStatusBadge(status: string) {
    switch (status) {
      case "pending":
        return "bg-yellow-500/20 text-yellow-300";
      case "approved":
        return "bg-green-500/20 text-green-300";
      case "rejected":
        return "bg-red-500/20 text-red-300";
      default:
        return "bg-gray-500/20 text-gray-300";
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Duty Swap Requests</h1>
          <p className="text-foreground-muted mt-1">
            View and manage duty swap requests between personnel
          </p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-4 items-center">
        <div className="flex items-center gap-2">
          <label className="text-sm text-foreground-muted">Status:</label>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-3 py-1.5 bg-surface border border-border rounded-lg text-foreground text-sm"
          >
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
            <option value="all">All</option>
          </select>
        </div>

        <div className="ml-auto text-sm text-foreground-muted">
          {filteredRequests.length} request{filteredRequests.length !== 1 ? "s" : ""}
        </div>
      </div>

      {/* Requests Table */}
      {filteredRequests.length === 0 ? (
        <div className="bg-surface border border-border rounded-lg p-8 text-center">
          <p className="text-foreground-muted">No duty swap requests found.</p>
          <p className="text-sm text-foreground-muted mt-2">
            Swap requests can be created from the Duty Roster page after a roster is approved.
          </p>
        </div>
      ) : (
        <div className="bg-surface border border-border rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-surface-elevated">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-foreground-muted uppercase tracking-wider">
                    Status
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-foreground-muted uppercase tracking-wider">
                    Original Assignment
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-foreground-muted uppercase tracking-wider">
                    Swap With
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-foreground-muted uppercase tracking-wider">
                    Reason
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-foreground-muted uppercase tracking-wider">
                    Required Approval
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-foreground-muted uppercase tracking-wider">
                    Submitted
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-foreground-muted uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filteredRequests.map((request) => (
                  <tr key={request.id} className="hover:bg-surface-elevated/50">
                    <td className="px-4 py-3">
                      <span className={`px-2 py-1 rounded-full text-xs font-medium ${getStatusBadge(request.status)}`}>
                        {request.status.charAt(0).toUpperCase() + request.status.slice(1)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-sm">
                        <div className="font-medium text-foreground">
                          {request.originalPersonnel?.rank} {request.originalPersonnel?.last_name}, {request.originalPersonnel?.first_name}
                        </div>
                        <div className="text-foreground-muted">
                          {request.originalDutyType?.duty_name} - {formatDate(request.original_duty_date)}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-sm">
                        <div className="font-medium text-foreground">
                          {request.targetPersonnel?.rank} {request.targetPersonnel?.last_name}, {request.targetPersonnel?.first_name}
                        </div>
                        <div className="text-foreground-muted">
                          {request.targetDutyType?.duty_name} - {formatDate(request.target_duty_date)}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-sm text-foreground max-w-xs truncate" title={request.reason}>
                        {request.reason}
                      </p>
                      {request.rejection_reason && (
                        <p className="text-xs text-red-400 mt-1">
                          Rejection: {request.rejection_reason}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-sm text-foreground-muted">
                        {getApproverLevelName(request.required_approver_level)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-foreground-muted">
                      {formatDate(request.created_at)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        {request.status === "pending" && canApproveRequest(request) && (
                          <>
                            <button
                              onClick={() => handleApprove(request.id)}
                              disabled={processingId === request.id}
                              className="px-2 py-1 text-xs bg-green-500/20 text-green-300 rounded hover:bg-green-500/30 disabled:opacity-50"
                            >
                              {processingId === request.id ? "..." : "Approve"}
                            </button>
                            <button
                              onClick={() => handleReject(request.id)}
                              disabled={processingId === request.id}
                              className="px-2 py-1 text-xs bg-red-500/20 text-red-300 rounded hover:bg-red-500/30 disabled:opacity-50"
                            >
                              Reject
                            </button>
                          </>
                        )}
                        {request.status === "pending" && request.requester_id === user?.id && (
                          <button
                            onClick={() => handleDelete(request.id)}
                            className="px-2 py-1 text-xs bg-gray-500/20 text-gray-300 rounded hover:bg-gray-500/30"
                          >
                            Cancel
                          </button>
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

      {/* Rejection Modal */}
      {rejectModal.isOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-surface rounded-lg border border-border w-full max-w-md">
            <div className="p-4 border-b border-border">
              <h2 className="text-lg font-semibold text-foreground">Reject Request</h2>
            </div>
            <div className="p-4 space-y-4">
              <div>
                <label className="block text-sm font-medium text-foreground-muted mb-1">
                  Reason for Rejection *
                </label>
                <textarea
                  value={rejectModal.reason}
                  onChange={(e) => setRejectModal(prev => ({ ...prev, reason: e.target.value }))}
                  rows={3}
                  className="w-full px-3 py-2 bg-background border border-border rounded-lg text-foreground placeholder:text-foreground-muted"
                  placeholder="Enter reason for rejection..."
                />
              </div>
            </div>
            <div className="p-4 border-t border-border flex justify-end gap-2">
              <Button
                variant="secondary"
                onClick={() => setRejectModal({ isOpen: false, requestId: null, reason: "" })}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                onClick={confirmReject}
                disabled={!rejectModal.reason.trim()}
              >
                Confirm Rejection
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
