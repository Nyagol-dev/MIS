import { cookies } from "next/headers";
import { verifyAnySession, COOKIE_NAME } from "@/lib/auth/session";
import { AdminTable } from "@/components/platform/AdminTable";
import { AdminCreateForm } from "@/components/platform/AdminCreateForm";
import { PageHeader } from "@/components/ui/PageHeader";

export default async function AdminsPage() {
  const cookieStore = await cookies();
  const cookie = cookieStore.get(COOKIE_NAME);
  const session = cookie?.value ? await verifyAnySession(cookie.value) : null;
  const currentAdminId = session?.sessionKind === 'platform_admin' ? session.platformAdminId : null;

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader eyebrow="Platform access" title="Administrators" description="Manage the accounts that can operate platform-level settings." actions={<AdminCreateForm />} />
      <AdminTable currentAdminId={currentAdminId} />
    </div>
  );
}
