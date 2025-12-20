"use client";

interface SpinnerProps {
  size?: "sm" | "md" | "lg";
  className?: string;
  /** Accessible label for screen readers */
  label?: string;
}

const sizeClasses = {
  sm: "h-4 w-4 border-2",
  md: "h-6 w-6 border-2",
  lg: "h-8 w-8 border-4",
};

export default function Spinner({
  size = "md",
  className = "",
  label = "Loading",
}: SpinnerProps) {
  return (
    <div
      role="status"
      aria-label={label}
      className={`inline-flex items-center justify-center ${className}`}
    >
      <div
        className={`animate-spin rounded-full border-primary border-t-transparent ${sizeClasses[size]}`}
      />
      <span className="sr-only">{label}</span>
    </div>
  );
}

/** Full page loading spinner with centered layout */
export function PageSpinner({ label = "Loading page" }: { label?: string }) {
  return (
    <div className="flex items-center justify-center min-h-[400px]">
      <Spinner size="lg" label={label} />
    </div>
  );
}

/** Inline spinner with optional text */
export function InlineSpinner({
  text,
  size = "sm",
}: {
  text?: string;
  size?: "sm" | "md";
}) {
  return (
    <span className="inline-flex items-center gap-2">
      <Spinner size={size} label={text || "Loading"} />
      {text && <span className="text-muted">{text}</span>}
    </span>
  );
}
