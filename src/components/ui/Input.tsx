"use client";

import { forwardRef, InputHTMLAttributes, useMemo } from "react";

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  helperText?: string;
}

const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className = "", label, error, helperText, id, ...props }, ref) => {
    const inputId = id || props.name;

    // Generate IDs for accessibility
    const errorId = useMemo(
      () => (error ? `${inputId}-error` : undefined),
      [inputId, error]
    );
    const helperId = useMemo(
      () => (helperText && !error ? `${inputId}-helper` : undefined),
      [inputId, helperText, error]
    );

    // Build aria-describedby from available descriptions
    const ariaDescribedBy = errorId || helperId || undefined;

    return (
      <div className="w-full">
        {label && (
          <label
            htmlFor={inputId}
            className="block text-sm font-medium text-foreground mb-1.5"
          >
            {label}
            {props.required && (
              <span className="text-error ml-1" aria-hidden="true">*</span>
            )}
          </label>
        )}
        <input
          ref={ref}
          id={inputId}
          aria-invalid={error ? "true" : undefined}
          aria-describedby={ariaDescribedBy}
          className={`
            w-full px-4 py-2.5 rounded-lg
            bg-surface border border-border
            text-foreground placeholder-foreground-muted
            transition-colors
            focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary
            disabled:opacity-50 disabled:cursor-not-allowed
            ${error ? "border-error focus:ring-error focus:border-error" : ""}
            ${className}
          `}
          {...props}
        />
        {error && (
          <p
            id={errorId}
            className="mt-1.5 text-sm text-error"
            role="alert"
            aria-live="polite"
          >
            {error}
          </p>
        )}
        {helperText && !error && (
          <p id={helperId} className="mt-1.5 text-sm text-foreground-muted">
            {helperText}
          </p>
        )}
      </div>
    );
  }
);

Input.displayName = "Input";

export default Input;
