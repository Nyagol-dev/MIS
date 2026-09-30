"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Input } from "@/components/ui/Input";

export function AdminCreateForm() {
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
      email: formData.get("email") as string,
      displayName: formData.get("displayName") as string,
    };

    try {
      const res = await fetch("/api/platform/admins", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        const data = await res.json();
        setSetupUrl(`${window.location.origin}${data.setupPath}`);
        window.dispatchEvent(new Event("refresh-admins"));
      } else {
        const data = await res.json();
        setError(data.error || "Failed to create admin");
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "An unexpected error occurred");
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Button onClick={() => setIsOpen(true)}>Create Admin</Button>
      <Modal isOpen={isOpen} onClose={() => setIsOpen(false)} title="Create New Admin">
        {setupUrl ? <div className="mt-4 space-y-4">
          <p className="rounded-md border border-emerald-200 bg-emerald-50 p-4 text-sm leading-6 text-emerald-900">Share this one-time password setup link with the new administrator through a private channel. It expires in 24 hours.</p>
          <Input label="One-time setup link" id="platform-admin-setup-link" type="url" value={setupUrl} readOnly />
          <div className="flex justify-end gap-3 border-t border-slate-100 pt-4">
            <Button type="button" variant="outline" onClick={async () => {
              try { await navigator.clipboard.writeText(setupUrl); setCopied(true); }
              catch { setCopied(false); }
            }}>{copied ? "Copied" : "Copy link"}</Button>
            <Button type="button" onClick={() => { setIsOpen(false); setSetupUrl(null); setCopied(false); }}>Done</Button>
          </div>
        </div> : <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          {error && <div className="text-red-500 text-sm mb-4">{error}</div>}
          <Input name="email" type="email" label="Email Address" required />
          <Input name="displayName" label="Display Name" required />
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
