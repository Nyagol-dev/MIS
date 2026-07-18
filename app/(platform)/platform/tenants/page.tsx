import { TenantTable } from "@/components/platform/TenantTable";
import { TenantCreateForm } from "@/components/platform/TenantCreateForm";

export default function TenantsPage() {
  return (
    <div className="space-y-6 max-w-7xl mx-auto p-6">
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Tenants</h1>
        <TenantCreateForm />
      </div>
      <TenantTable />
    </div>
  );
}
