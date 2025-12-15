"use client";

import { useState, useEffect, useMemo } from "react";
import Button from "@/components/ui/Button";
import type { Personnel, RoleName, DutyType, DutyChangeRequest } from "@/types";
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
  getAllDescendantUnitIds,
  isRosterApproved,
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
    default:
      // This should not be reachable with the current types, but ensures future safety.
      return 'Unknown Approver';
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

  // Swap request modal state
  const [swapModal, setSwapModal] = useState<{
    isOpen: boolean;
    step: 'select-person' | 'select-original' | 'select-target' | 'confirm';
    selectedPersonnel: Personnel | null;  // For managers selecting on behalf
    originalSlot: EnrichedSlot | null;
    targetSlot: EnrichedSlot | null;
    reason: string;
  }>({
    isOpen: false,
    step: 'select-person',
    selectedPersonnel: null,
    originalSlot: null,
    targetSlot: null,
    reason: ''
  });
  const [submittingSwap, setSubmittingSwap] = useState(false);
  const [allSlots, setAllSlots] = useState<EnrichedSlot[]>([]);

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

  // Get user's manager scope unit IDs
  const userScopeUnitIds = useMemo(() => {
    if (!user?.roles) return new Set<string>();

    const allUnitIds = new Set<string>();
    for (const role of user.roles) {
      if (MANAGER_ROLES.includes(role.role_name as RoleName) && role.scope_unit_id) {
        const descendantIds = getAllDescendantUnitIds(role.scope_unit_id);
        descendantIds.forEach(id => allUnitIds.add(id));
      }
    }
    return allUnitIds;
  }, [user?.roles]);

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

        // Fetch slots for the current month (for swap requests)
        const now = new Date();
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);
        const slotsData = getEnrichedSlots(startOfMonth, endOfMonth);
        setAllSlots(slotsData);
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

  // Refresh requests data from storage
  function refreshRequests() {
    const requestsData = getEnrichedDutyChangeRequests(statusFilter === "all" ? undefined : statusFilter);
    setRequests(requestsData);
  }

  // Handle approve
  async function handleApprove(requestId: string) {
    if (!user) return;
    setProcessingId(requestId);
    try {
      const result = approveDutyChangeRequest(requestId, user.id);
      if (result.success) {
        refreshRequests();
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
      refreshRequests();
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

    setProcessingId(requestId);
    try {
      deleteDutyChangeRequest(requestId);
      refreshRequests();
    } catch (err) {
      console.error("Error deleting request:", err);
    } finally {
      setProcessingId(null);
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

  // Get slots assigned to a specific personnel
  const getPersonnelSlots = (personnelId: string): EnrichedSlot[] => {
    return allSlots.filter(s => s.personnel_id === personnelId);
  };

  // Get my own duty slots
  const myDutySlots = useMemo(() => {
    if (!currentUserPersonnel) return [];
    return getPersonnelSlots(currentUserPersonnel.id);
  }, [allSlots, currentUserPersonnel]);

  // Get personnel in manager's scope who have assigned duties
  const personnelWithDutiesInScope = useMemo(() => {
    if (!isManager || userScopeUnitIds.size === 0) return [];

    // Get unique personnel IDs from slots that are in scope
    const personnelIdsWithDuties = new Set<string>();
    for (const slot of allSlots) {
      if (slot.personnel_id) {
        // Look up the full personnel record to get unit_section_id
        const person = personnel.find(p => p.id === slot.personnel_id);
        if (person && userScopeUnitIds.has(person.unit_section_id)) {
          personnelIdsWithDuties.add(slot.personnel_id);
        }
      }
    }

    // Return personnel objects
    return personnel.filter(p => personnelIdsWithDuties.has(p.id));
  }, [allSlots, personnel, isManager, userScopeUnitIds]);

  // Get available slots for swap (excluding the original slot's personnel)
  const availableSlotsForSwap = useMemo(() => {
    if (!swapModal.originalSlot) return [];

    return allSlots.filter(slot => {
      // Must be assigned to someone else
      if (!slot.personnel_id || slot.personnel_id === swapModal.originalSlot?.personnel_id) return false;
      // Must not be the same slot
      if (slot.id === swapModal.originalSlot?.id) return false;
      // Must have personnel info
      if (!slot.personnel) return false;
      return true;
    });
  }, [allSlots, swapModal.originalSlot]);

  // Handle opening the swap modal
  function openSwapModal() {
    if (isManager) {
      // Manager flow: start with selecting personnel
      setSwapModal({
        isOpen: true,
        step: 'select-person',
        selectedPersonnel: null,
        originalSlot: null,
        targetSlot: null,
        reason: ''
      });
    } else {
      // Regular user flow: check if they have any assigned duties
      if (myDutySlots.length === 0) {
        alert("You are not assigned to any duties. Only personnel with assigned duties can request a swap.");
        return;
      }
      // Skip to select original duty
      setSwapModal({
        isOpen: true,
        step: 'select-original',
        selectedPersonnel: currentUserPersonnel,
        originalSlot: null,
        targetSlot: null,
        reason: ''
      });
    }
  }

  // Handle selecting personnel (for managers)
  function handleSelectPersonnel(person: Personnel) {
    const personSlots = getPersonnelSlots(person.id);
    if (personSlots.length === 0) {
      alert("This person has no assigned duties to swap.");
      return;
    }
    setSwapModal(prev => ({
      ...prev,
      step: 'select-original',
      selectedPersonnel: person
    }));
  }

  // Handle selecting original slot
  function handleSelectOriginalSlot(slot: EnrichedSlot) {
    setSwapModal(prev => ({
      ...prev,
      step: 'select-target',
      originalSlot: slot
    }));
  }

  // Handle selecting target slot
  function handleSelectTargetSlot(slot: EnrichedSlot) {
    setSwapModal(prev => ({
      ...prev,
      step: 'confirm',
      targetSlot: slot
    }));
  }

  // Handle submitting swap request
  function handleSubmitSwapRequest() {
    if (!swapModal.originalSlot || !swapModal.targetSlot || !user || !swapModal.reason.trim()) {
      alert("Please complete all steps and provide a reason.");
      return;
    }

    setSubmittingSwap(true);

    try {
      const approverLevel = determineApproverLevel(
        swapModal.originalSlot.personnel_id!,
        swapModal.targetSlot.personnel_id!
      );

      const request: DutyChangeRequest = {
        id: crypto.randomUUID(),
        requester_id: user.id,
        requester_personnel_id: currentUserPersonnel?.id || null,

        original_slot_id: swapModal.originalSlot.id,
        original_personnel_id: swapModal.originalSlot.personnel_id!,
        original_duty_date: new Date(swapModal.originalSlot.date_assigned),
        original_duty_type_id: swapModal.originalSlot.duty_type_id,

        target_slot_id: swapModal.targetSlot.id,
        target_personnel_id: swapModal.targetSlot.personnel_id!,
        target_duty_date: new Date(swapModal.targetSlot.date_assigned),
        target_duty_type_id: swapModal.targetSlot.duty_type_id,

        reason: swapModal.reason.trim(),
        status: 'pending',
        required_approver_level: approverLevel,
        approved_by: null,
        approved_at: null,
        rejection_reason: null,
        created_at: new Date(),
        updated_at: new Date(),
      };

      createDutyChangeRequest(request);

      refreshRequests();

      alert("Swap request submitted successfully!");

      // Close modal
      setSwapModal({
        isOpen: false,
        step: 'select-person',
        selectedPersonnel: null,
        originalSlot: null,
        targetSlot: null,
        reason: ''
      });
    } catch (err) {
      console.error("Error submitting swap request:", err);
      alert("Failed to submit swap request. Please try again.");
    } finally {
      setSubmittingSwap(false);
    }
  }

  // Close swap modal
  function closeSwapModal() {
    setSwapModal({
      isOpen: false,
      step: 'select-person',
      selectedPersonnel: null,
      originalSlot: null,
      targetSlot: null,
      reason: ''
    });
  }

  // Go back in swap modal
  function goBackInSwapModal() {
    if (swapModal.step === 'select-original') {
      if (isManager) {
        setSwapModal(prev => ({ ...prev, step: 'select-person', selectedPersonnel: null }));
      } else {
        closeSwapModal();
      }
    } else if (swapModal.step === 'select-target') {
      setSwapModal(prev => ({ ...prev, step: 'select-original', originalSlot: null }));
    } else if (swapModal.step === 'confirm') {
      setSwapModal(prev => ({ ...prev, step: 'select-target', targetSlot: null }));
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
        <Button variant="primary" onClick={openSwapModal}>
          <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
          </svg>
          Request Swap
        </Button>
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
                              disabled={processingId !== null}
                              className="px-2 py-1 text-xs bg-green-500/20 text-green-300 rounded hover:bg-green-500/30 disabled:opacity-50"
                            >
                              {processingId === request.id ? "..." : "Approve"}
                            </button>
                            <button
                              onClick={() => handleReject(request.id)}
                              disabled={processingId !== null}
                              className="px-2 py-1 text-xs bg-red-500/20 text-red-300 rounded hover:bg-red-500/30 disabled:opacity-50"
                            >
                              Reject
                            </button>
                          </>
                        )}
                        {request.status === "pending" && request.requester_id === user?.id && (
                          <button
                            onClick={() => handleDelete(request.id)}
                            disabled={processingId !== null}
                            className="px-2 py-1 text-xs bg-gray-500/20 text-gray-300 rounded hover:bg-gray-500/30 disabled:opacity-50"
                          >
                            {processingId === request.id ? "..." : "Cancel"}
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

      {/* Swap Request Modal */}
      {swapModal.isOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-surface rounded-lg border border-border w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
            <div className="p-4 border-b border-border flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-foreground">Request Duty Swap</h2>
                <p className="text-sm text-foreground-muted mt-1">
                  {swapModal.step === 'select-person' && 'Select a service member'}
                  {swapModal.step === 'select-original' && 'Select the duty to swap away'}
                  {swapModal.step === 'select-target' && 'Select the duty to swap with'}
                  {swapModal.step === 'confirm' && 'Confirm swap request'}
                </p>
              </div>
              <button
                onClick={closeSwapModal}
                className="text-foreground-muted hover:text-foreground"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="p-4 overflow-y-auto flex-1">
              {/* Step 1: Select Personnel (Managers only) */}
              {swapModal.step === 'select-person' && (
                <div className="space-y-4">
                  <p className="text-sm text-foreground-muted">
                    Select a service member in your scope who has assigned duties ({personnelWithDutiesInScope.length} available):
                  </p>
                  {personnelWithDutiesInScope.length === 0 ? (
                    <div className="text-center py-8 text-foreground-muted">
                      <p>No personnel with assigned duties found in your scope.</p>
                    </div>
                  ) : (
                    <div className="max-h-96 overflow-y-auto space-y-2 border border-border rounded-lg p-2">
                      {personnelWithDutiesInScope.map((person) => (
                        <button
                          key={person.id}
                          onClick={() => handleSelectPersonnel(person)}
                          className="w-full text-left p-3 rounded-lg border border-border hover:bg-primary/10 hover:border-primary transition-colors"
                        >
                          <div className="flex justify-between items-center">
                            <div>
                              <p className="font-medium text-foreground">
                                {person.rank} {person.last_name}, {person.first_name}
                              </p>
                              <p className="text-xs text-foreground-muted">
                                {getPersonnelSlots(person.id).length} assigned duties
                              </p>
                            </div>
                            <svg className="w-4 h-4 text-foreground-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                            </svg>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Step 2: Select Original Duty */}
              {swapModal.step === 'select-original' && swapModal.selectedPersonnel && (
                <div className="space-y-4">
                  <div className="p-3 bg-primary/10 rounded-lg">
                    <p className="text-sm text-foreground-muted">Swapping for:</p>
                    <p className="font-medium text-foreground">
                      {swapModal.selectedPersonnel.rank} {swapModal.selectedPersonnel.last_name}, {swapModal.selectedPersonnel.first_name}
                    </p>
                  </div>

                  <p className="text-sm text-foreground-muted">
                    Select the duty to swap away:
                  </p>

                  {(() => {
                    const slots = getPersonnelSlots(swapModal.selectedPersonnel.id);
                    return slots.length === 0 ? (
                      <div className="text-center py-8 text-foreground-muted">
                        <p>No assigned duties found.</p>
                      </div>
                    ) : (
                      <div className="max-h-64 overflow-y-auto space-y-2 border border-border rounded-lg p-2">
                        {slots.map((slot) => (
                          <button
                            key={slot.id}
                            onClick={() => handleSelectOriginalSlot(slot)}
                            className="w-full text-left p-3 rounded-lg border border-border hover:bg-primary/10 hover:border-primary transition-colors"
                          >
                            <div className="flex justify-between items-center">
                              <div>
                                <p className="font-medium text-foreground">
                                  {slot.duty_type?.duty_name}
                                </p>
                                <p className="text-sm text-foreground-muted">
                                  {formatDate(slot.date_assigned)}
                                </p>
                              </div>
                              <svg className="w-4 h-4 text-foreground-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                              </svg>
                            </div>
                          </button>
                        ))}
                      </div>
                    );
                  })()}
                </div>
              )}

              {/* Step 3: Select Target Duty */}
              {swapModal.step === 'select-target' && swapModal.originalSlot && (
                <div className="space-y-4">
                  <div className="p-3 bg-primary/10 rounded-lg">
                    <p className="text-sm text-foreground-muted">Original Duty:</p>
                    <p className="font-medium text-foreground">
                      {swapModal.originalSlot.duty_type?.duty_name} - {formatDate(swapModal.originalSlot.date_assigned)}
                    </p>
                    <p className="text-xs text-foreground-muted">
                      {swapModal.originalSlot.personnel?.rank} {swapModal.originalSlot.personnel?.last_name}
                    </p>
                  </div>

                  <p className="text-sm text-foreground-muted">
                    Select a duty to swap with ({availableSlotsForSwap.length} available):
                  </p>

                  {availableSlotsForSwap.length === 0 ? (
                    <div className="text-center py-8 text-foreground-muted">
                      <p>No duties available to swap with.</p>
                    </div>
                  ) : (
                    <div className="max-h-64 overflow-y-auto space-y-2 border border-border rounded-lg p-2">
                      {availableSlotsForSwap.map((slot) => (
                        <button
                          key={slot.id}
                          onClick={() => handleSelectTargetSlot(slot)}
                          className="w-full text-left p-3 rounded-lg border border-border hover:bg-green-500/10 hover:border-green-500 transition-colors"
                        >
                          <div className="flex justify-between items-start">
                            <div>
                              <p className="font-medium text-foreground">
                                {slot.duty_type?.duty_name}
                              </p>
                              <p className="text-sm text-foreground-muted">
                                {formatDate(slot.date_assigned)}
                              </p>
                            </div>
                            <div className="text-right">
                              <p className="text-sm text-foreground">
                                {slot.personnel?.rank} {slot.personnel?.last_name}
                              </p>
                            </div>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Step 4: Confirm */}
              {swapModal.step === 'confirm' && swapModal.originalSlot && swapModal.targetSlot && (
                <div className="space-y-4">
                  {/* Summary */}
                  <div className="grid grid-cols-2 gap-4">
                    <div className="p-3 bg-primary/10 rounded-lg">
                      <p className="text-xs text-foreground-muted uppercase tracking-wide mb-1">Giving Up</p>
                      <p className="font-medium text-foreground">
                        {swapModal.originalSlot.duty_type?.duty_name}
                      </p>
                      <p className="text-sm text-foreground-muted">
                        {formatDate(swapModal.originalSlot.date_assigned)}
                      </p>
                      <p className="text-xs text-foreground-muted mt-1">
                        {swapModal.originalSlot.personnel?.rank} {swapModal.originalSlot.personnel?.last_name}
                      </p>
                    </div>
                    <div className="p-3 bg-green-500/10 rounded-lg">
                      <p className="text-xs text-foreground-muted uppercase tracking-wide mb-1">Receiving</p>
                      <p className="font-medium text-foreground">
                        {swapModal.targetSlot.duty_type?.duty_name}
                      </p>
                      <p className="text-sm text-foreground-muted">
                        {formatDate(swapModal.targetSlot.date_assigned)}
                      </p>
                      <p className="text-xs text-foreground-muted mt-1">
                        {swapModal.targetSlot.personnel?.rank} {swapModal.targetSlot.personnel?.last_name}
                      </p>
                    </div>
                  </div>

                  {/* Reason */}
                  <div>
                    <label className="block text-sm font-medium text-foreground-muted mb-1">
                      Reason for Swap Request *
                    </label>
                    <textarea
                      value={swapModal.reason}
                      onChange={(e) => setSwapModal(prev => ({ ...prev, reason: e.target.value }))}
                      rows={3}
                      className="w-full px-3 py-2 bg-background border border-border rounded-lg text-foreground placeholder:text-foreground-muted"
                      placeholder="Explain why you need to swap this duty..."
                    />
                  </div>

                  {/* Approval Info */}
                  <div className="p-3 bg-yellow-500/10 rounded-lg text-sm">
                    <p className="text-yellow-400 font-medium">Approval Required:</p>
                    <p className="text-foreground-muted">
                      {getApproverLevelName(
                        determineApproverLevel(
                          swapModal.originalSlot.personnel_id!,
                          swapModal.targetSlot.personnel_id!
                        )
                      )}
                    </p>
                  </div>
                </div>
              )}
            </div>

            <div className="p-4 border-t border-border flex justify-between">
              {swapModal.step !== 'select-person' && (isManager || swapModal.step !== 'select-original') ? (
                <Button variant="ghost" onClick={goBackInSwapModal}>
                  Back
                </Button>
              ) : (
                <div />
              )}
              <div className="flex gap-2">
                <Button variant="ghost" onClick={closeSwapModal}>
                  Cancel
                </Button>
                {swapModal.step === 'confirm' && (
                  <Button
                    variant="primary"
                    onClick={handleSubmitSwapRequest}
                    disabled={submittingSwap || !swapModal.reason.trim()}
                  >
                    {submittingSwap ? "Submitting..." : "Submit Request"}
                  </Button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
