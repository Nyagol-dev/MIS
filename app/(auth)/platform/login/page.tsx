import { Suspense } from 'react';
import { LoginCard } from '@/components/auth/LoginCard';
import { PlatformLoginForm } from '@/components/auth/PlatformLoginForm';

export const metadata = {
  title: 'Platform Login',
  description: 'Sign in to the platform administration',
};

export default function PlatformLoginPage() {
  return (
    <LoginCard 
      title="Platform Administration" 
      subtitle="Restricted access for system administrators"
    >
      <Suspense fallback={<div className="text-center text-sm text-slate-500">Loading form...</div>}>
        <PlatformLoginForm />
      </Suspense>
    </LoginCard>
  );
}
