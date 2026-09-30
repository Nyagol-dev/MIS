import Link from "next/link";
import { SiteFooter } from "@/components/marketing/SiteFooter";
import { SiteHeader } from "@/components/marketing/SiteHeader";

export const metadata = {
  title: "Features — Nexus MIS",
  description: "The core tools that make up a Nexus MIS organisation workspace.",
};

const features = [
  {
    number: "01",
    title: "A workspace shaped around your organisation",
    description: "Create record types that reflect the work you actually do. Add the fields, relationships and choices your team needs, then manage those records in one consistent place.",
    detail: "Entity types · Custom fields · Record management",
  },
  {
    number: "02",
    title: "People and permissions with clear boundaries",
    description: "Bring staff into the workspace and organise access by role. Permissions can be managed across the system and for individual record types.",
    detail: "User management · Roles · Entity permissions",
  },
  {
    number: "03",
    title: "A separate place for platform operations",
    description: "Platform administrators manage organisations and platform accounts through a dedicated area, separate from day-to-day tenant workspaces.",
    detail: "Organisation setup · Platform administrators · Audit trail",
  },
  {
    number: "04",
    title: "Reporting and billing tools when you need them",
    description: "Use reporting tools to explore operational data. The platform also includes subscription billing flows with Stripe and M-Pesa integrations.",
    detail: "Reports · Subscriptions · Stripe and M-Pesa",
  },
];

export default function FeaturesPage() {
  return (
    <div className="min-h-screen bg-[#f8f9f7] font-sans text-slate-900">
      <SiteHeader current="features" />
      <main className="mx-auto max-w-7xl px-5 py-14 sm:px-8 sm:py-20">
        <div className="max-w-3xl">
          <p className="text-xs font-semibold uppercase tracking-[0.13em] text-brand-800">The toolkit</p>
          <h1 className="mt-4 text-4xl font-semibold leading-tight tracking-tight text-slate-950 sm:text-5xl">The right structure for the work you already do.</h1>
          <p className="mt-5 max-w-2xl text-base leading-7 text-slate-600">Nexus brings together a small set of practical tools. Start with your records and people, then add the controls and reporting your organisation needs.</p>
        </div>

        <div className="mt-14 border-t border-slate-200">
          {features.map((feature) => (
            <article key={feature.number} className="grid gap-3 border-b border-slate-200 py-8 md:grid-cols-[5rem_0.85fr_1.15fr] md:gap-8 md:py-10">
              <span className="pt-1 text-xs font-semibold tabular-nums text-slate-400">{feature.number}</span>
              <h2 className="max-w-sm text-xl font-semibold leading-7 text-slate-900">{feature.title}</h2>
              <div>
                <p className="max-w-2xl text-sm leading-6 text-slate-600">{feature.description}</p>
                <p className="mt-4 text-xs font-medium text-slate-500">{feature.detail}</p>
              </div>
            </article>
          ))}
        </div>

        <div className="mt-12 flex flex-col gap-4 border-l-2 border-brand-800 pl-5 sm:flex-row sm:items-center sm:justify-between">
          <p className="max-w-xl text-sm leading-6 text-slate-600">See how the platform area and organisation workspace fit together.</p>
          <Link href="/how-it-works" className="text-sm font-semibold text-brand-800 hover:text-brand-600">How it works <span aria-hidden="true">→</span></Link>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
