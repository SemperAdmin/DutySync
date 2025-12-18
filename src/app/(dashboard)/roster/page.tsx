"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import Button from "@/components/ui/Button";
import type { UnitSection, DutyType, Personnel, RoleName, BlockedDuty } from "@/types";
import {
  getUnitSections,
  getEnrichedSlots,
  getAllDutyTypes,
  getPersonnelByUnit,
  getAllPersonnel,
  getDutyRequirements,
  hasQualification,
  getActiveNonAvailability,
  updateDutySlot,
  createDutySlot,
  deleteDutySlot,
  getPersonnelByEdipi,
  isDutyBlockedOnDate,
  createBlockedDuty,
  deleteBlockedDuty,
  getAllBlockedDuties,
  getDutyValueByDutyType,
  isRosterApproved,
  approveRoster,
  getDutySlotsByDateAndType,
  createDutyChangeRequest,
  determineApproverLevel,
  getApproverLevelName,
  buildSwapApprovals,
  clearDutySlotsByDutyType,
  type EnrichedSlot,
  type ApprovedRoster,
} from "@/lib/client-stores";
import type { DutyChangeRequest } from "@/types";
import { useAuth } from "@/lib/supabase-auth";
import {
  VIEW_MODE_KEY,
  VIEW_MODE_CHANGE_EVENT,
  VIEW_MODE_ADMIN,
  VIEW_MODE_UNIT_ADMIN,
  VIEW_MODE_USER,
  type ViewMode,
} from "@/lib/constants";
import { matchesFilter } from "@/lib/duty-thruster";
import { useSyncRefresh } from "@/hooks/useSync";
import { buildHierarchicalUnitOptions, formatUnitOptionLabel } from "@/lib/unit-hierarchy";
import { formatDateToString } from "@/lib/date-utils";

// Manager role names that can assign duties within their scope
const MANAGER_ROLES: RoleName[] = [
  "Unit Manager",
  "Company Manager",
  "Section Manager",
  "Work Section Manager",
];

// Unit Admin can mark liberty days
const UNIT_ADMIN_ROLES: RoleName[] = ["Unit Admin"];

// Liberty day storage key
const LIBERTY_DAYS_KEY = "duty-sync-liberty-days";

interface LibertyDay {
  date: string; // YYYY-MM-DD
  type: "holiday" | "liberty";
  unitId: string;
  createdBy: string;
  createdAt: string;
}

// Cell selection key format: `${dutyTypeId}_${dateStr}`
interface SelectedCell {
  dutyTypeId: string;
  date: Date;
  dutyTypeName: string;
}

