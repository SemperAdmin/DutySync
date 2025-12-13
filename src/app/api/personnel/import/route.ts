import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { auth, getSessionUser } from "@/lib/auth";
import {
  bulkCreatePersonnel,
  getUnitSectionById,
  getUnitSections,
} from "@/lib/stores";
import type { Personnel } from "@/types";

interface CSVRow {
  service_id: string;
  first_name: string;
  last_name: string;
  rank: string;
  unit_name?: string;
  unit_section_id?: string;
}

// Parse CSV content
function parseCSV(content: string): CSVRow[] {
  const lines = content.trim().split("\n");
  if (lines.length < 2) {
    throw new Error("CSV must have a header row and at least one data row");
  }

  // Parse header - normalize to lowercase and trim
  const headerLine = lines[0];
  const headers = headerLine.split(",").map((h) =>
    h.trim().toLowerCase().replace(/['"]/g, "").replace(/\s+/g, "_")
  );

  // Required columns
  const requiredColumns = ["service_id", "first_name", "last_name", "rank"];
  const missingColumns = requiredColumns.filter((col) => !headers.includes(col));

  if (missingColumns.length > 0) {
    throw new Error(`Missing required columns: ${missingColumns.join(", ")}`);
  }

  // Parse data rows
  const rows: CSVRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    // Handle quoted values with commas
    const values: string[] = [];
    let current = "";
    let inQuotes = false;

    for (const char of line) {
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === "," && !inQuotes) {
        values.push(current.trim().replace(/^["']|["']$/g, ""));
        current = "";
      } else {
        current += char;
      }
    }
    values.push(current.trim().replace(/^["']|["']$/g, ""));

    if (values.length !== headers.length) {
      console.warn(`Row ${i + 1} has ${values.length} columns, expected ${headers.length}`);
      continue;
    }

    const row: Record<string, string> = {};
    headers.forEach((header, index) => {
      row[header] = values[index] || "";
    });

    rows.push(row as unknown as CSVRow);
  }

  return rows;
}

// POST import personnel from CSV
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

    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const defaultUnitId = formData.get("unit_id") as string | null;

    if (!file) {
      return NextResponse.json(
        { error: "No file provided" },
        { status: 400 }
      );
    }

    // Validate file type
    const fileName = file.name.toLowerCase();
    if (!fileName.endsWith(".csv") && !fileName.endsWith(".txt")) {
      return NextResponse.json(
        { error: "File must be a CSV or TXT file" },
        { status: 400 }
      );
    }

    // Read file content
    const content = await file.text();

    // Parse CSV
    let rows: CSVRow[];
    try {
      rows = parseCSV(content);
    } catch (parseError) {
      return NextResponse.json(
        { error: `CSV parsing error: ${parseError instanceof Error ? parseError.message : parseError}` },
        { status: 400 }
      );
    }

    if (rows.length === 0) {
      return NextResponse.json(
        { error: "No valid data rows found in CSV" },
        { status: 400 }
      );
    }

    // Get all units for matching
    const units = getUnitSections();
    const unitsByName = new Map(units.map((u) => [u.unit_name.toLowerCase(), u.id]));

    // Validate default unit if provided
    if (defaultUnitId && !getUnitSectionById(defaultUnitId)) {
      return NextResponse.json(
        { error: "Default unit not found" },
        { status: 400 }
      );
    }

    // Process rows into Personnel objects
    const personnel: Personnel[] = [];
    const validationErrors: string[] = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNum = i + 2; // +2 because 1-indexed and header row

      // Validate required fields
      if (!row.service_id) {
        validationErrors.push(`Row ${rowNum}: Missing service_id`);
        continue;
      }
      if (!row.first_name) {
        validationErrors.push(`Row ${rowNum}: Missing first_name`);
        continue;
      }
      if (!row.last_name) {
        validationErrors.push(`Row ${rowNum}: Missing last_name`);
        continue;
      }
      if (!row.rank) {
        validationErrors.push(`Row ${rowNum}: Missing rank`);
        continue;
      }

      // Determine unit_section_id
      let unitId = row.unit_section_id || defaultUnitId;

      // Try to match by unit name if provided
      if (!unitId && row.unit_name) {
        unitId = unitsByName.get(row.unit_name.toLowerCase()) || null;
        if (!unitId) {
          validationErrors.push(`Row ${rowNum}: Unit "${row.unit_name}" not found`);
          continue;
        }
      }

      if (!unitId) {
        validationErrors.push(`Row ${rowNum}: No unit specified and no default unit provided`);
        continue;
      }

      personnel.push({
        id: uuidv4(),
        service_id: row.service_id.trim(),
        first_name: row.first_name.trim(),
        last_name: row.last_name.trim(),
        rank: row.rank.trim().toUpperCase(),
        unit_section_id: unitId,
        current_duty_score: 0,
        created_at: new Date(),
        updated_at: new Date(),
      });
    }

    if (personnel.length === 0) {
      return NextResponse.json(
        {
          error: "No valid personnel records to import",
          validationErrors
        },
        { status: 400 }
      );
    }

    // Bulk import
    const result = bulkCreatePersonnel(personnel);

    return NextResponse.json({
      message: "Import completed",
      created: result.created,
      updated: result.updated,
      errors: [...validationErrors, ...result.errors],
      total_processed: rows.length,
    });
  } catch (error) {
    console.error("Error importing personnel:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
