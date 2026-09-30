"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Input } from "@/components/ui/Input";

export function TenantCreateForm() {
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [setupUrl, setSetupUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    const formData = new FormData(e.currentTarget);
    const payload = {
      slug: formData.get("slug") as string,
      name: formData.get("name") as string,
      orgTypeId: formData.get("orgTypeId") as string,
      initialAdmin: {
        displayName: formData.get("initialAdminName") as string,
        email: formData.get("initialAdminEmail") as string,
      },
    };

    try {
      const res = await fetch("/api/platform/tenants", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        const data = await res.json();
        setSetupUrl(`${window.location.origin}${data.firstAdminSetupPath}`);
        window.dispatchEvent(new Event("refresh-tenants"));
      } else {
        const data = await res.json();
        setError(data.error || "Failed to create tenant");
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "An unexpected error occurred");
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Button onClick={() => setIsOpen(true)}>Create Tenant</Button>
      <Modal isOpen={isOpen} onClose={() => setIsOpen(false)} title="Create New Tenant">
        {setupUrl ? <div className="mt-4 space-y-4">
          <p className="rounded-md border border-emerald-200 bg-emerald-50 p-4 text-sm leading-6 text-emerald-900">The organisation and its first workspace administrator are ready. Share this one-time setup link privately; it expires in 24 hours.</p>
          <Input label="One-time setup link" id="tenant-admin-setup-link" type="url" value={setupUrl} readOnly />
          <div className="flex justify-end gap-3 border-t border-slate-100 pt-4">
            <Button type="button" variant="outline" onClick={async () => {
              try { await navigator.clipboard.writeText(setupUrl); setCopied(true); }
              catch { setCopied(false); }
            }}>{copied ? "Copied" : "Copy link"}</Button>
            <Button type="button" onClick={() => { setIsOpen(false); setSetupUrl(null); setCopied(false); }}>Done</Button>
          </div>
        </div> : <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          {error && <div className="text-red-500 text-sm mb-4">{error}</div>}
          <Input name="slug" label="Organisation slug" autoCapitalize="none" required />
          <Input name="name" label="Organisation name" required />
          <Input name="orgTypeId" label="Organisation type" placeholder="school, clinic, ngo, civic_agency, other" autoCapitalize="none" required />
          <div className="border-t border-slate-200 pt-4">
            <p className="mb-3 text-sm font-semibold text-slate-800">First workspace administrator</p>
            <div className="space-y-4">
              <Input name="initialAdminName" label="Full name" autoComplete="name" required />
              <Input name="initialAdminEmail" label="Email address" type="email" autoComplete="email" required />
            </div>
          </div>
          <div className="flex justify-end pt-4">
            <Button type="button" variant="ghost" onClick={() => setIsOpen(false)} className="mr-2">
              Cancel
            </Button>
            <Button type="submit" isLoading={loading}>Create</Button>
          </div>
        </form>}
      </Modal>
    </>
  );
}
