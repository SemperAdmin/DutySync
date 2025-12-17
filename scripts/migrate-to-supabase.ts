/**
 * Data Migration Script: JSON to Supabase
 *
 * This script migrates existing JSON data from public/data/ to Supabase tables.
 * Run this once to populate the database with existing data.
 *
 * Usage:
 *   npx tsx scripts/migrate-to-supabase.ts
 *
 * Requirements:
 *   - Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local
 *   - Or set SUPABASE_URL and SUPABASE_SERVICE_KEY for admin access
 */

import { createClient } from "@supabase/supabase-js";
import * as fs from "fs";
import * as path from "path";

// Load environment variables
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

// Supabase configuration - prefer service key for migrations
const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("Error: Missing Supabase credentials");
  console.error("Set SUPABASE_URL and SUPABASE_SERVICE_KEY (or NEXT_PUBLIC_* variants) in .env.local");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// Path to data files
const DATA_DIR = path.join(process.cwd(), "public", "data");

// Types for JSON data
interface UnitsIndex {
  units: { ruc: string; name: string; description?: string }[];
}

interface UnitStructure {
  units: {
    id: string;
    parent_id: string | null;
    unit_name: string;
    unit_code?: string;
    hierarchy_level: string;
    description?: string;
    created_at?: string;
    updated_at?: string;
  }[];
}

interface UnitMembers {
  personnel: {
    id: string;
    service_id: string;
    unit_section_id: string;
    first_name: string;
    last_name: string;
    rank: string;
    current_duty_score: number;
    created_at?: string;
    updated_at?: string;
  }[];
  encrypted?: boolean;
}

interface DutyTypesData {
  dutyTypes?: {
    id: string;
    unit_section_id: string;
    name: string;
    description?: string;
    personnel_required?: number;
    rank_filter_mode?: string;
    rank_filter_values?: string[];
    section_filter_mode?: string;
    section_filter_values?: string[];
  }[];
  dutyValues?: {
    id: string;
    duty_type_id: string;
    day_of_week: number;
    value: number;
  }[];
  dutyRequirements?: {
    id: string;
    duty_type_id: string;
    qualification_id: string;
    is_required?: boolean;
  }[];
}

interface DutyRoster {
  dutySlots?: {
    id: string;
    duty_type_id: string;
    personnel_id: string;
    date_assigned: string;
    status?: string;
    assigned_by?: string;
  }[];
}

interface NonAvailabilityData {
  nonAvailability?: {
    id: string;
    personnel_id: string;
    start_date: string;
    end_date: string;
    reason?: string;
    status?: string;
    submitted_by?: string;
    approved_by?: string;
  }[];
}

interface QualificationsData {
  qualifications?: {
    id: string;
    name: string;
    description?: string;
  }[];
  personnelQualifications?: {
    id: string;
    personnel_id: string;
    qualification_id: string;
    earned_date?: string;
    expiration_date?: string;
  }[];
}

interface UserData {
  id: string;
  edipi_encrypted: string;
  email: string;
  password_hash: string;
  personnel_id?: string | null;
  can_approve_non_availability?: boolean;
  roles?: {
    id?: string;
    role_name: string;
    scope_unit_id?: string | null;
    created_at?: string;
  }[];
  created_at?: string;
}

// EDIPI decryption (same logic as client-stores.ts)
const EDIPI_KEY = process.env.NEXT_PUBLIC_EDIPI_KEY || "DutySync2024";

function decryptEdipi(encrypted: string): string {
  if (!encrypted) return "";

  const tryDecrypt = (key: string): string | null => {
    try {
      const decoded = Buffer.from(encrypted, "base64").toString("binary");
      let result = "";
      for (let i = 0; i < decoded.length; i++) {
        const charCode = decoded.charCodeAt(i) ^ key.charCodeAt(i % key.length);
        result += String.fromCharCode(charCode);
      }
      // Validate result is a 10-digit EDIPI
      if (/^\d{10}$/.test(result)) {
        return result;
      }
      return null;
    } catch {
      return null;
    }
  };

  // Try with the configured key first
  const result = tryDecrypt(EDIPI_KEY);
  if (result) return result;

  // Try default key as fallback
  const defaultKey = "DutySync2024";
  if (EDIPI_KEY !== defaultKey) {
    const fallbackResult = tryDecrypt(defaultKey);
    if (fallbackResult) return fallbackResult;
  }

  // Return empty if decryption fails
  console.warn(`Failed to decrypt EDIPI: ${encrypted.substring(0, 10)}...`);
  return "";
}

