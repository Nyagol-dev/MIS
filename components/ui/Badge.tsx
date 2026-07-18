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
  const baseStyles = 'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold transition-colors duration-200 border';

  const variants = {
    primary: 'bg-indigo-55/70 text-indigo-700 border-indigo-200 dark:bg-indigo-950/40 dark:text-indigo-300 dark:border-indigo-800/80',
    secondary: 'bg-slate-100 text-slate-800 border-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:border-slate-700',
    success: 'bg-emerald-55/70 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800/80',
    danger: 'bg-red-55/70 text-red-700 border-red-200 dark:bg-red-950/40 dark:text-red-300 dark:border-red-800/80',
    warning: 'bg-amber-55/70 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800/80',
    info: 'bg-sky-55/70 text-sky-700 border-sky-200 dark:bg-sky-950/40 dark:text-sky-300 dark:border-sky-800/80',
    gray: 'bg-slate-100 text-slate-850 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700',
  };

  const currentVariant = variants[variant] || variants.gray;

  return (
    <span className={`${baseStyles} ${currentVariant} ${className}`} {...props}>
      {children}
    </span>
  );
};
