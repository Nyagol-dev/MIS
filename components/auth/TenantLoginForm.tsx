'use client';

import React, { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { safeReturnPath } from '@/lib/auth/safeReturnPath';

export function TenantLoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextUrl = safeReturnPath(searchParams?.get('next') ?? null, '/dashboard');
  
  const [orgSlug, setOrgSlug] = useState(searchParams?.get('org') || '');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsLoading(true);

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ slug: orgSlug.trim(), email: email.trim(), password }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Invalid credentials or tenant not found.');
      }

      router.push(nextUrl);
      router.refresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unable to sign in. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <form className="space-y-6" onSubmit={handleSubmit}>
      {error && (
        <div role="alert" aria-live="polite" className="rounded-md border border-red-200 bg-red-50 p-4 dark:border-red-900 dark:bg-red-900/30">
          <div className="text-sm text-red-700 dark:text-red-400">{error}</div>
        </div>
      )}

      <Input
        label="Organization Slug"
        id="orgSlug"
        type="text"
        required
        value={orgSlug}
        onChange={(e) => setOrgSlug(e.target.value)}
        placeholder="acme-corp"
        autoComplete="organization"
        autoCapitalize="none"
        spellCheck={false}
      />

      <Input
        label="Email Address"
        id="email"
        type="email"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="you@example.com"
        autoComplete="username"
      />

      <Input
        label="Password"
        id="password"
        type="password"
        autoComplete="current-password"
        required
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />

      <Button type="submit" className="w-full" isLoading={isLoading}>
        Sign In
      </Button>
    </form>
  );
}
