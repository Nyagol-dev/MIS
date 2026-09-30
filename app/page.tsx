import Link from "next/link";
import { SiteFooter } from "@/components/marketing/SiteFooter";
import { SiteHeader } from "@/components/marketing/SiteHeader";

export const metadata = {
  title: "Nexus MIS — a clearer place to do the work",
  description: "A practical management information system for organisations and the teams they serve.",
};

export default function HomePage() {
  return (
    <div className="min-h-screen bg-[#f8f9f7] font-sans text-slate-900">
      <a href="#main-content" className="skip-link">Skip to content</a>
      <SiteHeader />

      <main id="main-content" className="mx-auto max-w-7xl px-5 sm:px-8">
        <section className="grid min-h-[min(690px,calc(100vh-9rem))] items-center gap-12 py-16 lg:grid-cols-[1.1fr_0.9fr] lg:gap-20 lg:py-20">
          <div className="max-w-3xl">
            <p className="mb-6 inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.13em] text-brand-800">
              <span aria-hidden="true" className="h-px w-8 bg-brand-700" />
              Management information, made manageable
            </p>
            <h1 className="max-w-[13ch] text-5xl font-semibold leading-[1.07] tracking-[-0.045em] text-slate-950 sm:text-6xl lg:text-[4.25rem]">
              A clearer place to do the work.
            </h1>
            <p className="mt-7 max-w-xl text-lg leading-8 text-slate-600">
              Keep the records, people and permissions behind your organisation in one considered workspace.
            </p>
            <div className="mt-9 flex flex-wrap items-center gap-x-7 gap-y-3">
              <Link href="/login" className="inline-flex min-h-12 items-center gap-3 rounded-md bg-brand-900 px-5 text-sm font-semibold text-white transition-colors hover:bg-brand-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2">
                Go to your workspace <span aria-hidden="true">→</span>
              </Link>
              <Link href="/features" className="inline-flex min-h-12 items-center text-sm font-semibold text-slate-700 underline decoration-slate-300 underline-offset-4 transition-colors hover:text-brand-800 hover:decoration-brand-500">
                Explore the system
              </Link>
            </div>
          </div>

          <aside aria-label="Choose your sign-in area" className="w-full max-w-md justify-self-start lg:justify-self-end">
            <p className="mb-3 text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Choose your area</p>
            <div className="divide-y divide-slate-200 border-y border-slate-200">
              <Link href="/login" className="group flex items-start justify-between gap-5 py-6 transition-colors hover:bg-white/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500">
                <span>
                  <span className="block text-base font-semibold text-slate-900">Organisation workspace</span>
                  <span className="mt-1.5 block text-sm leading-6 text-slate-600">For staff managing records and day-to-day operations.</span>
                </span>
                <span aria-hidden="true" className="pt-0.5 text-lg text-slate-400 transition-transform group-hover:translate-x-1 group-hover:text-brand-800">→</span>
              </Link>
              <Link href="/platform/login" className="group flex items-start justify-between gap-5 py-6 transition-colors hover:bg-white/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500">
                <span>
                  <span className="block text-base font-semibold text-slate-900">Platform administration</span>
                  <span className="mt-1.5 block text-sm leading-6 text-slate-600">For administrators setting up organisations and platform access.</span>
                </span>
                <span aria-hidden="true" className="pt-0.5 text-lg text-slate-400 transition-transform group-hover:translate-x-1 group-hover:text-brand-800">→</span>
              </Link>
            </div>
            <p className="mt-5 text-xs leading-5 text-slate-500">Built for education, healthcare, community programmes and public service.</p>
          </aside>
        </section>

        <section className="border-t border-slate-200 py-7">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-slate-600">Good systems should make the next step feel clear.</p>
            <Link href="/how-it-works" className="inline-flex items-center gap-2 text-sm font-semibold text-brand-800 hover:text-brand-600">See how Nexus works <span aria-hidden="true">→</span></Link>
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
