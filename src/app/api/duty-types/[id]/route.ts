import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { auth, getSessionUser } from "@/lib/auth";
import {
  getDutyTypeById,
  updateDutyType,
  deleteDutyType,
  getDutyRequirements,
  addDutyRequirement,
  clearDutyRequirements,
  getDutyValueByDutyType,
  createDutyValue,
  updateDutyValue,
} from "@/lib/stores";
import type { DutyValue } from "@/types";

// GET single duty type
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();

    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const dutyType = getDutyTypeById(id);

    if (!dutyType) {
      return NextResponse.json({ error: "Duty type not found" }, { status: 404 });
    }

    return NextResponse.json({
      duty_type: {
        ...dutyType,
        requirements: getDutyRequirements(id),
        duty_value: getDutyValueByDutyType(id) || null,
      },
    });
  } catch (error) {
    console.error("Error fetching duty type:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// PUT update duty type
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
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

    const { id } = await params;
    const existing = getDutyTypeById(id);

    if (!existing) {
      return NextResponse.json({ error: "Duty type not found" }, { status: 404 });
    }

    // If Unit Admin, verify they have access to this unit
    const isAppAdmin = user?.roles?.some((role) => role.role_name === "App Admin");
    if (!isAppAdmin) {
      const hasUnitAccess = user?.roles?.some(
        (role) =>
          role.role_name === "Unit Admin" &&
          role.scope_unit_id === existing.unit_section_id
      );
      if (!hasUnitAccess) {
        return NextResponse.json(
          { error: "Forbidden: No access to this unit" },
          { status: 403 }
        );
      }
    }

    const body = await request.json();
    const {
      duty_name,
      description,
      slots_needed,
      required_rank_min,
      required_rank_max,
      is_active,
      requirements,
      base_weight,
      weekend_multiplier,
      holiday_multiplier,
    } = body;

    // Build updates object
    const updates: Partial<typeof existing> = {};
    if (duty_name !== undefined) updates.duty_name = duty_name;
    if (description !== undefined) updates.description = description;
    if (slots_needed !== undefined) updates.slots_needed = parseInt(slots_needed);
    if (required_rank_min !== undefined) updates.required_rank_min = required_rank_min;
    if (required_rank_max !== undefined) updates.required_rank_max = required_rank_max;
    if (is_active !== undefined) updates.is_active = is_active;

    const updated = updateDutyType(id, updates);

    // Update requirements if provided
    if (requirements !== undefined && Array.isArray(requirements)) {
      clearDutyRequirements(id);
      requirements.forEach((qualName: string) => {
        addDutyRequirement(id, qualName);
      });
    }

    // Update duty value if any value fields provided
    if (
      base_weight !== undefined ||
      weekend_multiplier !== undefined ||
      holiday_multiplier !== undefined
    ) {
      let dutyValue = getDutyValueByDutyType(id);

      if (dutyValue) {
        const valueUpdates: Partial<DutyValue> = {};
        if (base_weight !== undefined) valueUpdates.base_weight = base_weight;
        if (weekend_multiplier !== undefined)
          valueUpdates.weekend_multiplier = weekend_multiplier;
        if (holiday_multiplier !== undefined)
          valueUpdates.holiday_multiplier = holiday_multiplier;

        updateDutyValue(dutyValue.id, valueUpdates);
      } else {
        // Create new duty value
        const newDutyValue: DutyValue = {
          id: uuidv4(),
          duty_type_id: id,
          base_weight: base_weight || 1.0,
          weekend_multiplier: weekend_multiplier || 1.5,
          holiday_multiplier: holiday_multiplier || 2.0,
        };
        createDutyValue(newDutyValue);
      }
    }

    return NextResponse.json({
      duty_type: {
        ...updated,
        requirements: getDutyRequirements(id),
        duty_value: getDutyValueByDutyType(id) || null,
      },
    });
  } catch (error) {
    console.error("Error updating duty type:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// DELETE duty type
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
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

    const { id } = await params;
    const existing = getDutyTypeById(id);

    if (!existing) {
      return NextResponse.json({ error: "Duty type not found" }, { status: 404 });
    }

    // If Unit Admin, verify they have access to this unit
    const isAppAdmin = user?.roles?.some((role) => role.role_name === "App Admin");
    if (!isAppAdmin) {
      const hasUnitAccess = user?.roles?.some(
        (role) =>
          role.role_name === "Unit Admin" &&
          role.scope_unit_id === existing.unit_section_id
      );
      if (!hasUnitAccess) {
        return NextResponse.json(
          { error: "Forbidden: No access to this unit" },
          { status: 403 }
        );
      }
    }

    const deleted = deleteDutyType(id);

    if (!deleted) {
      return NextResponse.json(
        { error: "Failed to delete duty type" },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting duty type:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
