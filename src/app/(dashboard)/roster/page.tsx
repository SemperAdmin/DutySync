import Card, { CardHeader, CardTitle, CardContent } from "@/components/ui/Card";

export default function RosterPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-foreground">Duty Roster</h1>
        <p className="text-foreground-muted mt-1">
          View and manage duty assignments
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Coming Soon</CardTitle>
        </CardHeader>
        <CardContent className="py-12 text-center">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-primary/20 flex items-center justify-center">
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
                d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
              />
            </svg>
          </div>
          <h2 className="text-xl font-semibold text-foreground mb-2">
            Duty Roster Feature
          </h2>
          <p className="text-foreground-muted max-w-md mx-auto">
            The duty roster calendar view is under development. Once unit
            sections, personnel, and duty types are configured, you&apos;ll be able
            to view and manage duty assignments here.
          </p>
          <div className="mt-8 p-4 rounded-lg bg-surface-elevated border border-border max-w-sm mx-auto text-left">
            <h3 className="text-sm font-medium text-foreground mb-2">
              Upcoming Features:
            </h3>
            <ul className="text-sm text-foreground-muted space-y-1">
              <li className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-highlight" />
                Calendar view of duty assignments
              </li>
              <li className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-highlight" />
                Duty Thruster auto-scheduling
              </li>
              <li className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-highlight" />
                Manual assignment overrides
              </li>
              <li className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-highlight" />
                Export to PDF/Excel
              </li>
            </ul>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
