"use client";

import { Component, ReactNode, Suspense } from "react";
import Button from "./Button";

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error, errorInfo: React.ErrorInfo) => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

/**
 * Error boundary component that catches JavaScript errors in child components
 * and displays a fallback UI instead of crashing the entire app.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    // Log error to console in development
    if (process.env.NODE_ENV === "development") {
      console.error("ErrorBoundary caught an error:", error, errorInfo);
    }

    // Call optional error handler
    this.props.onError?.(error, errorInfo);
  }

  handleReset = (): void => {
    this.setState({ hasError: false, error: null });
  };

  render(): ReactNode {
    if (this.state.hasError) {
      // Use custom fallback if provided
      if (this.props.fallback) {
        return this.props.fallback;
      }

      // Default error UI
      return (
        <div className="min-h-[200px] flex items-center justify-center p-6">
          <div className="text-center max-w-md">
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-error/10 flex items-center justify-center">
              <svg
                className="w-8 h-8 text-error"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                />
              </svg>
            </div>
            <h2 className="text-lg font-semibold text-foreground mb-2">
              Something went wrong
            </h2>
            <p className="text-foreground-muted mb-4">
              An error occurred while rendering this component.
              {process.env.NODE_ENV === "development" && this.state.error && (
                <span className="block mt-2 text-sm font-mono text-error">
                  {this.state.error.message}
                </span>
              )}
            </p>
            <Button onClick={this.handleReset} variant="secondary" size="sm">
              Try Again
            </Button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

/**
 * Wrapper for async operations in components.
 * Combines ErrorBoundary with Suspense for handling both loading and error states.
 */
interface AsyncBoundaryProps {
  children: ReactNode;
  errorFallback?: ReactNode;
  loadingFallback?: ReactNode;
}

export function AsyncBoundary({
  children,
  errorFallback,
  loadingFallback,
}: AsyncBoundaryProps): ReactNode {
  return (
    <ErrorBoundary fallback={errorFallback}>
      <Suspense fallback={loadingFallback ?? null}>
        {children}
      </Suspense>
    </ErrorBoundary>
  );
}

export default ErrorBoundary;
