"use client";

import Card, { CardHeader, CardTitle, CardContent } from "@/components/ui/Card";
import { useAuth } from "@/lib/client-auth";

export default function ProfilePage() {
  const { user } = useAuth();

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
          <CardHeader>
            <CardTitle>Account Information</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className="text-sm text-foreground-muted">EDIPI</label>
              <p className="font-medium text-foreground font-mono">
                {user?.edipi}
              </p>
            </div>
            <div>
              <label className="text-sm text-foreground-muted">Email</label>
              <p className="font-medium text-foreground">
                {user?.email}
              </p>
            </div>
            <div>
              <label className="text-sm text-foreground-muted">User ID</label>
              <p className="font-mono text-sm text-foreground-muted">
                {user?.id}
              </p>
            </div>
            <div>
              <label className="text-sm text-foreground-muted">
                Personnel Linked
              </label>
              <p className="font-medium text-foreground">
                {user?.personnel_id ? (
                  <span className="text-success">Yes</span>
                ) : (
                  <span className="text-warning">Not linked</span>
                )}
              </p>
            </div>
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
                        Unit Scope: {role.scope_unit_id}
                      </p>
                    )}
                  </div>
                  <span
                    className={`px-2 py-0.5 text-xs font-medium rounded ${
                      role.role_name === "App Admin"
                        ? "bg-highlight/20 text-highlight"
                        : role.role_name === "Unit Admin"
                        ? "bg-primary/20 text-blue-400"
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
