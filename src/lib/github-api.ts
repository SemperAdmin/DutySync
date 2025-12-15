/**
 * GitHub API service for updating seed files in the repository
 */

// Hardcoded GitHub configuration (non-sensitive)
const GITHUB_CONFIG = {
  owner: "SemperAdmin",
  repo: "DutySync",
  branch: "main",
};

// Token from environment variable (set at build time via GitHub secret)
const GITHUB_TOKEN = process.env.NEXT_PUBLIC_GITHUB_WORKFLOW_TOKEN || "";

const GITHUB_SETTINGS_KEY = "dutysync_github_settings";

export interface GitHubSettings {
  owner: string;        // Repository owner (e.g., "SemperAdmin")
  repo: string;         // Repository name (e.g., "DutySync")
  branch: string;       // Branch to update (e.g., "main")
  token: string;        // Personal access token with repo scope
  unitPath: string;     // Path to unit data (e.g., "public/data/unit/02301")
}

export interface GitHubUpdateResult {
  success: boolean;
  message: string;
  sha?: string;
}

// Get GitHub settings - uses hardcoded config + env var token, with localStorage fallback for unitPath
export function getGitHubSettings(): GitHubSettings | null {
  // First check if we have the env var token (preferred)
  if (GITHUB_TOKEN) {
    // Get unitPath from localStorage if available
    let unitPath = "public/data/unit/02301"; // default
    if (typeof window !== "undefined") {
      const stored = localStorage.getItem(GITHUB_SETTINGS_KEY);
      if (stored) {
        try {
          const parsed = JSON.parse(stored);
          if (parsed.unitPath) unitPath = parsed.unitPath;
        } catch {
          // ignore parse errors
        }
      }
    }

    return {
      ...GITHUB_CONFIG,
      token: GITHUB_TOKEN,
      unitPath,
    };
  }

  // Fallback to localStorage settings (for local development)
  if (typeof window === "undefined") return null;
  const stored = localStorage.getItem(GITHUB_SETTINGS_KEY);
  if (!stored) return null;
  try {
    return JSON.parse(stored);
  } catch {
    return null;
  }
}

// Save GitHub settings (only unitPath is really needed now)
export function saveGitHubSettings(settings: GitHubSettings): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(GITHUB_SETTINGS_KEY, JSON.stringify(settings));
}

// Clear GitHub settings
export function clearGitHubSettings(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(GITHUB_SETTINGS_KEY);
}

// Check if GitHub is configured
export function isGitHubConfigured(): boolean {
  // Check env var first
  if (GITHUB_TOKEN) {
    return true;
  }
  // Fallback to localStorage
  const settings = getGitHubSettings();
  return !!(settings?.owner && settings?.repo && settings?.token);
}

// Get file SHA from GitHub (needed for updates)
async function getFileSha(
  settings: GitHubSettings,
  filePath: string
): Promise<string | null> {
  try {
    const response = await fetch(
      `https://api.github.com/repos/${settings.owner}/${settings.repo}/contents/${filePath}?ref=${settings.branch}`,
      {
        headers: {
          Authorization: `Bearer ${settings.token}`,
          Accept: "application/vnd.github.v3+json",
        },
      }
    );

    if (response.status === 404) {
      return null; // File doesn't exist yet
    }

    if (!response.ok) {
      throw new Error(`Failed to get file info: ${response.statusText}`);
    }

    const data = await response.json();
    return data.sha;
  } catch (error) {
    console.error("Error getting file SHA:", error);
    return null;
  }
}

