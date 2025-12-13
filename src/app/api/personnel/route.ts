import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { auth, getSessionUser } from "@/lib/auth";
import {
  getAllPersonnel,
  getPersonnelByUnit,
  createPersonnel,
  getUnitSectionById,
} from "@/lib/stores";
import type { Personnel } from "@/types";

// GET all personnel (with optional unit filter)
export async function GET(request: NextRequest) {
  try {
    const session = await auth();

    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const unitId = searchParams.get("unit_id");

    let personnel: Personnel[];

    if (unitId) {
      personnel = getPersonnelByUnit(unitId);
    } else {
      personnel = getAllPersonnel();
    }

    return NextResponse.json({ personnel, count: personnel.length });
  } catch (error) {
    console.error("Error fetching personnel:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// POST create new personnel
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
    const { service_id, first_name, last_name, rank, unit_section_id } = body;

    // Validate required fields
    if (!service_id || !first_name || !last_name || !rank || !unit_section_id) {
      return NextResponse.json(
        { error: "All fields are required: service_id, first_name, last_name, rank, unit_section_id" },
        { status: 400 }
      );
    }

    // Validate unit exists
    const unit = getUnitSectionById(unit_section_id);
    if (!unit) {
      return NextResponse.json(
        { error: "Unit section not found" },
        { status: 400 }
      );
    }

    const newPersonnel: Personnel = {
      id: uuidv4(),
      service_id,
      first_name,
      last_name,
      rank,
      unit_section_id,
      current_duty_score: 0,
      created_at: new Date(),
      updated_at: new Date(),
    };

    const created = createPersonnel(newPersonnel);

    return NextResponse.json({ personnel: created }, { status: 201 });
  } catch (error) {
    console.error("Error creating personnel:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
