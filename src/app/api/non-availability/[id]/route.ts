import { NextRequest, NextResponse } from "next/server";
import { auth, getSessionUser } from "@/lib/auth";
import {
  getNonAvailabilityById,
  updateNonAvailability,
  deleteNonAvailability,
  getPersonnelById,
} from "@/lib/stores";

// GET single non-availability request
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
    const request = getNonAvailabilityById(id);

    if (!request) {
      return NextResponse.json({ error: "Request not found" }, { status: 404 });
    }

    const personnel = getPersonnelById(request.personnel_id);

    return NextResponse.json({
      request: {
        ...request,
        personnel: personnel
          ? {
              id: personnel.id,
              first_name: personnel.first_name,
              last_name: personnel.last_name,
              rank: personnel.rank,
            }
          : null,
      },
    });
  } catch (error) {
    console.error("Error fetching non-availability request:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// PATCH update non-availability request (approve/reject)
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();

    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const user = getSessionUser(session);

    // Check if user is admin
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
    const existing = getNonAvailabilityById(id);

    if (!existing) {
      return NextResponse.json({ error: "Request not found" }, { status: 404 });
    }

    const body = await request.json();
    const { status } = body;

    // Validate status
    if (status && !["pending", "approved", "rejected"].includes(status)) {
      return NextResponse.json({ error: "Invalid status" }, { status: 400 });
    }

    const updates: Partial<typeof existing> = {};
    if (status) {
      updates.status = status;
      if (status === "approved" || status === "rejected") {
        updates.approved_by = user?.id || null;
      }
    }

    const updated = updateNonAvailability(id, updates);

    if (!updated) {
      return NextResponse.json(
        { error: "Failed to update request" },
        { status: 500 }
      );
    }

    const personnel = getPersonnelById(updated.personnel_id);

    return NextResponse.json({
      request: {
        ...updated,
        personnel: personnel
          ? {
              id: personnel.id,
              first_name: personnel.first_name,
              last_name: personnel.last_name,
              rank: personnel.rank,
            }
          : null,
      },
    });
  } catch (error) {
    console.error("Error updating non-availability request:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// DELETE non-availability request
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
    const { id } = await params;
    const existing = getNonAvailabilityById(id);

    if (!existing) {
      return NextResponse.json({ error: "Request not found" }, { status: 404 });
    }

    // Check permissions - admin or owner can delete
    const isAdmin = user?.roles?.some(
      (role) => role.role_name === "App Admin" || role.role_name === "Unit Admin"
    );
    const isOwner = user?.personnel_id === existing.personnel_id;

    if (!isAdmin && !isOwner) {
      return NextResponse.json(
        { error: "Forbidden: Cannot delete this request" },
        { status: 403 }
      );
    }

    // Only allow deletion of pending requests for non-admins
    if (!isAdmin && existing.status !== "pending") {
      return NextResponse.json(
        { error: "Cannot delete approved/rejected requests" },
        { status: 400 }
      );
    }

    const deleted = deleteNonAvailability(id);

    if (!deleted) {
      return NextResponse.json(
        { error: "Failed to delete request" },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting non-availability request:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
