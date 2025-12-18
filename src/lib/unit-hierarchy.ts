import type { UnitSection } from "@/types";

export interface HierarchicalUnitOption {
  id: string;
  label: string;
  depth: number;
  unit: UnitSection;
}

/**
 * Builds a hierarchical list of units with proper indentation for display in dropdowns.
 * Units are sorted alphabetically at each level.
 *
 * @param units - Flat array of all units
 * @param rootUnitId - Optional root unit ID to start from (defaults to units with no parent)
 * @returns Array of units with depth information for indentation
 *
 * @example
 * // Returns:
 * // [
 * //   { id: "1", label: "02301", depth: 0 },
 * //   { id: "2", label: "H Company", depth: 1 },
 * //   { id: "3", label: "1DIV", depth: 2 },
 * //   { id: "4", label: "HQMP", depth: 3 },
 * //   { id: "5", label: "HQZZ", depth: 3 },
 * //   { id: "6", label: "3DIV", depth: 2 },
 * //   { id: "7", label: "S Company", depth: 1 },
 * // ]
 */
export function buildHierarchicalUnitOptions(
  units: UnitSection[],
  rootUnitId?: string | null
): HierarchicalUnitOption[] {
  const result: HierarchicalUnitOption[] = [];

  // Build a map of parent_id -> children for efficient lookup
  const childrenMap = new Map<string | null, UnitSection[]>();

  for (const unit of units) {
    const parentId = unit.parent_id;
    if (!childrenMap.has(parentId)) {
      childrenMap.set(parentId, []);
    }
    childrenMap.get(parentId)!.push(unit);
  }

  // Sort children alphabetically at each level
  for (const children of childrenMap.values()) {
    children.sort((a, b) => a.unit_name.localeCompare(b.unit_name));
  }

  // Recursive function to add units with depth
  function addUnitsRecursively(parentId: string | null, depth: number) {
    const children = childrenMap.get(parentId) || [];

    for (const unit of children) {
      result.push({
        id: unit.id,
        label: unit.unit_name,
        depth,
        unit,
      });

      // Recursively add children
      addUnitsRecursively(unit.id, depth + 1);
    }
  }

  if (rootUnitId) {
    // Start from a specific root unit
    const rootUnit = units.find(u => u.id === rootUnitId);
    if (rootUnit) {
      result.push({
        id: rootUnit.id,
        label: rootUnit.unit_name,
        depth: 0,
        unit: rootUnit,
      });
      addUnitsRecursively(rootUnit.id, 1);
    }
  } else {
    // Start from units with no parent (top level)
    addUnitsRecursively(null, 0);
  }

  return result;
}

/**
 * Generates indentation string for a given depth level.
 * Uses non-breaking spaces for consistent display in select options.
 *
 * @param depth - The depth level (0 = no indent, 1 = one level, etc.)
 * @param spacesPerLevel - Number of spaces per indentation level (default: 4)
 * @returns String with appropriate indentation
 */
export function getIndentString(depth: number, spacesPerLevel: number = 4): string {
  if (depth === 0) return "";
  // Use regular spaces - HTML entities don't work well in React option elements
  return "    ".repeat(depth);
}

/**
 * Formats a unit option label with proper indentation.
 *
 * @param option - The hierarchical unit option
 * @param showHierarchyLevel - Whether to show the hierarchy level in parentheses
 * @returns Formatted string for display
 */
export function formatUnitOptionLabel(
  option: HierarchicalUnitOption,
  showHierarchyLevel: boolean = false
): string {
  const indent = getIndentString(option.depth);
  const levelSuffix = showHierarchyLevel ? ` (${option.unit.hierarchy_level})` : "";
  return `${indent}${option.label}${levelSuffix}`;
}

/**
 * Gets all descendant unit IDs for a given unit.
 * Useful for filtering personnel or duty types by unit scope.
 *
 * @param units - Flat array of all units
 * @param unitId - The parent unit ID
 * @returns Set of all descendant unit IDs (including the parent)
 */
export function getDescendantUnitIds(units: UnitSection[], unitId: string): Set<string> {
  const result = new Set<string>([unitId]);

  const childrenMap = new Map<string, UnitSection[]>();
  for (const unit of units) {
    if (unit.parent_id) {
      if (!childrenMap.has(unit.parent_id)) {
        childrenMap.set(unit.parent_id, []);
      }
      childrenMap.get(unit.parent_id)!.push(unit);
    }
  }

  function addDescendants(parentId: string) {
    const children = childrenMap.get(parentId) || [];
    for (const child of children) {
      result.add(child.id);
      addDescendants(child.id);
    }
  }

  addDescendants(unitId);
  return result;
}
