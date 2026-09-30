import { TenantTable } from "@/components/platform/TenantTable";
import { TenantCreateForm } from "@/components/platform/TenantCreateForm";
import { PageHeader } from "@/components/ui/PageHeader";

export default function TenantsPage() {
  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader eyebrow="Platform operations" title="Organisations" description="Create and maintain organisation workspaces on the platform." actions={<TenantCreateForm />} />
      <TenantTable />
    </div>
  );
}
