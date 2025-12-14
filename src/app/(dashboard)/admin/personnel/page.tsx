"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import Card, {
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import type { Personnel, UnitSection } from "@/types";
import {
  getAllPersonnel,
  getUnitSections,
  createPersonnel,
  parseManpowerTsv,
  importManpowerData,
  exportUnitStructure,
  exportUnitMembers,
} from "@/lib/client-stores";
import {
  isGitHubConfigured,
  getGitHubSettings,
  saveGitHubSettings,
  pushSeedFilesToGitHub,
  testGitHubConnection,
  type GitHubSettings,
} from "@/lib/github-api";

export default function PersonnelPage() {
  const [personnel, setPersonnel] = useState<Personnel[]>([]);
  const [units, setUnits] = useState<UnitSection[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showImportModal, setShowImportModal] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [filterUnit, setFilterUnit] = useState<string>("");
  const [searchTerm, setSearchTerm] = useState("");

  const fetchData = useCallback(() => {
    try {
      const personnelData = getAllPersonnel();
      const unitsData = getUnitSections();

      setPersonnel(personnelData);
      setUnits(unitsData);
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Create a Map of units for O(1) lookups
  const unitMap = useMemo(() => new Map(units.map(u => [u.id, u])), [units]);

  const getUnitName = (unitId: string) => {
    const unit = unitMap.get(unitId);
    return unit?.unit_name || "Unknown";
  };

  // Build full unit path (e.g., "H Company > S1DV > CUST")
  const getFullUnitPath = (unitId: string): string => {
    const path: string[] = [];
    let currentUnit = unitMap.get(unitId);

    while (currentUnit) {
      // Skip RUC level for cleaner display
      if (currentUnit.hierarchy_level !== "ruc") {
        path.unshift(currentUnit.unit_name);
      }
      currentUnit = currentUnit.parent_id
        ? unitMap.get(currentUnit.parent_id)
        : undefined;
    }

    return path.join(" > ") || "Unknown";
  };

  // Get parent unit at specific level
  const getParentAtLevel = (
    unitId: string,
    level: "company" | "section" | "platoon" | "work_section"
  ): string => {
    let currentUnit = unitMap.get(unitId);

    while (currentUnit) {
      if (currentUnit.hierarchy_level === level) {
        return currentUnit.unit_name;
      }
      currentUnit = currentUnit.parent_id
        ? unitMap.get(currentUnit.parent_id)
        : undefined;
    }

    return "-";
  };

  // Check if unitId is the filterUnit OR is a descendant of filterUnit
  const isUnitInFilterPath = (unitId: string): boolean => {
    if (!filterUnit) return true;
    if (unitId === filterUnit) return true;

    // Walk up the hierarchy to see if filterUnit is an ancestor
    let currentUnit = unitMap.get(unitId);
    while (currentUnit?.parent_id) {
      if (currentUnit.parent_id === filterUnit) {
        return true;
      }
      currentUnit = unitMap.get(currentUnit.parent_id);
    }
    return false;
  };

  // Filter and search personnel
  const filteredPersonnel = personnel.filter((p) => {
    const matchesUnit = isUnitInFilterPath(p.unit_section_id);
    const matchesSearch =
      !searchTerm ||
      p.first_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      p.last_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      p.service_id.toLowerCase().includes(searchTerm.toLowerCase()) ||
      p.rank.toLowerCase().includes(searchTerm.toLowerCase());
    return matchesUnit && matchesSearch;
  });

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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Personnel</h1>
          <p className="text-foreground-muted mt-1">
            Manage service members and import roster data
          </p>
        </div>
        <div className="flex gap-3">
          <Button variant="secondary" onClick={() => setShowImportModal(true)}>
            <svg
              className="w-5 h-5 mr-2"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"
              />
            </svg>
            Import CSV
          </Button>
          <Button variant="accent" onClick={() => setShowAddModal(true)}>
            <svg
              className="w-5 h-5 mr-2"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 6v6m0 0v6m0-6h6m-6 0H6"
              />
            </svg>
            Add Personnel
          </Button>
        </div>
      </div>

      {/* Error Alert */}
      {error && (
        <div className="p-4 rounded-lg bg-error/10 border border-error/20 text-error">
          {error}
          <button
            onClick={() => setError(null)}
            className="ml-2 text-error hover:underline"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Import Modal */}
      {showImportModal && (
        <ImportModal
          units={units}
          onClose={() => setShowImportModal(false)}
          onSuccess={() => {
            setShowImportModal(false);
            fetchData();
          }}
        />
      )}

      {/* Add Modal */}
      {showAddModal && (
        <AddPersonnelModal
          units={units}
          onClose={() => setShowAddModal(false)}
          onSuccess={() => {
            setShowAddModal(false);
            fetchData();
          }}
        />
      )}

      {/* Filters */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-col md:flex-row gap-4">
            <div className="flex-1">
              <Input
                placeholder="Search by name, service ID, or rank..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
            <div className="w-full md:w-64">
              <select
                className="w-full px-4 py-2.5 rounded-lg bg-surface border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                value={filterUnit}
                onChange={(e) => setFilterUnit(e.target.value)}
              >
                <option value="">All Sections</option>
                {units.map((unit) => (
                  <option key={unit.id} value={unit.id}>
                    {unit.unit_name}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Personnel Table */}
      <Card>
        <CardHeader>
          <CardTitle>
            Personnel Roster
            <span className="text-foreground-muted text-sm font-normal ml-2">
              ({filteredPersonnel.length} of {personnel.length})
            </span>
          </CardTitle>
          <CardDescription>
            Service members available for duty assignment
          </CardDescription>
        </CardHeader>
        <CardContent>
          {personnel.length === 0 ? (
            <div className="text-center py-12">
              <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-primary/20 flex items-center justify-center">
                <svg
                  className="w-8 h-8 text-highlight"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z"
                  />
                </svg>
              </div>
              <h2 className="text-xl font-semibold text-foreground mb-2">
                No Personnel Records
              </h2>
              <p className="text-foreground-muted mb-6 max-w-md mx-auto">
                Import your unit roster via CSV or add personnel manually to get started.
              </p>
              <div className="flex justify-center gap-3">
                <Button variant="accent" onClick={() => setShowImportModal(true)}>
                  Import CSV
                </Button>
                <Button variant="secondary" onClick={() => setShowAddModal(true)}>
                  Add Manually
                </Button>
              </div>
            </div>
          ) : filteredPersonnel.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-foreground-muted">No personnel match your search criteria</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left py-3 px-4 text-sm font-medium text-foreground-muted">
                      Name
                    </th>
                    <th className="text-left py-3 px-4 text-sm font-medium text-foreground-muted">
                      Rank
                    </th>
                    <th className="text-left py-3 px-4 text-sm font-medium text-foreground-muted">
                      Company
                    </th>
                    <th className="text-left py-3 px-4 text-sm font-medium text-foreground-muted">
                      Section
                    </th>
                    <th className="text-left py-3 px-4 text-sm font-medium text-foreground-muted">
                      Work Section
                    </th>
                    <th className="text-left py-3 px-4 text-sm font-medium text-foreground-muted">
                      Duty Score
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filteredPersonnel.map((person) => (
                    <tr
                      key={person.id}
                      className="border-b border-border hover:bg-surface-elevated"
                    >
                      <td className="py-3 px-4">
                        <span className="font-medium text-foreground">
                          {person.last_name}, {person.first_name}
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        <span className="px-2 py-0.5 text-xs font-medium rounded bg-primary/20 text-blue-400">
                          {person.rank}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-foreground-muted">
                        {getParentAtLevel(person.unit_section_id, "company")}
                      </td>
                      <td className="py-3 px-4 text-foreground-muted">
                        {getParentAtLevel(person.unit_section_id, "section")}
                      </td>
                      <td className="py-3 px-4 text-foreground-muted">
                        {getUnitName(person.unit_section_id)}
                      </td>
                      <td className="py-3 px-4">
                        <span className="text-highlight font-medium">
                          {person.current_duty_score.toFixed(1)}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function ImportModal({
  units,
  onClose,
  onSuccess,
}: {
  units: UnitSection[];
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    personnel: { created: number; updated: number };
    units?: { created: number };
    nonAvailability?: { created: number };
    errors: string[];
  } | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // GitHub sync state
  const [gitHubStatus, setGitHubStatus] = useState<"idle" | "pushing" | "success" | "error">("idle");
  const [gitHubMessage, setGitHubMessage] = useState<string>("");
  const [showSettings, setShowSettings] = useState(false);
  const [settings, setSettings] = useState<GitHubSettings>(() => {
    const saved = getGitHubSettings();
    return saved || {
      owner: "",
      repo: "",
      branch: "main",
      token: "",
      unitPath: "public/data/unit/02301",
    };
  });
  const [testingConnection, setTestingConnection] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<string>("");

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setSelectedFile(file);
      setError(null);
      setResult(null);
      setGitHubStatus("idle");
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file && (file.name.endsWith('.csv') || file.name.endsWith('.txt'))) {
      setSelectedFile(file);
      setError(null);
      setResult(null);
      setGitHubStatus("idle");
    } else {
      setError("Please drop a CSV or TXT file");
    }
  };

  const handleTestConnection = async () => {
    setTestingConnection(true);
    setConnectionStatus("");
    const result = await testGitHubConnection(settings);
    setConnectionStatus(result.message);
    setTestingConnection(false);
  };

  const handleSaveSettings = () => {
    saveGitHubSettings(settings);
    setShowSettings(false);
    setConnectionStatus("");
  };

  const handleSubmit = async () => {
    if (!selectedFile) {
      setError("Please select a file");
      return;
    }

    setIsSubmitting(true);
    setError(null);
    setGitHubStatus("idle");

    try {
      const text = await selectedFile.text();

      // Parse Morning Report format (supports both CSV and TSV)
      const records = parseManpowerTsv(text);

      if (records.length === 0) {
        throw new Error("No valid records found in file. Make sure it contains Rank, Name, EDIPI columns.");
      }

      const data = importManpowerData(records);

      setResult({
        personnel: data.personnel,
        units: data.units,
        nonAvailability: data.nonAvailability,
        errors: data.errors || [],
      });

      // Auto-push to GitHub if configured
      if ((data.personnel.created > 0 || data.units?.created) && isGitHubConfigured()) {
        setGitHubStatus("pushing");
        setGitHubMessage("Pushing to GitHub...");

        const unitStructure = exportUnitStructure();
        const unitMembers = exportUnitMembers();
        // Pass the detected RUC to push to the correct unit folder
        const pushResult = await pushSeedFilesToGitHub(unitStructure, unitMembers, data.ruc);

        if (pushResult.success) {
          setGitHubStatus("success");
          setGitHubMessage("Successfully pushed to GitHub. Changes will deploy automatically.");
        } else {
          setGitHubStatus("error");
          setGitHubMessage(
            `Push failed: ${pushResult.structureResult.message || pushResult.membersResult.message}`
          );
        }
      }

      if (data.personnel.created > 0 || data.personnel.updated > 0) {
        setTimeout(() => {
          onSuccess();
        }, 3000);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <Card variant="elevated" className="w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Import Morning Report</CardTitle>
              <CardDescription>
                Upload a Morning Report to replace the current roster
              </CardDescription>
            </div>
            <button
              type="button"
              onClick={() => setShowSettings(!showSettings)}
              className={`p-2 rounded-lg transition-colors ${
                showSettings ? "bg-primary/20 text-primary" : "hover:bg-surface-elevated text-foreground-muted"
              }`}
              title="GitHub Settings"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* GitHub Settings Panel */}
          {showSettings && (
            <div className="p-4 rounded-lg bg-surface-elevated border border-border space-y-3">
              <div className="flex items-center gap-2 mb-2">
                <svg className="w-5 h-5 text-foreground-muted" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
                </svg>
                <span className="font-medium text-foreground">GitHub Sync Settings</span>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Input
                  label="Owner"
                  placeholder="SemperAdmin"
                  value={settings.owner}
                  onChange={(e) => setSettings({ ...settings, owner: e.target.value })}
                />
                <Input
                  label="Repository"
                  placeholder="DutySync"
                  value={settings.repo}
                  onChange={(e) => setSettings({ ...settings, repo: e.target.value })}
                />
              </div>
              <Input
                label="Branch"
                placeholder="main"
                value={settings.branch}
                onChange={(e) => setSettings({ ...settings, branch: e.target.value })}
              />
              <Input
                label="Unit Data Path"
                placeholder="public/data/unit/02301"
                value={settings.unitPath}
                onChange={(e) => setSettings({ ...settings, unitPath: e.target.value })}
              />
              <Input
                label="Personal Access Token"
                type="password"
                placeholder="ghp_xxxxxxxxxxxx"
                value={settings.token}
                onChange={(e) => setSettings({ ...settings, token: e.target.value })}
              />
              <p className="text-xs text-foreground-muted">
                Token needs <code className="bg-surface px-1 rounded">repo</code> scope.{" "}
                <a
                  href="https://github.com/settings/tokens/new?scopes=repo&description=DutySync"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline"
                >
                  Create token
                </a>
              </p>
              {connectionStatus && (
                <p className={`text-xs ${connectionStatus.includes("Connected") ? "text-success" : "text-error"}`}>
                  {connectionStatus}
                </p>
              )}
              <div className="flex gap-2 pt-2">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={handleTestConnection}
                  isLoading={testingConnection}
                  disabled={!settings.owner || !settings.repo || !settings.token}
                >
                  Test Connection
                </Button>
                <Button
                  type="button"
                  variant="accent"
                  size="sm"
                  onClick={handleSaveSettings}
                  disabled={!settings.owner || !settings.repo || !settings.token}
                >
                  Save Settings
                </Button>
              </div>
            </div>
          )}

          {error && (
            <div className="p-3 rounded-lg bg-error/10 border border-error/20 text-error text-sm">
              {error}
            </div>
          )}

          {result && (
            <div
              className={`p-3 rounded-lg border text-sm ${
                result.personnel.created > 0 || result.personnel.updated > 0
                  ? "bg-success/10 border-success/20 text-success"
                  : "bg-warning/10 border-warning/20 text-warning"
              }`}
            >
              <p className="font-medium">Import Results:</p>
              <ul className="mt-1 space-y-1">
                <li>Personnel Created: {result.personnel.created}</li>
                <li>Personnel Updated: {result.personnel.updated}</li>
                {result.units && result.units.created > 0 && (
                  <li>Units Created: {result.units.created}</li>
                )}
                {result.nonAvailability && result.nonAvailability.created > 0 && (
                  <li>Non-Availability Records: {result.nonAvailability.created}</li>
                )}
                {result.errors.length > 0 && (
                  <li className="text-error">
                    Errors: {result.errors.length}
                    <ul className="ml-4 mt-1 text-xs">
                      {result.errors.slice(0, 5).map((err, i) => (
                        <li key={i}>{err}</li>
                      ))}
                      {result.errors.length > 5 && (
                        <li>...and {result.errors.length - 5} more</li>
                      )}
                    </ul>
                  </li>
                )}
              </ul>

              {/* GitHub Sync Status */}
              {(result.personnel.created > 0 || result.units?.created) && (
                <div className="mt-3 pt-3 border-t border-success/20">
                  {!isGitHubConfigured() ? (
                    <p className="text-xs text-foreground-muted">
                      Configure GitHub settings to auto-sync changes to the repository.
                    </p>
                  ) : gitHubStatus === "pushing" ? (
                    <div className="flex items-center gap-2 text-foreground-muted">
                      <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                      <span className="text-xs">{gitHubMessage}</span>
                    </div>
                  ) : gitHubStatus === "success" ? (
                    <div className="flex items-center gap-2 text-success">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                      <span className="text-xs">{gitHubMessage}</span>
                    </div>
                  ) : gitHubStatus === "error" ? (
                    <div className="flex items-center gap-2 text-error">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                      <span className="text-xs">{gitHubMessage}</span>
                    </div>
                  ) : null}
                </div>
              )}
            </div>
          )}

          {/* File Upload */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-1.5">
              Morning Report File
            </label>
            <div
              className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors ${
                selectedFile
                  ? "border-success bg-success/5"
                  : isDragging
                  ? "border-primary bg-primary/10"
                  : "border-border hover:border-primary"
              }`}
              onClick={() => fileInputRef.current?.click()}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,.txt"
                onChange={handleFileChange}
                className="hidden"
              />
              {selectedFile ? (
                <div>
                  <svg
                    className="w-8 h-8 mx-auto text-success mb-2"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                    />
                  </svg>
                  <p className="text-foreground font-medium">{selectedFile.name}</p>
                  <p className="text-sm text-foreground-muted mt-1">
                    Click to change file
                  </p>
                </div>
              ) : (
                <div>
                  <svg
                    className="w-8 h-8 mx-auto text-foreground-muted mb-2"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
                    />
                  </svg>
                  <p className="text-foreground-muted">
                    Click to select or drag and drop
                  </p>
                  <p className="text-sm text-foreground-muted mt-1">
                    CSV or TXT file
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Format Help */}
          <div className="p-3 rounded-lg bg-surface-elevated border border-border">
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-medium text-foreground">
                Morning Report Format:
              </p>
              {isGitHubConfigured() && (
                <span className="flex items-center gap-1 text-xs text-success">
                  <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
                  </svg>
                  Auto-sync enabled
                </span>
              )}
            </div>
            <ul className="text-xs text-foreground-muted space-y-1">
              <li>• CSV or tab-separated file</li>
              <li>• Auto-detects header row with Rank, Name, EDIPI</li>
              <li>• Auto-creates Company, Section, Work Section units</li>
              <li>• Creates Leave/TAD non-availability records</li>
              <li>• <span className="text-warning">Replaces all existing personnel</span></li>
            </ul>
          </div>

          <div className="flex gap-3 pt-4">
            <Button
              type="button"
              variant="secondary"
              onClick={onClose}
              disabled={isSubmitting || gitHubStatus === "pushing"}
              className="flex-1"
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="accent"
              onClick={handleSubmit}
              isLoading={isSubmitting}
              disabled={isSubmitting || !selectedFile || gitHubStatus === "pushing"}
              className="flex-1"
            >
              Import
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function AddPersonnelModal({
  units,
  onClose,
  onSuccess,
}: {
  units: UnitSection[];
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    service_id: "",
    first_name: "",
    last_name: "",
    rank: "",
    unit_section_id: "",
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError(null);

    try {
      const newPerson: Personnel = {
        id: crypto.randomUUID(),
        service_id: formData.service_id,
        first_name: formData.first_name,
        last_name: formData.last_name,
        rank: formData.rank,
        unit_section_id: formData.unit_section_id,
        current_duty_score: 0,
        created_at: new Date(),
        updated_at: new Date(),
      };

      createPersonnel(newPerson);
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <Card variant="elevated" className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Add Personnel</CardTitle>
          <CardDescription>
            Manually add a new service member to the roster
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="p-3 rounded-lg bg-error/10 border border-error/20 text-error text-sm">
                {error}
              </div>
            )}

            <Input
              label="Service ID"
              placeholder="e.g., 123456789"
              value={formData.service_id}
              onChange={(e) =>
                setFormData({ ...formData, service_id: e.target.value })
              }
              required
              disabled={isSubmitting}
            />

            <div className="grid grid-cols-2 gap-4">
              <Input
                label="First Name"
                placeholder="John"
                value={formData.first_name}
                onChange={(e) =>
                  setFormData({ ...formData, first_name: e.target.value })
                }
                required
                disabled={isSubmitting}
              />
              <Input
                label="Last Name"
                placeholder="Doe"
                value={formData.last_name}
                onChange={(e) =>
                  setFormData({ ...formData, last_name: e.target.value })
                }
                required
                disabled={isSubmitting}
              />
            </div>

            <Input
              label="Rank"
              placeholder="e.g., SGT, CPL, PFC"
              value={formData.rank}
              onChange={(e) =>
                setFormData({ ...formData, rank: e.target.value.toUpperCase() })
              }
              required
              disabled={isSubmitting}
            />

            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">
                Unit
              </label>
              <select
                className="w-full px-4 py-2.5 rounded-lg bg-surface border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50"
                value={formData.unit_section_id}
                onChange={(e) =>
                  setFormData({ ...formData, unit_section_id: e.target.value })
                }
                required
                disabled={isSubmitting}
              >
                <option value="">Select a unit...</option>
                {units.map((unit) => (
                  <option key={unit.id} value={unit.id}>
                    {unit.unit_name}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex gap-3 pt-4">
              <Button
                type="button"
                variant="secondary"
                onClick={onClose}
                disabled={isSubmitting}
                className="flex-1"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                variant="accent"
                isLoading={isSubmitting}
                disabled={isSubmitting}
                className="flex-1"
              >
                Add Personnel
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