// Update or create a file in GitHub with retry on SHA conflict
export async function updateGitHubFile(
  settings: GitHubSettings,
  filePath: string,
  content: object,
  commitMessage: string,
  maxRetries: number = 3
): Promise<GitHubUpdateResult> {
  let lastError: string = "Unknown error occurred";

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      // Get current file SHA if it exists (required for updates)
      const sha = await getFileSha(settings, filePath);

      // Encode content as base64
      const jsonContent = JSON.stringify(content, null, 2);
      const base64Content = btoa(unescape(encodeURIComponent(jsonContent)));

      const body: Record<string, string> = {
        message: commitMessage,
        content: base64Content,
        branch: settings.branch,
      };

      // Include SHA if updating existing file
      if (sha) {
        body.sha = sha;
      }

      const response = await fetch(
        `https://api.github.com/repos/${settings.owner}/${settings.repo}/contents/${filePath}`,
        {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${settings.token}`,
            Accept: "application/vnd.github.v3+json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
        }
      );

      // Handle SHA mismatch (409 Conflict) - retry with fresh SHA
      if (response.status === 409) {
        console.warn(`[updateGitHubFile] SHA conflict on ${filePath}, retrying (${attempt + 1}/${maxRetries})...`);
        lastError = `SHA conflict - file was modified`;
        // Wait a bit before retrying to allow the previous update to complete
        await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
        continue;
      }

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(
          errorData.message || `GitHub API error: ${response.statusText}`
        );
      }

      const data = await response.json();
      return {
        success: true,
        message: sha ? "File updated successfully" : "File created successfully",
        sha: data.content.sha,
      };
    } catch (error) {
      lastError = error instanceof Error ? error.message : "Unknown error occurred";
      // Don't retry on non-409 errors
      if (!lastError.includes("conflict")) {
        break;
      }
    }
  }

  return {
    success: false,
    message: lastError,
  };
}

// Update both unit-structure.json and unit-members.json
// If ruc is provided, uses that to construct the path; otherwise uses settings.unitPath
export async function pushSeedFilesToGitHub(
  unitStructure: object,
  unitMembers: object,
  ruc?: string | null
): Promise<{
  success: boolean;
  structureResult: GitHubUpdateResult;
  membersResult: GitHubUpdateResult;
}> {
  const settings = getGitHubSettings();

  if (!settings) {
    return {
      success: false,
      structureResult: { success: false, message: "GitHub not configured" },
      membersResult: { success: false, message: "GitHub not configured" },
    };
  }

  // Use the provided RUC to construct path, or fall back to settings.unitPath
  const unitPath = ruc ? `public/data/unit/${ruc}` : settings.unitPath;
  const timestamp = new Date().toISOString().split("T")[0];

  // Update unit-structure.json
  const structureResult = await updateGitHubFile(
    settings,
    `${unitPath}/unit-structure.json`,
    unitStructure,
    `chore: Update unit structure from import (${timestamp})`
  );

  // Update unit-members.json
  const membersResult = await updateGitHubFile(
    settings,
    `${unitPath}/unit-members.json`,
    unitMembers,
    `chore: Update unit members from import (${timestamp})`
  );

  return {
    success: structureResult.success && membersResult.success,
    structureResult,
    membersResult,
  };
}

// Push all unit seed files (duty types, roster, non-availability, qualifications)
export async function pushAllUnitSeedFiles(
  ruc: string,
  dutyTypes: object,
  dutyRoster: object,
  nonAvailability: object,
  qualifications: object
): Promise<{
  success: boolean;
  results: {
    dutyTypes: GitHubUpdateResult;
    dutyRoster: GitHubUpdateResult;
    nonAvailability: GitHubUpdateResult;
    qualifications: GitHubUpdateResult;
  };
}> {
  const settings = getGitHubSettings();

  if (!settings) {
    const notConfigured = { success: false, message: "GitHub not configured" };
    return {
      success: false,
      results: {
        dutyTypes: notConfigured,
        dutyRoster: notConfigured,
        nonAvailability: notConfigured,
        qualifications: notConfigured,
      },
    };
  }

  const unitPath = `public/data/unit/${ruc}`;
  const timestamp = new Date().toISOString().split("T")[0];

  // Push all files in parallel
  const [dutyTypesResult, dutyRosterResult, nonAvailabilityResult, qualificationsResult] =
    await Promise.all([
      updateGitHubFile(
        settings,
        `${unitPath}/duty-types.json`,
        dutyTypes,
        `chore: Update duty types (${timestamp})`
      ),
      updateGitHubFile(
        settings,
        `${unitPath}/duty-roster.json`,
        dutyRoster,
        `chore: Update duty roster (${timestamp})`
      ),
      updateGitHubFile(
        settings,
        `${unitPath}/non-availability.json`,
        nonAvailability,
        `chore: Update non-availability (${timestamp})`
      ),
      updateGitHubFile(
        settings,
        `${unitPath}/qualifications.json`,
        qualifications,
        `chore: Update qualifications (${timestamp})`
      ),
    ]);

  return {
    success:
      dutyTypesResult.success &&
      dutyRosterResult.success &&
      nonAvailabilityResult.success &&
      qualificationsResult.success,
    results: {
      dutyTypes: dutyTypesResult,
      dutyRoster: dutyRosterResult,
      nonAvailability: nonAvailabilityResult,
      qualifications: qualificationsResult,
    },
  };
}

// Push a single unit seed file
export async function pushUnitSeedFile(
  ruc: string,
  fileType: "duty-types" | "duty-roster" | "non-availability" | "qualifications" | "duty-change-requests",
  data: object
): Promise<GitHubUpdateResult> {
  const settings = getGitHubSettings();

  if (!settings) {
    return { success: false, message: "GitHub not configured" };
  }

  const unitPath = `public/data/unit/${ruc}`;
  const timestamp = new Date().toISOString().split("T")[0];

  return updateGitHubFile(
    settings,
    `${unitPath}/${fileType}.json`,
    data,
    `chore: Update ${fileType} (${timestamp})`
  );
}

// Test GitHub connection
export async function testGitHubConnection(
  settings: GitHubSettings
): Promise<{ success: boolean; message: string }> {
  try {
    const response = await fetch(
      `https://api.github.com/repos/${settings.owner}/${settings.repo}`,
      {
        headers: {
          Authorization: `Bearer ${settings.token}`,
          Accept: "application/vnd.github.v3+json",
        },
      }
    );

    if (response.status === 401) {
      return { success: false, message: "Invalid token or token expired" };
    }

    if (response.status === 404) {
      return { success: false, message: "Repository not found" };
    }

    if (!response.ok) {
      return { success: false, message: `Error: ${response.statusText}` };
    }

    const data = await response.json();
    return {
      success: true,
      message: `Connected to ${data.full_name}`,
    };
  } catch (error) {
    return {
      success: false,
      message: error instanceof Error ? error.message : "Connection failed",
    };
  }
}

