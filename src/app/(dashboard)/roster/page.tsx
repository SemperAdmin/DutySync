"use client";

import { useState, useEffect, useMemo } from "react";
import Button from "@/components/ui/Button";
import type { UnitSection, DutySlot, DutyType, Personnel } from "@/types";

interface EnrichedSlot extends DutySlot {
  duty_type: { id: string; duty_name: string; unit_section_id: string } | null;
  personnel: { id: string; first_name: string; last_name: string; rank: string } | null;
}

export default function RosterPage() {
  const [slots, setSlots] = useState<EnrichedSlot[]>([]);
  const [units, setUnits] = useState<UnitSection[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedUnit, setSelectedUnit] = useState("");
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedSlot, setSelectedSlot] = useState<EnrichedSlot | null>(null);

  // Get first and last day of the current month view (including surrounding days for calendar grid)
  const { startDate, endDate, calendarDays } = useMemo(() => {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();

    // First day of the month
    const firstDay = new Date(year, month, 1);
    // Last day of the month
    const lastDay = new Date(year, month + 1, 0);

    // Start from the Sunday of the first week
    const startDate = new Date(firstDay);
    startDate.setDate(startDate.getDate() - startDate.getDay());

    // End on the Saturday of the last week
    const endDate = new Date(lastDay);
    endDate.setDate(endDate.getDate() + (6 - endDate.getDay()));

    // Generate array of calendar days
    const days: Date[] = [];
    const current = new Date(startDate);
    while (current <= endDate) {
      days.push(new Date(current));
      current.setDate(current.getDate() + 1);
    }

    return { startDate, endDate, calendarDays: days };
  }, [currentDate]);

  useEffect(() => {
    fetchData();
  }, [selectedUnit, startDate, endDate]);

  async function fetchData() {
    try {
      setLoading(true);

      // Fetch units
      const unitsRes = await fetch("/api/units");
      if (unitsRes.ok) {
        const data = await unitsRes.json();
        setUnits(data.units || []);
      }

      // Fetch duty slots for the date range
      let url = `/api/duty-slots?start_date=${startDate.toISOString()}&end_date=${endDate.toISOString()}`;
      if (selectedUnit) {
        url += `&unit_id=${selectedUnit}`;
      }

      const slotsRes = await fetch(url);
      if (slotsRes.ok) {
        const data = await slotsRes.json();
        setSlots(data.slots || []);
      }
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

  function getSlotsForDate(date: Date): EnrichedSlot[] {
    const dateStr = date.toISOString().split("T")[0];
    return slots.filter((slot) => {
      const slotDateStr = new Date(slot.date_assigned).toISOString().split("T")[0];
      return slotDateStr === dateStr;
    });
  }

  function isToday(date: Date): boolean {
    const today = new Date();
    return date.toDateString() === today.toDateString();
  }

  function isCurrentMonth(date: Date): boolean {
    return date.getMonth() === currentDate.getMonth();
  }

  function isWeekend(date: Date): boolean {
    const day = date.getDay();
    return day === 0 || day === 6;
  }

  function formatMonthYear(date: Date): string {
    return date.toLocaleDateString("en-US", { month: "long", year: "numeric" });
  }

  function getStatusColor(status: string): string {
    switch (status) {
      case "completed":
        return "bg-green-500/20 text-green-400 border-green-500/30";
      case "cancelled":
        return "bg-red-500/20 text-red-400 border-red-500/30";
      default:
        return "bg-primary/20 text-primary border-primary/30";
    }
  }

  const weekDays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Duty Roster</h1>
          <p className="text-foreground-muted mt-1">
            View and manage duty assignments
          </p>
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

      {/* Calendar Grid */}
      <div className="bg-surface rounded-lg border border-border overflow-hidden">
        {/* Week Day Headers */}
        <div className="grid grid-cols-7 border-b border-border">
          {weekDays.map((day, idx) => (
            <div
              key={day}
              className={`py-3 text-center text-sm font-medium ${
                idx === 0 || idx === 6 ? "text-highlight" : "text-foreground"
              }`}
            >
              {day}
            </div>
          ))}
        </div>

        {/* Calendar Days */}
        {loading ? (
          <div className="flex items-center justify-center h-96">
            <div className="text-foreground-muted">Loading calendar...</div>
          </div>
        ) : (
          <div className="grid grid-cols-7">
            {calendarDays.map((date, idx) => {
              const daySlots = getSlotsForDate(date);
              const dateIsToday = isToday(date);
              const dateIsCurrentMonth = isCurrentMonth(date);
              const dateIsWeekend = isWeekend(date);

              return (
                <div
                  key={idx}
                  className={`min-h-[120px] border-b border-r border-border p-2 ${
                    !dateIsCurrentMonth ? "bg-background/50" : ""
                  } ${dateIsWeekend ? "bg-highlight/5" : ""}`}
                >
                  {/* Date Number */}
                  <div className="flex items-center justify-between mb-1">
                    <span
                      className={`text-sm font-medium ${
                        dateIsToday
                          ? "w-7 h-7 flex items-center justify-center rounded-full bg-primary text-white"
                          : dateIsCurrentMonth
                          ? dateIsWeekend
                            ? "text-highlight"
                            : "text-foreground"
                          : "text-foreground-muted"
                      }`}
                    >
                      {date.getDate()}
                    </span>
                    {daySlots.length > 0 && (
                      <span className="text-xs text-foreground-muted">
                        {daySlots.length} {daySlots.length === 1 ? "duty" : "duties"}
                      </span>
                    )}
                  </div>

                  {/* Duty Slots */}
                  <div className="space-y-1">
                    {daySlots.slice(0, 3).map((slot) => (
                      <button
                        key={slot.id}
                        onClick={() => setSelectedSlot(slot)}
                        className={`w-full text-left px-2 py-1 rounded text-xs truncate border transition-colors hover:brightness-110 ${getStatusColor(slot.status)}`}
                      >
                        <span className="font-medium">
                          {slot.duty_type?.duty_name || "Unknown"}
                        </span>
                        {slot.personnel && (
                          <span className="text-[10px] block opacity-80">
                            {slot.personnel.rank} {slot.personnel.last_name}
                          </span>
                        )}
                      </button>
                    ))}
                    {daySlots.length > 3 && (
                      <button
                        onClick={() => {
                          // Could open a modal showing all slots for this day
                          if (daySlots[3]) setSelectedSlot(daySlots[3]);
                        }}
                        className="text-xs text-foreground-muted hover:text-foreground"
                      >
                        +{daySlots.length - 3} more
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Legend */}
      <div className="flex items-center gap-6 text-sm">
        <div className="flex items-center gap-2">
          <span className="w-3 h-3 rounded bg-primary/20 border border-primary/30" />
          <span className="text-foreground-muted">Scheduled</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-3 h-3 rounded bg-green-500/20 border border-green-500/30" />
          <span className="text-foreground-muted">Completed</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-3 h-3 rounded bg-red-500/20 border border-red-500/30" />
          <span className="text-foreground-muted">Cancelled</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-3 h-3 rounded bg-highlight/10 border border-highlight/30" />
          <span className="text-foreground-muted">Weekend</span>
        </div>
      </div>

      {/* Stats Summary */}
      <div className="grid gap-4 md:grid-cols-4">
        <div className="bg-surface rounded-lg border border-border p-4">
          <div className="text-2xl font-bold text-foreground">{slots.length}</div>
          <div className="text-sm text-foreground-muted">Total Duties</div>
        </div>
        <div className="bg-surface rounded-lg border border-border p-4">
          <div className="text-2xl font-bold text-foreground">
            {slots.filter((s) => s.status === "scheduled").length}
          </div>
          <div className="text-sm text-foreground-muted">Scheduled</div>
        </div>
        <div className="bg-surface rounded-lg border border-border p-4">
          <div className="text-2xl font-bold text-green-400">
            {slots.filter((s) => s.status === "completed").length}
          </div>
          <div className="text-sm text-foreground-muted">Completed</div>
        </div>
        <div className="bg-surface rounded-lg border border-border p-4">
          <div className="text-2xl font-bold text-red-400">
            {slots.filter((s) => s.status === "cancelled").length}
          </div>
          <div className="text-sm text-foreground-muted">Cancelled</div>
        </div>
      </div>

      {/* Slot Detail Modal */}
      {selectedSlot && (
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
    </div>
  );
}
