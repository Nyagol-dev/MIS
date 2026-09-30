import Link from "next/link";

function Wordmark() {
  return (
    <Link href="/" aria-label="Nexus MIS home" className="inline-flex items-center gap-3 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500">
      <span aria-hidden="true" className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-900 text-sm font-bold text-white">N</span>
      <span className="text-sm font-semibold tracking-tight text-slate-900">Nexus <span className="font-normal text-slate-500">MIS</span></span>
    </Link>
  );
}

export function SiteHeader({ current }: { current?: "features" | "how-it-works" }) {
  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex h-[4.5rem] max-w-7xl items-center justify-between px-5 sm:px-8">
        <Wordmark />
        <nav aria-label="Main navigation" className="flex items-center gap-4 sm:gap-8">
          <Link aria-current={current === "features" ? "page" : undefined} href="/features" className="hidden text-sm font-medium text-slate-600 transition-colors hover:text-brand-800 sm:inline">Features</Link>
          <Link aria-current={current === "how-it-works" ? "page" : undefined} href="/how-it-works" className="hidden text-sm font-medium text-slate-600 transition-colors hover:text-brand-800 sm:inline">How it works</Link>
          <Link href="/platform/login" className="hidden text-sm font-medium text-slate-600 transition-colors hover:text-brand-800 md:inline">Platform admin</Link>
          <Link href="/login" className="inline-flex min-h-10 items-center rounded-md bg-brand-900 px-4 text-sm font-semibold text-white transition-colors hover:bg-brand-800">Workspace sign in</Link>
        </nav>
      </div>
    </header>
  );
}