// Update a user file in GitHub (for role changes)
export async function pushUserFileToGitHub(
  userId: string,
  userData: object
): Promise<GitHubUpdateResult> {
  console.log("[pushUserFileToGitHub] Starting push for user:", userId);
  const settings = getGitHubSettings();
  console.log("[pushUserFileToGitHub] Settings:", settings ? `${settings.owner}/${settings.repo}` : "not configured");

  if (!settings) {
    return { success: false, message: "GitHub not configured" };
  }

  const filePath = `public/data/user/${userId}.json`;
  const timestamp = new Date().toISOString().split("T")[0];

  console.log("[pushUserFileToGitHub] Pushing to path:", filePath);
  const result = await updateGitHubFile(
    settings,
    filePath,
    userData,
    `chore: Update user roles (${timestamp})`
  );
  console.log("[pushUserFileToGitHub] Result:", result);
  return result;
}

// Delete a user file from GitHub
export async function deleteUserFileFromGitHub(
  userId: string
): Promise<GitHubUpdateResult> {
  const settings = getGitHubSettings();

  if (!settings) {
    return { success: false, message: "GitHub not configured" };
  }

  const filePath = `public/data/user/${userId}.json`;

  try {
    // Get current file SHA (required for deletion)
    const shaResponse = await fetch(
      `https://api.github.com/repos/${settings.owner}/${settings.repo}/contents/${filePath}?ref=${settings.branch}`,
      {
        headers: {
          Authorization: `Bearer ${settings.token}`,
          Accept: "application/vnd.github.v3+json",
        },
      }
    );

    if (shaResponse.status === 404) {
      return { success: true, message: "File already deleted" };
    }

    if (!shaResponse.ok) {
      throw new Error(`Failed to get file info: ${shaResponse.statusText}`);
    }

    const shaData = await shaResponse.json();
    const sha = shaData.sha;

    // Delete the file
    const timestamp = new Date().toISOString().split("T")[0];
    const response = await fetch(
      `https://api.github.com/repos/${settings.owner}/${settings.repo}/contents/${filePath}`,
      {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${settings.token}`,
          Accept: "application/vnd.github.v3+json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: `chore: Delete user account (${timestamp})`,
          sha: sha,
          branch: settings.branch,
        }),
      }
    );

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(
        errorData.message || `GitHub API error: ${response.statusText}`
      );
    }

    return {
      success: true,
      message: "User file deleted successfully",
    };
  } catch (error) {
    return {
      success: false,
      message: error instanceof Error ? error.message : "Unknown error occurred",
    };
  }
}

// ============================================================================
// GitHub Actions Workflow Triggers
// These functions trigger workflows instead of directly modifying files,
// which is more secure as the workflow uses GITHUB_TOKEN
// ============================================================================

export interface WorkflowTriggerResult {
  success: boolean;
  message: string;
}

// Trigger the update-user-roles workflow
export async function triggerUpdateUserRolesWorkflow(
  userId: string,
  roles: Array<{ role_name: string; scope_unit_id: string | null }>,
  canApproveNonAvailability?: boolean
): Promise<WorkflowTriggerResult> {
  const settings = getGitHubSettings();

  if (!settings) {
    return { success: false, message: "GitHub not configured" };
  }

  try {
    console.log("[triggerUpdateUserRolesWorkflow] Triggering workflow for user:", userId);
    console.log("[triggerUpdateUserRolesWorkflow] Roles:", roles);

    const response = await fetch(
      `https://api.github.com/repos/${settings.owner}/${settings.repo}/actions/workflows/update-user-roles.yml/dispatches`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${settings.token}`,
          Accept: "application/vnd.github.v3+json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ref: settings.branch,
          inputs: {
            user_id: userId,
            roles_json: JSON.stringify(roles),
            can_approve_non_availability: canApproveNonAvailability !== undefined
              ? String(canApproveNonAvailability)
              : "",
          },
        }),
      }
    );

    console.log("[triggerUpdateUserRolesWorkflow] Response status:", response.status);

    // 204 No Content means success for workflow dispatch
    if (response.status === 204) {
      return {
        success: true,
        message: "Workflow triggered successfully. Changes will be applied shortly.",
      };
    }

    // Handle errors
    const errorData = await response.json().catch(() => ({}));
    console.error("[triggerUpdateUserRolesWorkflow] Error:", errorData);

    throw new Error(
      errorData.message || `GitHub API error: ${response.status} ${response.statusText}`
    );
  } catch (error) {
    console.error("[triggerUpdateUserRolesWorkflow] Exception:", error);
    return {
      success: false,
      message: error instanceof Error ? error.message : "Unknown error occurred",
    };
  }
}

