import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { auth, getSessionUser } from "@/lib/auth";
import {
  getAllNonAvailability,
  getNonAvailabilityByPersonnel,
  createNonAvailability,
  getPersonnelById,
  getAllPersonnel,
} from "@/lib/stores";
import type { NonAvailability } from "@/types";

// GET non-availability requests
export async function GET(request: NextRequest) {
  try {
    const session = await auth();

    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const user = getSessionUser(session);
    const { searchParams } = new URL(request.url);
    const personnelId = searchParams.get("personnel_id");
    const status = searchParams.get("status");

    let requests: NonAvailability[];

    // Check if user is admin
    const isAdmin = user?.roles?.some(
      (role) => role.role_name === "App Admin" || role.role_name === "Unit Admin"
    );

    if (personnelId) {
      // Get requests for specific personnel
      requests = getNonAvailabilityByPersonnel(personnelId);
    } else if (isAdmin) {
      // Admins can see all requests
      requests = getAllNonAvailability();
    } else if (user?.personnel_id) {
      // Regular users only see their own requests
      requests = getNonAvailabilityByPersonnel(user.personnel_id);
    } else {
      requests = [];
    }

    // Filter by status if specified
    if (status) {
      requests = requests.filter((r) => r.status === status);
    }

    // Enrich with personnel info
    const enrichedRequests = requests.map((req) => {
      const personnel = getPersonnelById(req.personnel_id);
      return {
        ...req,
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

    return NextResponse.json({ requests: enrichedRequests });
  } catch (error) {
    console.error("Error fetching non-availability requests:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// POST create non-availability request
export async function POST(request: NextRequest) {
  try {
    const session = await auth();

    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const user = getSessionUser(session);
    const body = await request.json();
    const { personnel_id, start_date, end_date, reason } = body;

    // Validate required fields
    if (!start_date || !end_date || !reason) {
      return NextResponse.json(
        { error: "start_date, end_date, and reason are required" },
        { status: 400 }
      );
    }

    // Determine personnel_id
    let targetPersonnelId = personnel_id;

    // Check if user is admin (can create for anyone)
    const isAdmin = user?.roles?.some(
      (role) => role.role_name === "App Admin" || role.role_name === "Unit Admin"
    );

    if (!targetPersonnelId) {
      // Use the current user's personnel_id
      if (!user?.personnel_id) {
        return NextResponse.json(
          { error: "personnel_id is required (user not linked to personnel)" },
          { status: 400 }
        );
      }
      targetPersonnelId = user.personnel_id;
    } else if (!isAdmin && targetPersonnelId !== user?.personnel_id) {
      // Non-admins can only create requests for themselves
      return NextResponse.json(
        { error: "Forbidden: Cannot create requests for other personnel" },
        { status: 403 }
      );
    }

    // Verify personnel exists
    const personnel = getPersonnelById(targetPersonnelId);
    if (!personnel) {
      return NextResponse.json(
        { error: "Personnel not found" },
        { status: 404 }
      );
    }

    // Validate dates
    const startDateParsed = new Date(start_date);
    const endDateParsed = new Date(end_date);

    if (startDateParsed > endDateParsed) {
      return NextResponse.json(
        { error: "start_date must be before or equal to end_date" },
        { status: 400 }
      );
    }

    // Create the request
    const newRequest: NonAvailability = {
      id: uuidv4(),
      personnel_id: targetPersonnelId,
      start_date: startDateParsed,
      end_date: endDateParsed,
      reason,
      status: isAdmin ? "approved" : "pending", // Auto-approve if admin creates it
      approved_by: isAdmin ? user?.id || null : null,
      created_at: new Date(),
    };

    createNonAvailability(newRequest);

    return NextResponse.json({
      request: {
        ...newRequest,
        personnel: {
          id: personnel.id,
          first_name: personnel.first_name,
          last_name: personnel.last_name,
          rank: personnel.rank,
        },
      },
    });
  } catch (error) {
    console.error("Error creating non-availability request:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
