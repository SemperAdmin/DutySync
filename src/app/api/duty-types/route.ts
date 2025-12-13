import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { auth, getSessionUser } from "@/lib/auth";
import {
  getAllDutyTypes,
  getDutyTypesByUnit,
  createDutyType,
  getDutyRequirements,
  addDutyRequirement,
  getDutyValueByDutyType,
  createDutyValue,
  getUnitSectionById,
} from "@/lib/stores";
import type { DutyType, DutyValue } from "@/types";

// GET all duty types (optionally filter by unit)
export async function GET(request: NextRequest) {
  try {
    const session = await auth();

    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const unitId = searchParams.get("unit_id");

    let dutyTypes: DutyType[];
    if (unitId) {
      dutyTypes = getDutyTypesByUnit(unitId);
    } else {
      dutyTypes = getAllDutyTypes();
    }

    // Include requirements and values for each duty type
    const enrichedDutyTypes = dutyTypes.map((dt) => ({
      ...dt,
      requirements: getDutyRequirements(dt.id),
      duty_value: getDutyValueByDutyType(dt.id) || null,
    }));

    return NextResponse.json({ duty_types: enrichedDutyTypes });
  } catch (error) {
    console.error("Error fetching duty types:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// POST create new duty type
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
    const {
      unit_section_id,
      duty_name,
      description,
      slots_needed,
      required_rank_min,
      required_rank_max,
      requirements,
      base_weight,
      weekend_multiplier,
      holiday_multiplier,
    } = body;

    // Validate required fields
    if (!unit_section_id || !duty_name || !slots_needed) {
      return NextResponse.json(
        { error: "unit_section_id, duty_name, and slots_needed are required" },
        { status: 400 }
      );
    }

    // Verify unit exists
    const unit = getUnitSectionById(unit_section_id);
    if (!unit) {
      return NextResponse.json({ error: "Unit not found" }, { status: 404 });
    }

    // If Unit Admin, verify they have access to this unit
    const isAppAdmin = user?.roles?.some((role) => role.role_name === "App Admin");
    if (!isAppAdmin) {
      const hasUnitAccess = user?.roles?.some(
        (role) =>
          role.role_name === "Unit Admin" && role.scope_unit_id === unit_section_id
      );
      if (!hasUnitAccess) {
        return NextResponse.json(
          { error: "Forbidden: No access to this unit" },
          { status: 403 }
        );
      }
    }

    const dutyTypeId = uuidv4();
    const now = new Date();

    // Create duty type
    const newDutyType: DutyType = {
      id: dutyTypeId,
      unit_section_id,
      duty_name,
      description: description || null,
      slots_needed: parseInt(slots_needed),
      required_rank_min: required_rank_min || null,
      required_rank_max: required_rank_max || null,
      is_active: true,
      created_at: now,
      updated_at: now,
    };

    createDutyType(newDutyType);

    // Add requirements if provided
    if (requirements && Array.isArray(requirements)) {
      requirements.forEach((qualName: string) => {
        addDutyRequirement(dutyTypeId, qualName);
      });
    }

    // Create duty value with defaults or provided values
    const dutyValueId = uuidv4();
    const newDutyValue: DutyValue = {
      id: dutyValueId,
      duty_type_id: dutyTypeId,
      base_weight: base_weight || 1.0,
      weekend_multiplier: weekend_multiplier || 1.5,
      holiday_multiplier: holiday_multiplier || 2.0,
    };

    createDutyValue(newDutyValue);

    return NextResponse.json({
      duty_type: {
        ...newDutyType,
        requirements: getDutyRequirements(dutyTypeId),
        duty_value: newDutyValue,
      },
    });
  } catch (error) {
    console.error("Error creating duty type:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