// Trigger the delete-user workflow
export async function triggerDeleteUserWorkflow(
  userId: string
): Promise<WorkflowTriggerResult> {
  const settings = getGitHubSettings();

  if (!settings) {
    return { success: false, message: "GitHub not configured" };
  }

  try {
    console.log("[triggerDeleteUserWorkflow] Triggering workflow for user:", userId);

    const response = await fetch(
      `https://api.github.com/repos/${settings.owner}/${settings.repo}/actions/workflows/delete-user.yml/dispatches`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${settings.token}`,
          Accept: "application/vnd.github.v3+json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ref: settings.branch,
          inputs: {
            user_id: userId,
          },
        }),
      }
    );

    console.log("[triggerDeleteUserWorkflow] Response status:", response.status);

    // 204 No Content means success for workflow dispatch
    if (response.status === 204) {
      return {
        success: true,
        message: "Delete workflow triggered successfully. User will be removed shortly.",
      };
    }

    // Handle errors
    const errorData = await response.json().catch(() => ({}));
    console.error("[triggerDeleteUserWorkflow] Error:", errorData);

    throw new Error(
      errorData.message || `GitHub API error: ${response.status} ${response.statusText}`
    );
  } catch (error) {
    console.error("[triggerDeleteUserWorkflow] Exception:", error);
    return {
      success: false,
      message: error instanceof Error ? error.message : "Unknown error occurred",
    };
  }
}

// ============================================================================
// Unit Data Workflow Triggers
// These functions trigger workflows to update unit-specific data files
// ============================================================================

type UnitDataFileType = "duty-types" | "duty-roster" | "non-availability" | "qualifications";

// Trigger a workflow to update a unit data file
export async function triggerUnitDataWorkflow(
  ruc: string,
  fileType: UnitDataFileType,
  data: object
): Promise<WorkflowTriggerResult> {
  const settings = getGitHubSettings();

  if (!settings) {
    return { success: false, message: "GitHub not configured" };
  }

  const workflowFile = `update-${fileType}.yml`;

  try {
    console.log(`[triggerUnitDataWorkflow] Triggering ${workflowFile} for RUC: ${ruc}`);

    const response = await fetch(
      `https://api.github.com/repos/${settings.owner}/${settings.repo}/actions/workflows/${workflowFile}/dispatches`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${settings.token}`,
          Accept: "application/vnd.github.v3+json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ref: settings.branch,
          inputs: {
            ruc: ruc,
            data_json: JSON.stringify(data),
          },
        }),
      }
    );

    console.log(`[triggerUnitDataWorkflow] Response status: ${response.status}`);

    // 204 No Content means success for workflow dispatch
    if (response.status === 204) {
      return {
        success: true,
        message: `${fileType} workflow triggered successfully. Changes will be applied shortly.`,
      };
    }

    // Handle errors
    const errorData = await response.json().catch(() => ({}));
    console.error(`[triggerUnitDataWorkflow] Error:`, errorData);

    throw new Error(
      errorData.message || `GitHub API error: ${response.status} ${response.statusText}`
    );
  } catch (error) {
    console.error(`[triggerUnitDataWorkflow] Exception:`, error);
    return {
      success: false,
      message: error instanceof Error ? error.message : "Unknown error occurred",
    };
  }
}

