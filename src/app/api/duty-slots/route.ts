import { NextRequest, NextResponse } from "next/server";
import { auth, getSessionUser } from "@/lib/auth";
import {
  getAllDutySlots,
  getDutySlotsByDateRange,
  getDutySlotsByUnit,
  getDutySlotById,
  updateDutySlot,
  deleteDutySlot,
  getDutyTypeById,
  getPersonnelById,
} from "@/lib/stores";

// GET duty slots with optional filters
export async function GET(request: NextRequest) {
  try {
    const session = await auth();

    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const unitId = searchParams.get("unit_id");
    const startDate = searchParams.get("start_date");
    const endDate = searchParams.get("end_date");

    let slots;

    if (startDate && endDate) {
      slots = getDutySlotsByDateRange(new Date(startDate), new Date(endDate));
      // Filter by unit if specified
      if (unitId) {
        slots = slots.filter((slot) => {
          const dutyType = getDutyTypeById(slot.duty_type_id);
          return dutyType?.unit_section_id === unitId;
        });
      }
    } else if (unitId) {
      slots = getDutySlotsByUnit(unitId);
    } else {
      slots = getAllDutySlots();
    }

    // Enrich slots with duty type and personnel info
    const enrichedSlots = slots.map((slot) => {
      const dutyType = getDutyTypeById(slot.duty_type_id);
      const personnel = getPersonnelById(slot.personnel_id);
      return {
        ...slot,
        date_assigned: slot.date_assigned instanceof Date
          ? slot.date_assigned.toISOString()
          : slot.date_assigned,
        duty_type: dutyType
          ? {
              id: dutyType.id,
              duty_name: dutyType.duty_name,
              unit_section_id: dutyType.unit_section_id,
            }
          : null,
        personnel: personnel
          ? {
              id: personnel.id,
              first_name: personnel.first_name,
              last_name: personnel.last_name,
              rank: personnel.rank,
            }
          : null,
      };
    });

    return NextResponse.json({ slots: enrichedSlots });
  } catch (error) {
    console.error("Error fetching duty slots:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// DELETE a specific duty slot
export async function DELETE(request: NextRequest) {
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

    const { searchParams } = new URL(request.url);
    const slotId = searchParams.get("id");

    if (!slotId) {
      return NextResponse.json({ error: "Slot ID required" }, { status: 400 });
    }

    const slot = getDutySlotById(slotId);
    if (!slot) {
      return NextResponse.json({ error: "Slot not found" }, { status: 404 });
    }

    // Verify unit access for Unit Admins
    const isAppAdmin = user?.roles?.some((role) => role.role_name === "App Admin");
    if (!isAppAdmin) {
      const dutyType = getDutyTypeById(slot.duty_type_id);
      const hasUnitAccess = user?.roles?.some(
        (role) =>
          role.role_name === "Unit Admin" &&
          role.scope_unit_id === dutyType?.unit_section_id
      );
      if (!hasUnitAccess) {
        return NextResponse.json(
          { error: "Forbidden: No access to this unit" },
          { status: 403 }
        );
      }
    }

    const deleted = deleteDutySlot(slotId);
    if (!deleted) {
      return NextResponse.json(
        { error: "Failed to delete slot" },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting duty slot:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// PATCH update a duty slot (e.g., change status, swap personnel)
export async function PATCH(request: NextRequest) {
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
    const { id, personnel_id, status } = body;

    if (!id) {
      return NextResponse.json({ error: "Slot ID required" }, { status: 400 });
    }

    const slot = getDutySlotById(id);
    if (!slot) {
      return NextResponse.json({ error: "Slot not found" }, { status: 404 });
    }

    // Verify unit access for Unit Admins
    const isAppAdmin = user?.roles?.some((role) => role.role_name === "App Admin");
    if (!isAppAdmin) {
      const dutyType = getDutyTypeById(slot.duty_type_id);
      const hasUnitAccess = user?.roles?.some(
        (role) =>
          role.role_name === "Unit Admin" &&
          role.scope_unit_id === dutyType?.unit_section_id
      );
      if (!hasUnitAccess) {
        return NextResponse.json(
          { error: "Forbidden: No access to this unit" },
          { status: 403 }
        );
      }
    }

    const updates: Record<string, unknown> = {};
    if (personnel_id !== undefined) updates.personnel_id = personnel_id;
    if (status !== undefined) {
      if (!["scheduled", "completed", "cancelled"].includes(status)) {
        return NextResponse.json({ error: "Invalid status" }, { status: 400 });
      }
      updates.status = status;
    }

    const updated = updateDutySlot(id, updates);
    if (!updated) {
      return NextResponse.json(
        { error: "Failed to update slot" },
        { status: 500 }
      );
    }

    return NextResponse.json({ slot: updated });
  } catch (error) {
    console.error("Error updating duty slot:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
