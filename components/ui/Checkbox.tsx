import React from 'react';

export interface CheckboxProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label?: string;
  error?: string;
  helperText?: string;
}

export const Checkbox: React.FC<CheckboxProps> = ({
  className = '',
  label,
  error,
  helperText,
  id,
  ...props
}) => {
  const checkboxId = id || React.useId();
  const errorId = `${checkboxId}-error`;
  const helperId = `${checkboxId}-helper`;

  const checkboxBaseStyles = 'h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 dark:border-slate-700 dark:bg-slate-900 dark:focus:ring-offset-slate-900 transition-colors duration-200 cursor-pointer disabled:cursor-not-allowed disabled:opacity-50';

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-start">
        <div className="flex h-5 items-center">
          <input
            id={checkboxId}
            type="checkbox"
            className={`${checkboxBaseStyles} ${className}`}
            aria-invalid={!!error}
            aria-describedby={
              error ? errorId : helperText ? helperId : undefined
            }
            {...props}
          />
        </div>
        {(label || helperText) && (
          <div className="ml-3 text-sm leading-5">
            {label && (
              <label
                htmlFor={checkboxId}
                className="font-medium text-slate-700 dark:text-slate-300 cursor-pointer select-none"
              >
                {label}
              </label>
            )}
            {helperText && (
              <p id={helperId} className="text-slate-500 dark:text-slate-400">
                {helperText}
              </p>
            )}
          </div>
        )}
      </div>
      {error && (
        <p id={errorId} className="ml-7 text-xs text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
    </div>
  );
};