// Trigger workflow to update duty types
export async function triggerUpdateDutyTypesWorkflow(
  ruc: string,
  data: object
): Promise<WorkflowTriggerResult> {
  return triggerUnitDataWorkflow(ruc, "duty-types", data);
}

// Trigger workflow to update duty roster
export async function triggerUpdateDutyRosterWorkflow(
  ruc: string,
  data: object
): Promise<WorkflowTriggerResult> {
  return triggerUnitDataWorkflow(ruc, "duty-roster", data);
}

// Trigger workflow to update non-availability
export async function triggerUpdateNonAvailabilityWorkflow(
  ruc: string,
  data: object
): Promise<WorkflowTriggerResult> {
  return triggerUnitDataWorkflow(ruc, "non-availability", data);
}

// Trigger workflow to update qualifications
export async function triggerUpdateQualificationsWorkflow(
  ruc: string,
  data: object
): Promise<WorkflowTriggerResult> {
  return triggerUnitDataWorkflow(ruc, "qualifications", data);
}

// Trigger all unit data workflows at once
export async function triggerAllUnitDataWorkflows(
  ruc: string,
  dutyTypes: object,
  dutyRoster: object,
  nonAvailability: object,
  qualifications: object
): Promise<{
  success: boolean;
  results: {
    dutyTypes: WorkflowTriggerResult;
    dutyRoster: WorkflowTriggerResult;
    nonAvailability: WorkflowTriggerResult;
    qualifications: WorkflowTriggerResult;
  };
}> {
  // Trigger all workflows in parallel
  const [dutyTypesResult, dutyRosterResult, nonAvailabilityResult, qualificationsResult] =
    await Promise.all([
      triggerUpdateDutyTypesWorkflow(ruc, dutyTypes),
      triggerUpdateDutyRosterWorkflow(ruc, dutyRoster),
      triggerUpdateNonAvailabilityWorkflow(ruc, nonAvailability),
      triggerUpdateQualificationsWorkflow(ruc, qualifications),
    ]);

  return {
    success:
      dutyTypesResult.success &&
      dutyRosterResult.success &&
      nonAvailabilityResult.success &&
      qualificationsResult.success,
    results: {
      dutyTypes: dutyTypesResult,
      dutyRoster: dutyRosterResult,
      nonAvailability: nonAvailabilityResult,
      qualifications: qualificationsResult,
    },
  };
}

