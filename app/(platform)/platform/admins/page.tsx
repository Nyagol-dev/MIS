import { cookies } from "next/headers";
import { verifyAnySession, COOKIE_NAME } from "@/lib/auth/session";
import { AdminTable } from "@/components/platform/AdminTable";
import { AdminCreateForm } from "@/components/platform/AdminCreateForm";

export default async function AdminsPage() {
  const cookieStore = await cookies();
  const cookie = cookieStore.get(COOKIE_NAME);
  const session = cookie?.value ? await verifyAnySession(cookie.value) : null;
  const currentAdminId = session?.sessionKind === 'platform_admin' ? session.platformAdminId : null;

  return (
    <div className="space-y-6 max-w-7xl mx-auto p-6">
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Platform Admins</h1>
        <AdminCreateForm />
      </div>
      <AdminTable currentAdminId={currentAdminId} />
    </div>
  );
}
