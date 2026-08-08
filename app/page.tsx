import Link from 'next/link';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';

export const metadata = {
  title: 'Nexus MIS — Management Information System',
  description:
    'A unified, flexible platform for schools, clinics, NGOs, and civic agencies to manage operations, scale programs, and handle complex reporting.',
};

export default function MarketingPage() {
  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 font-sans text-slate-900 dark:text-slate-100 flex flex-col">

      {/* Navigation */}
      <header className="border-b border-slate-200 dark:border-slate-800 bg-white/90 dark:bg-slate-950/90 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          {/* Brand mark */}
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-brand-800 rounded flex items-center justify-center shadow-sm flex-shrink-0">
              <span className="text-white font-bold text-sm leading-none select-none">N</span>
            </div>
            <span className="font-bold text-lg tracking-tight text-slate-900 dark:text-white">
              Nexus
            </span>
          </div>

          <nav>
            <Link href="/login">
              {/* Outline variant in nav — CTAs are understated until committed */}
              <Button variant="outline" size="sm">Sign in</Button>
            </Link>
          </nav>
        </div>
      </header>

      {/* Hero */}
      <main className="flex-grow">
        <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-24 pb-16 lg:pt-32 lg:pb-24 flex flex-col items-center text-center">
          <Badge variant="primary" className="mb-6">
            Platform 1.0 — Now Available
          </Badge>

          {/* No gradient text — plain, authoritative heading */}
          <h1 className="text-4xl lg:text-6xl font-extrabold tracking-tight mb-6 text-slate-900 dark:text-white max-w-4xl leading-tight">
            The Unified Platform for{' '}
            <span className="text-brand-700 dark:text-brand-400">
              Dynamic Organisations
            </span>
          </h1>

          <p className="text-lg lg:text-xl text-slate-600 dark:text-slate-400 max-w-2xl mb-10 leading-relaxed">
            A flexible, secure foundation for schools, clinics, NGOs, and civic agencies to manage
            operations, scale programs, and handle complex reporting — without custom development.
          </p>

          <div className="flex flex-col sm:flex-row gap-3">
            <Link href="/login">
              {/* Primary brand CTA — single accent colour */}
              <Button variant="primary" size="lg">
                Get Started
              </Button>
            </Link>
            <Link href="/platform/login">
              <Button variant="ghost" size="lg" className="text-slate-500 dark:text-slate-400">
                Platform admin ↗
              </Button>
            </Link>
          </div>
        </section>

        {/* Divider with institution type callout */}
        <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-16">
          <div className="flex flex-wrap justify-center gap-2">
            {['Schools & Colleges', 'Health Clinics', 'NGOs & CBOs', 'Civic Agencies', 'Faith Organisations'].map((label) => (
              <span
                key={label}
                className="inline-flex items-center px-3 py-1 rounded text-xs font-medium bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 shadow-sm"
              >
                {label}
              </span>
            ))}
          </div>
        </section>

        {/* Features / Capabilities */}
        <section className="bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 py-20 lg:py-28">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center mb-14">
              <h2 className="text-2xl lg:text-3xl font-bold tracking-tight text-slate-900 dark:text-white mb-3">
                Core Capabilities
              </h2>
              <p className="text-base text-slate-500 dark:text-slate-400 max-w-xl mx-auto">
                Built to support diverse institutional workflows on a single, maintainable codebase.
              </p>
            </div>

            {/*
              Unified icon backgrounds — no rainbow of colours.
              Institutional products don't use multi-colour decoration.
              Icon colour is a single brand-600 accent on a neutral slate surface.
            */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              {[
                {
                  emoji: '🏢',
                  title: 'Multi-Tenant Architecture',
                  desc: 'Securely isolate data and configurations per organisation. Supports any type — schools to civic agencies — without forking code.',
                },
                {
                  emoji: '📂',
                  title: 'Dynamic Entity Management',
                  desc: 'Define custom operational structures on the fly. Manage distinct record types and relationships natively.',
                },
                {
                  emoji: '📊',
                  title: 'Advanced Reporting',
                  desc: 'Transform complex operational data into actionable insights. Surface metrics for audits, compliance, and daily decisions.',
                },
                {
                  emoji: '💳',
                  title: 'Integrated Billing',
                  desc: 'Process payments with built-in Stripe and M-Pesa support. Handle subscriptions, invoices, and institutional funding.',
                },
              ].map((feature) => (
                <Card key={feature.title} className="h-full flex flex-col hover:shadow-md transition-shadow">
                  <CardHeader>
                    {/* Single neutral icon surface — no per-card colour theming */}
                    <div className="w-10 h-10 bg-slate-100 dark:bg-slate-800 rounded-lg flex items-center justify-center mb-3 text-xl border border-slate-200 dark:border-slate-700">
                      {feature.emoji}
                    </div>
                    <CardTitle>{feature.title}</CardTitle>
                  </CardHeader>
                  <CardContent className="flex-grow pt-0">
                    <CardDescription className="text-sm">
                      {feature.desc}
                    </CardDescription>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </section>

        {/* Trust / credibility strip */}
        <section className="bg-brand-900 dark:bg-brand-950 py-16">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
            <h2 className="text-xl font-semibold text-white mb-3">
              Designed for the institutions that serve your community
            </h2>
            <p className="text-brand-300 text-sm leading-relaxed max-w-2xl mx-auto">
              Nexus MIS is purpose-built for organisations operating under resource constraints, compliance requirements, and accountability obligations. No bloat. No vendor lock-in. Audit trails and role-based access from day one.
            </p>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 py-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col md:flex-row justify-between items-center gap-4">
          <div className="flex items-center gap-2">
            <div className="w-5 h-5 bg-brand-800 rounded flex items-center justify-center">
              <span className="text-white font-bold text-xs leading-none select-none">N</span>
            </div>
            <span className="font-semibold text-sm text-slate-700 dark:text-slate-300">Nexus Systems</span>
          </div>
          <p className="text-xs text-slate-400 dark:text-slate-500">
            © {new Date().getFullYear()} Nexus Systems. All rights reserved.
          </p>
          <div className="flex gap-4 text-xs text-slate-400 dark:text-slate-500">
            <span>Privacy</span>
            <span>Terms</span>
            <span>Security</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