// ============================================================================
// RUC Initialization
// ============================================================================

/**
 * Trigger workflow to initialize a new RUC with all required seed files
 *
 * Creates:
 * - public/data/unit/{ruc}/unit-structure.json
 * - public/data/unit/{ruc}/unit-members.json
 * - public/data/unit/{ruc}/duty-types.json
 * - public/data/unit/{ruc}/duty-roster.json
 * - public/data/unit/{ruc}/non-availability.json
 * - public/data/unit/{ruc}/qualifications.json
 * - public/data/unit/{ruc}/duty-change-requests.json
 *
 * Also updates:
 * - public/data/units-index.json
 * - public/data/rucs.json
 */
export async function triggerInitializeRucWorkflow(
  ruc: string,
  unitName?: string,
  unitDescription?: string
): Promise<WorkflowTriggerResult> {
  const settings = getGitHubSettings();

  if (!settings) {
    return { success: false, message: "GitHub not configured" };
  }

  const workflowFile = "initialize-ruc.yml";

  try {
    console.log(`[triggerInitializeRucWorkflow] Initializing RUC: ${ruc}`);

    const response = await fetch(
      `https://api.github.com/repos/${settings.owner}/${settings.repo}/actions/workflows/${workflowFile}/dispatches`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${settings.token}`,
          Accept: "application/vnd.github.v3+json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ref: settings.branch,
          inputs: {
            ruc: ruc,
            unit_name: unitName || "",
            unit_description: unitDescription || "",
          },
        }),
      }
    );

    console.log(`[triggerInitializeRucWorkflow] Response status: ${response.status}`);

    // 204 No Content means success for workflow dispatch
    if (response.status === 204) {
      return {
        success: true,
        message: `RUC ${ruc} initialization started. All seed files will be created shortly.`,
      };
    }

    // Handle errors
    const errorData = await response.json().catch(() => ({}));
    console.error(`[triggerInitializeRucWorkflow] Error:`, errorData);

    throw new Error(
      errorData.message || `GitHub API error: ${response.status} ${response.statusText}`
    );
  } catch (error) {
    console.error(`[triggerInitializeRucWorkflow] Exception:`, error);
    return {
      success: false,
      message: error instanceof Error ? error.message : "Unknown error occurred",
    };
  }
}

/**
 * Check if a RUC has been initialized (has seed files)
 */
export async function checkRucInitialized(ruc: string): Promise<boolean> {
  const settings = getGitHubSettings();
  if (!settings) return false;

  try {
    // Check if unit-structure.json exists for this RUC
    const response = await fetch(
      `https://api.github.com/repos/${settings.owner}/${settings.repo}/contents/public/data/unit/${ruc}/unit-structure.json?ref=${settings.branch}`,
      {
        headers: {
          Authorization: `Bearer ${settings.token}`,
          Accept: "application/vnd.github.v3+json",
        },
      }
    );

    return response.status === 200;
  } catch {
    return false;
  }
}
