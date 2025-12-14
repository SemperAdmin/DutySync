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
  getDutySlotsByDateRange,
  getAllNonAvailability,
  getUnitSections,
  getAllDutyTypes,
  updateNonAvailability,
} from "@/lib/client-stores";

// Manager role names
const MANAGER_ROLES: RoleName[] = [
  "Unit Manager",
  "Company Manager",
  "Platoon Manager",
  "Section Manager",
];

export default function ManagerDashboard() {
  const { user } = useAuth();
  const [personnel, setPersonnel] = useState<Personnel[]>([]);
  const [allPersonnel, setAllPersonnel] = useState<Personnel[]>([]);
  const [dutySlots, setDutySlots] = useState<DutySlot[]>([]);
  const [nonAvailability, setNonAvailability] = useState<NonAvailability[]>([]);
  const [units, setUnits] = useState<UnitSection[]>([]);
  const [dutyTypes, setDutyTypes] = useState<DutyType[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Get manager's scope unit ID
  const managerRole = useMemo(() => {
    if (!user?.roles) return null;
    return user.roles.find((r) => MANAGER_ROLES.includes(r.role_name as RoleName));
  }, [user?.roles]);

  const scopeUnitId = managerRole?.scope_unit_id || null;

  // Get scope unit name
  const scopeUnit = useMemo(() => {
    if (!scopeUnitId) return null;
    return units.find((u) => u.id === scopeUnitId);
  }, [scopeUnitId, units]);

  // Build children map for efficient descendant lookup
  const childrenByParentId = useMemo(() => {
    const map = new Map<string, UnitSection[]>();
    for (const unit of units) {
      if (unit.parent_id) {
        const existing = map.get(unit.parent_id) || [];
        existing.push(unit);
        map.set(unit.parent_id, existing);
      }
    }
    return map;
  }, [units]);

  // Get all descendant unit IDs (iterative to prevent stack overflow)
  const getDescendantIds = useCallback(
    (unitId: string): string[] => {
      const descendants: string[] = [];
      const stack: string[] = [unitId];
      while (stack.length > 0) {
        const currentId = stack.pop()!;
        const children = childrenByParentId.get(currentId) || [];
        for (const child of children) {
          descendants.push(child.id);
          stack.push(child.id);
        }
      }
      return descendants;
    },
    [childrenByParentId]
  );

  // Get all unit IDs in scope (including the scope unit itself and all descendants)
  const scopeUnitIds = useMemo(() => {
    if (!scopeUnitId) return new Set<string>();
    const ids = new Set<string>([scopeUnitId]);
    getDescendantIds(scopeUnitId).forEach((id) => ids.add(id));
    return ids;
  }, [scopeUnitId, getDescendantIds]);

  // Filter personnel to scope
  const scopedPersonnel = useMemo(() => {
    if (scopeUnitIds.size === 0) return allPersonnel;
    return allPersonnel.filter((p) => scopeUnitIds.has(p.unit_section_id));
  }, [allPersonnel, scopeUnitIds]);

  // Filter duty slots to scope (by personnel)
  const scopedDutySlots = useMemo(() => {
    const personnelIds = new Set(scopedPersonnel.map((p) => p.id));
    return dutySlots.filter((slot) => personnelIds.has(slot.personnel_id));
  }, [dutySlots, scopedPersonnel]);

  // Filter non-availability to scope
  const scopedNonAvailability = useMemo(() => {
    const personnelIds = new Set(scopedPersonnel.map((p) => p.id));
    return nonAvailability.filter((na) => personnelIds.has(na.personnel_id));
  }, [nonAvailability, scopedPersonnel]);

  const fetchData = useCallback(() => {
    try {
      const unitsData = getUnitSections();
      setUnits(unitsData);

      const allPers = getAllPersonnel();
      setAllPersonnel(allPers);

      const dutyTypesData = getAllDutyTypes();
      setDutyTypes(dutyTypesData);

      // Get duty slots for next 14 days
      const today = new Date();
      const futureDate = new Date();
      futureDate.setDate(today.getDate() + 14);
      const slots = getDutySlotsByDateRange(today, futureDate);
      setDutySlots(slots);

      // Get all non-availability
      const naData = getAllNonAvailability();
      setNonAvailability(naData);
    } catch (err) {
      console.error("Error loading dashboard data:", err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Calculate unit strength stats
  const strengthStats = useMemo(() => {
    const total = scopedPersonnel.length;
    const today = new Date();

    let onLeave = 0;
    let onTAD = 0;
    let medical = 0;

    scopedNonAvailability.forEach((na) => {
      if (na.status !== "approved") return;
      const start = new Date(na.start_date);
      const end = new Date(na.end_date);
      if (today >= start && today <= end) {
        const reason = na.reason.toLowerCase();
        if (reason.includes("leave")) onLeave++;
        else if (reason.includes("tad")) onTAD++;
        else if (reason.includes("medical")) medical++;
        else onLeave++; // Default to leave
      }
    });

    const unavailable = onLeave + onTAD + medical;
    const available = total - unavailable;
    const availablePercent = total > 0 ? Math.round((available / total) * 100) : 0;

    return { total, available, availablePercent, onLeave, onTAD, medical };
  }, [scopedPersonnel, scopedNonAvailability]);

  // Get pending non-availability requests
  const pendingRequests = useMemo(() => {
    return scopedNonAvailability
      .filter((na) => na.status === "pending")
      .map((na) => {
        const person = scopedPersonnel.find((p) => p.id === na.personnel_id);
        return { ...na, person };
      });
  }, [scopedNonAvailability, scopedPersonnel]);

  // Get personnel on duty this week
  const personnelOnDutyThisWeek = useMemo(() => {
    const today = new Date();
    const days: Array<{ date: Date; dayName: string; duties: Array<{ person: Personnel; dutyType: string }> }> = [];

    for (let i = 0; i < 7; i++) {
      const date = new Date(today);
      date.setDate(today.getDate() + i);
      date.setHours(0, 0, 0, 0);

      const dayName = date.toLocaleDateString("en-US", { weekday: "short" });
      const dayNum = date.getDate();

      const dayDuties = scopedDutySlots
        .filter((slot) => {
          const slotDate = new Date(slot.date_assigned);
          slotDate.setHours(0, 0, 0, 0);
          return slotDate.getTime() === date.getTime();
        })
        .map((slot) => {
          const person = scopedPersonnel.find((p) => p.id === slot.personnel_id);
          const dutyType = dutyTypes.find((dt) => dt.id === slot.duty_type_id);
          return {
            person: person!,
            dutyType: dutyType?.duty_name || "Duty",
          };
        })
        .filter((d) => d.person);

      days.push({
        date,
        dayName: `${dayName} ${dayNum}`,
        duties: dayDuties,
      });
    }

    return days;
  }, [scopedDutySlots, scopedPersonnel, dutyTypes]);

  // Calculate fairness stats
  const fairnessStats = useMemo(() => {
    if (scopedPersonnel.length === 0) return { avg: 0, stdDev: 0, fairnessIndex: 0 };

    const scores = scopedPersonnel.map((p) => p.current_duty_score);
    const avg = scores.reduce((sum, s) => sum + s, 0) / scores.length;
    const variance = scores.reduce((sum, s) => sum + Math.pow(s - avg, 2), 0) / scores.length;
    const stdDev = Math.sqrt(variance);

    // Fairness index: 100% when stdDev is 0, decreases as stdDev increases
    const maxExpectedStdDev = 5; // Assume 5 points stdDev is "very unfair"
    const fairnessIndex = Math.max(0, Math.min(100, 100 - (stdDev / maxExpectedStdDev) * 100));

    return { avg, stdDev, fairnessIndex };
  }, [scopedPersonnel]);

  // Get top and bottom duty scores
  const dutyScoreExtremes = useMemo(() => {
    const sorted = [...scopedPersonnel].sort((a, b) => b.current_duty_score - a.current_duty_score);
    return {
      highest: sorted.slice(0, 3),
      lowest: sorted.slice(-3).reverse(),
    };
  }, [scopedPersonnel]);

  // Get upcoming duties table data
  const upcomingDuties = useMemo(() => {
    return scopedDutySlots
      .sort((a, b) => new Date(a.date_assigned).getTime() - new Date(b.date_assigned).getTime())
      .slice(0, 10)
      .map((slot) => {
        const person = scopedPersonnel.find((p) => p.id === slot.personnel_id);
        const dutyType = dutyTypes.find((dt) => dt.id === slot.duty_type_id);
        return {
          ...slot,
          person,
          dutyTypeName: dutyType?.duty_name || "Unknown",
        };
      });
  }, [scopedDutySlots, scopedPersonnel, dutyTypes]);

  // Handle approve/deny non-availability
  const handleApproveRequest = (naId: string, approved: boolean) => {
    updateNonAvailability(naId, {
      status: approved ? "approved" : "rejected",
      approved_by: user?.id || null,
    });
    fetchData(); // Refresh data
  };

  // Get person display name
  const getPersonName = (person: Personnel | undefined) => {
    if (!person) return "Unknown";
    return `${person.rank} ${person.last_name}`;
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  if (!managerRole) {
    return (
      <div className="space-y-6">
        <Card>
          <CardContent className="py-12 text-center">
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-warning/20 flex items-center justify-center">
              <svg className="w-8 h-8 text-warning" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
            <h2 className="text-xl font-semibold text-foreground mb-2">No Manager Role Assigned</h2>
            <p className="text-foreground-muted max-w-md mx-auto">
              You don&apos;t have a manager role assigned. Contact your administrator to get access.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-foreground">Manager Dashboard</h1>
        <p className="text-foreground-muted mt-1">
          {scopeUnit?.unit_name || "Your Unit"} &bull; {managerRole.role_name} &bull;{" "}
          {scopedPersonnel.length} personnel
        </p>
      </div>

      {/* Pending Actions */}
      {pendingRequests.length > 0 && (
        <Card className="border-warning/50">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-warning">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              Pending Actions ({pendingRequests.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {pendingRequests.slice(0, 5).map((request) => (
                <div
                  key={request.id}
                  className="flex items-center justify-between p-3 rounded-lg bg-surface-elevated"
                >
                  <div>
                    <p className="font-medium text-foreground">
                      {getPersonName(request.person)} - {request.reason}
                    </p>
                    <p className="text-sm text-foreground-muted">
                      {new Date(request.start_date).toLocaleDateString()} -{" "}
                      {new Date(request.end_date).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleApproveRequest(request.id, true)}
                      className="p-2 rounded-lg bg-success/20 text-success hover:bg-success/30 transition-colors"
                      title="Approve"
                    >
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                    </button>
                    <button
                      onClick={() => handleApproveRequest(request.id, false)}
                      className="p-2 rounded-lg bg-error/20 text-error hover:bg-error/30 transition-colors"
                      title="Deny"
                    >
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Top Row - Strength and Personnel On Duty */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Unit Strength */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <svg className="w-5 h-5 text-highlight" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
              Unit Strength
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-foreground-muted">Total</span>
                <span className="text-2xl font-bold text-foreground">{strengthStats.total}</span>
              </div>
              <div className="space-y-2 text-sm">
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-success" />
                    Available
                  </span>
                  <span className="text-foreground">
                    {strengthStats.available} ({strengthStats.availablePercent}%)
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-warning" />
                    Leave
                  </span>
                  <span className="text-foreground">{strengthStats.onLeave}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-primary" />
                    TAD
                  </span>
                  <span className="text-foreground">{strengthStats.onTAD}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-error" />
                    Medical
                  </span>
                  <span className="text-foreground">{strengthStats.medical}</span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* My Personnel On Duty */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <svg className="w-5 h-5 text-highlight" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              My Personnel On Duty
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {personnelOnDutyThisWeek.map((day) => (
                <div key={day.dayName} className="flex items-start gap-3 text-sm">
                  <span className="w-16 text-foreground-muted shrink-0">{day.dayName}</span>
                  <span className="text-foreground">
                    {day.duties.length > 0
                      ? day.duties.map((d, i) => (
                          <span key={i}>
                            {getPersonName(d.person)}{" "}
                            <span className="text-foreground-muted">({d.dutyType})</span>
                            {i < day.duties.length - 1 && ", "}
                          </span>
                        ))
                      : "—"}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Second Row - Fairness and Scores */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Fairness Snapshot */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <svg className="w-5 h-5 text-highlight" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 6l3 1m0 0l-3 9a5.002 5.002 0 006.001 0M6 7l3 9M6 7l6-2m6 2l3-1m-3 1l-3 9a5.002 5.002 0 006.001 0M18 7l3 9m-3-9l-6-2m0-2v2m0 16V5m0 16H9m3 0h3" />
              </svg>
              Fairness Snapshot
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="p-3 rounded-lg bg-surface-elevated">
                  <p className="text-xs text-foreground-muted">Unit Avg</p>
                  <p className="text-lg font-semibold text-foreground">
                    {fairnessStats.avg.toFixed(1)}
                  </p>
                </div>
                <div className="p-3 rounded-lg bg-surface-elevated">
                  <p className="text-xs text-foreground-muted">Std Dev</p>
                  <p className="text-lg font-semibold text-foreground">
                    {fairnessStats.stdDev.toFixed(1)}
                  </p>
                </div>
              </div>
              <div>
                <div className="flex items-center justify-between text-sm mb-1">
                  <span className="text-foreground-muted">Fairness Index</span>
                  <span className="text-highlight font-medium">
                    {Math.round(fairnessStats.fairnessIndex)}%
                  </span>
                </div>
                <div className="h-3 bg-surface-elevated rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-primary to-highlight rounded-full transition-all"
                    style={{ width: `${fairnessStats.fairnessIndex}%` }}
                  />
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Top/Bottom Duty Scores */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <svg className="w-5 h-5 text-highlight" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              Top/Bottom Duty Scores
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div>
                <p className="text-xs text-foreground-muted uppercase tracking-wide mb-2">
                  Highest (consider for next duty)
                </p>
                <div className="space-y-1">
                  {dutyScoreExtremes.highest.map((person) => (
                    <div key={person.id} className="flex items-center justify-between text-sm">
                      <span className="text-foreground">{getPersonName(person)}</span>
                      <span className="text-highlight font-medium">
                        {person.current_duty_score.toFixed(1)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="border-t border-border pt-4">
                <p className="text-xs text-foreground-muted uppercase tracking-wide mb-2">
                  Lowest (due soon)
                </p>
                <div className="space-y-1">
                  {dutyScoreExtremes.lowest.map((person) => (
                    <div key={person.id} className="flex items-center justify-between text-sm">
                      <span className="text-foreground">{getPersonName(person)}</span>
                      <span className="text-warning font-medium">
                        {person.current_duty_score.toFixed(1)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Upcoming Duties Table */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <svg className="w-5 h-5 text-highlight" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
            </svg>
            Upcoming Duties
            <span className="text-foreground-muted text-sm font-normal ml-2">(Next 14 Days)</span>
          </CardTitle>
          <CardDescription>
            Showing personnel from: {scopeUnit?.unit_name || "Your Unit"} ({scopedPersonnel.length}{" "}
            members)
          </CardDescription>
        </CardHeader>
        <CardContent>
          {upcomingDuties.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left py-3 px-4 text-sm font-medium text-foreground-muted">
                      Date
                    </th>
                    <th className="text-left py-3 px-4 text-sm font-medium text-foreground-muted">
                      Duty Type
                    </th>
                    <th className="text-left py-3 px-4 text-sm font-medium text-foreground-muted">
                      Assigned
                    </th>
                    <th className="text-left py-3 px-4 text-sm font-medium text-foreground-muted">
                      Status
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {upcomingDuties.map((duty) => (
                    <tr key={duty.id} className="border-b border-border hover:bg-surface-elevated">
                      <td className="py-3 px-4 text-foreground">
                        {new Date(duty.date_assigned).toLocaleDateString("en-US", {
                          weekday: "short",
                          month: "short",
                          day: "numeric",
                        })}
                      </td>
                      <td className="py-3 px-4 text-foreground">{duty.dutyTypeName}</td>
                      <td className="py-3 px-4 text-foreground">{getPersonName(duty.person)}</td>
                      <td className="py-3 px-4">
                        {duty.status === "scheduled" ? (
                          <span className="inline-flex items-center gap-1 text-success text-sm">
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                            </svg>
                            Confirmed
                          </span>
                        ) : duty.status === "completed" ? (
                          <span className="text-foreground-muted text-sm">Completed</span>
                        ) : (
                          <span className="text-warning text-sm">Pending</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="text-center py-8">
              <p className="text-foreground-muted">No upcoming duties scheduled for your personnel</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
