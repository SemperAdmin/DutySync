import { NextRequest, NextResponse } from "next/server";
import { auth, getSessionUser } from "@/lib/auth";
import {
  getUnitSectionById,
  updateUnitSection,
  deleteUnitSection,
  getChildUnits,
} from "@/lib/stores";
import type { HierarchyLevel } from "@/types";

// GET single unit section
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
    const unit = getUnitSectionById(id);

    if (!unit) {
      return NextResponse.json({ error: "Unit not found" }, { status: 404 });
    }

    const children = getChildUnits(id);

    return NextResponse.json({ unit, children });
  } catch (error) {
    console.error("Error fetching unit:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// PUT update unit section
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

    const { id } = await params;
    const body = await request.json();
    const { unit_name, hierarchy_level } = body;

    const existing = getUnitSectionById(id);
    if (!existing) {
      return NextResponse.json({ error: "Unit not found" }, { status: 404 });
    }

    // Validate hierarchy level if provided
    if (hierarchy_level) {
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
    }

    const updates: { unit_name?: string; hierarchy_level?: HierarchyLevel } = {};
    if (unit_name) updates.unit_name = unit_name;
    if (hierarchy_level) updates.hierarchy_level = hierarchy_level;

    const updated = updateUnitSection(id, updates);

    return NextResponse.json({ unit: updated });
  } catch (error) {
    console.error("Error updating unit:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// DELETE unit section
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

    const { id } = await params;
    const existing = getUnitSectionById(id);

    if (!existing) {
      return NextResponse.json({ error: "Unit not found" }, { status: 404 });
    }

    const children = getChildUnits(id);
    if (children.length > 0) {
      return NextResponse.json(
        { error: "Cannot delete unit with child units" },
        { status: 400 }
      );
    }

    const deleted = deleteUnitSection(id);

    if (!deleted) {
      return NextResponse.json(
        { error: "Failed to delete unit" },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting unit:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
