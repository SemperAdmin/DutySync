import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import {
  getDutySlotsByDateRange,
  getDutyTypeById,
  getPersonnelById,
  getUnitSectionById,
} from "@/lib/stores";

// GET export duty roster as CSV
export async function GET(request: NextRequest) {
  try {
    const session = await auth();

    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const startDate = searchParams.get("start_date");
    const endDate = searchParams.get("end_date");
    const unitId = searchParams.get("unit_id");
    const format = searchParams.get("format") || "csv";

    if (!startDate || !endDate) {
      return NextResponse.json(
        { error: "start_date and end_date are required" },
        { status: 400 }
      );
    }

    // Get duty slots
    let slots = getDutySlotsByDateRange(new Date(startDate), new Date(endDate));

    // Filter by unit if specified
    if (unitId) {
      slots = slots.filter((slot) => {
        const dutyType = getDutyTypeById(slot.duty_type_id);
        return dutyType?.unit_section_id === unitId;
      });
    }

    // Sort by date
    slots.sort(
      (a, b) =>
        new Date(a.date_assigned).getTime() - new Date(b.date_assigned).getTime()
    );

    // Enrich slots with related data
    const enrichedSlots = slots.map((slot) => {
      const dutyType = getDutyTypeById(slot.duty_type_id);
      const personnel = getPersonnelById(slot.personnel_id);
      const unit = dutyType ? getUnitSectionById(dutyType.unit_section_id) : null;

      return {
        date: new Date(slot.date_assigned).toISOString().split("T")[0],
        day_of_week: new Date(slot.date_assigned).toLocaleDateString("en-US", {
          weekday: "long",
        }),
        duty_type: dutyType?.duty_name || "Unknown",
        unit: unit?.unit_name || "Unknown",
        rank: personnel?.rank || "",
        last_name: personnel?.last_name || "",
        first_name: personnel?.first_name || "",
        service_id: personnel?.service_id || "",
        points: slot.duty_points_earned,
        status: slot.status,
      };
    });

    if (format === "csv") {
      // Generate CSV
      const headers = [
        "Date",
        "Day",
        "Duty Type",
        "Unit",
        "Rank",
        "Last Name",
        "First Name",
        "Service ID",
        "Points",
        "Status",
      ];

      const rows = enrichedSlots.map((slot) => [
        slot.date,
        slot.day_of_week,
        slot.duty_type,
        slot.unit,
        slot.rank,
        slot.last_name,
        slot.first_name,
        slot.service_id,
        slot.points.toFixed(1),
        slot.status,
      ]);

      const csvContent = [
        headers.join(","),
        ...rows.map((row) =>
          row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")
        ),
      ].join("\n");

      // Return CSV file
      return new NextResponse(csvContent, {
        headers: {
          "Content-Type": "text/csv",
          "Content-Disposition": `attachment; filename="duty-roster-${startDate}-to-${endDate}.csv"`,
        },
      });
    } else if (format === "json") {
      return NextResponse.json({ slots: enrichedSlots });
    } else {
      return NextResponse.json(
        { error: "Invalid format. Use 'csv' or 'json'" },
        { status: 400 }
      );
    }
  } catch (error) {
    console.error("Error exporting roster:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
