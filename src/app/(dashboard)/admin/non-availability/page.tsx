"use client";

import { useState, useEffect } from "react";
import Button from "@/components/ui/Button";
import type { NonAvailability, Personnel } from "@/types";
import {
  getAllPersonnel,
  getEnrichedNonAvailability,
  createNonAvailability,
  updateNonAvailability,
  deleteNonAvailability as deleteNonAvailabilityFn,
  type EnrichedNonAvailability,
} from "@/lib/client-stores";

export default function NonAvailabilityAdminPage() {
  const [requests, setRequests] = useState<EnrichedNonAvailability[]>([]);
  const [personnel, setPersonnel] = useState<Personnel[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>("pending");
  const [processingId, setProcessingId] = useState<string | null>(null);

  // Add request modal
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [formData, setFormData] = useState({
    personnel_id: "",
    start_date: "",
    end_date: "",
    reason: "",
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetchData();
  }, [statusFilter]);

  function fetchData() {
    try {
      setLoading(true);

      // Fetch personnel for the add modal
      const personnelData = getAllPersonnel();
      setPersonnel(personnelData);

      // Fetch requests with status filter
      const requestsData = getEnrichedNonAvailability(statusFilter || undefined);
      setRequests(requestsData);
    } catch (err) {
      console.error("Error fetching data:", err);
    } finally {
      setLoading(false);
    }
  }

  function handleStatusChange(requestId: string, newStatus: "approved" | "rejected") {
    setProcessingId(requestId);

    try {
      updateNonAvailability(requestId, { status: newStatus });
      fetchData();
    } catch (err) {
      console.error("Error updating request:", err);
    } finally {
      setProcessingId(null);
    }
  }

  function handleDelete(requestId: string) {
    if (!confirm("Are you sure you want to delete this request?")) return;

    setProcessingId(requestId);

    try {
      deleteNonAvailabilityFn(requestId);
      fetchData();
    } catch (err) {
      console.error("Error deleting request:", err);
    } finally {
      setProcessingId(null);
    }
  }

  function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError("");

    try {
      const newRequest: NonAvailability = {
        id: crypto.randomUUID(),
        personnel_id: formData.personnel_id,
        start_date: new Date(formData.start_date),
        end_date: new Date(formData.end_date),
        reason: formData.reason,
        status: "approved", // Admin-created requests are auto-approved
        approved_by: "admin", // Admin-created requests
        created_at: new Date(),
      };

      createNonAvailability(newRequest);

      setIsAddModalOpen(false);
      setFormData({ personnel_id: "", start_date: "", end_date: "", reason: "" });
      fetchData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create request");
    } finally {
      setSubmitting(false);
    }
  }

  function formatDate(date: string | Date): string {
    return new Date(date).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  }

  function getStatusBadge(status: string): string {
    switch (status) {
      case "approved":
        return "bg-green-500/20 text-green-400";
      case "rejected":
        return "bg-red-500/20 text-red-400";
      default:
        return "bg-yellow-500/20 text-yellow-400";
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-foreground-muted">Loading requests...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Non-Availability Requests</h1>
          <p className="text-foreground-muted mt-1">
            Manage duty exemption requests from personnel
          </p>
        </div>
        <Button onClick={() => setIsAddModalOpen(true)}>+ Add Request</Button>
      </div>

      {/* Filters */}
      <div className="flex gap-4 items-center">
        <label className="text-sm text-foreground-muted">Filter by status:</label>
        <div className="flex gap-2">
          {["pending", "approved", "rejected", ""].map((status) => (
            <button
              key={status || "all"}
              onClick={() => setStatusFilter(status)}
              className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
                statusFilter === status
                  ? "bg-primary text-white"
                  : "bg-surface border border-border text-foreground-muted hover:text-foreground"
              }`}
            >
              {status || "All"}
            </button>
          ))}
        </div>
      </div>

      {/* Stats */}
      <div className="grid gap-4 md:grid-cols-4">
        <div className="bg-surface rounded-lg border border-border p-4">
          <div className="text-2xl font-bold text-yellow-400">
            {requests.filter((r) => r.status === "pending").length}
          </div>
          <div className="text-sm text-foreground-muted">Pending</div>
        </div>
        <div className="bg-surface rounded-lg border border-border p-4">
          <div className="text-2xl font-bold text-green-400">
            {requests.filter((r) => r.status === "approved").length}
          </div>
          <div className="text-sm text-foreground-muted">Approved</div>
        </div>
        <div className="bg-surface rounded-lg border border-border p-4">
          <div className="text-2xl font-bold text-red-400">
            {requests.filter((r) => r.status === "rejected").length}
          </div>
          <div className="text-sm text-foreground-muted">Rejected</div>
        </div>
        <div className="bg-surface rounded-lg border border-border p-4">
          <div className="text-2xl font-bold text-foreground">{requests.length}</div>
          <div className="text-sm text-foreground-muted">Total Shown</div>
        </div>
      </div>

      {/* Requests Table */}
      {requests.length === 0 ? (
        <div className="text-center py-12 bg-surface rounded-lg border border-border">
          <p className="text-foreground-muted">
            No {statusFilter || ""} requests found.
          </p>
        </div>
      ) : (
        <div className="bg-surface rounded-lg border border-border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border bg-surface-elevated">
                  <th className="text-left px-4 py-3 text-sm font-medium text-foreground">
                    Personnel
                  </th>
                  <th className="text-left px-4 py-3 text-sm font-medium text-foreground">
                    Date Range
                  </th>
                  <th className="text-left px-4 py-3 text-sm font-medium text-foreground">
                    Reason
                  </th>
                  <th className="text-left px-4 py-3 text-sm font-medium text-foreground">
                    Status
                  </th>
                  <th className="text-left px-4 py-3 text-sm font-medium text-foreground">
                    Submitted
                  </th>
                  <th className="text-right px-4 py-3 text-sm font-medium text-foreground">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {requests.map((request) => (
                  <tr key={request.id} className="border-b border-border last:border-0">
                    <td className="px-4 py-3">
                      {request.personnel ? (
                        <div>
                          <div className="font-medium text-foreground">
                            {request.personnel.rank} {request.personnel.last_name}
                          </div>
                          <div className="text-sm text-foreground-muted">
                            {request.personnel.first_name}
                          </div>
                        </div>
                      ) : (
                        <span className="text-foreground-muted">Unknown</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-foreground">
                      {formatDate(request.start_date)} - {formatDate(request.end_date)}
                    </td>
                    <td className="px-4 py-3 text-foreground max-w-[200px] truncate">
                      {request.reason}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`px-2 py-1 text-xs font-medium rounded-full ${getStatusBadge(
                          request.status
                        )}`}
                      >
                        {request.status.charAt(0).toUpperCase() + request.status.slice(1)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-foreground-muted">
                      {formatDate(request.created_at)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-2">
                        {request.status === "pending" && (
                          <>
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => handleStatusChange(request.id, "approved")}
                              disabled={processingId === request.id}
                            >
                              Approve
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => handleStatusChange(request.id, "rejected")}
                              disabled={processingId === request.id}
                            >
                              Reject
                            </Button>
                          </>
                        )}
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => handleDelete(request.id)}
                          disabled={processingId === request.id}
                        >
                          Delete
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Add Request Modal */}
      {isAddModalOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-surface rounded-lg border border-border w-full max-w-md">
            <div className="p-4 border-b border-border">
              <h2 className="text-lg font-semibold text-foreground">
                Add Non-Availability Request
              </h2>
            </div>
            <form onSubmit={handleCreate} className="p-4 space-y-4">
              {error && (
                <div className="p-3 bg-accent/20 text-accent rounded-lg text-sm">{error}</div>
              )}

              <div>
                <label className="block text-sm font-medium text-foreground mb-1">
                  Personnel *
                </label>
                <select
                  value={formData.personnel_id}
                  onChange={(e) =>
                    setFormData({ ...formData, personnel_id: e.target.value })
                  }
                  required
                  className="w-full px-3 py-2 bg-background border border-border rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                >
                  <option value="">Select Personnel</option>
                  {personnel.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.rank} {p.last_name}, {p.first_name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid gap-4 grid-cols-2">
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">
                    Start Date *
                  </label>
                  <input
                    type="date"
                    value={formData.start_date}
                    onChange={(e) =>
                      setFormData({ ...formData, start_date: e.target.value })
                    }
                    required
                    className="w-full px-3 py-2 bg-background border border-border rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">
                    End Date *
                  </label>
                  <input
                    type="date"
                    value={formData.end_date}
                    onChange={(e) =>
                      setFormData({ ...formData, end_date: e.target.value })
                    }
                    required
                    className="w-full px-3 py-2 bg-background border border-border rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-foreground mb-1">
                  Reason *
                </label>
                <textarea
                  value={formData.reason}
                  onChange={(e) => setFormData({ ...formData, reason: e.target.value })}
                  required
                  rows={3}
                  placeholder="e.g., Leave, TDY, Medical appointment, Training"
                  className="w-full px-3 py-2 bg-background border border-border rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>

              <p className="text-xs text-foreground-muted">
                Requests created by admins are automatically approved.
              </p>

              <div className="flex justify-end gap-3 pt-4 border-t border-border">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setIsAddModalOpen(false)}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={submitting}>
                  {submitting ? "Creating..." : "Create Request"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
