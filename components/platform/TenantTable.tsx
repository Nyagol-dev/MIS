"use client";

import { useState, useEffect } from "react";
import { Table } from "@/components/ui/Table";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";

export function TenantTable() {
  const [tenants, setTenants] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchTenants = async () => {
    try {
      const res = await fetch("/api/platform/tenants");
      if (res.ok) {
        const data = await res.json();
        setTenants(data.items || []);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTenants();
    const handleRefresh = () => fetchTenants();
    window.addEventListener("refresh-tenants", handleRefresh);
    return () => window.removeEventListener("refresh-tenants", handleRefresh);
  }, []);

  const handleDeactivate = async (id: string) => {
    if (!confirm("Are you sure you want to deactivate this tenant?")) return;
    try {
      const res = await fetch(`/api/platform/tenants/${id}`, { method: "DELETE" });
      if (res.ok) {
        fetchTenants();
      } else {
        const data = await res.json();
        alert(data.error || "Failed to deactivate");
      }
    } catch (e) {
      console.error(e);
    }
  };

  const columns = [
    { key: "slug", header: "Slug" },
    { key: "display_name", header: "Name" },
    { key: "org_type", header: "Type", render: (r: any) => <Badge variant="info">{r.org_type}</Badge> },
    { key: "is_active", header: "Status", render: (r: any) => (
      <Badge variant={r.is_active ? "success" : "gray"}>
        {r.is_active ? "Active" : "Inactive"}
      </Badge>
    )},
    { key: "actions", header: "Actions", render: (r: any) => (
      r.is_active ? (
        <Button variant="danger" size="sm" onClick={() => handleDeactivate(r.id)}>
          Deactivate
        </Button>
      ) : null
    )}
  ];

  return <Table columns={columns} data={tenants} />;
}
