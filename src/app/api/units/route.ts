import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { auth, getSessionUser } from "@/lib/auth";
import {
  getUnitSections,
  createUnitSection,
  getUnitSectionById,
} from "@/lib/stores";
import type { UnitSection, HierarchyLevel } from "@/types";

// GET all unit sections
export async function GET() {
  try {
    const session = await auth();

    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const units = getUnitSections();
    return NextResponse.json({ units });
  } catch (error) {
    console.error("Error fetching units:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// POST create new unit section
export async function POST(request: NextRequest) {
  try {
    const session = await auth();

    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const user = getSessionUser(session);

    // Check if user is App Admin
    const isAdmin = user?.roles?.some(
      (role) => role.role_name === "App Admin"
    );

    if (!isAdmin) {
      return NextResponse.json(
        { error: "Forbidden: App Admin access required" },
        { status: 403 }
      );
    }

    const body = await request.json();
    const { unit_name, hierarchy_level, parent_id } = body;

    // Validate required fields
    if (!unit_name || !hierarchy_level) {
      return NextResponse.json(
        { error: "unit_name and hierarchy_level are required" },
        { status: 400 }
      );
    }

    // Validate hierarchy level
    const validLevels: HierarchyLevel[] = [
      "battalion",
      "company",
      "platoon",
      "section",
    ];
    if (!validLevels.includes(hierarchy_level)) {
      return NextResponse.json(
        { error: "Invalid hierarchy_level" },
        { status: 400 }
      );
    }

    // Validate parent exists if specified
    if (parent_id && !getUnitSectionById(parent_id)) {
      return NextResponse.json(
        { error: "Parent unit not found" },
        { status: 400 }
      );
    }

    // Validate hierarchy rules
    if (hierarchy_level === "battalion" && parent_id) {
      return NextResponse.json(
        { error: "Battalion cannot have a parent unit" },
        { status: 400 }
      );
    }

    if (hierarchy_level !== "battalion" && !parent_id) {
      return NextResponse.json(
        { error: "Non-battalion units must have a parent" },
        { status: 400 }
      );
    }

    const newUnit: UnitSection = {
      id: uuidv4(),
      unit_name,
      hierarchy_level,
      parent_id: parent_id || null,
      created_at: new Date(),
      updated_at: new Date(),
    };

    const created = createUnitSection(newUnit);

    return NextResponse.json({ unit: created }, { status: 201 });
  } catch (error) {
    console.error("Error creating unit:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
