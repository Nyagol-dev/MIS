'use client';

import React, { useEffect } from 'react';

export interface ToastProps {
  message: string;
  type?: 'success' | 'error' | 'warning' | 'info';
  onClose?: () => void;
  duration?: number;
  className?: string;
}

export const Toast: React.FC<ToastProps> = ({
  message,
  type = 'info',
  onClose,
  duration = 5000,
  className = '',
}) => {
  useEffect(() => {
    if (!onClose || duration <= 0) return;

    const timer = setTimeout(() => {
      onClose();
    }, duration);

    return () => clearTimeout(timer);
  }, [duration, onClose]);

  const bgStyles = {
    success: 'bg-emerald-50 text-emerald-900 border-emerald-250 dark:bg-emerald-950/90 dark:text-emerald-50 dark:border-emerald-800',
    error: 'bg-red-50 text-red-900 border-red-250 dark:bg-red-950/90 dark:text-red-50 dark:border-red-800',
    warning: 'bg-amber-55 text-amber-900 border-amber-250 dark:bg-amber-950/90 dark:text-amber-50 dark:border-amber-800',
    info: 'bg-slate-50 text-slate-900 border-slate-250 dark:bg-slate-900/90 dark:text-slate-50 dark:border-slate-800',
  };

  const icons = {
    success: (
      <svg className="h-5 w-5 text-emerald-600 dark:text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
    error: (
      <svg className="h-5 w-5 text-red-650 dark:text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
        <path strokeLinecap="round" strokeLinejoin="round" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
    warning: (
      <svg className="h-5 w-5 text-amber-600 dark:text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
      </svg>
    ),
    info: (
      <svg className="h-5 w-5 text-indigo-600 dark:text-indigo-450" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
        <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
  };

  return (
    <div
      className={`fixed bottom-4 right-4 z-50 flex items-center gap-3 p-4 rounded-xl border shadow-xl max-w-sm animate-scale-up ${bgStyles[type]} ${className}`}
      role="alert"
    >
      <div className="flex-shrink-0">{icons[type]}</div>
      <div className="flex-1 text-sm font-medium leading-5">{message}</div>
      {onClose && (
        <button
          type="button"
          onClick={onClose}
          className="flex-shrink-0 text-slate-400 hover:text-slate-650 dark:hover:text-slate-200 p-1 hover:bg-slate-100/50 dark:hover:bg-slate-800 rounded-lg transition-colors"
          aria-label="Close notification"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      )}
    </div>
  );
};
