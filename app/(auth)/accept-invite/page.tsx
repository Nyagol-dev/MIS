import { PasswordSetupForm } from "@/components/auth/PasswordSetupForm";
import { isValidCredentialSetupToken } from "@/lib/auth/credentialSetup";

export const metadata = {
  title: "Set your password — Nexus MIS",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default async function AcceptInvitePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const rawToken = typeof params.token === "string" ? params.token : "";
  const token = isValidCredentialSetupToken(rawToken) ? rawToken : "";

  return (
    <>
      <h1 className="px-6 pt-6 text-xl font-semibold tracking-tight text-slate-900 dark:text-white">Set up your workspace password</h1>
      <p className="px-6 pt-2 text-sm leading-6 text-slate-600 dark:text-slate-400">Choose a password to activate your invited account. This link can only be used once and expires after 24 hours.</p>
      <div className="p-6">
        <PasswordSetupForm token={token} />
      </div>
    </>
  );
}
