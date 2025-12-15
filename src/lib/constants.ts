// Shared constants used across the application

// Key for storing view mode preference in localStorage
export const VIEW_MODE_KEY = "dutysync_admin_view_mode";

// Custom event name for view mode changes (for same-tab communication)
export const VIEW_MODE_CHANGE_EVENT = "viewModeChange";

// View mode values
export type ViewMode = "admin" | "unit-admin" | "user";
export const VIEW_MODE_ADMIN: ViewMode = "admin";
export const VIEW_MODE_UNIT_ADMIN: ViewMode = "unit-admin";
export const VIEW_MODE_USER: ViewMode = "user";

// Maximum duty score for display calculations
export const MAX_DUTY_SCORE = 15;

// Default duty score multipliers
export const DEFAULT_WEEKEND_MULTIPLIER = 1.5;
export const DEFAULT_HOLIDAY_MULTIPLIER = 2.0;
