import { Suspense } from 'react';
import { LoginCard } from '@/components/auth/LoginCard';
import { TenantLoginForm } from '@/components/auth/TenantLoginForm';

export const metadata = {
  title: 'Login - Workspace',
  description: 'Sign in to your workspace',
};

export default function TenantLoginPage() {
  return (
    <LoginCard 
      title="Sign in to your workspace" 
      subtitle="Enter your organization details to continue"
    >
      <Suspense fallback={<div className="text-center text-sm text-slate-500">Loading form...</div>}>
        <TenantLoginForm />
      </Suspense>
    </LoginCard>
  );
}
