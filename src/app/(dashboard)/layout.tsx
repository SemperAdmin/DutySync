"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/supabase-auth";
import DashboardLayout from "@/components/layout/DashboardLayout";

export default function DashboardRootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, isLoading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!isLoading && !user) {
      router.push("/login");
    }
  }, [user, isLoading, router]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-foreground-muted">Loading...</div>
      </div>
    );
  }

  if (!user) {
    return null;
  }

  return <DashboardLayout user={user}>{children}</DashboardLayout>;
}
