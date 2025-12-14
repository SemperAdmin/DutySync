/**
 * Shared constants for unit hierarchy display
 */

// Color styles for hierarchy levels (used in admin pages)
const UNIT_COLORS = "bg-highlight/20 text-highlight border-highlight/30";
const COMPANY_COLORS = "bg-primary/20 text-blue-400 border-primary/30";
const SECTION_COLORS = "bg-success/20 text-success border-success/30";
const WORK_SECTION_COLORS = "bg-foreground-muted/20 text-foreground-muted border-foreground-muted/30";

export const levelColors: Record<string, string> = {
  unit: UNIT_COLORS,
  ruc: UNIT_COLORS,
  battalion: UNIT_COLORS,
  company: COMPANY_COLORS,
  section: SECTION_COLORS,
  work_section: WORK_SECTION_COLORS,
  platoon: SECTION_COLORS,
};

// Order for sorting hierarchy levels
export const levelOrder: Record<string, number> = {
  unit: 0,
  ruc: 0,
  battalion: 0,
  company: 1,
  section: 2,
  work_section: 3,
  platoon: 2,
};

// Get color for a hierarchy level with fallback
export function getLevelColor(level: string): string {
  return levelColors[level] || levelColors.work_section;
}

// Get order for a hierarchy level with fallback
export function getLevelOrder(level: string): number {
  return levelOrder[level] ?? 99;
}