// Helper to read JSON file
function readJsonFile<T>(filePath: string): T | null {
  try {
    if (!fs.existsSync(filePath)) {
      return null;
    }
    const content = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(content) as T;
  } catch (error) {
    console.warn(`Warning: Could not read ${filePath}:`, error);
    return null;
  }
}

// Helper to handle Supabase errors
function handleError(operation: string, error: unknown): void {
  console.error(`Error during ${operation}:`, error);
}

// Migration statistics
const stats = {
  organizations: 0,
  units: 0,
  personnel: 0,
  users: 0,
  userRoles: 0,
  dutyTypes: 0,
  dutyValues: 0,
  dutyRequirements: 0,
  dutySlots: 0,
  nonAvailability: 0,
  qualifications: 0,
  personnelQualifications: 0,
};

// Step 1: Migrate organizations (RUCs)
async function migrateOrganizations(): Promise<Map<string, string>> {
  console.log("\n📦 Migrating organizations...");

  const rucToOrgId = new Map<string, string>();
  const indexPath = path.join(DATA_DIR, "units-index.json");
  const index = readJsonFile<UnitsIndex>(indexPath);

  if (!index?.units) {
    console.warn("No units index found");
    return rucToOrgId;
  }

  for (const ruc of index.units) {
    const { data, error } = await supabase
      .from("organizations")
      .upsert({
        ruc_code: ruc.ruc,
        name: ruc.name || ruc.ruc,
        description: ruc.description || null,
      }, { onConflict: "ruc_code" })
      .select()
      .single();

    if (error) {
      handleError(`organization ${ruc.ruc}`, error);
    } else if (data) {
      rucToOrgId.set(ruc.ruc, data.id);
      stats.organizations++;
      console.log(`  ✓ Organization: ${ruc.ruc} (${data.id})`);
    }
  }

  return rucToOrgId;
}

// Step 2: Migrate units for each organization
async function migrateUnits(rucToOrgId: Map<string, string>): Promise<void> {
  console.log("\n🏢 Migrating units...");

  for (const [ruc, orgId] of Array.from(rucToOrgId.entries())) {
    const structurePath = path.join(DATA_DIR, "unit", ruc, "unit-structure.json");
    const structure = readJsonFile<UnitStructure>(structurePath);

    if (!structure?.units) {
      console.warn(`  No unit structure found for RUC ${ruc}`);
      continue;
    }

    // Insert units in order (parents first)
    const unitsByParent = new Map<string | null, typeof structure.units>();
    for (const unit of structure.units) {
      const parentId = unit.parent_id || null;
      if (!unitsByParent.has(parentId)) {
        unitsByParent.set(parentId, []);
      }
      unitsByParent.get(parentId)!.push(unit);
    }

    // BFS to insert in correct order
    const queue: (string | null)[] = [null];
    while (queue.length > 0) {
      const parentId = queue.shift()!;
      const units = unitsByParent.get(parentId) || [];

      for (const unit of units) {
        const { error } = await supabase
          .from("units")
          .upsert({
            id: unit.id,
            organization_id: orgId,
            parent_id: unit.parent_id || null,
            unit_name: unit.unit_name,
            unit_code: unit.unit_code || null,
            hierarchy_level: unit.hierarchy_level,
            description: unit.description || null,
          }, { onConflict: "id" });

        if (error) {
          handleError(`unit ${unit.unit_name}`, error);
        } else {
          stats.units++;
          queue.push(unit.id);
        }
      }
    }

    console.log(`  ✓ RUC ${ruc}: ${structure.units.length} units`);
  }
}

