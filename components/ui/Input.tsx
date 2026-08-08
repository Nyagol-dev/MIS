import React from 'react';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  helperText?: string;
}

export const Input: React.FC<InputProps> = ({
  className = '',
  label,
  error,
  helperText,
  id,
  type = 'text',
  ...props
}) => {
  const inputId = id || React.useId();
  const errorId = `${inputId}-error`;
  const helperId = `${inputId}-helper`;

  const inputBaseStyles =
    'block w-full rounded-md border px-3 py-2 text-sm shadow-sm transition-colors duration-150 ' +
    'focus:outline-none focus:ring-2 focus:ring-offset-0 ' +
    'disabled:cursor-not-allowed disabled:opacity-50 ' +
    'bg-white dark:bg-slate-900';

  const stateStyles = error
    ? 'border-red-300 text-red-900 placeholder:text-red-300 focus:border-red-500 focus:ring-red-500 ' +
      'dark:border-red-700 dark:text-red-300 dark:placeholder:text-red-600'
    : 'border-slate-300 text-slate-900 placeholder:text-slate-400 focus:border-brand-600 focus:ring-brand-600 ' +
      'dark:border-slate-600 dark:text-slate-100 dark:placeholder:text-slate-500';

  return (
    <div className="w-full flex flex-col gap-1.5">
      {label && (
        <label
          htmlFor={inputId}
          className="text-sm font-medium text-slate-700 dark:text-slate-300"
        >
          {label}
        </label>
      )}
      <input
        id={inputId}
        type={type}
        className={`${inputBaseStyles} ${stateStyles} ${className}`}
        aria-invalid={!!error}
        aria-describedby={
          error ? errorId : helperText ? helperId : undefined
        }
        {...props}
      />
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
