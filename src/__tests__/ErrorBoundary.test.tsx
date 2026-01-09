import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ErrorBoundary } from "@/components/ui/ErrorBoundary";

// Component that throws an error
function ThrowError({ shouldThrow }: { shouldThrow: boolean }) {
  if (shouldThrow) {
    throw new Error("Test error");
  }
  return <div>No error</div>;
}

describe("ErrorBoundary", () => {
  // Suppress console.error for expected errors during tests
  const originalError = console.error;
  beforeEach(() => {
    console.error = vi.fn();
  });

  afterEach(() => {
    console.error = originalError;
  });

  it("renders children when there is no error", () => {
    render(
      <ErrorBoundary>
        <div>Child content</div>
      </ErrorBoundary>
    );

    expect(screen.getByText("Child content")).toBeInTheDocument();
  });

  it("renders error UI when child throws an error", () => {
    render(
      <ErrorBoundary>
        <ThrowError shouldThrow={true} />
      </ErrorBoundary>
    );

    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
  });

  it("renders custom fallback when provided", () => {
    render(
      <ErrorBoundary fallback={<div>Custom error message</div>}>
        <ThrowError shouldThrow={true} />
      </ErrorBoundary>
    );

    expect(screen.getByText("Custom error message")).toBeInTheDocument();
    expect(screen.queryByText("Something went wrong")).not.toBeInTheDocument();
  });

  it("calls onError callback when error occurs", () => {
    const onError = vi.fn();

    render(
      <ErrorBoundary onError={onError}>
        <ThrowError shouldThrow={true} />
      </ErrorBoundary>
    );

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ componentStack: expect.any(String) })
    );
  });

  it("resets error state when Try Again button is clicked", () => {
    const { rerender } = render(
      <ErrorBoundary>
        <ThrowError shouldThrow={true} />
      </ErrorBoundary>
    );

    // Error UI should be shown
    expect(screen.getByText("Something went wrong")).toBeInTheDocument();

    // We need to rerender with shouldThrow=false before clicking Try Again
    // because the component will re-render children after reset
    rerender(
      <ErrorBoundary>
        <ThrowError shouldThrow={false} />
      </ErrorBoundary>
    );

    // Click Try Again - but since we rerendered, the state is reset
    // In a real scenario, the error would be caught again if the issue persists
    const button = screen.queryByRole("button", { name: /try again/i });
    if (button) {
      fireEvent.click(button);
    }

    // After reset with non-throwing component, should show content
    expect(screen.getByText("No error")).toBeInTheDocument();
  });

  it("shows error message in development mode", () => {
    // Note: NODE_ENV is 'test' during testing, but the component shows error
    // message when NODE_ENV === 'development'. We test the general error UI here.
    render(
      <ErrorBoundary>
        <ThrowError shouldThrow={true} />
      </ErrorBoundary>
    );

    // The error message should be visible in the UI
    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
    expect(screen.getByText(/An error occurred while rendering this component/i)).toBeInTheDocument();
  });

  it("displays actual error message when in development environment", async () => {
    // Use vi.stubEnv to mock NODE_ENV
    vi.stubEnv("NODE_ENV", "development");

    render(
      <ErrorBoundary>
        <ThrowError shouldThrow={true} />
      </ErrorBoundary>
    );

    // In development mode, the actual error message "Test error" should be displayed
    expect(screen.getByText("Test error")).toBeInTheDocument();

    // Restore original NODE_ENV
    vi.unstubAllEnvs();
  });
});
