import { redirect } from "next/navigation";
import { auth, getSessionUser } from "@/lib/auth";
import DashboardLayout from "@/components/layout/DashboardLayout";

export default async function DashboardRootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();

  if (!session) {
    redirect("/login");
  }

  const user = getSessionUser(session);

  return (
    <DashboardLayout user={user}>
      {children}
    </DashboardLayout>
  );
}
