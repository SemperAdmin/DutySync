"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import Card, {
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/Card";
import { useAuth } from "@/lib/supabase-auth";
import { useSyncRefresh } from "@/hooks/useSync";
import type { Personnel, DutySlot, NonAvailability, UnitSection, DutyType, SwapPair } from "@/types";
import {
  getAllPersonnel,
  getPersonnelByEdipi,
  getDutySlotsByDateRange,
  getNonAvailabilityByPersonnel,
  getUnitSections,
  getAllDutyTypes,
} from "@/lib/data-layer";
import { calculateDutyScoreFromSlots, getSwapPairsByPersonnel, getAllDutySlots } from "@/lib/client-stores";
import { MAX_DUTY_SCORE } from "@/lib/constants";
import { getTodayString, addDaysToDateString } from "@/lib/date-utils";

interface DutyHistoryEntry {
  id: string;
  date: Date;
  dutyType: string;
  duration: string;
  points: number;
}

export default function UserDashboard() {
  const { user } = useAuth();
  const [personnel, setPersonnel] = useState<Personnel | null>(null);
  const [allPersonnel, setAllPersonnel] = useState<Personnel[]>([]);
  const [upcomingDuties, setUpcomingDuties] = useState<DutySlot[]>([]);
  const [pastDuties, setPastDuties] = useState<DutySlot[]>([]);
  const [nonAvailability, setNonAvailability] = useState<NonAvailability[]>([]);
  const [swapPairs, setSwapPairs] = useState<SwapPair[]>([]);
  const [allDutySlots, setAllDutySlots] = useState<DutySlot[]>([]);
  const [units, setUnits] = useState<UnitSection[]>([]);
  const [dutyTypes, setDutyTypes] = useState<DutyType[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(() => {
    try {
      setError(null);
      // Get current user's personnel record
      const myPersonnel = user?.edipi ? getPersonnelByEdipi(user.edipi) : null;
      setPersonnel(myPersonnel || null);

      // Get all personnel for unit comparisons
      const allPers = getAllPersonnel();
      setAllPersonnel(allPers);

      // Get units for hierarchy display
      const unitsData = getUnitSections();
      setUnits(unitsData);

      // Get duty types for names
      const dutyTypesData = getAllDutyTypes();
      setDutyTypes(dutyTypesData);

      if (myPersonnel) {
        // Get upcoming duties (next 90 days)
        // Include both "scheduled" and "approved" statuses for upcoming duties
        const today = getTodayString();
        const futureDate = addDaysToDateString(today, 90);
        const upcoming = getDutySlotsByDateRange(today, futureDate).filter(
          (slot) => slot.personnel_id === myPersonnel.id &&
            (slot.status === "scheduled" || slot.status === "approved")
        );
        setUpcomingDuties(upcoming);

        // Get past duties (last 90 days)
        const pastDate = addDaysToDateString(today, -90);
        const past = getDutySlotsByDateRange(pastDate, today).filter(
          (slot) => slot.personnel_id === myPersonnel.id && slot.status === "completed"
        );
        setPastDuties(past);

        // Get non-availability records
        const na = getNonAvailabilityByPersonnel(myPersonnel.id);
        setNonAvailability(na);

        // Get swap pairs involving this personnel
        const pairs = getSwapPairsByPersonnel(myPersonnel.id);
        setSwapPairs(pairs);

        // Get all duty slots for date lookups
        const dutySlots = getAllDutySlots();
        setAllDutySlots(dutySlots);
      }
    } catch (err) {
      console.error("Error loading dashboard data:", err);
      setError("Failed to load dashboard data. Please refresh the page.");
    } finally {
      setIsLoading(false);
    }
  }, [user?.edipi]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Auto-refresh when personnel or duty slots change (e.g., after roster approval)
  useSyncRefresh(["personnel", "dutySlots"], fetchData);

  // Calculate duty score from duty_slots (approved/swapped only)
  // This gives accurate score based on current organization's data
  const myDutyScore = useMemo(() => {
    if (!personnel) return 0;
    return calculateDutyScoreFromSlots(personnel.id);
  }, [personnel]);

  // Calculate unit statistics using calculated scores from duty_slots
  const unitStats = useMemo(() => {
    if (!personnel) return { unitAvg: 0, rank: 0, total: 0 };

    // Get all personnel in the same unit
    const unitPersonnel = allPersonnel.filter(
      (p) => p.unit_section_id === personnel.unit_section_id
    );

    if (unitPersonnel.length === 0) return { unitAvg: 0, rank: 0, total: 0 };

    // Calculate scores for each personnel from duty_slots
    const personnelWithScores = unitPersonnel.map(p => ({
      ...p,
      calculatedScore: calculateDutyScoreFromSlots(p.id)
    }));

    // Calculate average
    const totalScore = personnelWithScores.reduce((sum, p) => sum + p.calculatedScore, 0);
    const unitAvg = totalScore / personnelWithScores.length;

    // Calculate rank (sorted by calculated score descending)
    const sorted = [...personnelWithScores].sort((a, b) => b.calculatedScore - a.calculatedScore);
    const rank = sorted.findIndex((p) => p.id === personnel.id) + 1;

    return { unitAvg, rank, total: unitPersonnel.length };
  }, [personnel, allPersonnel]);

  // Create a Map of units for O(1) lookups (memoized separately from unitPath)
  const unitMap = useMemo(() => new Map(units.map(u => [u.id, u])), [units]);

  // Create a Map of duty types for O(1) lookups
  const dutyTypeMap = useMemo(() => new Map(dutyTypes.map(dt => [dt.id, dt])), [dutyTypes]);

  // Get duty type name by ID - O(1) lookup with useCallback
  const getDutyTypeName = useCallback((dutyTypeId: string): string => {
    const dt = dutyTypeMap.get(dutyTypeId);
    return dt?.duty_name || "Unknown Duty";
  }, [dutyTypeMap]);

  // Build unit hierarchy path
  const unitPath = useMemo(() => {
    if (!personnel) return "";

    const path: string[] = [];
    let currentUnit = unitMap.get(personnel.unit_section_id);

    while (currentUnit) {
      if (currentUnit.hierarchy_level !== "ruc") {
        path.unshift(currentUnit.unit_name);
      }
      currentUnit = currentUnit.parent_id
        ? unitMap.get(currentUnit.parent_id)
        : undefined;
    }

    return path.join(" > ");
  }, [personnel, unitMap]);

  // Get next duty
  const nextDuty = upcomingDuties.length > 0 ? upcomingDuties[0] : null;

  // Calculate days until next duty
  const daysUntilNextDuty = nextDuty
    ? Math.ceil(
        (new Date(nextDuty.date_assigned).getTime() - new Date().getTime()) /
          (1000 * 60 * 60 * 24)
      )
    : null;

  // Create a personnel map for O(1) lookups
  const personnelMap = useMemo(() => new Map(allPersonnel.map(p => [p.id, p])), [allPersonnel]);

  // Find previous and next duty personnel (for the same duty type on adjacent days)
  const adjacentDutyInfo = useMemo(() => {
    if (!nextDuty) return { previous: null, following: null };

    const dutyDate = nextDuty.date_assigned;
    const dutyTypeId = nextDuty.duty_type_id;

    // Calculate previous and following dates
    const prevDate = addDaysToDateString(dutyDate as string, -1);
    const followDate = addDaysToDateString(dutyDate as string, 1);

    // Find slots for same duty type on adjacent days
    const prevSlot = allDutySlots.find(
      (s) => s.date_assigned === prevDate && s.duty_type_id === dutyTypeId && s.personnel_id
    );
    const followSlot = allDutySlots.find(
      (s) => s.date_assigned === followDate && s.duty_type_id === dutyTypeId && s.personnel_id
    );

    // Get personnel info
    const prevPerson = prevSlot?.personnel_id ? personnelMap.get(prevSlot.personnel_id) : null;
    const followPerson = followSlot?.personnel_id ? personnelMap.get(followSlot.personnel_id) : null;

    // Get unit info for each person
    const prevUnit = prevPerson ? unitMap.get(prevPerson.unit_section_id) : null;
    const followUnit = followPerson ? unitMap.get(followPerson.unit_section_id) : null;

    return {
      previous: prevPerson ? {
        rank: prevPerson.rank,
        name: `${prevPerson.last_name}, ${prevPerson.first_name}`,
        phone: prevPerson.phone_number,
        unit: prevUnit?.unit_name || "Unknown",
      } : null,
      following: followPerson ? {
        rank: followPerson.rank,
        name: `${followPerson.last_name}, ${followPerson.first_name}`,
        phone: followPerson.phone_number,
        unit: followUnit?.unit_name || "Unknown",
      } : null,
    };
  }, [nextDuty, allDutySlots, personnelMap, unitMap]);

  // Get current and upcoming non-availability with efficient Date handling
  const now = new Date();

  // Get current non-availability status
  const currentNA = nonAvailability.find((na) => {
    const start = new Date(na.start_date);
    const end = new Date(na.end_date);
    return now >= start && now <= end && na.status === "approved";
  });

  // Get upcoming approved non-availability
  const upcomingNA = nonAvailability.filter((na) => {
    const start = new Date(na.start_date);
    return start > now && na.status === "approved";
  });

  // Get pending non-availability requests
  const pendingNA = nonAvailability.filter((na) => na.status === "pending");

  // Get pending duty swap requests (where the user is involved)
  const pendingSwaps = swapPairs.filter((pair) => pair.status === "pending");

  // Create a slot map for O(1) lookups
  const slotMap = useMemo(() => new Map(allDutySlots.map(s => [s.id, s])), [allDutySlots]);

  // Build duty history
  const dutyHistory: DutyHistoryEntry[] = pastDuties
    .sort((a, b) => new Date(b.date_assigned).getTime() - new Date(a.date_assigned).getTime())
    .slice(0, 10)
    .map((slot) => ({
      id: slot.id,
      date: new Date(slot.date_assigned),
      dutyType: getDutyTypeName(slot.duty_type_id),
      duration: "24hr",
      points: slot.points ?? 0,
    }));

  // Calculate total points in last 90 days
  const totalPointsLast90Days = pastDuties.reduce(
    (sum, slot) => sum + (slot.points ?? 0),
    0
  );

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

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-foreground">My Dashboard</h1>
        <p className="text-foreground-muted mt-1">
          Welcome back, {user?.displayName || user?.email || "Service Member"}
        </p>
      </div>

      {/* Top Row - Score and Next Duty */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* My Duty Score Card */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <svg className="w-5 h-5 text-highlight" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
              My Duty Score
            </CardTitle>
          </CardHeader>
          <CardContent>
            {personnel ? (
              <div className="space-y-4">
                {/* Score Bar */}
                <div className="flex items-center gap-4">
                  <div className="flex-1">
                    <div className="h-3 bg-surface-elevated rounded-full overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-primary to-highlight rounded-full transition-all"
                        style={{ width: `${Math.min(100, (myDutyScore / MAX_DUTY_SCORE) * 100)}%` }}
                      />
                    </div>
                  </div>
                  <span className="text-2xl font-bold text-highlight">
                    {myDutyScore.toFixed(1)}
                  </span>
                </div>

                {/* Stats */}
                <div className="grid grid-cols-2 gap-4 pt-2">
                  <div className="p-3 rounded-lg bg-surface-elevated">
                    <p className="text-xs text-foreground-muted">Unit Average</p>
                    <p className="text-lg font-semibold text-foreground">
                      {unitStats.unitAvg.toFixed(1)}
                    </p>
                  </div>
                  <div className="p-3 rounded-lg bg-surface-elevated">
                    <p className="text-xs text-foreground-muted">Your Rank</p>
                    <p className="text-lg font-semibold text-foreground">
                      {unitStats.rank} of {unitStats.total}
                    </p>
                  </div>
                </div>
              </div>
            ) : (
              <p className="text-foreground-muted text-center py-4">
                No personnel record linked to your account
              </p>
            )}
          </CardContent>
        </Card>

        {/* Next Duty Card */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <svg className="w-5 h-5 text-highlight" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              Next Duty
            </CardTitle>
          </CardHeader>
          <CardContent>
            {nextDuty ? (
              <div className="space-y-3">
                <div className="p-4 rounded-lg bg-primary/10 border border-primary/20">
                  <p className="text-lg font-semibold text-foreground">
                    {getDutyTypeName(nextDuty.duty_type_id)}
                  </p>
                  <p className="text-foreground-muted mt-1">
                    {new Date(nextDuty.date_assigned).toLocaleDateString("en-US", {
                      weekday: "long",
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}
                  </p>
                  <p className="text-sm text-foreground-muted">0600 - 0600 (24hr)</p>
                </div>

                {/* Adjacent Duty Personnel */}
                <div className="grid grid-cols-2 gap-3">
                  {/* Previous Day */}
                  <div className="p-3 rounded-lg bg-surface-elevated">
                    <p className="text-xs text-foreground-muted uppercase tracking-wide mb-1">Duty Before</p>
                    {adjacentDutyInfo.previous ? (
                      <div className="space-y-0.5">
                        <p className="text-sm font-medium text-foreground">
                          {adjacentDutyInfo.previous.rank} {adjacentDutyInfo.previous.name}
                        </p>
                        <p className="text-xs text-foreground-muted">{adjacentDutyInfo.previous.unit}</p>
                        {adjacentDutyInfo.previous.phone && (
                          <p className="text-xs text-primary">
                            <a href={`tel:${adjacentDutyInfo.previous.phone}`}>
                              {adjacentDutyInfo.previous.phone}
                            </a>
                          </p>
                        )}
                      </div>
                    ) : (
                      <p className="text-sm text-foreground-muted">Not assigned</p>
                    )}
                  </div>

                  {/* Following Day */}
                  <div className="p-3 rounded-lg bg-surface-elevated">
                    <p className="text-xs text-foreground-muted uppercase tracking-wide mb-1">Duty After</p>
                    {adjacentDutyInfo.following ? (
                      <div className="space-y-0.5">
                        <p className="text-sm font-medium text-foreground">
                          {adjacentDutyInfo.following.rank} {adjacentDutyInfo.following.name}
                        </p>
                        <p className="text-xs text-foreground-muted">{adjacentDutyInfo.following.unit}</p>
                        {adjacentDutyInfo.following.phone && (
                          <p className="text-xs text-primary">
                            <a href={`tel:${adjacentDutyInfo.following.phone}`}>
                              {adjacentDutyInfo.following.phone}
                            </a>
                          </p>
                        )}
                      </div>
                    ) : (
                      <p className="text-sm text-foreground-muted">Not assigned</p>
                    )}
                  </div>
                </div>

                {daysUntilNextDuty !== null && (
                  <div className="text-center">
                    <span className="text-3xl font-bold text-highlight">{daysUntilNextDuty}</span>
                    <span className="text-foreground-muted ml-2">
                      day{daysUntilNextDuty !== 1 ? "s" : ""} away
                    </span>
                  </div>
                )}
              </div>
            ) : (
              <div className="text-center py-6">
                <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-success/20 flex items-center justify-center">
                  <svg className="w-6 h-6 text-success" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <p className="text-foreground-muted">No upcoming duties scheduled</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Second Row - Status and Unit */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* My Status Card */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <svg className="w-5 h-5 text-highlight" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              My Status
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {/* Current Status */}
              <div className="flex items-center gap-3">
                {currentNA ? (
                  <>
                    <div className="w-3 h-3 rounded-full bg-warning animate-pulse" />
                    <div>
                      <p className="font-medium text-warning">{currentNA.reason}</p>
                      <p className="text-sm text-foreground-muted">
                        Until {new Date(currentNA.end_date).toLocaleDateString()}
                      </p>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="w-3 h-3 rounded-full bg-success" />
                    <p className="font-medium text-success">Available for Duty</p>
                  </>
                )}
              </div>

              {/* Upcoming Non-Availability */}
              {upcomingNA.length > 0 && (
                <div className="pt-3 border-t border-border">
                  <p className="text-xs text-foreground-muted uppercase tracking-wide mb-2">
                    Scheduled
                  </p>
                  <div className="space-y-2">
                    {upcomingNA.slice(0, 2).map((na) => (
                      <div
                        key={na.id}
                        className="flex justify-between text-sm p-2 rounded bg-surface-elevated"
                      >
                        <span className="text-foreground">{na.reason}</span>
                        <span className="text-foreground-muted">
                          {new Date(na.start_date).toLocaleDateString("en-US", {
                            month: "short",
                            day: "numeric",
                          })}
                          {" - "}
                          {new Date(na.end_date).toLocaleDateString("en-US", {
                            month: "short",
                            day: "numeric",
                          })}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {!currentNA && upcomingNA.length === 0 && (
                <p className="text-sm text-foreground-muted">No leave or TAD scheduled</p>
              )}
            </div>
          </CardContent>
        </Card>

        {/* My Unit Card */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <svg className="w-5 h-5 text-highlight" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
              </svg>
              My Unit
            </CardTitle>
          </CardHeader>
          <CardContent>
            {personnel ? (
              <div className="space-y-4">
                {/* Unit Hierarchy Path */}
                <div className="p-4 rounded-lg bg-surface-elevated">
                  <p className="text-sm text-foreground-muted mb-1">Assignment</p>
                  <p className="font-medium text-foreground">{unitPath || "Unknown"}</p>
                </div>

                {/* Quick Stats */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="p-3 rounded-lg bg-surface-elevated text-center">
                    <p className="text-2xl font-bold text-highlight">
                      {unitStats.total}
                    </p>
                    <p className="text-xs text-foreground-muted">In Section</p>
                  </div>
                  <div className="p-3 rounded-lg bg-surface-elevated text-center">
                    <p className="text-2xl font-bold text-highlight">
                      {upcomingDuties.length}
                    </p>
                    <p className="text-xs text-foreground-muted">Duties Ahead</p>
                  </div>
                </div>
              </div>
            ) : (
              <p className="text-foreground-muted text-center py-4">
                No unit assignment found
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Pending Requests - Show only if there are pending NA or duty swaps */}
      {(pendingNA.length > 0 || pendingSwaps.length > 0) && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <svg className="w-5 h-5 text-warning" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              Pending Requests
              <span className="ml-2 px-2 py-0.5 text-xs font-medium rounded-full bg-warning/20 text-warning">
                {pendingNA.length + pendingSwaps.length}
              </span>
            </CardTitle>
            <CardDescription>Requests awaiting approval</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {/* Pending Non-Availability Requests */}
              {pendingNA.length > 0 && (
                <div>
                  <p className="text-xs text-foreground-muted uppercase tracking-wide mb-2">
                    Non-Availability Requests
                  </p>
                  <div className="space-y-2">
                    {pendingNA.map((na) => (
                      <div
                        key={na.id}
                        className="flex justify-between items-center p-3 rounded-lg bg-surface-elevated border border-warning/20"
                      >
                        <div>
                          <p className="font-medium text-foreground">{na.reason}</p>
                          <p className="text-sm text-foreground-muted">
                            {new Date(na.start_date).toLocaleDateString("en-US", {
                              month: "short",
                              day: "numeric",
                            })}
                            {" - "}
                            {new Date(na.end_date).toLocaleDateString("en-US", {
                              month: "short",
                              day: "numeric",
                            })}
                          </p>
                        </div>
                        <span className="px-2 py-1 text-xs font-medium rounded-full bg-warning/20 text-warning">
                          Pending
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Pending Duty Swap Requests */}
              {pendingSwaps.length > 0 && (
                <div>
                  <p className="text-xs text-foreground-muted uppercase tracking-wide mb-2">
                    Duty Swap Requests
                  </p>
                  <div className="space-y-2">
                    {pendingSwaps.map((pair) => {
                      const personASlot = slotMap.get(pair.personA.giving_slot_id);
                      const personBSlot = slotMap.get(pair.personB.giving_slot_id);
                      const personA = personnelMap.get(pair.personA.personnel_id);
                      const personB = personnelMap.get(pair.personB.personnel_id);
                      // Determine if current user is personA or personB
                      const isPersonA = personnel?.id === pair.personA.personnel_id;
                      const partner = isPersonA ? personB : personA;

                      return (
                        <div
                          key={pair.swap_pair_id}
                          className="flex justify-between items-center p-3 rounded-lg bg-surface-elevated border border-warning/20"
                        >
                          <div>
                            <p className="font-medium text-foreground">
                              Swap with {partner?.rank} {partner?.last_name}
                            </p>
                            <p className="text-sm text-foreground-muted">
                              {personASlot?.date_assigned
                                ? new Date(personASlot.date_assigned).toLocaleDateString("en-US", {
                                    weekday: "short",
                                    month: "short",
                                    day: "numeric",
                                  })
                                : "Unknown date"}
                              {personBSlot?.date_assigned && (
                                <>
                                  {" ↔ "}
                                  {new Date(personBSlot.date_assigned).toLocaleDateString("en-US", {
                                    weekday: "short",
                                    month: "short",
                                    day: "numeric",
                                  })}
                                </>
                              )}
                            </p>
                          </div>
                          <span className="px-2 py-1 text-xs font-medium rounded-full bg-warning/20 text-warning">
                            Pending
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Duty History Table */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <svg className="w-5 h-5 text-highlight" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
            </svg>
            My Duty History
            <span className="text-foreground-muted text-sm font-normal ml-2">(Last 90 Days)</span>
          </CardTitle>
          <CardDescription>
            Total Points (90 days): <span className="font-semibold text-highlight">{totalPointsLast90Days.toFixed(1)}</span>
          </CardDescription>
        </CardHeader>
        <CardContent>
          {dutyHistory.length > 0 ? (
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
                      Duration
                    </th>
                    <th className="text-right py-3 px-4 text-sm font-medium text-foreground-muted">
                      Points
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {dutyHistory.map((entry) => (
                    <tr key={entry.id} className="border-b border-border hover:bg-surface-elevated">
                      <td className="py-3 px-4 text-foreground">
                        {entry.date.toLocaleDateString("en-US", {
                          month: "short",
                          day: "numeric",
                        })}
                      </td>
                      <td className="py-3 px-4 text-foreground">{entry.dutyType}</td>
                      <td className="py-3 px-4 text-foreground-muted">{entry.duration}</td>
                      <td className="py-3 px-4 text-right">
                        <span className="text-highlight font-medium">+{entry.points.toFixed(1)}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="text-center py-8">
              <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-surface-elevated flex items-center justify-center">
                <svg className="w-6 h-6 text-foreground-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                </svg>
              </div>
              <p className="text-foreground-muted">No duty history in the last 90 days</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
