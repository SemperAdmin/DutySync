"use client";

import Link from "next/link";
import Logo from "@/components/ui/Logo";
import Button from "@/components/ui/Button";
import { useAuth } from "@/lib/client-auth";

export default function HomePage() {
  const { user } = useAuth();

  return (
    <div className="min-h-screen flex flex-col">
      {/* Background Pattern */}
      <div className="fixed inset-0 bg-gradient-to-br from-background via-background to-background-secondary -z-10" />
      <div
        className="fixed inset-0 -z-10"
        style={{
          backgroundImage: `radial-gradient(circle at 20% 30%, rgba(26, 35, 126, 0.2) 0%, transparent 40%),
                           radial-gradient(circle at 80% 70%, rgba(26, 35, 126, 0.15) 0%, transparent 40%)`,
        }}
      />

      {/* Header */}
      <header className="p-6 flex items-center justify-between">
        <Logo size="md" />
        <nav className="flex items-center gap-4">
          {user ? (
            <>
              <span className="text-foreground-muted text-sm">
                Welcome, {user.displayName || user.edipi || user.email}
              </span>
              <Link href="/admin">
                <Button variant="secondary" size="sm">
                  Dashboard
                </Button>
              </Link>
            </>
          ) : (
            <>
              <Link href="/login">
                <Button variant="ghost" size="sm">
                  Sign In
                </Button>
              </Link>
              <Link href="/signup">
                <Button variant="accent" size="sm">
                  Get Started
                </Button>
              </Link>
            </>
          )}
        </nav>
      </header>

      {/* Hero Section */}
      <main className="flex-1 flex items-center justify-center p-6">
        <div className="max-w-4xl mx-auto text-center">
          <h1 className="text-5xl md:text-6xl font-bold text-foreground mb-6 leading-tight">
            Streamline Your
            <span className="block text-highlight">Duty Roster</span>
            Management
          </h1>
          <p className="text-xl text-foreground-muted mb-8 max-w-2xl mx-auto">
            A scalable, automated, and fair digital system for military duty roster
            management. Replace manual processes with intelligent scheduling.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-12">
            {user ? (
              <Link href="/admin">
                <Button variant="accent" size="lg">
                  Go to Dashboard
                </Button>
              </Link>
            ) : (
              <>
                <Link href="/signup">
                  <Button variant="accent" size="lg">
                    Get Started
                  </Button>
                </Link>
                <Link href="/login">
                  <Button variant="secondary" size="lg">
                    Sign In
                  </Button>
                </Link>
              </>
            )}
          </div>

          {/* Features */}
          <div className="grid md:grid-cols-3 gap-6 mt-16">
            <FeatureCard
              icon={
                <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
                </svg>
              }
              title="Automated Scheduling"
              description="Duty Thruster algorithm ensures fair and efficient duty assignments based on qualifications and availability."
            />
            <FeatureCard
              icon={
                <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 6l3 1m0 0l-3 9a5.002 5.002 0 006.001 0M6 7l3 9M6 7l6-2m6 2l3-1m-3 1l-3 9a5.002 5.002 0 006.001 0M18 7l3 9m-3-9l-6-2m0-2v2m0 16V5m0 16H9m3 0h3" />
                </svg>
              }
              title="Fair Point System"
              description="Track duty scores with weighted points for weekends, holidays, and duty types to ensure equitable distribution."
            />
            <FeatureCard
              icon={
                <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                </svg>
              }
              title="Role-Based Access"
              description="Secure access control with App Admin, Unit Admin, and Standard User roles for proper data governance."
            />
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="p-6 text-center border-t border-border">
        <p className="text-sm text-foreground-muted">
          Duty Sync MVP - Built for Military Duty Roster Management
        </p>
      </footer>
    </div>
  );
}

function FeatureCard({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="p-6 rounded-xl bg-surface border border-border hover:border-border-light transition-colors">
      <div className="w-14 h-14 rounded-lg bg-primary/20 flex items-center justify-center text-highlight mb-4 mx-auto">
        {icon}
      </div>
      <h3 className="text-lg font-semibold text-foreground mb-2">{title}</h3>
      <p className="text-sm text-foreground-muted">{description}</p>
    </div>
  );
}
