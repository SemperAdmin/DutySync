import { NextResponse } from "next/server";
import { auth, getSessionUser, userStore } from "@/lib/auth";

export async function GET() {
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

    // Get all users (exclude password hash)
    const users = Array.from(userStore.values()).map((u) => ({
      id: u.id,
      username: u.username,
      email: u.email,
      personnel_id: u.personnel_id,
      roles: u.roles,
    }));

    return NextResponse.json({ users });
  } catch (error) {
    console.error("Error fetching users:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
