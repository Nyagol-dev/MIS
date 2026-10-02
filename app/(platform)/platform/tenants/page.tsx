import { TenantTable } from "@/components/platform/TenantTable";
import { TenantCreateForm } from "@/components/platform/TenantCreateForm";
import { PageHeader } from "@/components/ui/PageHeader";

export default function TenantsPage() {
  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader eyebrow="Platform operations" title="Hospital provisioning" description="Provision the hospital tenant during an approved maintenance window." actions={process.env.ALLOW_TENANT_PROVISIONING === "true" ? <TenantCreateForm /> : undefined} />
      <TenantTable />
    </div>
  );
}
