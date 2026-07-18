import Link from 'next/link';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';

export default function MarketingPage() {
  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 font-sans text-slate-900 dark:text-slate-100 flex flex-col">
      {/* Navigation */}
      <header className="border-b border-slate-200 dark:border-slate-800 bg-white/80 dark:bg-slate-950/80 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center shadow-sm">
              <span className="text-white font-bold text-lg leading-none">N</span>
            </div>
            <span className="font-bold text-xl tracking-tight text-slate-900 dark:text-white">Nexus</span>
          </div>
          <nav>
            <Link href="/login">
              <Button variant="primary" className="shadow-sm">Log in</Button>
            </Link>
          </nav>
        </div>
      </header>

      {/* Hero Section */}
      <main className="flex-grow">
        <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-24 pb-16 lg:pt-32 lg:pb-24 flex flex-col items-center text-center">
          <Badge variant="primary" className="mb-6 px-3 py-1">Nexus Platform 1.0 is now live</Badge>
          <h1 className="text-5xl lg:text-7xl font-extrabold tracking-tight mb-8 text-slate-900 dark:text-white max-w-4xl">
            The Unified Platform for <span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-600 to-purple-600">Dynamic Organizations</span>
          </h1>
          <p className="text-xl lg:text-2xl text-slate-600 dark:text-slate-400 max-w-3xl mb-10 leading-relaxed">
            A flexible, secure foundation for schools, clinics, NGOs, and civic agencies to manage operations, scale programs, and handle complex reporting without custom development.
          </p>
          <div className="flex flex-col sm:flex-row gap-4">
            <Link href="/login">
              <Button variant="primary" size="lg" className="text-lg px-8 py-4 shadow-lg shadow-indigo-500/20">
                Get Started
              </Button>
            </Link>
          </div>
        </section>

        {/* Features/Capabilities Section */}
        <section className="bg-white dark:bg-slate-950 border-t border-slate-200 dark:border-slate-800 py-20 lg:py-32">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center mb-16">
              <h2 className="text-3xl lg:text-4xl font-bold tracking-tight text-slate-900 dark:text-white mb-4">
                Core Capabilities
              </h2>
              <p className="text-lg text-slate-600 dark:text-slate-400 max-w-2xl mx-auto">
                Built from the ground up to support diverse institutional workflows on a single codebase.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
              <Card className="h-full flex flex-col hover:shadow-md transition-shadow">
                <CardHeader>
                  <div className="w-12 h-12 bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 rounded-xl flex items-center justify-center mb-4 text-2xl shadow-sm">
                    🏢
                  </div>
                  <CardTitle>Multi-Tenant Architecture</CardTitle>
                </CardHeader>
                <CardContent className="flex-grow pt-0">
                  <CardDescription className="text-base">
                    Securely isolate data and configurations. Designed to support any organization type—from schools to civic agencies—without forking code.
                  </CardDescription>
                </CardContent>
              </Card>

              <Card className="h-full flex flex-col hover:shadow-md transition-shadow">
                <CardHeader>
                  <div className="w-12 h-12 bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400 rounded-xl flex items-center justify-center mb-4 text-2xl shadow-sm">
                    📂
                  </div>
                  <CardTitle>Dynamic Entity Management</CardTitle>
                </CardHeader>
                <CardContent className="flex-grow pt-0">
                  <CardDescription className="text-base">
                    Define custom operational structures on the fly. Manage distinct record types and relationships natively, adapting to your operational reality.
                  </CardDescription>
                </CardContent>
              </Card>

              <Card className="h-full flex flex-col hover:shadow-md transition-shadow">
                <CardHeader>
                  <div className="w-12 h-12 bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 rounded-xl flex items-center justify-center mb-4 text-2xl shadow-sm">
                    📊
                  </div>
                  <CardTitle>Advanced Reporting</CardTitle>
                </CardHeader>
                <CardContent className="flex-grow pt-0">
                  <CardDescription className="text-base">
                    Transform complex operational data into actionable insights. Surface the right metrics for audits, compliance, and daily decision-making.
                  </CardDescription>
                </CardContent>
              </Card>

              <Card className="h-full flex flex-col hover:shadow-md transition-shadow">
                <CardHeader>
                  <div className="w-12 h-12 bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400 rounded-xl flex items-center justify-center mb-4 text-2xl shadow-sm">
                    💳
                  </div>
                  <CardTitle>Integrated Billing</CardTitle>
                </CardHeader>
                <CardContent className="flex-grow pt-0">
                  <CardDescription className="text-base">
                    Process payments seamlessly with built-in Stripe and M-Pesa support. Handle subscriptions, one-off invoices, and institutional funding easily.
                  </CardDescription>
                </CardContent>
              </Card>
            </div>
          </div>
        </section>
      </main>
      
      {/* Footer */}
      <footer className="border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 py-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col md:flex-row justify-between items-center gap-4">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 bg-indigo-600 rounded flex items-center justify-center opacity-80">
              <span className="text-white font-bold text-xs leading-none">N</span>
            </div>
            <span className="font-semibold text-slate-900 dark:text-slate-100">Nexus Systems</span>
          </div>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            © {new Date().getFullYear()} Nexus Systems Inc. All rights reserved.
          </p>
        </div>
      </footer>
    </div>
  );
}
