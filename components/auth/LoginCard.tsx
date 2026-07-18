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
    <div className="px-6 pt-6 pb-8 space-y-6">
      {/* Heading block */}
      <div className="space-y-1">
        <h2 className="text-xl font-bold tracking-tight text-slate-900">
          {title}
        </h2>
        {subtitle && (
          <p className="text-sm text-slate-500">
            {subtitle}
          </p>
        )}
      </div>
      {/* Form content */}
      {children}
    </div>
  );
}
