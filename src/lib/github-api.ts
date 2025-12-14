/**
 * GitHub API service for updating seed files in the repository
 */

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

// Get stored GitHub settings
export function getGitHubSettings(): GitHubSettings | null {
  if (typeof window === "undefined") return null;
  const stored = localStorage.getItem(GITHUB_SETTINGS_KEY);
  if (!stored) return null;
  try {
    return JSON.parse(stored);
  } catch {
    return null;
  }
}

// Save GitHub settings
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

// Update or create a file in GitHub
export async function updateGitHubFile(
  settings: GitHubSettings,
  filePath: string,
  content: object,
  commitMessage: string
): Promise<GitHubUpdateResult> {
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
    return {
      success: false,
      message: error instanceof Error ? error.message : "Unknown error occurred",
    };
  }
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
  const settings = getGitHubSettings();

  if (!settings) {
    return { success: false, message: "GitHub not configured" };
  }

  const filePath = `public/data/user/${userId}.json`;
  const timestamp = new Date().toISOString().split("T")[0];

  return updateGitHubFile(
    settings,
    filePath,
    userData,
    `chore: Update user roles (${timestamp})`
  );
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
