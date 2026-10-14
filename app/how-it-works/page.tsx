import Link from "next/link";
import { SiteFooter } from "@/components/marketing/SiteFooter";
import { SiteHeader } from "@/components/marketing/SiteHeader";

export const metadata = {
  title: "How the hospital system works",
  description: "How hospital staff use the HMIS across registration, care, diagnostics, inpatient services, and billing.",
};

const phases = [
  {
    number: "01",
    label: "Hospital setup",
    title: "Provision the hospital once",
    description: "System support configures the hospital profile, departments, enabled services, and initial administrators through a restricted setup area.",
    href: "/platform/login",
    action: "System administrator sign in",
  },
  {
    number: "02",
    label: "Hospital administration",
    title: "Assign staff and access",
    description: "Hospital administrators maintain staff accounts, departments, roles, and access to clinical and operational modules.",
    href: "/login",
    action: "Hospital staff sign in",
  },
  {
    number: "03",
    label: "Everyday work",
    title: "Coordinate care across the patient journey",
    description: "Authorised teams work in registration, OPD, diagnostics, pharmacy, inpatient care, theatre, health records, billing, and claims.",
    href: "/features",
    action: "Review hospital services",
  },
];

export default function HowItWorksPage() {
  return (
    <div className="min-h-screen bg-[#f8f9f7] font-sans text-slate-900">
      <SiteHeader current="how-it-works" />
      <main className="mx-auto max-w-7xl px-5 py-14 sm:px-8 sm:py-20">
        <div className="max-w-3xl">
          <p className="text-xs font-semibold uppercase tracking-[0.13em] text-brand-800">Hospital operations</p>
          <h1 className="mt-4 text-4xl font-semibold leading-tight tracking-tight text-slate-950 sm:text-5xl">A clear path from hospital setup to daily care.</h1>
          <p className="mt-5 max-w-2xl text-base leading-7 text-slate-600">A restricted setup area supports provisioning. Hospital staff then use role based access for their clinical and operational responsibilities.</p>
        </div>

        <ol className="mt-14 max-w-5xl border-t border-slate-200">
          {phases.map((phase) => (
            <li key={phase.number} className="grid gap-x-8 gap-y-3 border-b border-slate-200 py-8 sm:grid-cols-[4rem_1fr_1fr] sm:py-10">
              <span className="pt-1 text-xs font-semibold tabular-nums text-slate-400">{phase.number}</span>
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.1em] text-slate-500">{phase.label}</p>
                <h2 className="mt-2 text-xl font-semibold leading-7 text-slate-900">{phase.title}</h2>
              </div>
              <div>
                <p className="text-sm leading-6 text-slate-600">{phase.description}</p>
                <Link href={phase.href} className="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-brand-800 hover:text-brand-600">{phase.action} <span aria-hidden="true">→</span></Link>
              </div>
            </li>
          ))}
        </ol>

        <div className="mt-12 rounded-xl bg-brand-900 px-6 py-8 text-white sm:px-8">
          <h2 className="text-xl font-semibold">Clear roles. Clear boundaries.</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-200">Organisation data is scoped by tenant in the database, while platform administration uses a separate operational area.</p>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
