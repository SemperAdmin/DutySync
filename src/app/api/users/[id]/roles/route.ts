import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { auth, getSessionUser, userStore } from "@/lib/auth";
import type { RoleName, UserRole } from "@/types";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();

    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const currentUser = getSessionUser(session);

    // Check if user is App Admin
    const isAdmin = currentUser?.roles?.some(
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
    const { role_name, scope_unit_id } = body as {
      role_name: RoleName;
      scope_unit_id: string | null;
    };

    // Validate role name
    const validRoles: RoleName[] = ["App Admin", "Unit Admin", "Standard User"];
    if (!validRoles.includes(role_name)) {
      return NextResponse.json(
        { error: "Invalid role name" },
        { status: 400 }
      );
    }

    // Find user
    let targetUser = null;
    let targetUsername = "";
    for (const [username, user] of userStore.entries()) {
      if (user.id === id) {
        targetUser = user;
        targetUsername = username;
        break;
      }
    }

    if (!targetUser) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // Create new role
    const newRole: UserRole = {
      id: uuidv4(),
      user_id: id,
      role_name,
      scope_unit_id: scope_unit_id || null,
      created_at: new Date(),
    };

    // For Unit Admin, check if already has this role for this unit
    if (role_name === "Unit Admin" && scope_unit_id) {
      const existingUnitAdminRole = targetUser.roles.find(
        (r) => r.role_name === "Unit Admin" && r.scope_unit_id === scope_unit_id
      );
      if (existingUnitAdminRole) {
        return NextResponse.json(
          { error: "User already has Unit Admin role for this unit" },
          { status: 400 }
        );
      }
    }

    // For App Admin, check if already has this role
    if (role_name === "App Admin") {
      const existingAppAdminRole = targetUser.roles.find(
        (r) => r.role_name === "App Admin"
      );
      if (existingAppAdminRole) {
        return NextResponse.json(
          { error: "User is already an App Admin" },
          { status: 400 }
        );
      }
    }

    // Update user roles
    const updatedRoles = [...targetUser.roles, newRole];

    // Update in store
    userStore.set(targetUsername, {
      ...targetUser,
      roles: updatedRoles,
    });

    return NextResponse.json({
      message: "Role assigned successfully",
      role: newRole,
    });
  } catch (error) {
    console.error("Error assigning role:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
