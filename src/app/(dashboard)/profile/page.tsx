"use client";

import { useState, useEffect, useCallback } from "react";
import Card, { CardHeader, CardTitle, CardContent } from "@/components/ui/Card";
import { useAuth } from "@/lib/supabase-auth";
import { getUnitSections, getPersonnelByEdipi } from "@/lib/data-layer";
import { updatePersonnel } from "@/lib/client-stores";
import { useToast } from "@/components/ui/Toast";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import type { UnitSection, Personnel } from "@/types";

export default function ProfilePage() {
  const { user } = useAuth();
  const toast = useToast();
  const [units, setUnits] = useState<UnitSection[]>([]);
  const [fullUnitPath, setFullUnitPath] = useState<string>("");
  const [personnel, setPersonnel] = useState<Personnel | null>(null);

  // Editing state
  const [isEditing, setIsEditing] = useState(false);
  const [editEmail, setEditEmail] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const loadProfileData = useCallback(() => {
    const allUnits = getUnitSections();
    setUnits(allUnits);

    // Fetch fresh personnel data by EDIPI (not from stale session)
    if (user?.edipi) {
      const person = getPersonnelByEdipi(user.edipi);
      if (person) {
        setPersonnel(person);
        const path = buildUnitPath(person.unit_section_id, allUnits);
        setFullUnitPath(path);
      } else {
        setPersonnel(null);
        setFullUnitPath("");
      }
    }
  }, [user?.edipi]);

  useEffect(() => {
    loadProfileData();
  }, [loadProfileData]);

  // Build the full unit hierarchy path (e.g., "H Company > S1DV > CUST")
  function buildUnitPath(unitId: string, allUnits: UnitSection[]): string {
    const path: string[] = [];
    let currentUnit = allUnits.find(u => u.id === unitId);

    while (currentUnit) {
      path.unshift(currentUnit.unit_name);
      currentUnit = currentUnit.parent_id
        ? allUnits.find(u => u.id === currentUnit?.parent_id)
        : undefined;
    }

    return path.join(" > ");
  }

  // Get unit path by ID (full hierarchy)
  // Note: Uses getUnitSections() directly to ensure we have latest data
  function getUnitPath(unitId: string | null): string {
    if (!unitId) return "Global";
    const allUnits = getUnitSections();
    return buildUnitPath(unitId, allUnits) || "Unknown Unit";
  }

  // Start editing - populate form with current values
  function startEditing() {
    setEditEmail(user?.email || "");
    setEditPhone(personnel?.phone_number || "");
    setIsEditing(true);
  }

  // Cancel editing
  function cancelEditing() {
    setIsEditing(false);
    setEditEmail("");
    setEditPhone("");
  }

  // Save changes
  async function saveChanges() {
    if (!personnel) {
      toast.error("No personnel record linked to update");
      return;
    }

    setIsSaving(true);
    try {
      // Update phone number on personnel record
      const updated = updatePersonnel(personnel.id, {
        phone_number: editPhone || null,
      });

      if (updated) {
        setPersonnel(updated);
        // Reload profile data to ensure we have latest from storage
        loadProfileData();
        toast.success("Profile updated successfully");
        setIsEditing(false);
      } else {
        toast.error("Failed to update profile");
      }
    } catch (err) {
      console.error("Error updating profile:", err);
      toast.error("Error updating profile");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-foreground">My Profile</h1>
        <p className="text-foreground-muted mt-1">
          View your account information and duty history
        </p>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        {/* Account Information */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Account Information</CardTitle>
            {personnel && !isEditing && (
              <Button
                variant="secondary"
                size="sm"
                onClick={startEditing}
                aria-label="Edit profile"
              >
                <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                </svg>
                Edit Profile
              </Button>
            )}
            {isEditing && (
              <span className="text-sm text-primary font-medium">Editing...</span>
            )}
          </CardHeader>
          <CardContent className="space-y-4">
            {personnel && (
              <div className="p-3 rounded-lg bg-primary/10 border border-primary/20">
                <label className="text-sm text-foreground-muted">Service Member</label>
                <p className="text-lg font-bold text-foreground">
                  {personnel.rank} {personnel.last_name}, {personnel.first_name}
                </p>
                {fullUnitPath && (
                  <p className="text-sm text-foreground-muted mt-1">
                    {fullUnitPath}
                  </p>
                )}
              </div>
            )}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm text-foreground-muted">EDIPI</label>
                <p className="font-medium text-foreground font-mono">
                  {user?.edipi}
                </p>
              </div>
              {personnel?.rank && (
                <div>
                  <label className="text-sm text-foreground-muted">Rank</label>
                  <p className="font-medium text-foreground">
                    {personnel.rank}
                  </p>
                </div>
              )}
            </div>
            {personnel && (
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-sm text-foreground-muted">First Name</label>
                  <p className="font-medium text-foreground">
                    {personnel.first_name}
                  </p>
                </div>
                <div>
                  <label className="text-sm text-foreground-muted">Last Name</label>
                  <p className="font-medium text-foreground">
                    {personnel.last_name}
                  </p>
                </div>
              </div>
            )}

            {/* Email field - editable */}
            <div>
              <label className="text-sm text-foreground-muted">Email</label>
              {isEditing ? (
                <Input
                  type="email"
                  value={editEmail}
                  onChange={(e) => setEditEmail(e.target.value)}
                  placeholder="Enter email address"
                  className="mt-1"
                  disabled
                  title="Email changes require account verification. Contact your administrator."
                />
              ) : (
                <p className="font-medium text-foreground">
                  {user?.email}
                </p>
              )}
              {isEditing && (
                <p className="text-xs text-foreground-muted mt-1">
                  Email changes require account verification
                </p>
              )}
            </div>

            {/* Phone field - editable */}
            <div>
              <label className="text-sm text-foreground-muted">Phone Number</label>
              {isEditing ? (
                <Input
                  type="tel"
                  value={editPhone}
                  onChange={(e) => setEditPhone(e.target.value)}
                  placeholder="Enter phone number"
                  className="mt-1"
                />
              ) : (
                <p className="font-medium text-foreground">
                  {personnel?.phone_number || <span className="text-foreground-muted italic">Not set</span>}
                </p>
              )}
            </div>

            <div>
              <label className="text-sm text-foreground-muted">
                Personnel Linked
              </label>
              <p className="font-medium text-foreground">
                {personnel ? (
                  <span className="text-success">Yes - Linked to roster</span>
                ) : (
                  <span className="text-warning">Not linked - Import roster with matching EDIPI</span>
                )}
              </p>
            </div>

            {/* Edit action buttons */}
            {isEditing && (
              <div className="flex gap-2 pt-2">
                <Button
                  variant="primary"
                  onClick={saveChanges}
                  disabled={isSaving}
                >
                  {isSaving ? "Saving..." : "Save Changes"}
                </Button>
                <Button
                  variant="secondary"
                  onClick={cancelEditing}
                  disabled={isSaving}
                >
                  Cancel
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Roles */}
        <Card>
          <CardHeader>
            <CardTitle>Assigned Roles</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {user?.roles?.map((role) => (
                <div
                  key={role.id}
                  className="flex items-center justify-between p-3 rounded-lg bg-surface-elevated border border-border"
                >
                  <div>
                    <p className="font-medium text-foreground">
                      {role.role_name}
                    </p>
                    {role.scope_unit_id && (
                      <p className="text-sm text-foreground-muted">
                        Unit Scope: {getUnitPath(role.scope_unit_id)}
                      </p>
                    )}
                  </div>
                  <span
                    className={`px-2 py-0.5 text-xs font-medium rounded ${
                      role.role_name === "App Admin"
                        ? "bg-highlight/20 text-highlight"
                        : role.role_name === "Unit Admin"
                        ? "bg-primary/20 text-blue-400"
                        : role.role_name.includes("Manager")
                        ? "bg-success/20 text-success"
                        : "bg-foreground-muted/20 text-foreground-muted"
                    }`}
                  >
                    {role.role_name}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Duty Score */}
      <Card>
        <CardHeader>
          <CardTitle>Duty Statistics</CardTitle>
        </CardHeader>
        <CardContent className="py-8 text-center">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-highlight/20 flex items-center justify-center">
            <svg
              className="w-8 h-8 text-highlight"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M3 6l3 1m0 0l-3 9a5.002 5.002 0 006.001 0M6 7l3 9M6 7l6-2m6 2l3-1m-3 1l-3 9a5.002 5.002 0 006.001 0M18 7l3 9m-3-9l-6-2m0-2v2m0 16V5m0 16H9m3 0h3"
              />
            </svg>
          </div>
          <p className="text-4xl font-bold text-highlight mb-2">--</p>
          <p className="text-foreground-muted">Current Duty Score</p>
          <p className="text-sm text-foreground-muted mt-4 max-w-md mx-auto">
            Your duty score will be calculated once you are linked to a personnel
            record and start completing duty assignments.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