// Step 3: Migrate personnel
async function migratePersonnel(rucToOrgId: Map<string, string>): Promise<void> {
  console.log("\n👥 Migrating personnel...");

  for (const [ruc, orgId] of Array.from(rucToOrgId.entries())) {
    const membersPath = path.join(DATA_DIR, "unit", ruc, "unit-members.json");
    const members = readJsonFile<UnitMembers>(membersPath);

    if (!members?.personnel) {
      console.warn(`  No personnel found for RUC ${ruc}`);
      continue;
    }

    // Batch insert personnel
    const personnelData = members.personnel.map((p) => ({
      id: p.id,
      organization_id: orgId,
      unit_id: p.unit_section_id,
      service_id: p.service_id,
      first_name: p.first_name,
      last_name: p.last_name,
      rank: p.rank,
      current_duty_score: p.current_duty_score || 0,
    }));

    const { error } = await supabase
      .from("personnel")
      .upsert(personnelData, { onConflict: "id" });

    if (error) {
      handleError(`personnel for RUC ${ruc}`, error);
    } else {
      stats.personnel += personnelData.length;
      console.log(`  ✓ RUC ${ruc}: ${personnelData.length} personnel`);
    }
  }
}

// Step 4: Migrate qualifications
async function migrateQualifications(rucToOrgId: Map<string, string>): Promise<void> {
  console.log("\n📜 Migrating qualifications...");

  for (const [ruc, orgId] of Array.from(rucToOrgId.entries())) {
    const qualsPath = path.join(DATA_DIR, "unit", ruc, "qualifications.json");
    const qualsData = readJsonFile<QualificationsData>(qualsPath);

    if (!qualsData?.qualifications) {
      continue;
    }

    // Insert qualifications
    const qualifications = qualsData.qualifications.map((q) => ({
      id: q.id,
      organization_id: orgId,
      name: q.name,
      description: q.description || null,
    }));

    const { error: qualError } = await supabase
      .from("qualifications")
      .upsert(qualifications, { onConflict: "id" });

    if (qualError) {
      handleError(`qualifications for RUC ${ruc}`, qualError);
    } else {
      stats.qualifications += qualifications.length;
    }

    // Insert personnel qualifications
    if (qualsData.personnelQualifications) {
      const pqData = qualsData.personnelQualifications.map((pq) => ({
        id: pq.id,
        personnel_id: pq.personnel_id,
        qualification_id: pq.qualification_id,
        earned_date: pq.earned_date || null,
        expiration_date: pq.expiration_date || null,
      }));

      const { error: pqError } = await supabase
        .from("personnel_qualifications")
        .upsert(pqData, { onConflict: "id" });

      if (pqError) {
        handleError(`personnel qualifications for RUC ${ruc}`, pqError);
      } else {
        stats.personnelQualifications += pqData.length;
      }
    }

    console.log(`  ✓ RUC ${ruc}: ${qualifications.length} qualifications`);
  }
}

// Step 5: Migrate duty types
async function migrateDutyTypes(rucToOrgId: Map<string, string>): Promise<void> {
  console.log("\n📋 Migrating duty types...");

  for (const [ruc, orgId] of Array.from(rucToOrgId.entries())) {
    const typesPath = path.join(DATA_DIR, "unit", ruc, "duty-types.json");
    const typesData = readJsonFile<DutyTypesData>(typesPath);

    if (!typesData?.dutyTypes) {
      continue;
    }

    // Insert duty types
    const dutyTypes = typesData.dutyTypes.map((dt) => ({
      id: dt.id,
      organization_id: orgId,
      unit_id: dt.unit_section_id,
      name: dt.name,
      description: dt.description || null,
      personnel_required: dt.personnel_required || 1,
      rank_filter_mode: dt.rank_filter_mode || "none",
      rank_filter_values: dt.rank_filter_values || null,
      section_filter_mode: dt.section_filter_mode || "none",
      section_filter_values: dt.section_filter_values || null,
    }));

    const { error: dtError } = await supabase
      .from("duty_types")
      .upsert(dutyTypes, { onConflict: "id" });

    if (dtError) {
      handleError(`duty types for RUC ${ruc}`, dtError);
    } else {
      stats.dutyTypes += dutyTypes.length;
    }

    // Insert duty values
    if (typesData.dutyValues) {
      const { error: dvError } = await supabase
        .from("duty_values")
        .upsert(typesData.dutyValues.map((dv) => ({
          id: dv.id,
          duty_type_id: dv.duty_type_id,
          day_of_week: dv.day_of_week,
          value: dv.value,
        })), { onConflict: "id" });

      if (dvError) {
        handleError(`duty values for RUC ${ruc}`, dvError);
      } else {
        stats.dutyValues += typesData.dutyValues.length;
      }
    }

    // Insert duty requirements
    if (typesData.dutyRequirements) {
      const { error: drError } = await supabase
        .from("duty_requirements")
        .upsert(typesData.dutyRequirements.map((dr) => ({
          id: dr.id,
          duty_type_id: dr.duty_type_id,
          qualification_id: dr.qualification_id,
          is_required: dr.is_required ?? true,
        })), { onConflict: "id" });

      if (drError) {
        handleError(`duty requirements for RUC ${ruc}`, drError);
      } else {
        stats.dutyRequirements += typesData.dutyRequirements.length;
      }
    }

    console.log(`  ✓ RUC ${ruc}: ${dutyTypes.length} duty types`);
  }
}

