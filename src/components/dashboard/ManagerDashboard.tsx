"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import Card, {
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import { useAuth } from "@/lib/client-auth";
import type { Personnel, DutySlot, NonAvailability, UnitSection, DutyType, RoleName } from "@/types";
import {
  getAllPersonnel,
  getUnitSections,
  getAllDutySlots,
  getAllNonAvailability,
  getAllDutyTypes,
  updateNonAvailability,
} from "@/lib/client-stores";
import { MAX_DUTY_SCORE } from "@/lib/constants";

// Manager role names - should match DashboardLayout
const MANAGER_ROLES: RoleName[] = [
  "Unit Manager",
  "Company Manager",
  "Platoon Manager",
  "Section Manager",
];

// Non-availability categories for robust categorization
type NACategory = "leave" | "tad" | "medical" | "other";

// Standard deviation threshold for fairness calculation
const MAX_EXPECTED_STD_DEV = 5;

export default function ManagerDashboard() {
  const { user } = useAuth();
  const [allPersonnel, setAllPersonnel] = useState<Personnel[]>([]);
  const [units, setUnits] = useState<UnitSection[]>([]);
  const [dutySlots, setDutySlots] = useState<DutySlot[]>([]);
  const [nonAvailability, setNonAvailability] = useState<NonAvailability[]>([]);
  const [dutyTypes, setDutyTypes] = useState<DutyType[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(() => {
    try {
      setError(null);
      const personnelData = getAllPersonnel();
      const unitsData = getUnitSections();
      const dutySlotsData = getAllDutySlots();
      const naData = getAllNonAvailability();
      const dutyTypesData = getAllDutyTypes();

      setAllPersonnel(personnelData);
      setUnits(unitsData);
      setDutySlots(dutySlotsData);
      setNonAvailability(naData);
      setDutyTypes(dutyTypesData);
    } catch (err) {
      console.error("Error loading manager dashboard data:", err);
      setError("Failed to load dashboard data. Please refresh the page.");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Create a Map of units for O(1) lookups
  const unitMap = useMemo(() => new Map(units.map(u => [u.id, u])), [units]);

  // Create a Map of parent_id to child unit IDs for O(1) children lookup
  const childrenMap = useMemo(() => {
    const map = new Map<string, string[]>();
    units.forEach(u => {
      if (u.parent_id) {
        const children = map.get(u.parent_id) || [];
        children.push(u.id);
        map.set(u.parent_id, children);
      }
    });
    return map;
  }, [units]);

  // Get the manager's scope unit ID from their role
  const managerScopeUnitId = useMemo(() => {
    if (!user?.roles) return null;
    const managerRole = user.roles.find(r =>
      MANAGER_ROLES.includes(r.role_name as RoleName) && r.scope_unit_id
    );
    return managerRole?.scope_unit_id || null;
  }, [user?.roles]);

  // Get all descendant unit IDs for the manager's scope - O(1) per level using childrenMap
  // Uses index-based iteration instead of shift() for O(1) queue operations
  const scopeUnitIds = useMemo(() => {
    if (!managerScopeUnitId) return new Set<string>();

    const ids = new Set<string>([managerScopeUnitId]);
    const queue = [managerScopeUnitId];

    for (let i = 0; i < queue.length; i++) {
      const currentId = queue[i];
      const children = childrenMap.get(currentId) || [];
      for (const childId of children) {
        if (!ids.has(childId)) {
          ids.add(childId);
          queue.push(childId);
        }
      }
    }

    return ids;
  }, [managerScopeUnitId, childrenMap]);

  // Get personnel within the manager's scope
  const scopedPersonnel = useMemo(() => {
    if (scopeUnitIds.size === 0) return [];
    return allPersonnel.filter(p => scopeUnitIds.has(p.unit_section_id));
  }, [allPersonnel, scopeUnitIds]);

  // Create a Set of scoped personnel IDs for O(1) lookups (shared by multiple filters)
  const scopedPersonnelIds = useMemo(() => new Set(scopedPersonnel.map(p => p.id)), [scopedPersonnel]);

  // Get duty slots for personnel within scope
  const scopedDutySlots = useMemo(() => {
    return dutySlots.filter(slot => scopedPersonnelIds.has(slot.personnel_id));
  }, [dutySlots, scopedPersonnelIds]);

  // Get non-availability for personnel within scope
  const scopedNonAvailability = useMemo(() => {
    return nonAvailability.filter(na => scopedPersonnelIds.has(na.personnel_id));
  }, [nonAvailability, scopedPersonnelIds]);

  // Create Maps for O(1) lookups in calculations
  const personnelMap = useMemo(() => new Map(scopedPersonnel.map(p => [p.id, p])), [scopedPersonnel]);
  const dutyTypeMap = useMemo(() => new Map(dutyTypes.map(dt => [dt.id, dt])), [dutyTypes]);

  // Categorize non-availability reason
  // Note: Medical is checked before leave to handle "medical leave" correctly
  const categorizeNA = (reason: string): NACategory => {
    const lowerReason = reason.toLowerCase();
    if (lowerReason.includes("medical") || lowerReason.includes("sick") || lowerReason.includes("appointment")) {
      return "medical";
    }
    if (lowerReason.includes("leave") || lowerReason.includes("pto") || lowerReason.includes("vacation")) {
      return "leave";
    }
    if (lowerReason.includes("tad") || lowerReason.includes("tdy") || lowerReason.includes("training")) {
      return "tad";
    }
    return "other";
  };

  // Calculate unit strength statistics
  const strengthStats = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    let onLeave = 0;
    let onTAD = 0;
    let medical = 0;

    scopedNonAvailability.forEach(na => {
      if (na.status !== "approved") return;

      const start = new Date(na.start_date);
      const end = new Date(na.end_date);
      start.setHours(0, 0, 0, 0);
      end.setHours(0, 0, 0, 0);

      if (today >= start && today <= end) {
        const category = categorizeNA(na.reason);
        switch (category) {
          case "leave":
            onLeave++;
            break;
          case "tad":
            onTAD++;
            break;
          case "medical":
            medical++;
            break;
          default:
            onLeave++; // Default to leave for "other"
        }
      }
    });

    const total = scopedPersonnel.length;
    const available = total - onLeave - onTAD - medical;

    return { total, available, onLeave, onTAD, medical };
  }, [scopedPersonnel, scopedNonAvailability]);

  // Calculate fairness statistics
  const fairnessStats = useMemo(() => {
    if (scopedPersonnel.length === 0) return { avg: 0, stdDev: 0, fairnessIndex: 0 };

    const scores = scopedPersonnel.map(p => p.current_duty_score);
    const avg = scores.reduce((sum, s) => sum + s, 0) / scores.length;
    const variance = scores.reduce((sum, s) => sum + Math.pow(s - avg, 2), 0) / scores.length;
    const stdDev = Math.sqrt(variance);

    // Fairness index: 100% when stdDev is 0, decreases as stdDev increases
    const fairnessIndex = Math.max(0, Math.min(100, 100 - (stdDev / MAX_EXPECTED_STD_DEV) * 100));

    return { avg, stdDev, fairnessIndex };
  }, [scopedPersonnel]);

  // Get pending non-availability requests
  const pendingRequests = useMemo(() => {
    return scopedNonAvailability
      .filter(na => na.status === "pending")
      .map(na => ({
        ...na,
        person: personnelMap.get(na.personnel_id),
      }))
      .filter(na => na.person);
  }, [scopedNonAvailability, personnelMap]);

  // Get personnel on duty this week
  const personnelOnDutyThisWeek = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Group duty slots by date for efficient lookup
    const slotsByDate = new Map<string, DutySlot[]>();
    scopedDutySlots.forEach(slot => {
      const slotDate = new Date(slot.date_assigned);
      slotDate.setHours(0, 0, 0, 0);
      const dateKey = slotDate.toISOString().split('T')[0];
      const existing = slotsByDate.get(dateKey) || [];
      existing.push(slot);
      slotsByDate.set(dateKey, existing);
    });

    const days: Array<{ date: Date; dayName: string; duties: Array<{ person: Personnel; dutyType: string }> }> = [];

    for (let i = 0; i < 7; i++) {
      const date = new Date(today);
      date.setDate(today.getDate() + i);

      const dayName = date.toLocaleDateString("en-US", { weekday: "short" });
      const dayNum = date.getDate();
      const dateKey = date.toISOString().split('T')[0];

      const daySlots = slotsByDate.get(dateKey) || [];
      const dayDuties = daySlots
        .map(slot => {
          const person = personnelMap.get(slot.personnel_id);
          const dutyType = dutyTypeMap.get(slot.duty_type_id);
          return person ? {
            person,
            dutyType: dutyType?.duty_name || "Duty",
          } : null;
        })
        .filter((d): d is { person: Personnel; dutyType: string } => d !== null);

      days.push({
        date,
        dayName: `${dayName} ${dayNum}`,
        duties: dayDuties,
      });
    }

    return days;
  }, [scopedDutySlots, personnelMap, dutyTypeMap]);

  // Get top/bottom performers by duty score
  const performanceStats = useMemo(() => {
    const sorted = [...scopedPersonnel].sort((a, b) => b.current_duty_score - a.current_duty_score);
    return {
      top: sorted.slice(0, 5),
      bottom: sorted.slice(-5).reverse(),
    };
  }, [scopedPersonnel]);

  // Handle approve/deny non-availability
  const handleApproveRequest = (naId: string, approved: boolean) => {
    const updatePayload: { status: "approved" | "rejected"; approved_by: string | null } = {
      status: approved ? "approved" : "rejected",
      approved_by: user?.id || null,
    };
    try {
      updateNonAvailability(naId, updatePayload);
      // Update state directly for efficiency
      setNonAvailability(prev =>
        prev.map(na =>
          na.id === naId
            ? { ...na, ...updatePayload }
            : na
        )
      );
    } catch (err) {
      console.error("Error updating non-availability:", err);
      setError(`Failed to ${approved ? "approve" : "deny"} request. Please try again.`);
    }
  };

  // Get unit name by ID
  const getUnitName = (unitId: string): string => {
    const unit = unitMap.get(unitId);
    return unit?.unit_name || "Unknown";
  };

  // Get scope unit name
  const scopeUnitName = managerScopeUnitId ? getUnitName(managerScopeUnitId) : "Unknown";

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center text-error p-8">
        <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-error/20 flex items-center justify-center">
          <svg className="w-6 h-6 text-error" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
        </div>
        <p className="text-lg font-medium">{error}</p>
      </div>
    );
  }

  if (!managerScopeUnitId) {
    return (
      <div className="text-center p-8">
        <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-warning/20 flex items-center justify-center">
          <svg className="w-8 h-8 text-warning" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
        </div>
        <h2 className="text-xl font-semibold text-foreground mb-2">No Manager Role Assigned</h2>
        <p className="text-foreground-muted">
          You need to be assigned a manager role with a unit scope to access this dashboard.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-foreground">Manager Dashboard</h1>
        <p className="text-foreground-muted mt-1">
          Managing <span className="text-highlight font-medium">{scopeUnitName}</span> &bull; {scopedPersonnel.length} personnel
        </p>
      </div>

      {/* Top Row - Strength & Fairness Stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Unit Strength Card */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <svg className="w-5 h-5 text-highlight" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              Unit Strength
            </CardTitle>
            <CardDescription>Current availability status</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {/* Main Stats */}
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-4xl font-bold text-highlight">{strengthStats.available}</p>
                  <p className="text-sm text-foreground-muted">Available</p>
                </div>
                <div className="text-right">
                  <p className="text-2xl font-semibold text-foreground">{strengthStats.total}</p>
                  <p className="text-sm text-foreground-muted">Total Assigned</p>
                </div>
              </div>

              {/* Breakdown */}
              <div className="grid grid-cols-3 gap-2 pt-3 border-t border-border">
                <div className="text-center p-2 rounded-lg bg-warning/10">
                  <p className="text-lg font-semibold text-warning">{strengthStats.onLeave}</p>
                  <p className="text-xs text-foreground-muted">On Leave</p>
                </div>
                <div className="text-center p-2 rounded-lg bg-primary/10">
                  <p className="text-lg font-semibold text-blue-400">{strengthStats.onTAD}</p>
                  <p className="text-xs text-foreground-muted">TAD</p>
                </div>
                <div className="text-center p-2 rounded-lg bg-error/10">
                  <p className="text-lg font-semibold text-error">{strengthStats.medical}</p>
                  <p className="text-xs text-foreground-muted">Medical</p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Fairness Index Card */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <svg className="w-5 h-5 text-highlight" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 6l3 1m0 0l-3 9a5.002 5.002 0 006.001 0M6 7l3 9M6 7l6-2m6 2l3-1m-3 1l-3 9a5.002 5.002 0 006.001 0M18 7l3 9m-3-9l-6-2m0-2v2m0 16V5m0 16H9m3 0h3" />
              </svg>
              Duty Fairness
            </CardTitle>
            <CardDescription>Score distribution across personnel</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {/* Fairness Index */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm text-foreground-muted">Fairness Index</span>
                  <span className="text-lg font-semibold text-foreground">{fairnessStats.fairnessIndex.toFixed(0)}%</span>
                </div>
                <div className="h-3 bg-surface-elevated rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${
                      fairnessStats.fairnessIndex >= 80 ? "bg-success" :
                      fairnessStats.fairnessIndex >= 60 ? "bg-warning" : "bg-error"
                    }`}
                    style={{ width: `${fairnessStats.fairnessIndex}%` }}
                  />
                </div>
              </div>

              {/* Stats */}
              <div className="grid grid-cols-2 gap-4 pt-3 border-t border-border">
                <div className="p-3 rounded-lg bg-surface-elevated">
                  <p className="text-xs text-foreground-muted">Average Score</p>
                  <p className="text-lg font-semibold text-foreground">{fairnessStats.avg.toFixed(1)}</p>
                </div>
                <div className="p-3 rounded-lg bg-surface-elevated">
                  <p className="text-xs text-foreground-muted">Std Deviation</p>
                  <p className="text-lg font-semibold text-foreground">{fairnessStats.stdDev.toFixed(2)}</p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Pending Requests */}
      {pendingRequests.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <svg className="w-5 h-5 text-warning" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              Pending Requests
              <span className="ml-2 px-2 py-0.5 text-xs font-medium rounded-full bg-warning/20 text-warning">
                {pendingRequests.length}
              </span>
            </CardTitle>
            <CardDescription>Non-availability requests awaiting approval</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {pendingRequests.map(request => (
                <div
                  key={request.id}
                  className="flex items-center justify-between p-4 rounded-lg bg-surface-elevated border border-border"
                >
                  <div className="flex-1">
                    <p className="font-medium text-foreground">
                      {request.person?.rank} {request.person?.last_name}, {request.person?.first_name}
                    </p>
                    <p className="text-sm text-foreground-muted">
                      {request.reason} &bull;{" "}
                      {new Date(request.start_date).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                      {" - "}
                      {new Date(request.end_date).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleApproveRequest(request.id, false)}
                      className="text-error hover:bg-error/10"
                    >
                      Deny
                    </Button>
                    <Button
                      variant="accent"
                      size="sm"
                      onClick={() => handleApproveRequest(request.id, true)}
                    >
                      Approve
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Weekly Duty Schedule */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <svg className="w-5 h-5 text-highlight" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            This Week&apos;s Duty Schedule
          </CardTitle>
          <CardDescription>Personnel on duty for the next 7 days</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-7 gap-2">
            {personnelOnDutyThisWeek.map((day, idx) => (
              <div
                key={idx}
                className={`p-3 rounded-lg text-center ${
                  idx === 0 ? "bg-primary/10 border border-primary/20" : "bg-surface-elevated"
                }`}
              >
                <p className={`text-xs font-medium ${idx === 0 ? "text-primary" : "text-foreground-muted"}`}>
                  {day.dayName}
                </p>
                {day.duties.length > 0 ? (
                  <div className="mt-2 space-y-1">
                    {day.duties.slice(0, 3).map((duty, dIdx) => (
                      <p key={dIdx} className="text-xs text-foreground truncate" title={`${duty.person.rank} ${duty.person.last_name}`}>
                        {duty.person.rank} {duty.person.last_name.substring(0, 6)}
                      </p>
                    ))}
                    {day.duties.length > 3 && (
                      <p className="text-xs text-foreground-muted">+{day.duties.length - 3} more</p>
                    )}
                  </div>
                ) : (
                  <p className="mt-2 text-xs text-foreground-muted">-</p>
                )}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Performance Stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Top Performers */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <svg className="w-5 h-5 text-success" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 10l7-7m0 0l7 7m-7-7v18" />
              </svg>
              Highest Duty Scores
            </CardTitle>
            <CardDescription>Personnel with most duty points</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {performanceStats.top.map((person, idx) => (
                <div key={person.id} className="flex items-center justify-between p-2 rounded-lg bg-surface-elevated">
                  <div className="flex items-center gap-3">
                    <span className="text-xs font-medium text-foreground-muted w-4">{idx + 1}</span>
                    <span className="text-sm text-foreground">
                      {person.rank} {person.last_name}
                    </span>
                  </div>
                  <span className="text-sm font-medium text-success">{person.current_duty_score.toFixed(1)}</span>
                </div>
              ))}
              {performanceStats.top.length === 0 && (
                <p className="text-sm text-foreground-muted text-center py-4">No personnel data</p>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Bottom Performers */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <svg className="w-5 h-5 text-warning" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
              </svg>
              Lowest Duty Scores
            </CardTitle>
            <CardDescription>Personnel available for next duty</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {performanceStats.bottom.map((person, idx) => (
                <div key={person.id} className="flex items-center justify-between p-2 rounded-lg bg-surface-elevated">
                  <div className="flex items-center gap-3">
                    <span className="text-xs font-medium text-foreground-muted w-4">{idx + 1}</span>
                    <span className="text-sm text-foreground">
                      {person.rank} {person.last_name}
                    </span>
                  </div>
                  <span className="text-sm font-medium text-warning">{person.current_duty_score.toFixed(1)}</span>
                </div>
              ))}
              {performanceStats.bottom.length === 0 && (
                <p className="text-sm text-foreground-muted text-center py-4">No personnel data</p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
