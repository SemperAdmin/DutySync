"use client";

import type { Personnel, NonAvailability } from "@/types";

interface ExemptionWithPersonnel extends NonAvailability {
  personnel?: Personnel;
}

interface PersonnelExemptionsDisplayProps {
  exemptions: ExemptionWithPersonnel[];
  title?: string;
  description?: string;
}

/**
 * Displays a list of personnel exemptions (non-availability records).
 * Used in duty type forms to show active/upcoming exemptions for a unit.
 */
export default function PersonnelExemptionsDisplay({
  exemptions,
  title = "Active/Upcoming Exemptions",
  description = "Personnel in this unit with non-availability",
}: PersonnelExemptionsDisplayProps) {
  if (exemptions.length === 0) return null;

  return (
    <div className="border-t border-border pt-4">
      <h3 className="text-sm font-medium text-foreground mb-2">
        {title} ({exemptions.length})
      </h3>
      <p className="text-xs text-foreground-muted mb-3">{description}</p>
      <div className="max-h-40 overflow-y-auto space-y-2 bg-surface-elevated rounded-lg p-2">
        {exemptions.map((exemption) => (
          <div
            key={exemption.id}
            className="flex items-center justify-between text-xs p-2 bg-background rounded border border-border"
          >
            <div className="flex items-center gap-2">
              <span
                className={`px-1.5 py-0.5 rounded-full text-xs font-medium ${
                  exemption.status === "approved"
                    ? "bg-green-500/20 text-green-400"
                    : exemption.status === "recommended"
                    ? "bg-blue-500/20 text-blue-400"
                    : "bg-yellow-500/20 text-yellow-400"
                }`}
              >
                {exemption.status}
              </span>
              <span className="font-medium text-foreground">
                {exemption.personnel?.rank} {exemption.personnel?.last_name},{" "}
                {exemption.personnel?.first_name}
              </span>
            </div>
            <div className="text-foreground-muted">
              {exemption.start_date} - {exemption.end_date}
              {exemption.reason && (
                <span className="ml-2 italic">({exemption.reason})</span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
