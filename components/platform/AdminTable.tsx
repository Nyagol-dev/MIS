"use client";

import { useState, useEffect } from "react";
import { Table } from "@/components/ui/Table";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";

export function AdminTable({ currentAdminId }: { currentAdminId: string | null }) {
  const [admins, setAdmins] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchAdmins = async () => {
    try {
      const res = await fetch("/api/platform/admins");
      if (res.ok) {
        const data = await res.json();
        setAdmins(data.items || []);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAdmins();
    const handleRefresh = () => fetchAdmins();
    window.addEventListener("refresh-admins", handleRefresh);
    return () => window.removeEventListener("refresh-admins", handleRefresh);
  }, []);

  const handleDeactivate = async (id: string) => {
    if (!confirm("Are you sure you want to deactivate this admin?")) return;
    try {
      const res = await fetch(`/api/platform/admins/${id}`, { method: "DELETE" });
      if (res.ok) {
        fetchAdmins();
      } else {
        const data = await res.json();
        alert(data.error || "Failed to deactivate");
      }
    } catch (e) {
      console.error(e);
    }
  };

  const columns = [
    { key: "email", header: "Email" },
    { key: "display_name", header: "Name" },
    { key: "is_active", header: "Status", render: (r: any) => (
      <Badge variant={r.is_active ? "success" : "gray"}>
        {r.is_active ? "Active" : "Inactive"}
      </Badge>
    )},
    { key: "actions", header: "Actions", render: (r: any) => {
      const isSelf = r.id === currentAdminId;
      if (!r.is_active) return null;
      
      return (
        <Button 
          variant="danger" 
          size="sm" 
          onClick={() => handleDeactivate(r.id)}
          disabled={isSelf}
          title={isSelf ? "Cannot deactivate yourself" : "Deactivate admin"}
        >
          Deactivate
        </Button>
      );
    }}
  ];

  return <Table columns={columns} data={admins} />;
}
