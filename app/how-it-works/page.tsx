import Link from "next/link";
import { SiteFooter } from "@/components/marketing/SiteFooter";
import { SiteHeader } from "@/components/marketing/SiteHeader";

export const metadata = {
  title: "How it works — Nexus MIS",
  description: "Understand the platform and organisation workspace in Nexus MIS.",
};

const phases = [
  {
    number: "01",
    label: "Platform administration",
    title: "Create an organisation workspace",
    description: "A platform administrator sets up the organisation and its first workspace administrator. Platform operations live in their own sign-in area.",
    href: "/platform/login",
    action: "Platform administrator sign in",
  },
  {
    number: "02",
    label: "Workspace administration",
    title: "Set up the way your team works",
    description: "Workspace administrators add people, define roles and configure the record types used by their organisation.",
    href: "/login",
    action: "Organisation workspace sign in",
  },
  {
    number: "03",
    label: "Everyday work",
    title: "Keep records moving with the team",
    description: "Staff work with the records they can access. The workspace keeps user roles, permissions and organisation data within the tenant boundary.",
    href: "/features",
    action: "Review workspace features",
  },
];

export default function HowItWorksPage() {
  return (
    <div className="min-h-screen bg-[#f8f9f7] font-sans text-slate-900">
      <SiteHeader current="how-it-works" />
      <main className="mx-auto max-w-7xl px-5 py-14 sm:px-8 sm:py-20">
        <div className="max-w-3xl">
          <p className="text-xs font-semibold uppercase tracking-[0.13em] text-brand-800">A steady handoff</p>
          <h1 className="mt-4 text-4xl font-semibold leading-tight tracking-tight text-slate-950 sm:text-5xl">From platform setup to the work of the day.</h1>
          <p className="mt-5 max-w-2xl text-base leading-7 text-slate-600">Nexus has two administration levels. Each one has a clear job, its own sign-in area and the tools needed for that part of the work.</p>
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
