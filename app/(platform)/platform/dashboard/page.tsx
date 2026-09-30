import Link from "next/link";
import { PageHeader } from "@/components/ui/PageHeader";

export const metadata = { title: "Platform overview" };

const platformLinks = [
  { href: "/platform/tenants", title: "Organisations", description: "Create and review organisation workspaces.", action: "Manage organisations" },
  { href: "/platform/admins", title: "Platform access", description: "Manage administrators who operate the platform.", action: "Manage administrators" },
];

export default function PlatformDashboard() {
  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader eyebrow="Platform" title="Platform operations." description="A focused starting point for organisation setup and platform access." />
      <div className="grid gap-4 lg:grid-cols-2">
        {platformLinks.map((item) => (
          <Link key={item.href} href={item.href} className="group flex min-h-52 flex-col rounded-xl border border-slate-200 bg-white p-6 transition-colors hover:border-brand-300 hover:bg-brand-50/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-brand-700 dark:hover:bg-slate-900">
            <span className="text-xs font-semibold uppercase tracking-[0.1em] text-slate-500">{item.title}</span>
            <span className="mt-5 text-xl font-semibold tracking-tight text-slate-900 group-hover:text-brand-900 dark:text-white dark:group-hover:text-brand-200">{item.action}</span>
            <span className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-400">{item.description}</span>
            <span aria-hidden="true" className="mt-auto pt-6 text-lg text-brand-800">→</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
