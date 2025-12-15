"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import Card, {
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import type { RoleName } from "@/types";
import {
  getAllUsers,
  getAllPersonnel,
  loadRucs,
  getAllRucs,
  updateRucName,
  type RucEntry,
} from "@/lib/client-stores";

type PageSize = 10 | 25 | 50 | 100;
const PAGE_SIZES: PageSize[] = [10, 25, 50, 100];

interface UserData {
  id: string;
  edipi: string;
  email: string;
  rank?: string;
  firstName?: string;
  lastName?: string;
  roles: Array<{
    id?: string;
    role_name: RoleName;
    scope_unit_id: string | null;
  }>;
}

export default function UnitManagementPage() {
  const [rucs, setRucs] = useState<RucEntry[]>([]);
  const [users, setUsers] = useState<UserData[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingRuc, setEditingRuc] = useState<RucEntry | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState<PageSize>(10);
  const [goToPage, setGoToPage] = useState("");

  const fetchData = useCallback(async () => {
    try {
      const data = await loadRucs();
      setRucs(data);

      // Build personnel lookup map by EDIPI for O(1) lookups
      const personnelList = getAllPersonnel();
      const personnelByEdipi = new Map(
        personnelList.map((p) => [p.service_id, p])
      );

      // Load users to show Unit Admins with personnel data
      const usersData = getAllUsers();
      setUsers(usersData.map(u => {
        const personnel = personnelByEdipi.get(u.edipi);
        return {
          id: u.id,
          edipi: u.edipi,
          email: u.email,
          rank: personnel?.rank,
          firstName: personnel?.first_name,
          lastName: personnel?.last_name,
          roles: (u.roles || []).map(r => ({
            id: r.id,
            role_name: r.role_name as RoleName,
            scope_unit_id: r.scope_unit_id,
          })),
        };
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Build map of RUC code -> Unit Admin(s)
  const unitAdminsByRuc = useMemo(() => {
    const map = new Map<string, UserData[]>();
    for (const user of users) {
      for (const role of user.roles) {
        if (role.role_name === "Unit Admin" && role.scope_unit_id) {
          const existing = map.get(role.scope_unit_id) || [];
          existing.push(user);
          map.set(role.scope_unit_id, existing);
        }
      }
    }
    return map;
  }, [users]);

  // Get display name for unit admin
  const getAdminDisplay = (user: UserData) => {
    if (user.rank && user.lastName) {
      return `${user.rank} ${user.lastName}, ${user.firstName || ""}`.trim();
    }
    return user.email;
  };

  // Filter RUCs based on search (case-insensitive)
  const filteredRucs = useMemo(() => {
    if (!searchQuery.trim()) return rucs;
    const q = searchQuery.toLowerCase();
    return rucs.filter(r =>
      r.ruc.toLowerCase().includes(q) ||
      (r.name && r.name.toLowerCase().includes(q))
    );
  }, [rucs, searchQuery]);

  // Pagination calculations
  const totalPages = Math.ceil(filteredRucs.length / pageSize);
  const startIndex = (currentPage - 1) * pageSize;
  const endIndex = startIndex + pageSize;
  const paginatedRucs = filteredRucs.slice(startIndex, endIndex);

  // Reset to page 1 when search or page size changes
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, pageSize]);

  const handleGoToPage = () => {
    const page = parseInt(goToPage, 10);
    if (!isNaN(page) && page >= 1 && page <= totalPages) {
      setCurrentPage(page);
      setGoToPage("");
    }
  };

  const handleSaveRucName = (rucCode: string, name: string | null) => {
    const success = updateRucName(rucCode, name);
    if (success) {
      // Refresh from cache (spread to create new array reference for React)
      setRucs([...getAllRucs()]);
      setEditingRuc(null);
    } else {
      setError("Failed to update RUC name");
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Unit Management</h1>
          <p className="text-foreground-muted mt-1">
            Manage RUC reference data and unit administrators ({rucs.length} total RUCs)
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Input
            placeholder="Search RUC or name..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-64"
          />
        </div>
      </div>

      {error && (
        <div className="p-4 rounded-lg bg-error/10 border border-error/20 text-error">
          {error}
          <button onClick={() => setError(null)} className="ml-2 text-error hover:underline">Dismiss</button>
        </div>
      )}

      {/* Edit RUC Name Modal */}
      {editingRuc && (
        <RucEditModal
          ruc={editingRuc}
          onClose={() => setEditingRuc(null)}
          onSave={handleSaveRucName}
        />
      )}

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>RUC Reference Data</CardTitle>
              <CardDescription>
                {(() => {
                  if (searchQuery.trim()) {
                    return `${filteredRucs.length} results found`;
                  }
                  const startItem = filteredRucs.length > 0 ? startIndex + 1 : 0;
                  const endItem = Math.min(endIndex, filteredRucs.length);
                  return `Showing ${startItem}-${endItem} of ${filteredRucs.length}`;
                })()}
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm text-foreground-muted">Per page:</span>
              <select
                className="px-3 py-1.5 rounded-lg bg-surface border border-border text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                value={pageSize}
                onChange={(e) => setPageSize(Number(e.target.value) as PageSize)}
              >
                {PAGE_SIZES.map(size => (
                  <option key={size} value={size}>{size}</option>
                ))}
              </select>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {paginatedRucs.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-foreground-muted">
                {searchQuery ? "No RUCs match your search" : "No RUCs loaded"}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left py-3 px-4 text-sm font-medium text-foreground-muted w-32">RUC</th>
                    <th className="text-left py-3 px-4 text-sm font-medium text-foreground-muted">Unit Name</th>
                    <th className="text-left py-3 px-4 text-sm font-medium text-foreground-muted">Unit Admin</th>
                    <th className="text-right py-3 px-4 text-sm font-medium text-foreground-muted w-24">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedRucs.map((ruc) => {
                    const admins = unitAdminsByRuc.get(ruc.ruc) || [];
                    return (
                      <tr key={ruc.ruc} className="border-b border-border hover:bg-surface-elevated">
                        <td className="py-3 px-4">
                          <span className="font-mono text-foreground font-medium">{ruc.ruc}</span>
                        </td>
                        <td className="py-3 px-4">
                          {ruc.name ? (
                            <span className="text-foreground">{ruc.name}</span>
                          ) : (
                            <span className="text-foreground-muted italic">Not set</span>
                          )}
                        </td>
                        <td className="py-3 px-4">
                          {admins.length > 0 ? (
                            <div className="flex flex-col gap-1">
                              {admins.map((admin) => (
                                <span key={admin.id} className="text-sm text-foreground">
                                  {getAdminDisplay(admin)}
                                </span>
                              ))}
                            </div>
                          ) : (
                            <span className="text-foreground-muted italic text-sm">None assigned</span>
                          )}
                        </td>
                        <td className="py-3 px-4 text-right">
                          <Button variant="ghost" size="sm" onClick={() => setEditingRuc(ruc)}>
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                            </svg>
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Pagination Controls */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-4 pt-4 border-t border-border">
              <div className="flex items-center gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setCurrentPage(1)}
                  disabled={currentPage === 1}
                >
                  First
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                >
                  Previous
                </Button>
              </div>

              <div className="flex items-center gap-3">
                <span className="text-sm text-foreground-muted">
                  Page {currentPage} of {totalPages}
                </span>
                <div className="flex items-center gap-2">
                  <Input
                    placeholder="Go to"
                    value={goToPage}
                    onChange={(e) => setGoToPage(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleGoToPage()}
                    className="w-20 text-sm"
                  />
                  <Button variant="secondary" size="sm" onClick={handleGoToPage}>
                    Go
                  </Button>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                  disabled={currentPage === totalPages}
                >
                  Next
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setCurrentPage(totalPages)}
                  disabled={currentPage === totalPages}
                >
                  Last
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// RUC Name Edit Modal
function RucEditModal({
  ruc,
  onClose,
  onSave,
}: {
  ruc: RucEntry;
  onClose: () => void;
  onSave: (rucCode: string, name: string | null) => void;
}) {
  const [name, setName] = useState(ruc.name || "");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(ruc.ruc, name.trim() || null);
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <Card variant="elevated" className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Edit RUC Name</CardTitle>
          <CardDescription>Set a display name for RUC {ruc.ruc}</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="p-3 rounded-lg bg-surface-elevated border border-border">
              <label className="block text-sm font-medium text-foreground-muted mb-1">RUC Code</label>
              <span className="font-mono text-lg text-foreground">{ruc.ruc}</span>
            </div>
            <Input
              label="Unit Name"
              placeholder="e.g., 1st Battalion, Alpha Company"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
            />
            <div className="flex gap-3 pt-2">
              <Button type="button" variant="secondary" onClick={onClose} className="flex-1">
                Cancel
              </Button>
              <Button type="submit" variant="accent" className="flex-1">
                Save
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
