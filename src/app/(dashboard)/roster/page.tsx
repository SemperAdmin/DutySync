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
  getChildUnits,
  getDutyRequirements,
  hasQualification,
  getActiveNonAvailability,
  updateDutySlot,
  createDutySlot,
  getPersonnelByEdipi,
  isDutyBlockedOnDate,
  createBlockedDuty,
  deleteBlockedDuty,
  getAllBlockedDuties,
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

  // Assignment modal state
  const [assignmentModal, setAssignmentModal] = useState<{
    isOpen: boolean;
    date: Date | null;
    dutyType: DutyType | null;
    existingSlot: EnrichedSlot | null;
  }>({ isOpen: false, date: null, dutyType: null, existingSlot: null });
  const [assigning, setAssigning] = useState(false);
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
  const isUnitAdminView = currentViewMode === VIEW_MODE_UNIT_ADMIN;

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

  // Get all unit IDs under a scope (recursive - includes the scope unit and all descendants)
  const getUnitsInScope = useCallback((scopeUnitId: string): string[] => {
    const result: string[] = [scopeUnitId];
    const children = getChildUnits(scopeUnitId);
    for (const child of children) {
      result.push(...getUnitsInScope(child.id));
    }
    return result;
  }, []);

  // All unit IDs the user can assign from (based on effective scope)
  const scopeUnitIds = useMemo(() => {
    if (!effectiveScopeUnitId) return [];
    return getUnitsInScope(effectiveScopeUnitId);
  }, [effectiveScopeUnitId, getUnitsInScope]);

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
    } catch (err) {
      console.error("Error fetching data:", err);
    } finally {
      setLoading(false);
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

  // Get slot for a specific date and duty type
  function getSlotForDateAndType(date: Date, dutyTypeId: string): EnrichedSlot | null {
    const dateStr = date.toISOString().split("T")[0];
    return slots.find((slot) => {
      const slotDateStr = new Date(slot.date_assigned).toISOString().split("T")[0];
      return slotDateStr === dateStr && slot.duty_type_id === dutyTypeId;
    }) || null;
  }

  // Check if date is a liberty/holiday day
  function getLibertyDay(date: Date): LibertyDay | null {
    const dateStr = date.toISOString().split("T")[0];
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
    return `${dutyTypeId}_${date.toISOString().split("T")[0]}`;
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
  const filteredDutyTypes = useMemo(() => {
    if (!selectedUnit) {
      return dutyTypes.filter(dt => dt.is_active);
    }
    return dutyTypes.filter(dt => dt.is_active && dt.unit_section_id === selectedUnit);
  }, [dutyTypes, selectedUnit]);

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

    // Check if cell is blocked
    const cellBlock = getCellBlock(date, dutyType.id);
    if (cellBlock) return; // Can't assign to blocked cells

    const existingSlot = getSlotForDateAndType(date, dutyType.id);

    // Regular users can only assign themselves to empty slots, not swap others
    if (!isManager && existingSlot?.personnel_id) {
      // Regular user trying to click on an already-assigned slot
      // Just show the details modal instead
      setSelectedSlot(existingSlot);
      return;
    }

    setAssignmentModal({
      isOpen: true,
      date,
      dutyType,
      existingSlot,
    });
  }

  // Handle date click for liberty marking (Unit Admin only)
  function handleDateClick(date: Date) {
    if (!isUnitAdmin || !unitAdminUnitId) return;

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
      const dateStr = date.toISOString().split("T")[0];

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
    if (!assignmentModal.date || !assignmentModal.dutyType || !user) return;

    setAssigning(true);

    try {
      if (assignmentModal.existingSlot) {
        // Update existing slot (swap)
        updateDutySlot(assignmentModal.existingSlot.id, {
          personnel_id: personnelId,
          assigned_by: user.id,
        });
      } else {
        // Create new slot
        const newSlot = {
          id: crypto.randomUUID(),
          duty_type_id: assignmentModal.dutyType.id,
          personnel_id: personnelId,
          date_assigned: assignmentModal.date,
          assigned_by: user.id,
          duty_points_earned: 1.0,
          status: "scheduled" as const,
          created_at: new Date(),
          updated_at: new Date(),
        };
        createDutySlot(newSlot);
      }

      fetchData();
      setAssignmentModal({ isOpen: false, date: null, dutyType: null, existingSlot: null });
    } catch (err) {
      console.error("Error assigning duty:", err);
    } finally {
      setAssigning(false);
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

  // Export to CSV
  function exportToCSV() {
    const headers = ["Date", "Day", "Status", ...filteredDutyTypes.map(dt => dt.duty_name)];
    const rows = monthDays.map((date) => {
      const dayName = date.toLocaleDateString("en-US", { weekday: "long" });
      const dateStr = date.toISOString().split("T")[0];
      const libertyDay = getLibertyDay(date);
      const dayStatus = libertyDay ? libertyDay.type.toUpperCase() : "";

      const dutyAssignments = filteredDutyTypes.map(dt => {
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
                ${filteredDutyTypes.map(dt => `<th>${dt.duty_name}</th>`).join("")}
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
                    ${filteredDutyTypes.map(dt => {
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
          <Button variant="secondary" size="sm" onClick={exportToCSV}>
            <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            Export CSV
          </Button>
          <Button variant="secondary" size="sm" onClick={printRoster}>
            <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
            </svg>
            Print / PDF
          </Button>
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

        {/* Unit Filter */}
        <div className="flex items-center gap-2">
          <label className="text-sm text-foreground-muted">Filter by Unit:</label>
          <select
            value={selectedUnit}
            onChange={(e) => setSelectedUnit(e.target.value)}
            className="px-3 py-1.5 bg-background border border-border rounded-lg text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary"
          >
            <option value="">All Units</option>
            {units.map((unit) => (
              <option key={unit.id} value={unit.id}>
                {unit.unit_name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Unit Admin Controls Info */}
      {isUnitAdmin && (
        <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-3 space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-sm text-green-400">
              <strong>Unit Admin Controls:</strong>
            </p>
            {!isSelectingMode ? (
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
            )}
          </div>
          <ul className="text-sm text-green-400 list-disc list-inside space-y-0.5">
            <li>Click on a <strong>Date</strong> in the Date column to mark entire day as Holiday or Liberty</li>
            {isSelectingMode ? (
              <li className="text-orange-400"><strong>Click cells</strong> to select them for blocking, then click &quot;Block Selected&quot;</li>
            ) : (
              <li>Click <strong>&quot;Block Cells Mode&quot;</strong> to select multiple duty cells to block</li>
            )}
            <li>Click on a <span className="text-orange-400">blocked cell</span> to view details or remove the block</li>
          </ul>
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
                      {dt.duty_name}
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
                        } ${isUnitAdmin ? "cursor-pointer hover:bg-primary/20" : ""}`}
                        onClick={() => isUnitAdmin && handleDateClick(date)}
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
                        const slot = getSlotForDateAndType(date, dt.id);
                        const cellBlock = getCellBlock(date, dt.id);
                        const isSelected = isCellSelected(dt.id, date);

                        // Cell-level block (specific duty on specific day)
                        if (cellBlock) {
                          return (
                            <td
                              key={dt.id}
                              className={`text-center px-3 py-2 text-sm ${isUnitAdmin ? "cursor-pointer hover:bg-orange-500/10" : ""}`}
                              onClick={() => isUnitAdmin && openExistingBlockModal(date, dt)}
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

                        // Selection mode - show selection state
                        if (isSelectingMode && isUnitAdmin) {
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
                              {slot ? (
                                <div className={`px-2 py-1 rounded text-xs ${isSelected ? "opacity-50" : ""} ${getStatusColor(slot.status)}`}>
                                  {slot.personnel ? (
                                    <span>{slot.personnel.rank} {slot.personnel.last_name}</span>
                                  ) : (
                                    <span className="text-foreground-muted italic">Unassigned</span>
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
                            {slot ? (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (canAssignDuties) {
                                    handleCellClick(date, dt);
                                  } else {
                                    setSelectedSlot(slot);
                                  }
                                }}
                                className={`px-2 py-1 rounded text-xs transition-colors hover:brightness-110 ${getStatusColor(slot.status)}`}
                              >
                                {slot.personnel ? (
                                  <span>
                                    {slot.personnel.rank} {slot.personnel.last_name}
                                  </span>
                                ) : (
                                  <span className="text-foreground-muted italic">Unassigned</span>
                                )}
                              </button>
                            ) : (
                              <span className={`text-foreground-muted/50 ${canAssignDuties ? "hover:text-primary" : ""}`}>
                                {canAssignDuties ? "+ Assign" : "-"}
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
            <div className="p-4 border-t border-border flex justify-end">
              <Button variant="ghost" onClick={() => setSelectedSlot(null)}>
                Close
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Assignment Modal */}
      {assignmentModal.isOpen && assignmentModal.date && assignmentModal.dutyType && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-surface rounded-lg border border-border w-full max-w-lg">
            <div className="p-4 border-b border-border flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-foreground">
                  {isManager
                    ? (assignmentModal.existingSlot ? "Swap Duty Assignment" : "Assign Duty")
                    : "Assign Yourself"}
                </h2>
                <p className="text-sm text-foreground-muted mt-1">
                  {assignmentModal.dutyType.duty_name} - {formatDate(assignmentModal.date)}
                </p>
              </div>
              <button
                onClick={() => setAssignmentModal({ isOpen: false, date: null, dutyType: null, existingSlot: null })}
                className="text-foreground-muted hover:text-foreground"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="p-4">
              {assignmentModal.existingSlot?.personnel && (
                <div className="mb-4 p-3 bg-primary/10 rounded-lg">
                  <p className="text-sm text-foreground-muted">Currently Assigned:</p>
                  <p className="text-foreground font-medium">
                    {assignmentModal.existingSlot.personnel.rank} {assignmentModal.existingSlot.personnel.first_name} {assignmentModal.existingSlot.personnel.last_name}
                  </p>
                </div>
              )}

              <div className="space-y-2">
                <p className="text-sm text-foreground-muted">
                  Select personnel to assign ({eligiblePersonnel.length} eligible):
                </p>

                {eligiblePersonnel.length === 0 ? (
                  <div className="text-center py-8 text-foreground-muted">
                    <p>No eligible personnel found.</p>
                    <p className="text-xs mt-1">Check qualifications and non-availability.</p>
                  </div>
                ) : (
                  <div className="max-h-64 overflow-y-auto space-y-1">
                    {eligiblePersonnel.map((person) => {
                      const isCurrentlyAssigned = assignmentModal.existingSlot?.personnel?.id === person.id;

                      return (
                        <button
                          key={person.id}
                          onClick={() => !isCurrentlyAssigned && handleAssign(person.id)}
                          disabled={assigning || isCurrentlyAssigned}
                          className={`w-full text-left px-3 py-2 rounded-lg transition-colors ${
                            isCurrentlyAssigned
                              ? "bg-primary/20 text-primary cursor-default"
                              : "bg-surface-elevated hover:bg-primary/10 text-foreground"
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <div>
                              <span className="font-medium">{person.rank} {person.last_name}, {person.first_name}</span>
                              <span className="text-xs text-foreground-muted ml-2">
                                Score: {person.current_duty_score.toFixed(1)}
                              </span>
                            </div>
                            {isCurrentlyAssigned && (
                              <span className="text-xs bg-primary/30 px-2 py-0.5 rounded">Current</span>
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            <div className="p-4 border-t border-border flex justify-end gap-2">
              <Button
                variant="ghost"
                onClick={() => setAssignmentModal({ isOpen: false, date: null, dutyType: null, existingSlot: null })}
              >
                Cancel
              </Button>
            </div>
          </div>
        </div>
      )}

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
    </div>
  );
}
