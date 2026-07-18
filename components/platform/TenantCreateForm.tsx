"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Input } from "@/components/ui/Input";

export function TenantCreateForm() {
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    const formData = new FormData(e.currentTarget);
    const payload = {
      slug: formData.get("slug") as string,
      name: formData.get("name") as string,
      orgTypeId: formData.get("orgTypeId") as string,
    };

    try {
      const res = await fetch("/api/platform/tenants", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        setIsOpen(false);
        window.dispatchEvent(new Event("refresh-tenants"));
      } else {
        const data = await res.json();
        setError(data.error || "Failed to create tenant");
      }
    } catch (err: any) {
      setError(err.message || "An unexpected error occurred");
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Button onClick={() => setIsOpen(true)}>Create Tenant</Button>
      <Modal isOpen={isOpen} onClose={() => setIsOpen(false)} title="Create New Tenant">
        <form onSubmit={handleSubmit} className="space-y-4 mt-4">
          {error && <div className="text-red-500 text-sm mb-4">{error}</div>}
          <Input name="slug" label="Slug" required />
          <Input name="name" label="Display Name" required />
          <Input name="orgTypeId" label="Organization Type (Slug)" required />
          <div className="flex justify-end pt-4">
            <Button type="button" variant="ghost" onClick={() => setIsOpen(false)} className="mr-2">
              Cancel
            </Button>
            <Button type="submit" isLoading={loading}>Create</Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
