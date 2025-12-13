import { NextRequest, NextResponse } from "next/server";
import { auth, getSessionUser } from "@/lib/auth";
import { generateSchedule, previewSchedule } from "@/lib/duty-thruster";
import { getUnitSectionById } from "@/lib/stores";

// POST generate or preview schedule
export async function POST(request: NextRequest) {
  try {
    const session = await auth();

    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const user = getSessionUser(session);

    // Check if user is App Admin or Unit Admin
    const isAdmin = user?.roles?.some(
      (role) => role.role_name === "App Admin" || role.role_name === "Unit Admin"
    );

    if (!isAdmin) {
      return NextResponse.json(
        { error: "Forbidden: Admin access required" },
        { status: 403 }
      );
    }

    const body = await request.json();
    const { unit_id, start_date, end_date, preview, clear_existing } = body;

    // Validate required fields
    if (!unit_id || !start_date || !end_date) {
      return NextResponse.json(
        { error: "unit_id, start_date, and end_date are required" },
        { status: 400 }
      );
    }

    // Verify unit exists
    const unit = getUnitSectionById(unit_id);
    if (!unit) {
      return NextResponse.json({ error: "Unit not found" }, { status: 404 });
    }

    // If Unit Admin, verify they have access to this unit
    const isAppAdmin = user?.roles?.some((role) => role.role_name === "App Admin");
    if (!isAppAdmin) {
      const hasUnitAccess = user?.roles?.some(
        (role) =>
          role.role_name === "Unit Admin" && role.scope_unit_id === unit_id
      );
      if (!hasUnitAccess) {
        return NextResponse.json(
          { error: "Forbidden: No access to this unit" },
          { status: 403 }
        );
      }
    }

    // Parse dates
    const startDate = new Date(start_date);
    const endDate = new Date(end_date);

    // Validate date range
    if (startDate > endDate) {
      return NextResponse.json(
        { error: "start_date must be before or equal to end_date" },
        { status: 400 }
      );
    }

    // Limit to 90 days to prevent excessive scheduling
    const daysDiff = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
    if (daysDiff > 90) {
      return NextResponse.json(
        { error: "Date range cannot exceed 90 days" },
        { status: 400 }
      );
    }

    const scheduleRequest = {
      unitId: unit_id,
      startDate,
      endDate,
      assignedBy: user?.id || "system",
      clearExisting: clear_existing || false,
    };

    // Generate or preview
    const result = preview
      ? previewSchedule(scheduleRequest)
      : generateSchedule(scheduleRequest);

    return NextResponse.json({
      success: result.success,
      preview: !!preview,
      slots_created: result.slotsCreated,
      slots_skipped: result.slotsSkipped,
      errors: result.errors,
      warnings: result.warnings,
      slots: result.slots.map((slot) => ({
        ...slot,
        date_assigned: slot.date_assigned instanceof Date
          ? slot.date_assigned.toISOString()
          : slot.date_assigned,
      })),
    });
  } catch (error) {
    console.error("Error generating schedule:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
