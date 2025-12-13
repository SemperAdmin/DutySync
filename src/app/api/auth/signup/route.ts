import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { hashPassword, userStore } from "@/lib/auth";
import type { UserRole } from "@/types";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { username, email, serviceId, password } = body;

    // Validate required fields
    if (!username || !email || !serviceId || !password) {
      return NextResponse.json(
        { error: "All fields are required" },
        { status: 400 }
      );
    }

    // Validate password length
    if (password.length < 8) {
      return NextResponse.json(
        { error: "Password must be at least 8 characters" },
        { status: 400 }
      );
    }

    // Check if username already exists
    if (userStore.has(username)) {
      return NextResponse.json(
        { error: "Username already exists" },
        { status: 400 }
      );
    }

    // Check if email already exists
    for (const user of userStore.values()) {
      if (user.email === email) {
        return NextResponse.json(
          { error: "Email already registered" },
          { status: 400 }
        );
      }
    }

    // TODO: In production, validate serviceId against personnel table in database
    // For MVP, we'll create the user without personnel linkage

    // Hash password
    const passwordHash = await hashPassword(password);

    // Create user ID
    const userId = uuidv4();

    // Assign default Standard User role
    const defaultRole: UserRole = {
      id: uuidv4(),
      user_id: userId,
      role_name: "Standard User",
      scope_unit_id: null,
      created_at: new Date(),
    };

    // Store user
    userStore.set(username, {
      id: userId,
      username,
      email,
      password_hash: passwordHash,
      personnel_id: null, // Will be linked when matched with personnel record
      roles: [defaultRole],
    });

    return NextResponse.json(
      { message: "Account created successfully", userId },
      { status: 201 }
    );
  } catch (error) {
    console.error("Signup error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