// Step 6: Migrate duty slots (roster)
async function migrateDutySlots(rucToOrgId: Map<string, string>): Promise<void> {
  console.log("\n📅 Migrating duty slots...");

  for (const [ruc, orgId] of Array.from(rucToOrgId.entries())) {
    const rosterPath = path.join(DATA_DIR, "unit", ruc, "duty-roster.json");
    const rosterData = readJsonFile<DutyRoster>(rosterPath);

    if (!rosterData?.dutySlots) {
      continue;
    }

    const slots = rosterData.dutySlots.map((slot) => ({
      id: slot.id,
      organization_id: orgId,
      duty_type_id: slot.duty_type_id,
      personnel_id: slot.personnel_id,
      date_assigned: slot.date_assigned,
      status: slot.status || "scheduled",
      assigned_by: slot.assigned_by || null,
    }));

    const { error } = await supabase
      .from("duty_slots")
      .upsert(slots, { onConflict: "id" });

    if (error) {
      handleError(`duty slots for RUC ${ruc}`, error);
    } else {
      stats.dutySlots += slots.length;
      console.log(`  ✓ RUC ${ruc}: ${slots.length} duty slots`);
    }
  }
}

// Step 7: Migrate non-availability
async function migrateNonAvailability(rucToOrgId: Map<string, string>): Promise<void> {
  console.log("\n🚫 Migrating non-availability...");

  for (const [ruc, orgId] of Array.from(rucToOrgId.entries())) {
    const naPath = path.join(DATA_DIR, "unit", ruc, "non-availability.json");
    const naData = readJsonFile<NonAvailabilityData>(naPath);

    if (!naData?.nonAvailability) {
      continue;
    }

    const records = naData.nonAvailability.map((na) => ({
      id: na.id,
      organization_id: orgId,
      personnel_id: na.personnel_id,
      start_date: na.start_date,
      end_date: na.end_date,
      reason: na.reason || null,
      status: na.status || "pending",
      submitted_by: na.submitted_by || null,
      approved_by: na.approved_by || null,
    }));

    const { error } = await supabase
      .from("non_availability")
      .upsert(records, { onConflict: "id" });

    if (error) {
      handleError(`non-availability for RUC ${ruc}`, error);
    } else {
      stats.nonAvailability += records.length;
      console.log(`  ✓ RUC ${ruc}: ${records.length} non-availability records`);
    }
  }
}

