"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import Button from "@/components/ui/Button";
import type { Personnel, RoleName, DutyType, SwapApproval, SwapRecommendation } from "@/types";
import {
  getAllPersonnel,
  getEnrichedSwapPairs,
  createDutySwap,
  approveSwapApproval,
  rejectSwap,
  deleteSwap,
  acceptSwapRequest,
  determineRequiredApprovalLevel,
  canApproveChangeRequest,
  canRecommendChangeRequest,
  addSwapRecommendation,
  meetsAllDutyRequirements,
  type EnrichedSwapPair,
  getUnitSections,
  getPersonnelByEdipi,
  getChildUnits,
  getAllDutyTypes,
  getEnrichedSlots,
  getDutySlotById,
  getAllDescendantUnitIds,
  isRosterApproved,
  type EnrichedSlot,
  getSwapApprovalsByRequestId,
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

export default function DutySwapsPage() {
  const { user } = useAuth();
  const [swapPairs, setSwapPairs] = useState<EnrichedSwapPair[]>([]);
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

  // Recommendation modal
  const [recommendModal, setRecommendModal] = useState<{
    isOpen: boolean;
    requestId: string | null;
    recommendation: 'recommend' | 'not_recommend';
    comment: string;
  }>({ isOpen: false, requestId: null, recommendation: 'recommend', comment: "" });

  // Swap request modal state
  type SwapModalState = {
    isOpen: boolean;
    step: 'select-person' | 'select-original' | 'select-target' | 'confirm';
    selectedPersonnel: Personnel | null;
    originalSlot: EnrichedSlot | null;
    targetSlot: EnrichedSlot | null;
    reason: string;
  };
  const initialSwapModalState: SwapModalState = {
    isOpen: false,
    step: 'select-person',
    selectedPersonnel: null,
    originalSlot: null,
    targetSlot: null,
    reason: ''
  };
  const [swapModal, setSwapModal] = useState<SwapModalState>(initialSwapModalState);
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

  // Fetch data function
  const fetchData = useCallback(() => {
    setLoading(true);
    try {
      const personnelData = getAllPersonnel();
      setPersonnel(personnelData);

      const dutyTypesData = getAllDutyTypes();
      setDutyTypes(dutyTypesData);

      const swapPairsData = getEnrichedSwapPairs(statusFilter === "all" ? undefined : statusFilter as 'pending' | 'approved' | 'rejected');
      setSwapPairs(swapPairsData);

      // Fetch slots for current and next month (for swap requests)
      const now = new Date();
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      const endOfNextMonth = new Date(now.getFullYear(), now.getMonth() + 2, 0);
      const slotsData = getEnrichedSlots(startOfMonth, endOfNextMonth);
      setAllSlots(slotsData);
    } catch (err) {
      console.error("Error fetching duty swap data:", err);
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  // Initial fetch and re-fetch on filter change
  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Listen for sync updates and refresh automatically
  useSyncRefresh(["personnel", "dutyTypes", "dutySlots"], fetchData);

  // Filter swap pairs based on user's scope
  const filteredSwapPairs = useMemo(() => {
    if (effectiveIsAppAdmin) return swapPairs;

    // Show swap pairs the user is involved in
    const mySwapPairs = swapPairs.filter(pair => {
      // User is the requester
      if (pair.requester_id === user?.id) return true;
      // User is one of the personnel involved
      if (currentUserPersonnel && (
        pair.personA.personnel_id === currentUserPersonnel.id ||
        pair.personB.personnel_id === currentUserPersonnel.id
      )) return true;
      // User can approve one of the approval steps
      const canApproveA = pair.personA.approvals.some(a =>
        a.status === 'pending' && canApproveApprovalStep(a)
      );
      const canApproveB = pair.personB.approvals.some(a =>
        a.status === 'pending' && canApproveApprovalStep(a)
      );
      if (canApproveA || canApproveB) return true;
      return false;
    });

    return mySwapPairs;
  }, [swapPairs, effectiveIsAppAdmin, user?.id, currentUserPersonnel]);

  // Check if user can approve a specific approval step
  function canApproveApprovalStep(approval: SwapApproval): boolean {
    if (!user?.roles) return false;

    // Match approver_type to role names
    const roleMapping: Record<string, RoleName> = {
      'work_section_manager': 'Work Section Manager',
      'section_manager': 'Section Manager',
      'company_manager': 'Company Manager',
    };

    const requiredRole = roleMapping[approval.approver_type];
    if (!requiredRole) return false;

    return user.roles.some(role => {
      if (role.role_name !== requiredRole) return false;
      // Check scope - null scope means company-wide
      if (!approval.scope_unit_id) return true;
      if (!role.scope_unit_id) return true;
      // Check if user's scope includes the approval's scope
      const scopeUnits = getAllDescendantUnitIds(role.scope_unit_id);
      return scopeUnits.includes(approval.scope_unit_id);
    });
  }

  // Refresh swap pairs data from storage
  function refreshSwapPairs() {
    const swapPairsData = getEnrichedSwapPairs(statusFilter === "all" ? undefined : statusFilter as 'pending' | 'approved' | 'rejected');
    setSwapPairs(swapPairsData);
  }

  // Handle approve an approval step
  async function handleApproveStep(approvalId: string) {
    if (!user) return;
    setProcessingId(approvalId);
    try {
      const result = approveSwapApproval(approvalId, user.id);
      if (result.success) {
        refreshSwapPairs();
        if (result.swapCompleted) {
          alert("Swap completed! Both duties have been exchanged.");
        }
      } else {
        alert(result.error || "Failed to approve");
      }
    } catch (err) {
      console.error("Error approving:", err);
    } finally {
      setProcessingId(null);
    }
  }

  // Handle accept swap (partner acceptance)
  async function handleAcceptSwap(requestId: string) {
    if (!user) return;
    setProcessingId(requestId);
    try {
      const result = acceptSwapRequest(requestId, user.id);
      if (result.success) {
        refreshSwapPairs();
        if (result.swapCompleted) {
          alert("Swap completed! The duty roster has been updated.");
        } else {
          alert("Swap request accepted! Waiting for manager approvals.");
        }
      } else {
        alert(result.error || "Failed to accept swap");
      }
    } catch (err) {
      console.error("Error accepting swap:", err);
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
      rejectSwap(rejectModal.requestId, user.id, rejectModal.reason);
      refreshSwapPairs();
      setRejectModal({ isOpen: false, requestId: null, reason: "" });
    } catch (err) {
      console.error("Error rejecting request:", err);
    } finally {
      setProcessingId(null);
    }
  }

  // Handle opening recommendation modal
  function handleRecommend(requestId: string, type: 'recommend' | 'not_recommend') {
    setRecommendModal({ isOpen: true, requestId, recommendation: type, comment: "" });
  }

  // Confirm recommendation
  function confirmRecommend() {
    if (!recommendModal.requestId || !user || !recommendModal.comment.trim()) {
      alert("Please provide a comment for your recommendation");
      return;
    }

    setProcessingId(recommendModal.requestId);
    try {
      addSwapRecommendation(
        recommendModal.requestId,
        user.id,
        recommendModal.recommendation,
        recommendModal.comment
      );
      refreshSwapPairs();
      setRecommendModal({ isOpen: false, requestId: null, recommendation: 'recommend', comment: "" });
    } catch (err) {
      console.error("Error adding recommendation:", err);
      alert("Failed to add recommendation. Please try again.");
    } finally {
      setProcessingId(null);
    }
  }

  // Handle delete (only for pending swaps by the requester)
  function handleDeleteSwap(swapPairId: string) {
    if (!confirm("Are you sure you want to delete this swap request?")) return;

    setProcessingId(swapPairId);
    try {
      deleteSwap(swapPairId);
      refreshSwapPairs();
    } catch (err) {
      console.error("Error deleting swap:", err);
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

    // Create a Map for O(1) personnel lookups
    const personnelMap = new Map(personnel.map(p => [p.id, p]));

    // Get unique personnel IDs from slots that are in scope
    const personnelIdsWithDuties = new Set<string>();
    for (const slot of allSlots) {
      if (slot.personnel_id) {
        // Look up the full personnel record to get unit_section_id
        const person = personnelMap.get(slot.personnel_id);
        if (person && userScopeUnitIds.has(person.unit_section_id)) {
          personnelIdsWithDuties.add(slot.personnel_id);
        }
      }
    }

    // Return personnel objects
    return personnel.filter(p => personnelIdsWithDuties.has(p.id));
  }, [allSlots, personnel, isManager, userScopeUnitIds]);

  // Get slots for the selected personnel in swap modal
  const selectedPersonnelSlots = useMemo(() => {
    if (!swapModal.selectedPersonnel) return [];
    return getPersonnelSlots(swapModal.selectedPersonnel.id);
  }, [allSlots, swapModal.selectedPersonnel]);

  // Get available slots for swap (excluding the original slot's personnel)
  const availableSlotsForSwap = useMemo(() => {
    if (!swapModal.originalSlot || !swapModal.selectedPersonnel) return [];

    const originalPersonnelId = swapModal.selectedPersonnel.id;
    const originalDutyTypeId = swapModal.originalSlot.duty_type_id;

    return allSlots
      .filter(slot => {
        // Must be assigned to someone else
        if (!slot.personnel_id || slot.personnel_id === swapModal.originalSlot?.personnel_id) return false;
        // Must not be the same slot
        if (slot.id === swapModal.originalSlot?.id) return false;
        // Must have personnel info
        if (!slot.personnel) return false;

        // Check qualifications - original person must be qualified for target duty
        if (!meetsAllDutyRequirements(originalPersonnelId, slot.duty_type_id)) return false;

        // Check qualifications - target person must be qualified for original duty
        if (!meetsAllDutyRequirements(slot.personnel_id, originalDutyTypeId)) return false;

        return true;
      })
      // Sort by date (earliest first)
      .sort((a, b) => {
        const dateA = new Date(a.date_assigned).getTime();
        const dateB = new Date(b.date_assigned).getTime();
        return dateA - dateB;
      });
  }, [allSlots, swapModal.originalSlot, swapModal.selectedPersonnel]);

  // Handle opening the swap modal
  function openSwapModal() {
    if (isManager) {
      // Manager flow: start with selecting personnel
      setSwapModal({ ...initialSwapModalState, isOpen: true });
    } else {
      // Regular user flow: check if they have any assigned duties
      if (myDutySlots.length === 0) {
        alert("You are not assigned to any duties. Only personnel with assigned duties can request a swap.");
        return;
      }
      // Skip to select original duty
      setSwapModal({
        ...initialSwapModalState,
        isOpen: true,
        step: 'select-original',
        selectedPersonnel: currentUserPersonnel,
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
      // Create swap with two linked rows
      createDutySwap({
        personAId: swapModal.originalSlot.personnel_id!,
        personASlotId: swapModal.originalSlot.id,
        personBId: swapModal.targetSlot.personnel_id!,
        personBSlotId: swapModal.targetSlot.id,
        requesterId: user.id,
        reason: swapModal.reason.trim(),
      });

      refreshSwapPairs();

      alert("Swap request submitted successfully! The target person and chain of command will need to approve.");

      closeSwapModal();
    } catch (err) {
      console.error("Error submitting swap request:", err);
      alert("Failed to submit swap request. Please try again.");
    } finally {
      setSubmittingSwap(false);
    }
  }

  // Close swap modal
  function closeSwapModal() {
    setSwapModal(initialSwapModalState);
  }

  // Check if back button should be shown in swap modal
  function shouldShowBackButton(): boolean {
    if (swapModal.step === 'select-person') return false;
    if (!isManager && swapModal.step === 'select-original') return false;
    return true;
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
          {filteredSwapPairs.length} swap{filteredSwapPairs.length !== 1 ? "s" : ""}
        </div>
      </div>

      {/* Swap Pairs Table */}
      {filteredSwapPairs.length === 0 ? (
        <div className="bg-surface border border-border rounded-lg p-8 text-center">
          <p className="text-foreground-muted">No duty swap requests found.</p>
          <p className="text-sm text-foreground-muted mt-2">
            Swap requests can be created from the Duty Roster page after a roster is approved.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {filteredSwapPairs.map((pair) => {
            const personADetails = pair.personADetails;
            const personBDetails = pair.personBDetails;
            const needsPartnerAccept = !pair.personA.partner_accepted || !pair.personB.partner_accepted;

            // Find pending approvals that the current user can approve
            const myApprovableSteps = [
              ...pair.personA.approvals.filter(a => a.status === 'pending' && canApproveApprovalStep(a)),
              ...pair.personB.approvals.filter(a => a.status === 'pending' && canApproveApprovalStep(a)),
            ];

            // Check if current user is the target person needing to accept
            const isTargetPerson = currentUserPersonnel && (
              (pair.personA.personnel_id === currentUserPersonnel.id && !pair.personA.partner_accepted) ||
              (pair.personB.personnel_id === currentUserPersonnel.id && !pair.personB.partner_accepted)
            );

            // Get the request ID for the current user's side (for acceptance)
            const myRequestId = currentUserPersonnel && pair.personA.personnel_id === currentUserPersonnel.id
              ? pair.personA.request.id
              : pair.personB.request.id;

            return (
              <div key={pair.swap_pair_id} className="bg-surface border border-border rounded-lg overflow-hidden">
                {/* Header */}
                <div className="p-4 border-b border-border bg-surface-elevated flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${getStatusBadge(pair.status)}`}>
                      {pair.status.charAt(0).toUpperCase() + pair.status.slice(1)}
                    </span>
                    <span className="text-sm text-foreground-muted">
                      Submitted {formatDate(pair.created_at)}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    {pair.status === "pending" && pair.requester_id === user?.id && (
                      <button
                        onClick={() => handleDeleteSwap(pair.swap_pair_id)}
                        disabled={processingId !== null}
                        className="px-2 py-1 text-xs bg-gray-500/20 text-gray-300 rounded hover:bg-gray-500/30 disabled:opacity-50"
                      >
                        Cancel Request
                      </button>
                    )}
                  </div>
                </div>

                {/* Swap Details */}
                <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Person A Side */}
                  <div className="p-3 bg-blue-500/10 rounded-lg">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs text-blue-300 uppercase tracking-wide">Person A</span>
                      {pair.personA.partner_accepted ? (
                        <span className="text-xs text-green-400">✓ Accepted</span>
                      ) : (
                        <span className="text-xs text-yellow-400">⏳ Pending Accept</span>
                      )}
                    </div>
                    <div className="text-sm">
                      <div className="font-medium text-foreground">
                        {personADetails?.personnel?.rank} {personADetails?.personnel?.last_name}, {personADetails?.personnel?.first_name}
                      </div>
                      <div className="text-foreground-muted mt-1">
                        <span className="text-red-300">Giving:</span> {personADetails?.givingDutyType?.duty_name} - {personADetails?.givingSlot && formatDate(personADetails.givingSlot.date_assigned)}
                      </div>
                      <div className="text-foreground-muted">
                        <span className="text-green-300">Receiving:</span> {personADetails?.receivingDutyType?.duty_name} - {personADetails?.receivingSlot && formatDate(personADetails.receivingSlot.date_assigned)}
                      </div>
                    </div>
                    {/* Person A Approval Chain */}
                    <div className="mt-3 pt-3 border-t border-blue-500/20">
                      <div className="text-xs text-foreground-muted mb-1">Approvals:</div>
                      <div className="space-y-1">
                        {pair.personA.approvals.map((approval) => (
                          <div key={approval.id} className="flex items-center gap-2 text-xs">
                            {approval.status === 'approved' ? (
                              <span className="text-green-400">✓</span>
                            ) : approval.status === 'rejected' ? (
                              <span className="text-red-400">✗</span>
                            ) : (
                              <span className="text-yellow-400">○</span>
                            )}
                            <span className="text-foreground-muted">
                              {approval.approver_type.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase())}
                            </span>
                            {approval.status === 'pending' && canApproveApprovalStep(approval) && (
                              <button
                                onClick={() => handleApproveStep(approval.id)}
                                disabled={processingId !== null || needsPartnerAccept}
                                className="ml-auto px-2 py-0.5 text-xs bg-green-500/20 text-green-300 rounded hover:bg-green-500/30 disabled:opacity-50"
                              >
                                Approve
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Person B Side */}
                  <div className="p-3 bg-purple-500/10 rounded-lg">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs text-purple-300 uppercase tracking-wide">Person B</span>
                      {pair.personB.partner_accepted ? (
                        <span className="text-xs text-green-400">✓ Accepted</span>
                      ) : (
                        <span className="text-xs text-yellow-400">⏳ Pending Accept</span>
                      )}
                    </div>
                    <div className="text-sm">
                      <div className="font-medium text-foreground">
                        {personBDetails?.personnel?.rank} {personBDetails?.personnel?.last_name}, {personBDetails?.personnel?.first_name}
                      </div>
                      <div className="text-foreground-muted mt-1">
                        <span className="text-red-300">Giving:</span> {personBDetails?.givingDutyType?.duty_name} - {personBDetails?.givingSlot && formatDate(personBDetails.givingSlot.date_assigned)}
                      </div>
                      <div className="text-foreground-muted">
                        <span className="text-green-300">Receiving:</span> {personBDetails?.receivingDutyType?.duty_name} - {personBDetails?.receivingSlot && formatDate(personBDetails.receivingSlot.date_assigned)}
                      </div>
                    </div>
                    {/* Person B Approval Chain */}
                    <div className="mt-3 pt-3 border-t border-purple-500/20">
                      <div className="text-xs text-foreground-muted mb-1">Approvals:</div>
                      <div className="space-y-1">
                        {pair.personB.approvals.map((approval) => (
                          <div key={approval.id} className="flex items-center gap-2 text-xs">
                            {approval.status === 'approved' ? (
                              <span className="text-green-400">✓</span>
                            ) : approval.status === 'rejected' ? (
                              <span className="text-red-400">✗</span>
                            ) : (
                              <span className="text-yellow-400">○</span>
                            )}
                            <span className="text-foreground-muted">
                              {approval.approver_type.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase())}
                            </span>
                            {approval.status === 'pending' && canApproveApprovalStep(approval) && (
                              <button
                                onClick={() => handleApproveStep(approval.id)}
                                disabled={processingId !== null || needsPartnerAccept}
                                className="ml-auto px-2 py-0.5 text-xs bg-green-500/20 text-green-300 rounded hover:bg-green-500/30 disabled:opacity-50"
                              >
                                Approve
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Reason */}
                <div className="px-4 pb-4">
                  <div className="text-sm">
                    <span className="text-foreground-muted">Reason: </span>
                    <span className="text-foreground">{pair.reason}</span>
                  </div>
                  {pair.personA.request.rejection_reason && (
                    <p className="text-xs text-red-400 mt-1">
                      Rejection: {pair.personA.request.rejection_reason}
                    </p>
                  )}
                </div>

                {/* Actions */}
                {pair.status === "pending" && (
                  <div className="px-4 pb-4 flex items-center gap-2">
                    {/* Accept button for target person */}
                    {isTargetPerson && (
                      <button
                        onClick={() => handleAcceptSwap(myRequestId)}
                        disabled={processingId !== null}
                        className="px-3 py-1.5 text-sm bg-green-500/20 text-green-300 rounded hover:bg-green-500/30 disabled:opacity-50"
                      >
                        Accept Swap Request
                      </button>
                    )}

                    {/* Reject button for approvers */}
                    {(myApprovableSteps.length > 0 || isTargetPerson) && (
                      <button
                        onClick={() => handleReject(pair.personA.request.id)}
                        disabled={processingId !== null}
                        className="px-3 py-1.5 text-sm bg-red-500/20 text-red-300 rounded hover:bg-red-500/30 disabled:opacity-50"
                      >
                        Reject
                      </button>
                    )}

                    {/* Recommendations */}
                    {pair.recommendations && pair.recommendations.length > 0 && (
                      <div className="ml-4 text-xs space-x-2">
                        {pair.recommendations.map((rec) => (
                          <span key={rec.id} className={rec.recommendation === 'recommend' ? 'text-blue-300' : 'text-orange-300'}>
                            {rec.recommendation === 'recommend' ? '👍' : '👎'}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
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

      {/* Recommendation Modal */}
      {recommendModal.isOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-surface rounded-lg border border-border w-full max-w-md">
            <div className="p-4 border-b border-border">
              <h2 className="text-lg font-semibold text-foreground">
                {recommendModal.recommendation === 'recommend' ? 'Recommend' : 'Not Recommend'} Request
              </h2>
              <p className="text-sm text-foreground-muted mt-1">
                As a manager outside the direct chain of command, your recommendation will be recorded for the approvers to consider.
              </p>
            </div>
            <div className="p-4 space-y-4">
              <div>
                <label className="block text-sm font-medium text-foreground-muted mb-1">
                  Comment *
                </label>
                <textarea
                  value={recommendModal.comment}
                  onChange={(e) => setRecommendModal(prev => ({ ...prev, comment: e.target.value }))}
                  rows={3}
                  className="w-full px-3 py-2 bg-background border border-border rounded-lg text-foreground placeholder:text-foreground-muted"
                  placeholder={recommendModal.recommendation === 'recommend'
                    ? "Why do you recommend this swap?"
                    : "Why do you not recommend this swap?"
                  }
                />
              </div>
            </div>
            <div className="p-4 border-t border-border flex justify-end gap-2">
              <Button
                variant="secondary"
                onClick={() => setRecommendModal({ isOpen: false, requestId: null, recommendation: 'recommend', comment: "" })}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                onClick={confirmRecommend}
                disabled={!recommendModal.comment.trim()}
              >
                Submit {recommendModal.recommendation === 'recommend' ? 'Recommendation' : 'Non-Recommendation'}
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

                  {selectedPersonnelSlots.length === 0 ? (
                    <div className="text-center py-8 text-foreground-muted">
                      <p>No assigned duties found.</p>
                    </div>
                  ) : (
                    <div className="max-h-64 overflow-y-auto space-y-2 border border-border rounded-lg p-2">
                      {selectedPersonnelSlots.map((slot) => (
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
                  )}
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
                      {(() => {
                        const level = determineRequiredApprovalLevel(
                          swapModal.originalSlot.personnel_id!,
                          swapModal.targetSlot.personnel_id!
                        );
                        const levelNames: Record<string, string> = {
                          'work_section': 'Work Section Managers',
                          'section': 'Section Managers',
                          'company': 'Company Manager',
                        };
                        return levelNames[level] || 'Manager approval';
                      })()}
                    </p>
                  </div>
                </div>
              )}
            </div>

            <div className="p-4 border-t border-border flex justify-between">
              {shouldShowBackButton() ? (
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
