"use client";

import Card, { CardHeader, CardTitle, CardContent } from "@/components/ui/Card";
import Link from "next/link";
import Button from "@/components/ui/Button";
import { useAuth } from "@/lib/client-auth";

export default function AdminDashboard() {
  const { user } = useAuth();
  const isAdmin = user?.roles?.some(
    (role) => role.role_name === "App Admin"
  );

  return (
    <div className="space-y-6">
      {/* Welcome Section */}
      <div>
        <h1 className="text-3xl font-bold text-foreground">Dashboard</h1>
        <p className="text-foreground-muted mt-1">
          Welcome back, {user?.username}
        </p>
      </div>

      {/* Quick Stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="Total Personnel"
          value="--"
          description="Active service members"
          icon={
            <svg
              className="w-6 h-6"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"
              />
            </svg>
          }
        />
        <StatCard
          title="Unit Sections"
          value="--"
          description="Active units"
          icon={
            <svg
              className="w-6 h-6"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"
              />
            </svg>
          }
        />
        <StatCard
          title="Upcoming Duties"
          value="--"
          description="Next 7 days"
          icon={
            <svg
              className="w-6 h-6"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
              />
            </svg>
          }
        />
        <StatCard
          title="Your Duty Score"
          value="--"
          description="Accumulated points"
          icon={
            <svg
              className="w-6 h-6"
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
          }
        />
      </div>

      {/* Admin Quick Actions */}
      {isAdmin && (
        <Card>
          <CardHeader>
            <CardTitle>App Admin Quick Actions</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Link href="/admin/units">
                <div className="p-4 rounded-lg border border-border hover:border-primary hover:bg-surface-elevated transition-colors cursor-pointer">
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-primary/20">
                      <svg
                        className="w-5 h-5 text-highlight"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M12 6v6m0 0v6m0-6h6m-6 0H6"
                        />
                      </svg>
                    </div>
                    <div>
                      <h3 className="font-medium text-foreground">
                        Manage Units
                      </h3>
                      <p className="text-sm text-foreground-muted">
                        Add or edit unit sections
                      </p>
                    </div>
                  </div>
                </div>
              </Link>

              <Link href="/admin/users">
                <div className="p-4 rounded-lg border border-border hover:border-primary hover:bg-surface-elevated transition-colors cursor-pointer">
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-primary/20">
                      <svg
                        className="w-5 h-5 text-highlight"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z"
                        />
                      </svg>
                    </div>
                    <div>
                      <h3 className="font-medium text-foreground">
                        Manage Users
                      </h3>
                      <p className="text-sm text-foreground-muted">
                        Assign roles and permissions
                      </p>
                    </div>
                  </div>
                </div>
              </Link>

              <div className="p-4 rounded-lg border border-border hover:border-primary hover:bg-surface-elevated transition-colors cursor-pointer opacity-50">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-primary/20">
                    <svg
                      className="w-5 h-5 text-highlight"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"
                      />
                    </svg>
                  </div>
                  <div>
                    <h3 className="font-medium text-foreground">Import Data</h3>
                    <p className="text-sm text-foreground-muted">
                      Upload personnel CSV (Coming Soon)
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Getting Started Guide */}
      <Card>
        <CardHeader>
          <CardTitle>Getting Started</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <SetupStep
              number={1}
              title="Set up Unit Structure"
              description="Define your battalion, companies, platoons, and sections"
              completed={false}
              action={
                isAdmin ? (
                  <Link href="/admin/units">
                    <Button variant="secondary" size="sm">
                      Configure
                    </Button>
                  </Link>
                ) : null
              }
            />
            <SetupStep
              number={2}
              title="Import Personnel"
              description="Upload your unit's personnel roster via CSV"
              completed={false}
              disabled
            />
            <SetupStep
              number={3}
              title="Configure Duty Types"
              description="Set up duty types with requirements and point values"
              completed={false}
              disabled
            />
            <SetupStep
              number={4}
              title="Generate Roster"
              description="Use Duty Thruster to auto-generate fair schedules"
              completed={false}
              disabled
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function StatCard({
  title,
  value,
  description,
  icon,
}: {
  title: string;
  value: string;
  description: string;
  icon: React.ReactNode;
}) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-sm text-foreground-muted">{title}</p>
            <p className="text-3xl font-bold text-foreground mt-1">{value}</p>
            <p className="text-xs text-foreground-muted mt-1">{description}</p>
          </div>
          <div className="p-2 rounded-lg bg-primary/20 text-highlight">
            {icon}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function SetupStep({
  number,
  title,
  description,
  completed,
  disabled,
  action,
}: {
  number: number;
  title: string;
  description: string;
  completed: boolean;
  disabled?: boolean;
  action?: React.ReactNode;
}) {
  return (
    <div
      className={`flex items-center gap-4 p-4 rounded-lg border ${
        disabled
          ? "border-border opacity-50"
          : completed
          ? "border-success/30 bg-success/5"
          : "border-border"
      }`}
    >
      <div
        className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${
          completed
            ? "bg-success text-white"
            : disabled
            ? "bg-surface-elevated text-foreground-muted"
            : "bg-primary text-white"
        }`}
      >
        {completed ? (
          <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
            <path
              fillRule="evenodd"
              d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
              clipRule="evenodd"
            />
          </svg>
        ) : (
          number
        )}
      </div>
      <div className="flex-1">
        <h3 className="font-medium text-foreground">{title}</h3>
        <p className="text-sm text-foreground-muted">{description}</p>
      </div>
      {action && !disabled && <div>{action}</div>}
    </div>
  );
}