// Step 8: Migrate users and roles
async function migrateUsers(): Promise<void> {
  console.log("\n👤 Migrating users...");

  // First, get role IDs from the database
  const { data: roles, error: rolesError } = await supabase
    .from("roles")
    .select("id, name");

  if (rolesError || !roles) {
    console.error("Could not fetch roles:", rolesError);
    return;
  }

  const roleMap = new Map(roles.map((r) => [r.name, r.id]));

  // Read user files from public/data/user/
  const userDir = path.join(DATA_DIR, "user");
  if (!fs.existsSync(userDir)) {
    console.warn("No user directory found");
    return;
  }

  const userFiles = fs.readdirSync(userDir).filter((f) => f.endsWith(".json"));

  for (const file of userFiles) {
    const userData = readJsonFile<UserData>(path.join(userDir, file));
    if (!userData) continue;

    // Decrypt the EDIPI (stored as plain text in Supabase)
    const plainEdipi = decryptEdipi(userData.edipi_encrypted);
    if (!plainEdipi) {
      console.warn(`  ⚠️  Skipping user ${userData.email} - could not decrypt EDIPI`);
      continue;
    }

    // Insert user with plain EDIPI and password_hash
    const { error: userError } = await supabase
      .from("users")
      .upsert({
        id: userData.id,
        edipi: plainEdipi,
        email: userData.email,
        password_hash: userData.password_hash,
        personnel_id: userData.personnel_id || null,
        can_approve_non_availability: userData.can_approve_non_availability ?? false,
      }, { onConflict: "id" });

    if (userError) {
      handleError(`user ${userData.email}`, userError);
      continue;
    }

    stats.users++;
    console.log(`  ✓ User: ${userData.email} (EDIPI: ${plainEdipi})`);

    // Migrate user roles
    if (userData.roles && userData.roles.length > 0) {
      for (const role of userData.roles) {
        const roleId = roleMap.get(role.role_name);
        if (!roleId) {
          console.warn(`    ⚠️  Unknown role: ${role.role_name}`);
          continue;
        }

        const { error: roleError } = await supabase
          .from("user_roles")
          .upsert({
            id: role.id || `role-${userData.id}-${role.role_name.toLowerCase().replace(/\s+/g, "-")}`,
            user_id: userData.id,
            role_id: roleId,
            scope_unit_id: role.scope_unit_id || null,
          }, { onConflict: "id" });

        if (roleError) {
          handleError(`role ${role.role_name} for user ${userData.email}`, roleError);
        } else {
          stats.userRoles++;
        }
      }
    }
  }

  console.log(`\n  ✓ Users migrated: ${stats.users}`);
  console.log(`  ✓ User roles migrated: ${stats.userRoles}`);
}

// Main migration function
async function migrate(): Promise<void> {
  console.log("═══════════════════════════════════════════════════════════");
  console.log("       DutySync Data Migration: JSON → Supabase");
  console.log("═══════════════════════════════════════════════════════════");
  console.log(`\nSupabase URL: ${supabaseUrl}`);
  console.log(`Data directory: ${DATA_DIR}`);

  const startTime = Date.now();

  try {
    // Run migrations in order (respecting foreign key constraints)
    const rucToOrgId = await migrateOrganizations();
    await migrateUnits(rucToOrgId);
    await migratePersonnel(rucToOrgId);
    await migrateQualifications(rucToOrgId);
    await migrateDutyTypes(rucToOrgId);
    await migrateDutySlots(rucToOrgId);
    await migrateNonAvailability(rucToOrgId);
    await migrateUsers();

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);

    console.log("\n═══════════════════════════════════════════════════════════");
    console.log("                    Migration Complete!");
    console.log("═══════════════════════════════════════════════════════════");
    console.log("\nStatistics:");
    console.log(`  Organizations:           ${stats.organizations}`);
    console.log(`  Units:                   ${stats.units}`);
    console.log(`  Personnel:               ${stats.personnel}`);
    console.log(`  Qualifications:          ${stats.qualifications}`);
    console.log(`  Personnel Qualifications: ${stats.personnelQualifications}`);
    console.log(`  Duty Types:              ${stats.dutyTypes}`);
    console.log(`  Duty Values:             ${stats.dutyValues}`);
    console.log(`  Duty Requirements:       ${stats.dutyRequirements}`);
    console.log(`  Duty Slots:              ${stats.dutySlots}`);
    console.log(`  Non-Availability:        ${stats.nonAvailability}`);
    console.log(`  Users (pending auth):    ${stats.users}`);
    console.log(`  User Roles (pending):    ${stats.userRoles}`);
    console.log(`\nDuration: ${duration}s`);

  } catch (error) {
    console.error("\n❌ Migration failed:", error);
    process.exit(1);
  }
}

// Run migration
migrate();
