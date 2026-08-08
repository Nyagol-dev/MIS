import React from 'react';

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: 'primary' | 'secondary' | 'success' | 'danger' | 'warning' | 'info' | 'gray';
}

export const Badge: React.FC<BadgeProps> = ({
  children,
  className = '',
  variant = 'gray',
  ...props
}) => {
  // Restrained: rounded-md not rounded-full — pill badges read as startup-y
  const baseStyles =
    'inline-flex items-center rounded px-2 py-0.5 text-xs font-medium tracking-wide border transition-colors duration-150';

  const variants = {
    // Brand accent — navy tones, used sparingly
    primary:
      'bg-brand-50 text-brand-700 border-brand-200 dark:bg-brand-900/40 dark:text-brand-300 dark:border-brand-800/60',
    secondary:
      'bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700',
    success:
      'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800/60',
    danger:
      'bg-red-50 text-red-700 border-red-200 dark:bg-red-950/40 dark:text-red-300 dark:border-red-800/60',
    warning:
      'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800/60',
    info:
      'bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-950/40 dark:text-sky-300 dark:border-sky-800/60',
    gray:
      'bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700',
  };

  const currentVariant = variants[variant] || variants.gray;

  return (
    <span className={`${baseStyles} ${currentVariant} ${className}`} {...props}>
      {children}
    </span>
  );
};
