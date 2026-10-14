import Link from "next/link";
import { SiteFooter } from "@/components/marketing/SiteFooter";
import { SiteHeader } from "@/components/marketing/SiteHeader";

export const metadata = {
  title: "Hospital services",
  description: "Patient care and operational modules in the hospital management information system.",
};

const features = [
  {
    number: "01",
    title: "Patient registration and outpatient care",
    description: "Maintain the patient registry, open encounters, capture triage observations, document care, and place clinical orders.",
    detail: "Patient registry · OPD · Triage · Clinical notes · Orders",
  },
  {
    number: "02",
    title: "Diagnostics and treatment services",
    description: "Move work through laboratory, radiology, pharmacy, inpatient wards, and theatre with dedicated clinical worklists.",
    detail: "Laboratory · Radiology · Pharmacy · Inpatient · Theatre",
  },
  {
    number: "03",
    title: "Health records and continuity",
    description: "Support clinical coding, chart amendments, release-of-information requests, and registry integration workflows.",
    detail: "Health records · ICD-11 coding · Amendments · HIE",
  },
  {
    number: "04",
    title: "Billing, payments, and claims",
    description: "Manage patient invoices and payments, M-Pesa collections, waivers, insurance eligibility, and SHA claim workflows.",
    detail: "Patient billing · M-Pesa · Insurance · SHA claims",
  },
];

export default function FeaturesPage() {
  return (
    <div className="min-h-screen bg-[#f8f9f7] font-sans text-slate-900">
      <SiteHeader current="features" />
      <main className="mx-auto max-w-7xl px-5 py-14 sm:px-8 sm:py-20">
        <div className="max-w-3xl">
          <p className="text-xs font-semibold uppercase tracking-[0.13em] text-brand-800">Hospital services</p>
          <h1 className="mt-4 text-4xl font-semibold leading-tight tracking-tight text-slate-950 sm:text-5xl">Support the patient journey across departments.</h1>
          <p className="mt-5 max-w-2xl text-base leading-7 text-slate-600">Clinical and operational teams use dedicated work areas with role based access and an auditable record of activity.</p>
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
          <p className="max-w-xl text-sm leading-6 text-slate-600">Hospital access is configured for one facility and its authorised staff.</p>
          <Link href="/how-it-works" className="text-sm font-semibold text-brand-800 hover:text-brand-600">How it works <span aria-hidden="true">→</span></Link>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
