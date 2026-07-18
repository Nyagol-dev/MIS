"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Input } from "@/components/ui/Input";

export function AdminCreateForm() {
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

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
        setIsOpen(false);
        window.dispatchEvent(new Event("refresh-admins"));
      } else {
        const data = await res.json();
        setError(data.error || "Failed to create admin");
      }
    } catch (err: any) {
      setError(err.message || "An unexpected error occurred");
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Button onClick={() => setIsOpen(true)}>Create Admin</Button>
      <Modal isOpen={isOpen} onClose={() => setIsOpen(false)} title="Create New Admin">
        <form onSubmit={handleSubmit} className="space-y-4 mt-4">
          {error && <div className="text-red-500 text-sm mb-4">{error}</div>}
          <Input name="email" type="email" label="Email Address" required />
          <Input name="displayName" label="Display Name" required />
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