export default function RosterPage() {
  const { user } = useAuth();
  const [slots, setSlots] = useState<EnrichedSlot[]>([]);
  const [units, setUnits] = useState<UnitSection[]>([]);
  const [dutyTypes, setDutyTypes] = useState<DutyType[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedUnit, setSelectedUnit] = useState("");
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedSlot, setSelectedSlot] = useState<EnrichedSlot | null>(null);

  // Liberty days state
  const [libertyDays, setLibertyDays] = useState<LibertyDay[]>([]);
  const [libertyModal, setLibertyModal] = useState<{
    isOpen: boolean;
    startDate: Date | null;
  }>({ isOpen: false, startDate: null });
  const [libertyFormData, setLibertyFormData] = useState({
    type: "liberty" as "holiday" | "liberty",
    days: 1,
  });

  // Cell-level blocked duties state
  const [blockedDuties, setBlockedDuties] = useState<BlockedDuty[]>([]);

  // Multi-cell selection for blocking
  const [selectedCells, setSelectedCells] = useState<Map<string, SelectedCell>>(new Map());
  const [isSelectingMode, setIsSelectingMode] = useState(false);
  const [blockModal, setBlockModal] = useState<{
    isOpen: boolean;
    cells: SelectedCell[];
    existingBlock: BlockedDuty | null; // For viewing/removing single block
  }>({ isOpen: false, cells: [], existingBlock: null });
  const [blockComment, setBlockComment] = useState("");

  // Duty type details modal state (read-only view)
  const [dutyTypeDetailsModal, setDutyTypeDetailsModal] = useState<{
    isOpen: boolean;
    dutyType: DutyType | null;
  }>({ isOpen: false, dutyType: null });

  // Export/Print modal state
  const [exportModal, setExportModal] = useState<{
    isOpen: boolean;
    mode: 'csv' | 'print';
  }>({ isOpen: false, mode: 'csv' });

  // Duty type filter state (controls what's shown in the view AND what gets exported)
  const [dutyTypeFilter, setDutyTypeFilter] = useState<Set<string>>(new Set()); // Empty = show all
  const [filterDropdownOpen, setFilterDropdownOpen] = useState(false);

  // Assignment modal state (supports multi-slot duties)
  const [assignmentModal, setAssignmentModal] = useState<{
    isOpen: boolean;
    date: Date | null;
    dutyType: DutyType | null;
    existingSlots: EnrichedSlot[]; // All slots for this duty on this date
  }>({ isOpen: false, date: null, dutyType: null, existingSlots: [] });
  const [assigning, setAssigning] = useState(false);
  const [currentViewMode, setCurrentViewMode] = useState<ViewMode>(VIEW_MODE_USER);

  // Roster approval state
  const [rosterApproval, setRosterApproval] = useState<ApprovedRoster | null>(null);
  const [approveModal, setApproveModal] = useState(false);
  const [approving, setApproving] = useState(false);

  // Swap request modal state
  const [swapModal, setSwapModal] = useState<{
    isOpen: boolean;
    originalSlot: EnrichedSlot | null;
    step: 'select' | 'confirm';
    targetSlot: EnrichedSlot | null;
    reason: string;
  }>({ isOpen: false, originalSlot: null, step: 'select', targetSlot: null, reason: '' });
  const [submittingSwap, setSubmittingSwap] = useState(false);

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

  // Check if user is App Admin
  const isAppAdmin = useMemo(() => {
    if (!user?.roles) return false;
    return user.roles.some(r => r.role_name === "App Admin");
  }, [user?.roles]);

  // Effective App Admin status (App Admin in Admin view)
  const effectiveIsAppAdmin = isAppAdmin && isAdminView;

  // Effective Unit Admin status (Unit Admin in Unit Admin view)
  const effectiveIsUnitAdmin = useMemo(() => {
    if (!user?.roles) return false;
    const hasUnitAdminRole = user.roles.some(r => r.role_name === "Unit Admin");
    return hasUnitAdminRole && isUnitAdminView;
  }, [user?.roles, isUnitAdminView]);

  // Check if user has manager role
  const hasManagerRole = useMemo(() => {
    if (!user?.roles) return false;
    return user.roles.some(r => MANAGER_ROLES.includes(r.role_name as RoleName));
  }, [user?.roles]);

  // Check if user is Unit Admin (can mark liberty days)
  const isUnitAdmin = useMemo(() => {
    if (!user?.roles) return false;
    return user.roles.some(r => UNIT_ADMIN_ROLES.includes(r.role_name as RoleName));
  }, [user?.roles]);

  // Effective "manager" status - either a manager role OR Unit Admin in Unit Admin View
  const isManager = useMemo(() => {
    // User has a manager role
    if (hasManagerRole) return true;
    // Unit Admin in Unit Admin View can also manage assignments
    if (isUnitAdmin && isUnitAdminView) return true;
    return false;
  }, [hasManagerRole, isUnitAdmin, isUnitAdminView]);

  // All logged-in users can click to assign (self or others based on role)
  const canAssignDuties = useMemo(() => {
    return !!user; // Any logged-in user can assign duties
  }, [user]);

  // Get Unit Admin's unit scope
  const unitAdminUnitId = useMemo(() => {
    if (!user?.roles) return null;
    const unitAdminRole = user.roles.find(r => r.role_name === "Unit Admin");
    return unitAdminRole?.scope_unit_id || null;
  }, [user?.roles]);

  // Get manager's scope unit ID (from any manager role)
  const managerScopeUnitId = useMemo(() => {
    if (!user?.roles) return null;
    const managerRole = user.roles.find(r => MANAGER_ROLES.includes(r.role_name as RoleName));
    return managerRole?.scope_unit_id || null;
  }, [user?.roles]);

  // Get effective scope based on view mode
  const effectiveScopeUnitId = useMemo(() => {
    // In Unit Admin View, use Unit Admin scope
    if (isUnitAdminView && unitAdminUnitId) {
      return unitAdminUnitId;
    }
    // Otherwise, use manager scope (if they have a manager role)
    return managerScopeUnitId;
  }, [isUnitAdminView, unitAdminUnitId, managerScopeUnitId]);

  // Build hierarchical unit options for the dropdown
  const hierarchicalUnits = useMemo(() => {
    return buildHierarchicalUnitOptions(units);
  }, [units]);

  // Build a map of unit ID -> unit for quick lookups
  const unitMap = useMemo(() => {
    return new Map(units.map(u => [u.id, u]));
  }, [units]);

  // Build a map of parent ID -> child unit IDs for hierarchy traversal
  const childrenMap = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const unit of units) {
      if (unit.parent_id) {
        const existing = map.get(unit.parent_id) || [];
        existing.push(unit.id);
        map.set(unit.parent_id, existing);
      }
    }
    return map;
  }, [units]);

  // All unit IDs the user can assign from (based on effective scope)
  const scopeUnitIds = useMemo(() => {
    // App Admin in Admin view can see all units
    if (effectiveIsAppAdmin) {
      return units.map(u => u.id);
    }

    if (!effectiveScopeUnitId) return [];

    // For Unit Admin view, include ALL units in the organization
    // This handles cases where unit hierarchies may not be properly connected
    if (effectiveIsUnitAdmin) {
      const scopeUnit = unitMap.get(effectiveScopeUnitId);
      if (scopeUnit) {
        // Get organization_id from the scope unit (it's stored in the extended type)
        const orgId = (scopeUnit as UnitSection & { organization_id?: string }).organization_id;
        if (orgId) {
          // Include all units for this organization
          return units
            .filter(u => (u as UnitSection & { organization_id?: string }).organization_id === orgId)
            .map(u => u.id);
        }
      }
      // Fallback: include all units if no organization_id
      return units.map(u => u.id);
    }

    // For manager roles, walk the hierarchy tree
    const ids: string[] = [effectiveScopeUnitId];
    const queue = [effectiveScopeUnitId];

    for (let i = 0; i < queue.length; i++) {
      const currentId = queue[i];
      const children = childrenMap.get(currentId) || [];
      for (const childId of children) {
        if (!ids.includes(childId)) {
          ids.push(childId);
          queue.push(childId);
        }
      }
    }

    return ids;
  }, [effectiveIsAppAdmin, effectiveIsUnitAdmin, effectiveScopeUnitId, childrenMap, units, unitMap]);

  // Load liberty days from localStorage
  const loadLibertyDays = useCallback(() => {
    try {
      const stored = localStorage.getItem(LIBERTY_DAYS_KEY);
      if (stored) {
        setLibertyDays(JSON.parse(stored));
      }
    } catch (err) {
      console.error("Error loading liberty days:", err);
    }
  }, []);

  // Save liberty days to localStorage
  const saveLibertyDays = useCallback((days: LibertyDay[]) => {
    try {
      localStorage.setItem(LIBERTY_DAYS_KEY, JSON.stringify(days));
      setLibertyDays(days);
    } catch (err) {
      console.error("Error saving liberty days:", err);
    }
  }, []);

  // Get first and last day of the current month
  const { startDate, endDate, monthDays } = useMemo(() => {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();

    const startDate = new Date(year, month, 1);
    const endDate = new Date(year, month + 1, 0);

    // Generate array of days in the month
    const days: Date[] = [];
    const current = new Date(startDate);
    while (current <= endDate) {
      days.push(new Date(current));
      current.setDate(current.getDate() + 1);
    }

    return { startDate, endDate, monthDays: days };
  }, [currentDate]);

  useEffect(() => {
    loadLibertyDays();
  }, [loadLibertyDays]);

  useEffect(() => {
    fetchData();
  }, [selectedUnit, startDate, endDate]);

  // Listen for sync updates and refresh automatically
  useSyncRefresh(["personnel", "units", "dutySlots", "nonAvailability", "dutyTypes"], fetchData);

  function fetchData() {
    try {
      setLoading(true);

      // Fetch units
      const unitsData = getUnitSections();
      setUnits(unitsData);

      // Fetch all duty types
      const dutyTypesData = getAllDutyTypes();
      setDutyTypes(dutyTypesData);

      // Fetch duty slots for the date range
      const slotsData = getEnrichedSlots(startDate, endDate, selectedUnit || undefined);
      setSlots(slotsData);

      // Fetch blocked duties
      const blockedData = getAllBlockedDuties();
      setBlockedDuties(blockedData);

      // Check roster approval status (only if a unit is selected or user is Unit Admin)
      const effectiveUnit = selectedUnit || unitAdminUnitId;
      if (effectiveUnit) {
        const approval = isRosterApproved(
          effectiveUnit,
          currentDate.getFullYear(),
          currentDate.getMonth()
        );
        setRosterApproval(approval);
      } else {
        setRosterApproval(null);
      }
    } catch (err) {
      console.error("Error fetching data:", err);
    } finally {
      setLoading(false);
    }
  }

  // Handle roster approval
  function handleApproveRoster() {
    if (!user || !unitAdminUnitId) return;

    setApproving(true);
    try {
      const result = approveRoster(
        unitAdminUnitId,
        currentDate.getFullYear(),
        currentDate.getMonth(),
        user.id
      );
      setRosterApproval(result.approval);
      setApproveModal(false);
      alert(`Roster approved! ${result.scoresApplied} personnel duty scores have been updated.`);
      fetchData(); // Refresh data
    } catch (err) {
      console.error("Error approving roster:", err);
      alert(err instanceof Error ? err.message : "Failed to approve roster");
    } finally {
      setApproving(false);
    }
  }

  function navigateMonth(delta: number) {
    setCurrentDate((prev) => {
      const newDate = new Date(prev);
      newDate.setMonth(newDate.getMonth() + delta);
      return newDate;
    });
  }

  function goToToday() {
    setCurrentDate(new Date());
  }

  // Get slot for a specific date and duty type (returns first match - for backward compatibility)
  function getSlotForDateAndType(date: Date, dutyTypeId: string): EnrichedSlot | null {
    const dateStr = formatDateToString(date);
    return slots.find((slot) => {
      const slotDateStr = formatDateToString(new Date(slot.date_assigned));
      return slotDateStr === dateStr && slot.duty_type_id === dutyTypeId;
    }) || null;
  }

  // Get ALL slots for a specific date and duty type (for multi-slot duties)
  function getSlotsForDateAndType(date: Date, dutyTypeId: string): EnrichedSlot[] {
    const dateStr = formatDateToString(date);
    return slots.filter((slot) => {
      const slotDateStr = formatDateToString(new Date(slot.date_assigned));
      return slotDateStr === dateStr && slot.duty_type_id === dutyTypeId;
    });
  }

  // Check if date is a liberty/holiday day
  function getLibertyDay(date: Date): LibertyDay | null {
    const dateStr = formatDateToString(date);
    const effectiveUnit = selectedUnit || unitAdminUnitId;
    return libertyDays.find(ld =>
      ld.date === dateStr &&
      (effectiveUnit ? ld.unitId === effectiveUnit : true)
    ) || null;
  }

  // Check if a specific duty cell is blocked
  function getCellBlock(date: Date, dutyTypeId: string): BlockedDuty | null {
    const dateTime = date.getTime();
    return blockedDuties.find((bd) => {
      if (bd.duty_type_id !== dutyTypeId) return false;
      const start = new Date(bd.start_date).getTime();
      const end = new Date(bd.end_date).getTime();
      return dateTime >= start && dateTime <= end;
    }) || null;
  }

  // Get cell key for selection map
  function getCellKey(dutyTypeId: string, date: Date): string {
    return `${dutyTypeId}_${formatDateToString(date)}`;
  }

  // Toggle cell selection (for multi-select blocking)
  function toggleCellSelection(date: Date, dutyType: DutyType) {
    const key = getCellKey(dutyType.id, date);
    setSelectedCells(prev => {
      const newMap = new Map(prev);
      if (newMap.has(key)) {
        newMap.delete(key);
      } else {
        newMap.set(key, {
          dutyTypeId: dutyType.id,
          date: new Date(date),
          dutyTypeName: dutyType.duty_name,
        });
      }
      return newMap;
    });
  }

  // Check if cell is selected
  function isCellSelected(dutyTypeId: string, date: Date): boolean {
    return selectedCells.has(getCellKey(dutyTypeId, date));
  }

  // Clear all selected cells
  function clearSelection() {
    setSelectedCells(new Map());
    setIsSelectingMode(false);
  }

  // Open block modal for selected cells
  function openBlockModal() {
    if (selectedCells.size === 0) return;
    setBlockModal({
      isOpen: true,
      cells: Array.from(selectedCells.values()),
      existingBlock: null,
    });
    setBlockComment("");
  }

  // Open block modal to view/remove existing block
  function openExistingBlockModal(date: Date, dutyType: DutyType) {
    const existingBlock = getCellBlock(date, dutyType.id);
    if (!existingBlock) return;
    setBlockModal({
      isOpen: true,
      cells: [{
        dutyTypeId: dutyType.id,
        date: new Date(date),
        dutyTypeName: dutyType.duty_name,
      }],
      existingBlock,
    });
    setBlockComment(existingBlock.reason || "");
  }

  // Handle block submission (single or multiple cells)
  function handleBlockCells() {
    if (blockModal.cells.length === 0 || !user) return;
    if (!blockComment.trim()) {
      alert("Please provide a reason for blocking.");
      return;
    }

    // Create a block for each selected cell
    for (const cell of blockModal.cells) {
      const dutyType = dutyTypes.find(dt => dt.id === cell.dutyTypeId);
      const effectiveUnit = selectedUnit || unitAdminUnitId || dutyType?.unit_section_id || "";

      const newBlock: BlockedDuty = {
        id: crypto.randomUUID(),
        duty_type_id: cell.dutyTypeId,
        unit_section_id: effectiveUnit,
        start_date: cell.date,
        end_date: cell.date, // Single day block
        reason: blockComment.trim(),
        blocked_by: user.id,
        created_at: new Date(),
      };

      createBlockedDuty(newBlock);
    }

    setBlockModal({ isOpen: false, cells: [], existingBlock: null });
    setBlockComment("");
    clearSelection();
    fetchData();
  }

  // Handle unblock cell
  function handleUnblockCell() {
    if (!blockModal.existingBlock) return;
    deleteBlockedDuty(blockModal.existingBlock.id);
    setBlockModal({ isOpen: false, cells: [], existingBlock: null });
    setBlockComment("");
    fetchData();
  }

  function isToday(date: Date): boolean {
    const today = new Date();
    return date.toDateString() === today.toDateString();
  }

  function isWeekend(date: Date): boolean {
    const day = date.getDay();
    return day === 0 || day === 6;
  }

  function formatMonthYear(date: Date): string {
    return date.toLocaleDateString("en-US", { month: "long", year: "numeric" });
  }

  function formatDate(date: Date): string {
    return date.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  }

  function getStatusColor(status: string): string {
    switch (status) {
      case "completed":
        return "bg-green-500/20 text-green-400";
      case "cancelled":
        return "bg-red-500/20 text-red-400 line-through";
      default:
        return "bg-primary/10 text-foreground";
    }
  }

  // Filter duty types based on selected unit
  // All active duty types for the selected unit (before view filter)
  const availableDutyTypes = useMemo(() => {
    if (!selectedUnit) {
      return dutyTypes.filter(dt => dt.is_active);
    }
    return dutyTypes.filter(dt => dt.is_active && dt.unit_section_id === selectedUnit);
  }, [dutyTypes, selectedUnit]);

  // Filtered duty types based on user selection (used for display and export)
  const filteredDutyTypes = useMemo(() => {
    if (dutyTypeFilter.size === 0) {
      return availableDutyTypes; // Show all when no filter selected
    }
    return availableDutyTypes.filter(dt => dutyTypeFilter.has(dt.id));
  }, [availableDutyTypes, dutyTypeFilter]);

  // Toggle a duty type in the filter
  function toggleDutyTypeFilter(dutyTypeId: string) {
    setDutyTypeFilter(prev => {
      const newSet = new Set(prev);
      if (newSet.has(dutyTypeId)) {
        newSet.delete(dutyTypeId);
      } else {
        newSet.add(dutyTypeId);
      }
      // If all items are now selected, revert to the 'show all' state (empty set)
      if (newSet.size === availableDutyTypes.length) {
        return new Set();
      }
      return newSet;
    });
  }

  // Clear all filters (show all)
  function clearDutyTypeFilter() {
    setDutyTypeFilter(new Set());
  }

  // Get the current user's personnel record
  const currentUserPersonnel = useMemo(() => {
    if (!user?.edipi) return null;
    return getPersonnelByEdipi(user.edipi) || null;
  }, [user?.edipi]);

  // Get eligible personnel for a duty type on a specific date
  // For regular users: only themselves
  // For managers: personnel within their scope
  function getEligiblePersonnel(dutyType: DutyType, date: Date): Personnel[] {
    const allPersonnel = getAllPersonnel();
    const requirements = getDutyRequirements(dutyType.id);

    return allPersonnel.filter(person => {
      // Regular users can only assign themselves
      if (!isManager) {
        if (!currentUserPersonnel || person.id !== currentUserPersonnel.id) {
          return false;
        }
      } else {
        // Managers: only include personnel within their scope
        if (scopeUnitIds.length > 0 && !scopeUnitIds.includes(person.unit_section_id)) {
          return false;
        }
      }

      // Check rank filter criteria from duty type
      if (!matchesFilter(dutyType.rank_filter_mode, dutyType.rank_filter_values, person.rank)) {
        return false;
      }

      // Check section filter criteria from duty type
      if (!matchesFilter(dutyType.section_filter_mode, dutyType.section_filter_values, person.unit_section_id)) {
        return false;
      }

      // Check if person is available (not on non-availability)
      const nonAvail = getActiveNonAvailability(person.id, date);
      if (nonAvail) return false;

      // Check qualifications if any are required
      if (requirements.length > 0) {
        const hasAllQuals = requirements.every(req =>
          hasQualification(person.id, req.required_qual_name)
        );
        if (!hasAllQuals) return false;
      }

      return true;
    });
  }

  // Handle cell click for assignment
  function handleCellClick(date: Date, dutyType: DutyType) {
    if (!canAssignDuties) return;

    // Check if roster is approved (locked)
    if (rosterApproval) {
      alert("This roster has been approved and is locked for editing.");
      return;
    }

    // Check if cell is blocked
    const cellBlock = getCellBlock(date, dutyType.id);
    if (cellBlock) return; // Can't assign to blocked cells

    // Get all existing slots for this duty on this date
    const existingSlots = getSlotsForDateAndType(date, dutyType.id);
    const filledSlots = existingSlots.filter(s => s.personnel_id);
    const slotsNeeded = dutyType.slots_needed || 1;

    // Regular users can only add themselves if there's room
    if (!isManager) {
      // Check if all slots are filled
      if (filledSlots.length >= slotsNeeded) {
        // All slots filled - show info about first slot
        if (existingSlots[0]) {
          setSelectedSlot(existingSlots[0]);
        }
        return;
      }
      // Check if user is already assigned
      const userAlreadyAssigned = filledSlots.some(s => s.personnel_id === currentUserPersonnel?.id);
      if (userAlreadyAssigned) {
        alert("You are already assigned to this duty on this date.");
        return;
      }
    }

    setAssignmentModal({
      isOpen: true,
      date,
      dutyType,
      existingSlots,
    });
  }

  // Handle date click for liberty marking (Unit Admin only)
  function handleDateClick(date: Date) {
    if (!isUnitAdmin || !unitAdminUnitId) return;

    // Check if roster is approved (locked)
    if (rosterApproval) {
      alert("This roster has been approved and is locked for editing.");
      return;
    }

    // Check if already a liberty day - if so, offer to remove
    const existing = getLibertyDay(date);
    if (existing) {
      if (confirm(`Remove ${existing.type} day on ${formatDate(date)}?`)) {
        const updated = libertyDays.filter(ld => ld.date !== existing.date || ld.unitId !== existing.unitId);
        saveLibertyDays(updated);
      }
      return;
    }

    setLibertyModal({ isOpen: true, startDate: date });
    setLibertyFormData({ type: "liberty", days: 1 });
  }

  // Add liberty/holiday days
  function handleAddLibertyDays() {
    if (!libertyModal.startDate || !user || !unitAdminUnitId) return;

    const newDays: LibertyDay[] = [];
    const start = new Date(libertyModal.startDate);

    for (let i = 0; i < libertyFormData.days; i++) {
      const date = new Date(start);
      date.setDate(date.getDate() + i);
      const dateStr = formatDateToString(date);

      // Check if this date already has a liberty day for this unit
      const exists = libertyDays.some(ld => ld.date === dateStr && ld.unitId === unitAdminUnitId);
      if (!exists) {
        newDays.push({
          date: dateStr,
          type: libertyFormData.type,
          unitId: unitAdminUnitId,
          createdBy: user.id,
          createdAt: new Date().toISOString(),
        });
      }
    }

    saveLibertyDays([...libertyDays, ...newDays]);
    setLibertyModal({ isOpen: false, startDate: null });
  }

  // Handle personnel assignment
  function handleAssign(personnelId: string) {
    const { date, dutyType, existingSlots } = assignmentModal;
    if (!date || !dutyType || !user) return;

    setAssigning(true);

    try {
      const slotsNeeded = dutyType.slots_needed || 1;

      // Re-check actual slot count from localStorage before creating (prevents over-assignment)
      const actualSlots = getDutySlotsByDateAndType(date, dutyType.id);
      const actualFilled = actualSlots.filter(s => s.personnel_id).length;

      if (actualFilled >= slotsNeeded) {
        alert(`All ${slotsNeeded} slots are already filled for this duty.`);
        fetchData();
        setAssignmentModal({ isOpen: false, date: null, dutyType: null, existingSlots: [] });
        return;
      }

      // Check if person is already assigned
      if (actualSlots.some(s => s.personnel_id === personnelId)) {
        alert("This person is already assigned to this duty on this date.");
        return;
      }

      // Create new slot
      const newSlot = {
        id: crypto.randomUUID(),
        duty_type_id: dutyType.id,
        personnel_id: personnelId,
        date_assigned: date,
        assigned_by: user.id,
        duty_points_earned: 1.0,
        status: "scheduled" as const,
        created_at: new Date(),
        updated_at: new Date(),
      };
      createDutySlot(newSlot);

      // Optimistically update UI
      const allPersonnelData = getAllPersonnel();
      const assignedPerson = allPersonnelData.find(p => p.id === personnelId);
      const newEnrichedSlot: EnrichedSlot = {
        ...newSlot,
        duty_type: { id: dutyType.id, duty_name: dutyType.duty_name, unit_section_id: dutyType.unit_section_id },
        personnel: assignedPerson ? { id: assignedPerson.id, first_name: assignedPerson.first_name, last_name: assignedPerson.last_name, rank: assignedPerson.rank } : null,
      };

      const updatedSlots = [...existingSlots, newEnrichedSlot];
      const filledCount = updatedSlots.filter(s => s.personnel_id).length;

      if (filledCount >= slotsNeeded) {
        // All slots filled, close modal
        setAssignmentModal({ isOpen: false, date: null, dutyType: null, existingSlots: [] });
      } else {
        // More slots available - update modal state optimistically
        setAssignmentModal(prev => ({ ...prev, existingSlots: updatedSlots }));
      }

      // Fetch in background to sync with source of truth
      fetchData();
    } catch (err) {
      console.error("Error assigning duty:", err);
    } finally {
      setAssigning(false);
    }
  }

  // Handle removing an assignment (for multi-slot duties)
  function handleRemoveAssignment(slotId: string) {
    if (!assignmentModal.date || !assignmentModal.dutyType) return;

    setAssigning(true);
    try {
      // Delete the slot from localStorage
      const deleted = deleteDutySlot(slotId);

      if (deleted) {
        // Update modal state by filtering out the deleted slot
        // (Don't rely on fetchData which updates React state asynchronously)
        setAssignmentModal(prev => ({
          ...prev,
          existingSlots: prev.existingSlots.filter(s => s.id !== slotId)
        }));

        // Refresh the main data display
        fetchData();
      }
    } catch (err) {
      console.error("Error removing assignment:", err);
    } finally {
      setAssigning(false);
    }
  }

  // Open swap request modal
  function openSwapModal(slot: EnrichedSlot) {
    setSwapModal({
      isOpen: true,
      originalSlot: slot,
      step: 'select',
      targetSlot: null,
      reason: ''
    });
    setSelectedSlot(null); // Close the details modal
  }

  // Get available slots for swap (duties assigned to other personnel in the same month)
  const availableSlotsForSwap = useMemo(() => {
    if (!swapModal.originalSlot || !currentUserPersonnel) return [];

    // Get all assigned slots in the current month (excluding the original slot)
    return slots.filter(slot => {
      // Must be assigned to someone else
      if (!slot.personnel_id || slot.personnel_id === swapModal.originalSlot?.personnel_id) return false;
      // Must not be the same slot
      if (slot.id === swapModal.originalSlot?.id) return false;
      // Must have personnel info
      if (!slot.personnel) return false;
      return true;
    });
  }, [slots, swapModal.originalSlot, currentUserPersonnel]);

  // Handle swap request submission
  function handleSubmitSwapRequest() {
    if (!swapModal.originalSlot || !swapModal.targetSlot || !user || !swapModal.reason.trim()) {
      alert("Please select a duty to swap with and provide a reason.");
      return;
    }

    setSubmittingSwap(true);

    try {
      // Determine the required approver level
      const approverLevel = determineApproverLevel(
        swapModal.originalSlot.personnel_id!,
        swapModal.targetSlot.personnel_id!
      );

      // Build the multi-level approval workflow
      const approvals = buildSwapApprovals(
        swapModal.originalSlot.personnel_id!,
        swapModal.targetSlot.personnel_id!
      );

      // Create the swap request
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
        approvals: approvals,
        recommendations: [],
        approved_by: null,
        approved_at: null,
        rejection_reason: null,
        created_at: new Date(),
        updated_at: new Date(),
      };

      createDutyChangeRequest(request);

      alert("Swap request submitted successfully! The target person and chain of command will need to approve.");

      // Close the modal
      setSwapModal({ isOpen: false, originalSlot: null, step: 'select', targetSlot: null, reason: '' });
    } catch (err) {
      console.error("Error submitting swap request:", err);
      alert("Failed to submit swap request. Please try again.");
    } finally {
      setSubmittingSwap(false);
    }
  }

  // Helper to properly escape a CSV cell
  function escapeCsvCell(cell: string | number | null | undefined): string {
    const str = String(cell ?? "");
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  }

  // Open export modal
  function openExportModal(mode: 'csv' | 'print') {
    setExportModal({ isOpen: true, mode });
  }

  // Export uses the same filtered duty types as the view
  const exportDutyTypes = filteredDutyTypes;

  // Export to CSV
  function exportToCSV() {
    if (exportDutyTypes.length === 0) return;
    const headers = ["Date", "Day", "Status", ...exportDutyTypes.map(dt => dt.duty_name)];
    const rows = monthDays.map((date) => {
      const dayName = date.toLocaleDateString("en-US", { weekday: "long" });
      const dateStr = formatDateToString(date);
      const libertyDay = getLibertyDay(date);
      const dayStatus = libertyDay ? libertyDay.type.toUpperCase() : "";

      const dutyAssignments = exportDutyTypes.map(dt => {
        if (libertyDay) return libertyDay.type.toUpperCase();
        const slot = getSlotForDateAndType(date, dt.id);
        if (!slot) return "";
        if (!slot.personnel) return "Unassigned";
        return `${slot.personnel.rank} ${slot.personnel.last_name}`;
      });

      return [dateStr, dayName, dayStatus, ...dutyAssignments];
    });

    const csv = [
      headers.map(escapeCsvCell).join(","),
      ...rows.map((row) => row.map(escapeCsvCell).join(",")),
    ].join("\n");

    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    a.download = `duty-roster-${year}-${String(month + 1).padStart(2, "0")}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // Print roster
  function printRoster() {
    if (exportDutyTypes.length === 0) return;
    const printWindow = window.open("", "_blank");
    if (!printWindow) return;

    const monthYear = formatMonthYear(currentDate);
    const unitName = selectedUnit
      ? units.find((u) => u.id === selectedUnit)?.unit_name || "Selected Unit"
      : "All Units";

    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <title>Duty Roster - ${monthYear}</title>
          <style>
            body { font-family: Arial, sans-serif; padding: 20px; color: #333; font-size: 11px; }
            h1 { text-align: center; margin-bottom: 5px; font-size: 18px; }
            h2 { text-align: center; color: #666; margin-top: 0; font-weight: normal; font-size: 14px; }
            table { width: 100%; border-collapse: collapse; margin-top: 20px; }
            th, td { border: 1px solid #ddd; padding: 4px 6px; text-align: center; }
            th { background-color: #1A237E; color: white; font-size: 10px; }
            td { font-size: 10px; }
            tr:nth-child(even) { background-color: #f9f9f9; }
            .weekend { background-color: #FFF3E0; }
            .today { background-color: #E3F2FD; }
            .liberty { background-color: #E8F5E9; }
            .holiday { background-color: #FCE4EC; }
            .date-col { text-align: left; white-space: nowrap; }
            @media print {
              body { padding: 0; }
              button { display: none; }
            }
          </style>
        </head>
        <body>
          <h1>Duty Roster</h1>
          <h2>${monthYear} - ${unitName}</h2>
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Day</th>
                ${exportDutyTypes.map(dt => `<th>${dt.duty_name}</th>`).join("")}
              </tr>
            </thead>
            <tbody>
              ${monthDays.map((date) => {
                const isWeekendDay = isWeekend(date);
                const isTodayDate = isToday(date);
                const libertyDay = getLibertyDay(date);
                const dayName = date.toLocaleDateString("en-US", { weekday: "short" });
                const formattedDate = date.toLocaleDateString("en-US", { month: "short", day: "numeric" });

                let rowClass = "";
                if (libertyDay?.type === "liberty") rowClass = "liberty";
                else if (libertyDay?.type === "holiday") rowClass = "holiday";
                else if (isWeekendDay) rowClass = "weekend";
                if (isTodayDate) rowClass += " today";

                return `
                  <tr class="${rowClass}">
                    <td class="date-col">${formattedDate}</td>
                    <td>${dayName}${libertyDay ? ` (${libertyDay.type.toUpperCase()})` : ""}</td>
                    ${exportDutyTypes.map(dt => {
                      if (libertyDay) return `<td style="color: #4CAF50; font-style: italic;">${libertyDay.type.toUpperCase()}</td>`;
                      const slot = getSlotForDateAndType(date, dt.id);
                      if (!slot) return '<td>-</td>';
                      if (!slot.personnel) return '<td style="color: #999;">Unassigned</td>';
                      return `<td>${slot.personnel.rank} ${slot.personnel.last_name}</td>`;
                    }).join("")}
                  </tr>
                `;
              }).join("")}
            </tbody>
          </table>
          <p style="margin-top: 20px; text-align: center; color: #666; font-size: 10px;">
            Generated on ${new Date().toLocaleString()} by Duty Sync
          </p>
          <div style="text-align: center; margin-top: 20px;">
            <button onclick="window.print()" style="padding: 10px 20px; font-size: 14px; cursor: pointer;">
              Print / Save as PDF
            </button>
          </div>
        </body>
      </html>
    `;

    printWindow.document.write(html);
    printWindow.document.close();
  }

  // Get eligible personnel for the assignment modal
  const eligiblePersonnel = useMemo(() => {
    if (!assignmentModal.isOpen || !assignmentModal.date || !assignmentModal.dutyType) {
      return [];
    }
    return getEligiblePersonnel(assignmentModal.dutyType, assignmentModal.date);
  }, [assignmentModal.isOpen, assignmentModal.date, assignmentModal.dutyType]);

  // Calculate duty statistics
  const dutyStats = useMemo(() => {
    const totalDays = monthDays.length;
    const totalDutyTypes = filteredDutyTypes.length;

    // Count blocked cells (individual duty+date blocks)
    const blockedCellsCount = blockedDuties.filter(bd => {
      const blockDate = new Date(bd.start_date);
      return blockDate >= startDate && blockDate <= endDate &&
        filteredDutyTypes.some(dt => dt.id === bd.duty_type_id);
    }).length;

    // Total possible duties = days × duty types
    const totalPossibleDuties = totalDays * totalDutyTypes;

    // Total required duties = total possible - blocked cells
    const totalRequiredDuties = totalPossibleDuties - blockedCellsCount;

    // Count assigned duties (from slots)
    const assignedDuties = slots.length;

    // Remaining to assign
    const remainingDuties = Math.max(0, totalRequiredDuties - assignedDuties);

    return {
      totalDays,
      totalDutyTypes,
      blockedCellsCount,
      totalPossibleDuties,
      totalRequiredDuties,
      assignedDuties,
      remainingDuties,
    };
  }, [monthDays, filteredDutyTypes, blockedDuties, startDate, endDate, slots]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Duty Roster</h1>
          <p className="text-foreground-muted mt-1">
            {isManager
              ? "View and assign duty assignments for personnel in your scope"
              : "View duty roster and assign yourself to available slots"}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" onClick={() => openExportModal('csv')}>
            <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            Export CSV
          </Button>
          <Button variant="secondary" size="sm" onClick={() => openExportModal('print')}>
            <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
            </svg>
            Print / PDF
          </Button>
          {/* Approve Roster Button - Unit Admin only */}
          {isUnitAdmin && isUnitAdminView && unitAdminUnitId && (
            rosterApproval ? (
              <div className="flex items-center gap-2 px-3 py-1.5 bg-green-500/20 border border-green-500/30 rounded-lg">
                <svg className="w-4 h-4 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span className="text-sm text-green-400 font-medium">Roster Approved</span>
              </div>
            ) : (
              <Button
                variant="primary"
                size="sm"
                onClick={() => setApproveModal(true)}
                className="bg-green-600 hover:bg-green-700"
              >
                <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                Approve Roster
              </Button>
            )
          )}
        </div>
      </div>

      {/* Controls */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-surface rounded-lg border border-border p-4">
        <div className="flex items-center gap-4">
          {/* Month Navigation */}
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => navigateMonth(-1)}>
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </Button>
            <h2 className="text-lg font-semibold text-foreground min-w-[180px] text-center">
              {formatMonthYear(currentDate)}
            </h2>
            <Button variant="ghost" size="sm" onClick={() => navigateMonth(1)}>
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </Button>
          </div>
          <Button variant="secondary" size="sm" onClick={goToToday}>
            Today
          </Button>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-4">
          {/* Unit Filter */}
          <div className="flex items-center gap-2">
            <label className="text-sm text-foreground-muted">Unit:</label>
            <select
              value={selectedUnit}
              onChange={(e) => setSelectedUnit(e.target.value)}
              className="px-3 py-1.5 bg-background border border-border rounded-lg text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary font-mono"
            >
              <option value="">All Units</option>
              {hierarchicalUnits.map((option) => (
                <option key={option.id} value={option.id}>
                  {formatUnitOptionLabel(option)}
                </option>
              ))}
            </select>
          </div>

          {/* Duty Type Filter */}
          <div className="flex items-center gap-2 relative">
            <label className="text-sm text-foreground-muted">Duties:</label>
            <div className="relative">
              <button
                onClick={() => setFilterDropdownOpen(!filterDropdownOpen)}
                className="px-3 py-1.5 bg-background border border-border rounded-lg text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary flex items-center gap-2 min-w-[140px]"
              >
                <span className="truncate">
                  {dutyTypeFilter.size === 0
                    ? "All Duties"
                    : dutyTypeFilter.size === 1
                    ? availableDutyTypes.find(dt => dutyTypeFilter.has(dt.id))?.duty_name || "1 selected"
                    : `${dutyTypeFilter.size} selected`}
                </span>
                <svg className={`w-4 h-4 transition-transform ${filterDropdownOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              {/* Dropdown menu */}
              {filterDropdownOpen && (
                <div className="absolute top-full left-0 mt-1 w-64 bg-surface border border-border rounded-lg shadow-lg z-20 max-h-64 overflow-y-auto">
                  <div className="p-2 border-b border-border flex justify-between items-center">
                    <span className="text-xs text-foreground-muted">Select duty types to show</span>
                    <button
                      onClick={clearDutyTypeFilter}
                      className="text-xs text-primary hover:underline"
                    >
                      Show All
                    </button>
                  </div>
                  <div className="p-1">
                    {availableDutyTypes.length === 0 ? (
                      <p className="text-sm text-foreground-muted p-2">No duty types available</p>
                    ) : (
                      availableDutyTypes.map((dt) => (
                        <label
                          key={dt.id}
                          className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-surface-elevated cursor-pointer"
                        >
                          <input
                            type="checkbox"
                            checked={dutyTypeFilter.size === 0 || dutyTypeFilter.has(dt.id)}
                            onChange={() => {
                              if (dutyTypeFilter.size === 0) {
                                // From "show all", unchecking one item means selecting all except that one
                                const nextFilterIds = availableDutyTypes
                                  .filter(d => d.id !== dt.id)
                                  .map(d => d.id);
                                setDutyTypeFilter(new Set(nextFilterIds));
                              } else {
                                toggleDutyTypeFilter(dt.id);
                              }
                            }}
                            className="w-4 h-4 rounded border-border bg-background text-primary focus:ring-primary"
                          />
                          <span className="text-sm text-foreground truncate">{dt.duty_name}</span>
                        </label>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>
            {dutyTypeFilter.size > 0 && (
              <button
                onClick={clearDutyTypeFilter}
                className="text-xs text-foreground-muted hover:text-foreground"
                title="Clear filter"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Unit Admin Controls Info - only show in Unit Admin View */}
      {isUnitAdmin && isUnitAdminView && (
        <div className={`${rosterApproval ? 'bg-blue-500/10 border-blue-500/30' : 'bg-green-500/10 border-green-500/30'} border rounded-lg p-3 space-y-2`}>
          <div className="flex items-center justify-between">
            <p className={`text-sm ${rosterApproval ? 'text-blue-400' : 'text-green-400'}`}>
              <strong>Unit Admin Controls:</strong>
              {rosterApproval && (
                <span className="ml-2 px-2 py-0.5 bg-blue-500/20 rounded text-xs">
                  Roster Locked
                </span>
              )}
            </p>
            {!rosterApproval && (
              !isSelectingMode ? (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setIsSelectingMode(true)}
                  className="bg-orange-500/20 hover:bg-orange-500/30 text-orange-400 border-orange-500/30"
                >
                  <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                  </svg>
                  Block Cells Mode
                </Button>
              ) : (
                <div className="flex items-center gap-2">
                  <span className="text-sm text-orange-400">
                    {selectedCells.size} cell{selectedCells.size !== 1 ? "s" : ""} selected
                  </span>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={openBlockModal}
                    disabled={selectedCells.size === 0}
                    className="bg-orange-500/20 hover:bg-orange-500/30 text-orange-400 border-orange-500/30"
                  >
                    Block Selected
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={clearSelection}
                  >
                    Cancel
                  </Button>
                </div>
              )
            )}
          </div>
          {rosterApproval ? (
            <p className="text-sm text-blue-400">
              This roster was approved on {new Date(rosterApproval.approved_at).toLocaleDateString()}. Duty scores have been applied to personnel.
            </p>
          ) : (
            <ul className="text-sm text-green-400 list-disc list-inside space-y-0.5">
              <li>Click on a <strong>Date</strong> in the Date column to mark entire day as Holiday or Liberty</li>
              {isSelectingMode ? (
                <li className="text-orange-400"><strong>Click cells</strong> to select them for blocking, then click &quot;Block Selected&quot;</li>
              ) : (
                <li>Click <strong>&quot;Block Cells Mode&quot;</strong> to select multiple duty cells to block</li>
              )}
              <li>Click on a <span className="text-orange-400">blocked cell</span> to view details or remove the block</li>
            </ul>
          )}
        </div>
      )}

      {/* Cross-Table Roster */}
      <div className="bg-surface rounded-lg border border-border overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center h-96">
            <div className="text-foreground-muted">Loading roster...</div>
          </div>
        ) : filteredDutyTypes.length === 0 ? (
          <div className="flex items-center justify-center h-48">
            <div className="text-foreground-muted">
              No duty types found. {selectedUnit ? "Try selecting a different unit or 'All Units'." : "Create duty types in the Duty Types page."}
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border bg-surface-elevated">
                  <th className="text-left px-3 py-3 text-sm font-medium text-foreground sticky left-0 bg-surface-elevated z-10 min-w-[100px]">
                    Date
                  </th>
                  <th className="text-center px-2 py-3 text-sm font-medium text-foreground min-w-[50px]">
                    Day
                  </th>
                  {filteredDutyTypes.map((dt) => (
                    <th
                      key={dt.id}
                      className="text-center px-3 py-3 text-sm font-medium text-foreground min-w-[120px]"
                      title={dt.description || dt.duty_name}
                    >
                      <button
                        onClick={() => setDutyTypeDetailsModal({ isOpen: true, dutyType: dt })}
                        className="hover:text-primary hover:underline transition-colors"
                      >
                        {dt.duty_name}
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {monthDays.map((date, idx) => {
                  const dateIsToday = isToday(date);
                  const dateIsWeekend = isWeekend(date);
                  const libertyDay = getLibertyDay(date);
                  const dayName = date.toLocaleDateString("en-US", { weekday: "short" });

                  // Determine row background
                  let rowBg = "";
                  if (libertyDay?.type === "liberty") {
                    rowBg = "bg-green-500/10";
                  } else if (libertyDay?.type === "holiday") {
                    rowBg = "bg-pink-500/10";
                  } else if (dateIsToday) {
                    rowBg = "bg-primary/10";
                  } else if (dateIsWeekend) {
                    rowBg = "bg-highlight/5";
                  }

                  return (
                    <tr
                      key={idx}
                      className={`border-b border-border last:border-0 ${rowBg}`}
                    >
                      <td
                        className={`px-3 py-2 text-sm sticky left-0 z-10 ${
                          libertyDay?.type === "liberty" ? "bg-green-500/10" :
                          libertyDay?.type === "holiday" ? "bg-pink-500/10" :
                          dateIsToday ? "bg-primary/10 font-bold text-primary" :
                          dateIsWeekend ? "bg-highlight/5" : "bg-surface"
                        } ${isUnitAdmin && isUnitAdminView ? "cursor-pointer hover:bg-primary/20" : ""}`}
                        onClick={() => isUnitAdmin && isUnitAdminView && handleDateClick(date)}
                      >
                        <span className={
                          libertyDay ? "text-green-400" :
                          dateIsToday ? "text-primary" :
                          dateIsWeekend ? "text-highlight" : "text-foreground"
                        }>
                          {formatDate(date)}
                        </span>
                        {libertyDay && (
                          <span className={`ml-1 text-xs px-1 rounded ${
                            libertyDay.type === "holiday" ? "bg-pink-500/20 text-pink-400" :
                            "bg-green-500/20 text-green-400"
                          }`}>
                            {libertyDay.type.toUpperCase()}
                          </span>
                        )}
                      </td>
                      <td className={`text-center px-2 py-2 text-sm ${
                        dateIsWeekend ? "text-highlight font-medium" : "text-foreground-muted"
                      }`}>
                        {dayName}
                      </td>
                      {filteredDutyTypes.map((dt) => {
                        const allSlots = getSlotsForDateAndType(date, dt.id);
                        const filledSlots = allSlots.filter(s => s.personnel_id);
                        const slotsNeeded = dt.slots_needed || 1;
                        const cellBlock = getCellBlock(date, dt.id);
                        const isSelected = isCellSelected(dt.id, date);

                        // Cell-level block (specific duty on specific day)
                        if (cellBlock) {
                          return (
                            <td
                              key={dt.id}
                              className={`text-center px-3 py-2 text-sm ${isUnitAdmin && isUnitAdminView ? "cursor-pointer hover:bg-orange-500/10" : ""}`}
                              onClick={() => isUnitAdmin && isUnitAdminView && openExistingBlockModal(date, dt)}
                              title={cellBlock.reason || "Blocked"}
                            >
                              <div className="flex flex-col items-center gap-0.5">
                                <span className="text-xs px-2 py-0.5 rounded bg-orange-500/20 text-orange-400">
                                  BLOCKED
                                </span>
                                {cellBlock.reason && (
                                  <span className="text-xs text-orange-400/70 truncate max-w-[100px]">
                                    {cellBlock.reason}
                                  </span>
                                )}
                              </div>
                            </td>
                          );
                        }

                        // Selection mode - show selection state (only in Unit Admin View)
                        if (isSelectingMode && isUnitAdmin && isUnitAdminView) {
                          return (
                            <td
                              key={dt.id}
                              className={`text-center px-3 py-2 text-sm cursor-pointer transition-colors ${
                                isSelected
                                  ? "bg-orange-500/30 ring-2 ring-orange-500 ring-inset"
                                  : "hover:bg-orange-500/10"
                              }`}
                              onClick={() => toggleCellSelection(date, dt)}
                            >
                              {filledSlots.length > 0 ? (
                                <div className={`flex flex-col gap-0.5 ${isSelected ? "opacity-50" : ""}`}>
                                  {filledSlots.map((slot, idx) => (
                                    <div key={slot.id || idx} className={`px-2 py-0.5 rounded text-xs ${getStatusColor(slot.status)}`}>
                                      {slot.personnel ? (
                                        <span>{slot.personnel.rank} {slot.personnel.last_name}</span>
                                      ) : (
                                        <span className="text-foreground-muted italic">Unassigned</span>
                                      )}
                                    </div>
                                  ))}
                                  {slotsNeeded > 1 && filledSlots.length < slotsNeeded && (
                                    <span className="text-xs text-foreground-muted">
                                      ({filledSlots.length}/{slotsNeeded})
                                    </span>
                                  )}
                                </div>
                              ) : (
                                <span className={`text-foreground-muted/50 ${isSelected ? "text-orange-400" : ""}`}>
                                  {isSelected ? "✓ Selected" : "Click to select"}
                                </span>
                              )}
                            </td>
                          );
                        }

                        // Normal cell - show assignment (liberty/holiday days still need people assigned)
                        return (
                          <td
                            key={dt.id}
                            className={`text-center px-3 py-2 text-sm ${canAssignDuties ? "cursor-pointer hover:bg-primary/5" : ""}`}
                            onClick={() => canAssignDuties && handleCellClick(date, dt)}
                          >
                            {filledSlots.length > 0 ? (
                              <div className="flex flex-col gap-0.5">
                                {filledSlots.map((slot, idx) => (
                                  <button
                                    key={slot.id || idx}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      if (canAssignDuties) {
                                        handleCellClick(date, dt);
                                      } else {
                                        setSelectedSlot(slot);
                                      }
                                    }}
                                    className={`px-2 py-0.5 rounded text-xs transition-colors hover:brightness-110 ${getStatusColor(slot.status)}`}
                                  >
                                    {slot.personnel ? (
                                      <span>
                                        {slot.personnel.rank} {slot.personnel.last_name}
                                      </span>
                                    ) : (
                                      <span className="text-foreground-muted italic">Unassigned</span>
                                    )}
                                  </button>
                                ))}
                                {slotsNeeded > 1 && filledSlots.length < slotsNeeded && canAssignDuties && (
                                  <span className="text-xs text-primary/70 hover:text-primary">
                                    + Add ({filledSlots.length}/{slotsNeeded})
                                  </span>
                                )}
                              </div>
                            ) : (
                              <span className={`text-foreground-muted/50 ${canAssignDuties ? "hover:text-primary" : ""}`}>
                                {canAssignDuties ? (slotsNeeded > 1 ? `+ Assign (0/${slotsNeeded})` : "+ Assign") : "-"}
                              </span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-6 text-sm">
        <div className="flex items-center gap-2">
          <span className="w-3 h-3 rounded bg-primary/10" />
          <span className="text-foreground-muted">Scheduled</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-3 h-3 rounded bg-green-500/20" />
          <span className="text-foreground-muted">Completed</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-3 h-3 rounded bg-red-500/20" />
          <span className="text-foreground-muted">Cancelled</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-3 h-3 rounded bg-highlight/10 border border-highlight/30" />
          <span className="text-foreground-muted">Weekend</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-3 h-3 rounded bg-green-500/20 border border-green-500/30" />
          <span className="text-foreground-muted">Liberty</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-3 h-3 rounded bg-pink-500/20 border border-pink-500/30" />
          <span className="text-foreground-muted">Holiday</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-3 h-3 rounded bg-orange-500/20 border border-orange-500/30" />
          <span className="text-foreground-muted">Blocked</span>
        </div>
      </div>

      {/* Stats Summary */}
      <div className="grid gap-4 md:grid-cols-5">
        <div className="bg-surface rounded-lg border border-border p-4">
          <div className="text-2xl font-bold text-foreground">{dutyStats.totalRequiredDuties}</div>
          <div className="text-sm text-foreground-muted">Total Duties Required</div>
          <div className="text-xs text-foreground-muted mt-1">
            ({dutyStats.totalDays} days × {dutyStats.totalDutyTypes} types) - {dutyStats.blockedCellsCount} blocked
          </div>
        </div>
        <div className="bg-surface rounded-lg border border-border p-4">
          <div className="text-2xl font-bold text-primary">{dutyStats.assignedDuties}</div>
          <div className="text-sm text-foreground-muted">Assigned</div>
        </div>
        <div className="bg-surface rounded-lg border border-border p-4">
          <div className="text-2xl font-bold text-yellow-400">{dutyStats.remainingDuties}</div>
          <div className="text-sm text-foreground-muted">Remaining</div>
        </div>
        <div className="bg-surface rounded-lg border border-border p-4">
          <div className="text-2xl font-bold text-green-400">
            {slots.filter((s) => s.status === "completed").length}
          </div>
          <div className="text-sm text-foreground-muted">Completed</div>
        </div>
        <div className="bg-surface rounded-lg border border-border p-4">
          <div className="text-2xl font-bold text-orange-400">{dutyStats.blockedCellsCount}</div>
          <div className="text-sm text-foreground-muted">Blocked Cells</div>
        </div>
      </div>

      {/* Slot Detail Modal (read-only) */}
      {selectedSlot && !assignmentModal.isOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-surface rounded-lg border border-border w-full max-w-md">
            <div className="p-4 border-b border-border flex items-center justify-between">
              <h2 className="text-lg font-semibold text-foreground">Duty Details</h2>
              <button
                onClick={() => setSelectedSlot(null)}
                className="text-foreground-muted hover:text-foreground"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="p-4 space-y-4">
              <div>
                <label className="text-sm text-foreground-muted">Duty Type</label>
                <p className="text-foreground font-medium">
                  {selectedSlot.duty_type?.duty_name || "Unknown"}
                </p>
              </div>
              <div>
                <label className="text-sm text-foreground-muted">Assigned To</label>
                <p className="text-foreground font-medium">
                  {selectedSlot.personnel
                    ? `${selectedSlot.personnel.rank} ${selectedSlot.personnel.first_name} ${selectedSlot.personnel.last_name}`
                    : "Unassigned"}
                </p>
              </div>
              <div>
                <label className="text-sm text-foreground-muted">Date</label>
                <p className="text-foreground">
                  {new Date(selectedSlot.date_assigned).toLocaleDateString("en-US", {
                    weekday: "long",
                    year: "numeric",
                    month: "long",
                    day: "numeric",
                  })}
                </p>
              </div>
              <div className="flex gap-4">
                <div>
                  <label className="text-sm text-foreground-muted">Status</label>
                  <p>
                    <span
                      className={`inline-block px-2 py-0.5 rounded text-sm ${getStatusColor(selectedSlot.status)}`}
                    >
                      {selectedSlot.status.charAt(0).toUpperCase() + selectedSlot.status.slice(1)}
                    </span>
                  </p>
                </div>
                <div>
                  <label className="text-sm text-foreground-muted">Points Earned</label>
                  <p className="text-foreground font-medium">
                    {selectedSlot.duty_points_earned.toFixed(1)} pts
                  </p>
                </div>
              </div>
            </div>
            <div className="p-4 border-t border-border flex justify-end gap-2">
              {/* Show Request Swap button if roster is approved and user can request */}
              {rosterApproval && selectedSlot.personnel_id && (
                (selectedSlot.personnel_id === currentUserPersonnel?.id || isManager) && (
                  <Button
                    variant="secondary"
                    onClick={() => openSwapModal(selectedSlot)}
                  >
                    Request Swap
                  </Button>
                )
              )}
              <Button variant="ghost" onClick={() => setSelectedSlot(null)}>
                Close
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Swap Request Modal */}
      {swapModal.isOpen && swapModal.originalSlot && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-surface rounded-lg border border-border w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
            <div className="p-4 border-b border-border flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-foreground">Request Duty Swap</h2>
                <p className="text-sm text-foreground-muted mt-1">
                  {swapModal.step === 'select' ? 'Select a duty to swap with' : 'Confirm swap request'}
                </p>
              </div>
              <button
                onClick={() => setSwapModal({ isOpen: false, originalSlot: null, step: 'select', targetSlot: null, reason: '' })}
                className="text-foreground-muted hover:text-foreground"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="p-4 overflow-y-auto flex-1">
              {/* Original Duty Info */}
              <div className="mb-4 p-3 bg-primary/10 rounded-lg">
                <p className="text-sm text-foreground-muted mb-1">Your Duty:</p>
                <p className="text-foreground font-medium">
                  {swapModal.originalSlot.duty_type?.duty_name} - {new Date(swapModal.originalSlot.date_assigned).toLocaleDateString()}
                </p>
                <p className="text-sm text-foreground-muted">
                  {swapModal.originalSlot.personnel?.rank} {swapModal.originalSlot.personnel?.last_name}
                </p>
              </div>

              {swapModal.step === 'select' ? (
                <>
                  {/* Available slots to swap with */}
                  <div className="space-y-2">
                    <p className="text-sm text-foreground-muted">Select a duty to swap with ({availableSlotsForSwap.length} available):</p>
                    {availableSlotsForSwap.length === 0 ? (
                      <p className="text-center text-foreground-muted py-4">
                        No duties available to swap with in this month.
                      </p>
                    ) : (
                      <div className="max-h-64 overflow-y-auto space-y-2 border border-border rounded-lg p-2">
                        {availableSlotsForSwap.map((slot) => (
                          <button
                            key={slot.id}
                            onClick={() => setSwapModal(prev => ({ ...prev, targetSlot: slot, step: 'confirm' }))}
                            className="w-full text-left p-3 rounded-lg border border-border hover:bg-primary/10 hover:border-primary transition-colors"
                          >
                            <div className="flex justify-between items-start">
                              <div>
                                <p className="font-medium text-foreground">
                                  {slot.duty_type?.duty_name}
                                </p>
                                <p className="text-sm text-foreground-muted">
                                  {new Date(slot.date_assigned).toLocaleDateString("en-US", { weekday: 'short', month: 'short', day: 'numeric' })}
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
                </>
              ) : (
                <>
                  {/* Confirm step */}
                  <div className="space-y-4">
                    {/* Target Duty Info */}
                    <div className="p-3 bg-green-500/10 rounded-lg">
                      <p className="text-sm text-foreground-muted mb-1">Swap With:</p>
                      <p className="text-foreground font-medium">
                        {swapModal.targetSlot?.duty_type?.duty_name} - {swapModal.targetSlot && new Date(swapModal.targetSlot.date_assigned).toLocaleDateString()}
                      </p>
                      <p className="text-sm text-foreground-muted">
                        {swapModal.targetSlot?.personnel?.rank} {swapModal.targetSlot?.personnel?.last_name}
                      </p>
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
                    {swapModal.targetSlot && (
                      <div className="p-3 bg-yellow-500/10 rounded-lg text-sm">
                        <p className="text-yellow-400 font-medium">Approval Required:</p>
                        <p className="text-foreground-muted">
                          {getApproverLevelName(determineApproverLevel(swapModal.originalSlot.personnel_id!, swapModal.targetSlot.personnel_id!))}
                        </p>
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>

            <div className="p-4 border-t border-border flex justify-between">
              {swapModal.step === 'confirm' && (
                <Button
                  variant="ghost"
                  onClick={() => setSwapModal(prev => ({ ...prev, step: 'select', targetSlot: null }))}
                >
                  Back
                </Button>
              )}
              <div className="flex gap-2 ml-auto">
                <Button
                  variant="ghost"
                  onClick={() => setSwapModal({ isOpen: false, originalSlot: null, step: 'select', targetSlot: null, reason: '' })}
                >
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

      {/* Assignment Modal */}
      {assignmentModal.isOpen && assignmentModal.date && assignmentModal.dutyType && (() => {
        const slotsNeeded = assignmentModal.dutyType.slots_needed || 1;
        const filledSlots = assignmentModal.existingSlots.filter(s => s.personnel_id);
        const assignedPersonnelIds = new Set(filledSlots.map(s => s.personnel_id));
        const availableForAssignment = eligiblePersonnel.filter(p => !assignedPersonnelIds.has(p.id));
        const canAddMore = filledSlots.length < slotsNeeded;

        return (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-surface rounded-lg border border-border w-full max-w-lg">
              <div className="p-4 border-b border-border flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-foreground">
                    {isManager ? "Manage Duty Assignment" : "Assign Yourself"}
                  </h2>
                  <p className="text-sm text-foreground-muted mt-1">
                    {assignmentModal.dutyType.duty_name} - {formatDate(assignmentModal.date)}
                    {slotsNeeded > 1 && (
                      <span className="ml-2 px-2 py-0.5 bg-primary/10 rounded text-xs">
                        {filledSlots.length}/{slotsNeeded} slots filled
                      </span>
                    )}
                  </p>
                </div>
                <button
                  onClick={() => setAssignmentModal({ isOpen: false, date: null, dutyType: null, existingSlots: [] })}
                  className="text-foreground-muted hover:text-foreground"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <div className="p-4 space-y-4">
                {/* Currently Assigned Section */}
                {filledSlots.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-sm text-foreground-muted font-medium">Currently Assigned:</p>
                    <div className="space-y-1">
                      {filledSlots.map((slot) => (
                        <div key={slot.id} className="flex items-center justify-between p-2 bg-primary/10 rounded-lg">
                          <div>
                            <span className="text-foreground font-medium">
                              {slot.personnel?.rank} {slot.personnel?.first_name} {slot.personnel?.last_name}
                            </span>
                          </div>
                          {isManager && (
                            <button
                              onClick={() => handleRemoveAssignment(slot.id)}
                              disabled={assigning}
                              className="text-red-400 hover:text-red-300 text-xs px-2 py-1 rounded bg-red-500/10 hover:bg-red-500/20"
                            >
                              Remove
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Available Personnel Section */}
                {canAddMore && (
                  <div className="space-y-2">
                    <p className="text-sm text-foreground-muted">
                      {filledSlots.length > 0 ? "Add more personnel" : "Select personnel to assign"} ({availableForAssignment.length} eligible):
                    </p>

                    {availableForAssignment.length === 0 ? (
                      <div className="text-center py-4 text-foreground-muted bg-surface-elevated rounded-lg">
                        <p>No additional eligible personnel found.</p>
                        <p className="text-xs mt-1">Check qualifications and non-availability.</p>
                      </div>
                    ) : (
                      <div className="max-h-48 overflow-y-auto space-y-1 border border-border rounded-lg p-2">
                        {availableForAssignment.map((person) => (
                          <button
                            key={person.id}
                            onClick={() => handleAssign(person.id)}
                            disabled={assigning}
                            className="w-full text-left px-3 py-2 rounded-lg transition-colors bg-surface-elevated hover:bg-primary/10 text-foreground"
                          >
                            <div className="flex items-center justify-between">
                              <div>
                                <span className="font-medium">{person.rank} {person.last_name}, {person.first_name}</span>
                                <span className="text-xs text-foreground-muted ml-2">
                                  Score: {person.current_duty_score.toFixed(1)}
                                </span>
                              </div>
                              <span className="text-xs text-primary">+ Add</span>
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* All slots filled message */}
                {!canAddMore && filledSlots.length > 0 && (
                  <div className="text-center py-2 text-green-400 bg-green-500/10 rounded-lg text-sm">
                    All {slotsNeeded} slot{slotsNeeded > 1 ? "s" : ""} filled
                  </div>
                )}
              </div>

              <div className="p-4 border-t border-border flex justify-end gap-2">
                <Button
                  variant="ghost"
                  onClick={() => setAssignmentModal({ isOpen: false, date: null, dutyType: null, existingSlots: [] })}
                >
                  {filledSlots.length > 0 ? "Done" : "Cancel"}
                </Button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Liberty/Holiday Modal */}
      {libertyModal.isOpen && libertyModal.startDate && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-surface rounded-lg border border-border w-full max-w-md">
            <div className="p-4 border-b border-border flex items-center justify-between">
              <h2 className="text-lg font-semibold text-foreground">Mark Days Off</h2>
              <button
                onClick={() => setLibertyModal({ isOpen: false, startDate: null })}
                className="text-foreground-muted hover:text-foreground"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="p-4 space-y-4">
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">Starting Date</label>
                <p className="text-foreground">{formatDate(libertyModal.startDate)}</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-foreground mb-1">Type</label>
                <select
                  value={libertyFormData.type}
                  onChange={(e) => setLibertyFormData(prev => ({ ...prev, type: e.target.value as "holiday" | "liberty" }))}
                  className="w-full px-3 py-2 bg-background border border-border rounded-lg text-foreground"
                >
                  <option value="liberty">Liberty (Regular Days Off)</option>
                  <option value="holiday">Holiday (Federal/Training Holiday)</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-foreground mb-1">
                  Number of Days
                </label>
                <input
                  type="number"
                  min={1}
                  max={30}
                  value={libertyFormData.days}
                  onChange={(e) => setLibertyFormData(prev => ({ ...prev, days: Math.max(1, Math.min(30, parseInt(e.target.value) || 1)) }))}
                  className="w-full px-3 py-2 bg-background border border-border rounded-lg text-foreground"
                />
              </div>

              <p className="text-xs text-foreground-muted">
                This will mark {libertyFormData.days} consecutive day(s) starting from {formatDate(libertyModal.startDate)} as {libertyFormData.type}.
                Duties may still need to be assigned on these days.
              </p>
            </div>

            <div className="p-4 border-t border-border flex justify-end gap-2">
              <Button
                variant="ghost"
                onClick={() => setLibertyModal({ isOpen: false, startDate: null })}
              >
                Cancel
              </Button>
              <Button onClick={handleAddLibertyDays}>
                Mark as {libertyFormData.type.charAt(0).toUpperCase() + libertyFormData.type.slice(1)}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Block Cells Modal (multi-select) */}
      {blockModal.isOpen && blockModal.cells.length > 0 && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-surface rounded-lg border border-border w-full max-w-lg">
            <div className="p-4 border-b border-border flex items-center justify-between">
              <h2 className="text-lg font-semibold text-foreground">
                {blockModal.existingBlock ? "Manage Blocked Duty" : `Block ${blockModal.cells.length} Duty Cell${blockModal.cells.length > 1 ? "s" : ""}`}
              </h2>
              <button
                onClick={() => {
                  setBlockModal({ isOpen: false, cells: [], existingBlock: null });
                  setBlockComment("");
                }}
                className="text-foreground-muted hover:text-foreground"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="p-4 space-y-4">
              {/* Show selected cells */}
              <div className="p-3 bg-surface-elevated rounded-lg border border-border">
                <div className="text-sm text-foreground-muted mb-2">
                  {blockModal.existingBlock ? "Blocked Cell:" : "Selected Cells to Block:"}
                </div>
                <div className="max-h-32 overflow-y-auto space-y-1">
                  {blockModal.cells.map((cell, idx) => (
                    <div key={idx} className="flex items-center justify-between text-sm">
                      <span className="font-medium text-foreground">{cell.dutyTypeName}</span>
                      <span className="text-foreground-muted">{formatDate(cell.date)}</span>
                    </div>
                  ))}
                </div>
              </div>

              {blockModal.existingBlock ? (
                <div className="space-y-3">
                  <div>
                    <label className="block text-sm font-medium text-foreground mb-1">Current Reason</label>
                    <p className="text-foreground p-2 bg-orange-500/10 rounded-lg border border-orange-500/20">
                      {blockModal.existingBlock.reason || "No reason provided"}
                    </p>
                  </div>
                  <p className="text-xs text-foreground-muted">
                    Click &quot;Remove Block&quot; to allow assignments for this duty on this day.
                  </p>
                </div>
              ) : (
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">
                    Reason <span className="text-red-400">*</span>
                  </label>
                  <input
                    type="text"
                    value={blockComment}
                    onChange={(e) => setBlockComment(e.target.value)}
                    placeholder="e.g., Training, Field exercise, Equipment down..."
                    className="w-full px-3 py-2 bg-background border border-border rounded-lg text-foreground"
                  />
                  <p className="text-xs text-foreground-muted mt-1">
                    This reason will be applied to all {blockModal.cells.length} selected cell{blockModal.cells.length > 1 ? "s" : ""}
                  </p>
                </div>
              )}
            </div>

            <div className="p-4 border-t border-border flex justify-end gap-2">
              <Button
                variant="ghost"
                onClick={() => {
                  setBlockModal({ isOpen: false, cells: [], existingBlock: null });
                  setBlockComment("");
                }}
              >
                Cancel
              </Button>
              {blockModal.existingBlock ? (
                <Button variant="secondary" onClick={handleUnblockCell}>
                  Remove Block
                </Button>
              ) : (
                <Button onClick={handleBlockCells}>
                  Block {blockModal.cells.length} Cell{blockModal.cells.length > 1 ? "s" : ""}
                </Button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Duty Type Details Modal (read-only) */}
      {dutyTypeDetailsModal.isOpen && dutyTypeDetailsModal.dutyType && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-surface rounded-lg border border-border w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="p-4 border-b border-border flex items-center justify-between sticky top-0 bg-surface">
              <h2 className="text-lg font-semibold text-foreground">Duty Type Details</h2>
              <button
                onClick={() => setDutyTypeDetailsModal({ isOpen: false, dutyType: null })}
                className="text-foreground-muted hover:text-foreground"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="p-4 space-y-4">
              {/* Name and Description */}
              <div>
                <label className="text-sm text-foreground-muted">Duty Name</label>
                <p className="text-lg font-semibold text-foreground">
                  {dutyTypeDetailsModal.dutyType.duty_name}
                </p>
              </div>
              {dutyTypeDetailsModal.dutyType.description && (
                <div>
                  <label className="text-sm text-foreground-muted">Description</label>
                  <p className="text-foreground">
                    {dutyTypeDetailsModal.dutyType.description}
                  </p>
                </div>
              )}

              {/* Unit Section */}
              <div>
                <label className="text-sm text-foreground-muted">Unit Section</label>
                <p className="text-foreground">
                  {units.find(u => u.id === dutyTypeDetailsModal.dutyType?.unit_section_id)?.unit_name || "Unknown"}
                </p>
              </div>

              {/* Scheduling Info */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-sm text-foreground-muted">Personnel Required (Slots)</label>
                  <p className="text-foreground font-medium">
                    {dutyTypeDetailsModal.dutyType.slots_needed}
                  </p>
                </div>
                <div>
                  <label className="text-sm text-foreground-muted">Base Duty Points</label>
                  <p className="text-foreground font-medium">
                    {getDutyValueByDutyType(dutyTypeDetailsModal.dutyType.id)?.base_weight ?? 1} pts
                  </p>
                </div>
              </div>

              {/* Duty Point Multipliers */}
              {(() => {
                const dutyValue = getDutyValueByDutyType(dutyTypeDetailsModal.dutyType.id);
                return dutyValue ? (
                  <div className="p-3 bg-surface-elevated rounded-lg border border-border">
                    <label className="text-sm text-foreground-muted">Point Multipliers</label>
                    <div className="grid grid-cols-2 gap-4 mt-2">
                      <div>
                        <span className="text-xs text-foreground-muted">Weekend</span>
                        <p className="text-foreground font-medium">
                          {dutyValue.weekend_multiplier}x ({(dutyValue.base_weight * dutyValue.weekend_multiplier).toFixed(1)} pts)
                        </p>
                      </div>
                      <div>
                        <span className="text-xs text-foreground-muted">Holiday</span>
                        <p className="text-foreground font-medium">
                          {dutyValue.holiday_multiplier}x ({(dutyValue.base_weight * dutyValue.holiday_multiplier).toFixed(1)} pts)
                        </p>
                      </div>
                    </div>
                  </div>
                ) : null;
              })()}

              {/* Rank Filters */}
              {dutyTypeDetailsModal.dutyType.rank_filter_mode &&
               dutyTypeDetailsModal.dutyType.rank_filter_values &&
               dutyTypeDetailsModal.dutyType.rank_filter_values.length > 0 && (
                <div className="p-3 bg-surface-elevated rounded-lg border border-border">
                  <label className="text-sm text-foreground-muted">
                    Rank Filter ({dutyTypeDetailsModal.dutyType.rank_filter_mode === 'include' ? 'Only these ranks' : 'Exclude these ranks'})
                  </label>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {dutyTypeDetailsModal.dutyType.rank_filter_values.map((rank, idx) => (
                      <span
                        key={idx}
                        className={`px-2 py-0.5 rounded text-xs ${
                          dutyTypeDetailsModal.dutyType?.rank_filter_mode === 'include'
                            ? 'bg-green-500/20 text-green-400'
                            : 'bg-red-500/20 text-red-400'
                        }`}
                      >
                        {rank}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Section Filters */}
              {dutyTypeDetailsModal.dutyType.section_filter_mode &&
               dutyTypeDetailsModal.dutyType.section_filter_values &&
               dutyTypeDetailsModal.dutyType.section_filter_values.length > 0 && (
                <div className="p-3 bg-surface-elevated rounded-lg border border-border">
                  <label className="text-sm text-foreground-muted">
                    Section Filter ({dutyTypeDetailsModal.dutyType.section_filter_mode === 'include' ? 'Only these sections' : 'Exclude these sections'})
                  </label>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {dutyTypeDetailsModal.dutyType.section_filter_values.map((sectionId, idx) => {
                      const sectionName = units.find(u => u.id === sectionId)?.unit_name || sectionId;
                      return (
                        <span
                          key={idx}
                          className={`px-2 py-0.5 rounded text-xs ${
                            dutyTypeDetailsModal.dutyType?.section_filter_mode === 'include'
                              ? 'bg-green-500/20 text-green-400'
                              : 'bg-red-500/20 text-red-400'
                          }`}
                        >
                          {sectionName}
                        </span>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Status */}
              <div>
                <label className="text-sm text-foreground-muted">Status</label>
                <p>
                  <span className={`inline-block px-2 py-0.5 rounded text-sm ${
                    dutyTypeDetailsModal.dutyType.is_active
                      ? 'bg-green-500/20 text-green-400'
                      : 'bg-red-500/20 text-red-400'
                  }`}>
                    {dutyTypeDetailsModal.dutyType.is_active ? 'Active' : 'Inactive'}
                  </span>
                </p>
              </div>
            </div>
            <div className="p-4 border-t border-border flex justify-between sticky bottom-0 bg-surface">
              {/* Clear Roster button - only for Unit Admin */}
              {isUnitAdmin && isUnitAdminView && dutyTypeDetailsModal.dutyType && (
                <Button
                  variant="accent"
                  onClick={() => {
                    const dt = dutyTypeDetailsModal.dutyType;
                    if (!dt) return;
                    const confirmed = window.confirm(
                      `Clear all ${dt.duty_name} assignments for ${currentDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}?\n\nThis will remove all assigned personnel for this duty type in the current month.`
                    );
                    if (confirmed) {
                      const startOfMonth = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
                      const endOfMonth = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0);
                      const cleared = clearDutySlotsByDutyType(dt.id, startOfMonth, endOfMonth);
                      alert(`Cleared ${cleared} duty slot${cleared !== 1 ? 's' : ''}`);
                      setDutyTypeDetailsModal({ isOpen: false, dutyType: null });
                      fetchData();
                    }
                  }}
                >
                  Clear Roster
                </Button>
              )}
              <div className={isUnitAdmin && isUnitAdminView ? '' : 'ml-auto'}>
                <Button
                  variant="ghost"
                  onClick={() => setDutyTypeDetailsModal({ isOpen: false, dutyType: null })}
                >
                  Close
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Export/Print Confirmation Modal */}
      {exportModal.isOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-surface rounded-lg border border-border w-full max-w-md">
            <div className="p-4 border-b border-border flex items-center justify-between">
              <h2 className="text-lg font-semibold text-foreground">
                {exportModal.mode === 'csv' ? 'Export to CSV' : 'Print / PDF'}
              </h2>
              <button
                onClick={() => setExportModal({ isOpen: false, mode: 'csv' })}
                className="text-foreground-muted hover:text-foreground"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="p-4 space-y-4">
              <div className="p-3 bg-surface-elevated rounded-lg border border-border">
                <p className="text-sm text-foreground-muted mb-2">
                  <strong>Export Summary:</strong>
                </p>
                <ul className="text-sm text-foreground-muted space-y-1">
                  <li>Month: <span className="text-foreground">{formatMonthYear(currentDate)}</span></li>
                  <li>Days: <span className="text-foreground">{monthDays.length}</span></li>
                  <li>Duty Types: <span className="text-foreground">{filteredDutyTypes.length}</span></li>
                </ul>
                {filteredDutyTypes.length > 0 && (
                  <div className="mt-2 pt-2 border-t border-border">
                    <p className="text-xs text-foreground-muted mb-1">Included duties:</p>
                    <div className="flex flex-wrap gap-1">
                      {filteredDutyTypes.map(dt => (
                        <span key={dt.id} className="text-xs px-2 py-0.5 bg-primary/10 text-primary rounded">
                          {dt.duty_name}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
              {dutyTypeFilter.size > 0 && (
                <p className="text-xs text-foreground-muted">
                  Tip: Use the &quot;Duties&quot; filter in the controls above to change which duty types are included.
                </p>
              )}
            </div>
            <div className="p-4 border-t border-border flex justify-end gap-2">
              <Button
                variant="ghost"
                onClick={() => setExportModal({ isOpen: false, mode: 'csv' })}
              >
                Cancel
              </Button>
              <Button
                onClick={() => {
                  if (exportModal.mode === 'csv') {
                    exportToCSV();
                  } else {
                    printRoster();
                  }
                  setExportModal({ isOpen: false, mode: 'csv' });
                }}
                disabled={filteredDutyTypes.length === 0}
              >
                {exportModal.mode === 'csv' ? 'Export CSV' : 'Print / PDF'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Approve Roster Confirmation Modal */}
      {approveModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-surface rounded-lg border border-border w-full max-w-md">
            <div className="p-4 border-b border-border">
              <h2 className="text-lg font-semibold text-foreground">Approve Duty Roster</h2>
            </div>
            <div className="p-4 space-y-4">
              <div className="p-3 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
                <p className="text-sm text-yellow-400">
                  <strong>Warning:</strong> Approving the roster will:
                </p>
                <ul className="text-sm text-yellow-400 list-disc list-inside mt-2 space-y-1">
                  <li>Lock the roster for {formatMonthYear(currentDate)}</li>
                  <li>Apply duty points to all assigned personnel</li>
                  <li>Update personnel duty scores permanently</li>
                </ul>
              </div>
              <p className="text-sm text-foreground-muted">
                This action cannot be easily undone. Please ensure all duty assignments are correct before approving.
              </p>
            </div>
            <div className="p-4 border-t border-border flex justify-end gap-2">
              <Button
                variant="ghost"
                onClick={() => setApproveModal(false)}
                disabled={approving}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                onClick={handleApproveRoster}
                disabled={approving}
                className="bg-green-600 hover:bg-green-700"
              >
                {approving ? "Approving..." : "Approve Roster"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
