import React from 'react';

export function LoginCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-slate-50 py-12 px-4 sm:px-6 lg:px-8 dark:bg-slate-950">
      <div className="w-full max-w-md space-y-8">
        <div>
          <h2 className="mt-6 text-center text-3xl font-bold tracking-tight text-slate-900 dark:text-white">
            {title}
          </h2>
          {subtitle && (
            <p className="mt-2 text-center text-sm text-slate-600 dark:text-slate-400">
              {subtitle}
            </p>
          )}
        </div>
        <div className="bg-white py-8 px-4 shadow-xl sm:rounded-xl sm:px-10 dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
          {children}
        </div>
      </div>
    </div>
  );
}
