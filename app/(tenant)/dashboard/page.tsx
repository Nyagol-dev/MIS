import Link from "next/link";
import { PageHeader } from "@/components/ui/PageHeader";

export const metadata = { title: "Workspace overview" };

const workspaceLinks = [
  { href: "/entities", title: "Records", description: "Open the record types your organisation has set up.", action: "Browse records" },
  { href: "/users", title: "People", description: "Review workspace users and manage invitations where permitted.", action: "Manage users" },
  { href: "/roles", title: "Access", description: "Review roles and the permissions assigned to them.", action: "Review access" },
];

export default function WorkspaceDashboard() {
  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader eyebrow="Workspace" title="A good place to begin." description="Pick up with records, people or access. Each area has its own space, so the details stay easy to find." />
      <div className="grid gap-4 lg:grid-cols-3">
        {workspaceLinks.map((item) => (
          <Link key={item.href} href={item.href} className="group flex min-h-56 flex-col rounded-xl border border-slate-200 bg-white p-6 transition-colors hover:border-brand-300 hover:bg-brand-50/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-brand-700 dark:hover:bg-slate-900">
            <span className="text-xs font-semibold uppercase tracking-[0.1em] text-slate-500">{item.title}</span>
            <span className="mt-5 text-xl font-semibold tracking-tight text-slate-900 group-hover:text-brand-900 dark:text-white dark:group-hover:text-brand-200">{item.action}</span>
            <span className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-400">{item.description}</span>
            <span aria-hidden="true" className="mt-auto pt-6 text-lg text-brand-800">→</span>
          </Link>
        ))}
      </div>
      <p className="mt-8 max-w-3xl border-l-2 border-slate-300 pl-4 text-sm leading-6 text-slate-600 dark:border-slate-700 dark:text-slate-400">Your available actions depend on the permissions assigned to your role. Ask your workspace administrator if something you need is unavailable.</p>
    </div>
  );
}
