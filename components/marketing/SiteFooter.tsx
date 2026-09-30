import Link from "next/link";

export function SiteFooter() {
  return (
    <footer className="border-t border-slate-200 bg-white">
      <div className="mx-auto flex max-w-7xl flex-col gap-3 px-5 py-6 text-xs text-slate-500 sm:px-8 md:flex-row md:items-center md:justify-between">
        <span className="font-semibold text-slate-700">Nexus MIS</span>
        <span>Management tools for organisations doing important work.</span>
        <Link className="font-medium text-slate-600 hover:text-brand-800" href="/platform/login">Platform administration</Link>
      </div>
    </footer>
  );
}
