"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import Card, { CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/Card";
import { useAuth } from "@/lib/client-auth";
import type { DutyType, DutySlot, UnitSection, Personnel } from "@/types";
import {
  getAllDutyTypes,
  getUnitSections,
  getPersonnelByEdipi,
  getDutySlotsByDateRange,
  getAllPersonnel,
} from "@/lib/client-stores";

export default function TaskManagerPage() {
  const { user } = useAuth();
  const [dutyTypes, setDutyTypes] = useState<DutyType[]>([]);
  const [upcomingSlots, setUpcomingSlots] = useState<DutySlot[]>([]);
  const [units, setUnits] = useState<UnitSection[]>([]);
  const [personnel, setPersonnel] = useState<Personnel | null>(null);
  const [allPersonnel, setAllPersonnel] = useState<Personnel[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const fetchData = useCallback(() => {
    try {
      // Get current user's personnel record
      const myPersonnel = user?.edipi ? getPersonnelByEdipi(user.edipi) : null;
      setPersonnel(myPersonnel || null);

      // Get all data
      const allUnits = getUnitSections();
      setUnits(allUnits);

      const allDutyTypes = getAllDutyTypes();
      const allPers = getAllPersonnel();
      setAllPersonnel(allPers);

      if (myPersonnel) {
        const userSectionId = myPersonnel.unit_section_id;

        // Build hierarchy set (ancestors + descendants)
        const hierarchyUnitIds = new Set<string>();
        hierarchyUnitIds.add(userSectionId);

        // Find ancestors
        let currentUnit = allUnits.find(u => u.id === userSectionId);
        while (currentUnit?.parent_id) {
          hierarchyUnitIds.add(currentUnit.parent_id);
          currentUnit = allUnits.find(u => u.id === currentUnit?.parent_id);
        }

        // Find descendants
        const findDescendants = (parentId: string) => {
          const children = allUnits.filter(u => u.parent_id === parentId);
          for (const child of children) {
            hierarchyUnitIds.add(child.id);
            findDescendants(child.id);
          }
        };
        findDescendants(userSectionId);

        // Filter duty types to those in user's hierarchy
        const sectionDutyTypes = allDutyTypes.filter(dt =>
          dt.is_active && hierarchyUnitIds.has(dt.unit_section_id)
        );
        setDutyTypes(sectionDutyTypes);

        // Get upcoming duty slots for user's section's duty types
        const today = new Date();
        const futureDate = new Date();
        futureDate.setDate(today.getDate() + 30);

        const slots = getDutySlotsByDateRange(today, futureDate);
        const sectionSlots = slots.filter(slot =>
          sectionDutyTypes.some(dt => dt.id === slot.duty_type_id)
        );
        setUpcomingSlots(sectionSlots);
      }
    } catch (err) {
      console.error("Error loading task manager data:", err);
    } finally {
      setIsLoading(false);
    }
  }, [user?.edipi]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Create lookup maps
  const dutyTypeMap = useMemo(() => new Map(dutyTypes.map(dt => [dt.id, dt])), [dutyTypes]);
  const unitMap = useMemo(() => new Map(units.map(u => [u.id, u])), [units]);
  const personnelMap = useMemo(() => new Map(allPersonnel.map(p => [p.id, p])), [allPersonnel]);

  // Build unit path
  const buildUnitPath = useCallback((unitId: string): string => {
    const path: string[] = [];
    let current = unitMap.get(unitId);
    while (current) {
      if (current.hierarchy_level !== "ruc") {
        path.unshift(current.unit_name);
      }
      current = current.parent_id ? unitMap.get(current.parent_id) : undefined;
    }
    return path.join(" > ");
  }, [unitMap]);

  // Get user's unit path
  const userUnitPath = useMemo(() => {
    if (!personnel?.unit_section_id) return "Unknown";
    return buildUnitPath(personnel.unit_section_id) || "Unknown";
  }, [personnel?.unit_section_id, buildUnitPath]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  if (!personnel) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Task Manager</h1>
          <p className="text-foreground-muted mt-1">View duty types and tasks for your unit</p>
        </div>
        <Card>
          <CardContent className="py-8">
            <div className="text-center text-foreground-muted">
              <p>No personnel record found for your account.</p>
              <p className="text-sm mt-2">Please contact your administrator to link your account.</p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-foreground">Task Manager</h1>
        <p className="text-foreground-muted mt-1">
          Duty types and tasks for {userUnitPath}
        </p>
      </div>

      {/* Duty Types Grid */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <svg className="w-5 h-5 text-highlight" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
            </svg>
            Duty Types
            <span className="text-foreground-muted text-sm font-normal">({dutyTypes.length})</span>
          </CardTitle>
          <CardDescription>Active duty types configured for your unit hierarchy</CardDescription>
        </CardHeader>
        <CardContent>
          {dutyTypes.length === 0 ? (
            <div className="text-center py-8">
              <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-surface-elevated flex items-center justify-center">
                <svg className="w-6 h-6 text-foreground-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                </svg>
              </div>
              <p className="text-foreground-muted">No duty types configured for your unit</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {dutyTypes.map((dt) => (
                <div
                  key={dt.id}
                  className="p-4 rounded-lg bg-surface-elevated border border-border hover:border-primary/50 transition-colors"
                >
                  <h3 className="font-medium text-foreground">{dt.duty_name}</h3>
                  {dt.description && (
                    <p className="text-sm text-foreground-muted mt-1">{dt.description}</p>
                  )}
                  <div className="flex items-center gap-4 mt-3 text-xs text-foreground-muted">
                    <span className="flex items-center gap-1">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
                      </svg>
                      {dt.slots_needed} slot{dt.slots_needed !== 1 ? "s" : ""}
                    </span>
                    <span className="text-foreground-muted/70">
                      {buildUnitPath(dt.unit_section_id)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Upcoming Duties */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <svg className="w-5 h-5 text-highlight" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            Upcoming Assignments
            <span className="text-foreground-muted text-sm font-normal">(Next 30 Days)</span>
          </CardTitle>
          <CardDescription>Scheduled duty assignments for your unit</CardDescription>
        </CardHeader>
        <CardContent>
          {upcomingSlots.length === 0 ? (
            <div className="text-center py-8">
              <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-success/20 flex items-center justify-center">
                <svg className="w-6 h-6 text-success" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <p className="text-foreground-muted">No upcoming duty assignments</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left py-3 px-4 text-sm font-medium text-foreground-muted">Date</th>
                    <th className="text-left py-3 px-4 text-sm font-medium text-foreground-muted">Duty Type</th>
                    <th className="text-left py-3 px-4 text-sm font-medium text-foreground-muted">Assigned To</th>
                    <th className="text-left py-3 px-4 text-sm font-medium text-foreground-muted">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {upcomingSlots
                    .sort((a, b) => new Date(a.date_assigned).getTime() - new Date(b.date_assigned).getTime())
                    .slice(0, 20)
                    .map((slot) => {
                      const dutyType = dutyTypeMap.get(slot.duty_type_id);
                      const assignedPerson = personnelMap.get(slot.personnel_id);
                      const isMe = personnel.id === slot.personnel_id;

                      return (
                        <tr key={slot.id} className={`border-b border-border hover:bg-surface-elevated ${isMe ? "bg-primary/5" : ""}`}>
                          <td className="py-3 px-4 text-foreground">
                            {new Date(slot.date_assigned).toLocaleDateString("en-US", {
                              weekday: "short",
                              month: "short",
                              day: "numeric",
                            })}
                          </td>
                          <td className="py-3 px-4 text-foreground">
                            {dutyType?.duty_name || "Unknown"}
                          </td>
                          <td className="py-3 px-4">
                            {assignedPerson ? (
                              <span className={`font-medium ${isMe ? "text-primary" : "text-foreground"}`}>
                                {assignedPerson.rank} {assignedPerson.last_name}
                                {isMe && <span className="ml-2 text-xs text-primary">(You)</span>}
                              </span>
                            ) : (
                              <span className="text-foreground-muted italic">Unassigned</span>
                            )}
                          </td>
                          <td className="py-3 px-4">
                            <span className={`px-2 py-1 text-xs font-medium rounded-full ${
                              slot.status === "scheduled"
                                ? "bg-primary/20 text-primary"
                                : slot.status === "completed"
                                ? "bg-success/20 text-success"
                                : "bg-foreground-muted/20 text-foreground-muted"
                            }`}>
                              {slot.status.charAt(0).toUpperCase() + slot.status.slice(1)}
                            </span>
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
