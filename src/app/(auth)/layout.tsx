import { ReactNode } from "react";
import Logo from "@/components/ui/Logo";

interface AuthLayoutProps {
  children: ReactNode;
}

export default function AuthLayout({ children }: AuthLayoutProps) {
  return (
    <div className="min-h-screen flex flex-col bg-background">
      {/* Background Pattern */}
      <div className="fixed inset-0 bg-gradient-to-br from-background via-background to-background-secondary opacity-50 -z-10" />
      <div
        className="fixed inset-0 -z-10"
        style={{
          backgroundImage: `radial-gradient(circle at 25% 25%, rgba(26, 35, 126, 0.15) 0%, transparent 50%),
                           radial-gradient(circle at 75% 75%, rgba(26, 35, 126, 0.1) 0%, transparent 50%)`,
        }}
      />

      {/* Header */}
      <header className="p-6">
        <Logo size="sm" />
      </header>

      {/* Main Content */}
      <main className="flex-1 flex items-center justify-center p-6">
        {children}
      </main>

      {/* Footer */}
      <footer className="p-6 text-center">
        <p className="text-sm text-foreground-muted">
          Duty Sync MVP - Military Duty Roster Management System
        </p>
      </footer>
    </div>
  );
}
