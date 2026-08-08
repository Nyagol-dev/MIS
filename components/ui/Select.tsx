import React from 'react';

export interface SelectOption {
  label: string;
  value: string | number;
}

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  error?: string;
  helperText?: string;
  options: SelectOption[];
}

export const Select: React.FC<SelectProps> = ({
  className = '',
  label,
  error,
  helperText,
  options,
  id,
  children,
  ...props
}) => {
  const selectId = id || React.useId();
  const errorId = `${selectId}-error`;
  const helperId = `${selectId}-helper`;

  const selectBaseStyles =
    'block w-full appearance-none rounded-md border px-3 py-2 pr-10 text-sm shadow-sm ' +
    'transition-colors duration-150 focus:outline-none focus:ring-2 focus:ring-offset-0 ' +
    'disabled:cursor-not-allowed disabled:opacity-50 ' +
    'bg-white dark:bg-slate-900';

  const stateStyles = error
    ? 'border-red-300 text-red-900 focus:border-red-500 focus:ring-red-500 ' +
      'dark:border-red-700 dark:text-red-300'
    : 'border-slate-300 text-slate-900 focus:border-brand-600 focus:ring-brand-600 ' +
      'dark:border-slate-600 dark:text-slate-100';

  return (
    <div className="w-full flex flex-col gap-1.5">
      {label && (
        <label
          htmlFor={selectId}
          className="text-sm font-medium text-slate-700 dark:text-slate-300"
        >
          {label}
        </label>
      )}
      <div className="relative">
        <select
          id={selectId}
          className={`${selectBaseStyles} ${stateStyles} ${className}`}
          aria-invalid={!!error}
          aria-describedby={
            error ? errorId : helperText ? helperId : undefined
          }
          {...props}
        >
          {options.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3">
          <svg
            className="h-4 w-4 text-slate-400"
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 20 20"
            fill="currentColor"
            aria-hidden="true"
          >
            <path
              fillRule="evenodd"
              d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
              clipRule="evenodd"
            />
          </svg>
        </div>
      </div>
      {error ? (
        <p id={errorId} className="text-xs text-red-600 dark:text-red-400">
          {error}
        </p>
      ) : helperText ? (
        <p id={helperId} className="text-xs text-slate-500 dark:text-slate-400">
          {helperText}
        </p>
      ) : null}
    </div>
  );
};
