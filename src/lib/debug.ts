/**
 * Debug logging utility for conditional logging based on environment.
 *
 * Logs are only output in development mode or when DEBUG env var is set.
 * This helps keep production logs clean while maintaining visibility during development.
 */

const isDevelopment = process.env.NODE_ENV === "development";
const isDebugEnabled = process.env.DEBUG === "true" || process.env.NEXT_PUBLIC_DEBUG === "true";

type LogLevel = "debug" | "info" | "warn" | "error";

interface LogOptions {
  /** Prefix to add to the log message (e.g., module name) */
  prefix?: string;
  /** Additional data to log */
  data?: unknown;
  /** Force logging even in production */
  force?: boolean;
}

/**
 * Core logging function
 */
function log(level: LogLevel, message: string, options: LogOptions = {}): void {
  const { prefix, data, force = false } = options;

  // Only log in development/debug mode unless forced or error/warn level
  const shouldLog = force || isDevelopment || isDebugEnabled || level === "error" || level === "warn";

  if (!shouldLog) return;

  const formattedPrefix = prefix ? `[${prefix}]` : "";
  const formattedMessage = `${formattedPrefix} ${message}`.trim();

  const logFn = level === "debug" ? console.log : console[level];

  if (data !== undefined) {
    logFn(formattedMessage, data);
  } else {
    logFn(formattedMessage);
  }
}

/**
 * Debug-level logging (only in development/debug mode)
 */
export function debug(message: string, options?: LogOptions): void {
  log("debug", message, options);
}

/**
 * Info-level logging (only in development/debug mode)
 */
export function info(message: string, options?: LogOptions): void {
  log("info", message, options);
}

/**
 * Warning-level logging (always logged)
 */
export function warn(message: string, options?: LogOptions): void {
  log("warn", message, { ...options, force: true });
}

/**
 * Error-level logging (always logged)
 */
export function error(message: string, options?: LogOptions): void {
  log("error", message, { ...options, force: true });
}

/**
 * Create a logger instance with a fixed prefix
 */
export function createLogger(prefix: string) {
  return {
    debug: (message: string, data?: unknown) => debug(message, { prefix, data }),
    info: (message: string, data?: unknown) => info(message, { prefix, data }),
    warn: (message: string, data?: unknown) => warn(message, { prefix, data }),
    error: (message: string, data?: unknown) => error(message, { prefix, data }),
  };
}

// Pre-configured loggers for common modules
export const syncLogger = createLogger("Sync");
export const authLogger = createLogger("Auth");
export const dataLogger = createLogger("Data");
export const apiLogger = createLogger("API");
