/**
 * Input Validation Utilities
 *
 * Provides comprehensive validation functions for form inputs.
 * All validators return an error message string or null if valid.
 */

// ============================================================================
// BASIC VALIDATORS
// ============================================================================

/**
 * Check if value is not empty
 */
export function required(value: unknown, fieldName = "This field"): string | null {
  if (value === null || value === undefined || value === "") {
    return `${fieldName} is required`;
  }
  if (typeof value === "string" && value.trim() === "") {
    return `${fieldName} is required`;
  }
  return null;
}

/**
 * Check minimum length
 */
export function minLength(value: string, min: number, fieldName = "This field"): string | null {
  if (value.length < min) {
    return `${fieldName} must be at least ${min} characters`;
  }
  return null;
}

/**
 * Check maximum length
 */
export function maxLength(value: string, max: number, fieldName = "This field"): string | null {
  if (value.length > max) {
    return `${fieldName} must be no more than ${max} characters`;
  }
  return null;
}

/**
 * Check exact length
 */
export function exactLength(value: string, length: number, fieldName = "This field"): string | null {
  if (value.length !== length) {
    return `${fieldName} must be exactly ${length} characters`;
  }
  return null;
}

/**
 * Check if value matches a pattern
 */
export function pattern(value: string, regex: RegExp, message: string): string | null {
  if (!regex.test(value)) {
    return message;
  }
  return null;
}

// ============================================================================
// SPECIFIC VALIDATORS
// ============================================================================

/**
 * Validate EDIPI (10-digit number)
 */
export function edipi(value: string): string | null {
  if (!value) {
    return "EDIPI is required";
  }
  if (!/^\d{10}$/.test(value)) {
    return "EDIPI must be exactly 10 digits";
  }
  return null;
}

/**
 * Validate email address
 */
export function email(value: string): string | null {
  if (!value) {
    return "Email is required";
  }
  // RFC 5322 compliant email regex (simplified)
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(value)) {
    return "Please enter a valid email address";
  }
  return null;
}

/**
 * Validate password strength
 */
export function password(value: string): string | null {
  if (!value) {
    return "Password is required";
  }
  if (value.length < 8) {
    return "Password must be at least 8 characters";
  }
  if (!/[A-Z]/.test(value)) {
    return "Password must contain at least one uppercase letter";
  }
  if (!/[a-z]/.test(value)) {
    return "Password must contain at least one lowercase letter";
  }
  if (!/[0-9]/.test(value)) {
    return "Password must contain at least one number";
  }
  if (!/[!@#$%^&*(),.?":{}|<>]/.test(value)) {
    return "Password must contain at least one special character";
  }
  return null;
}

/**
 * Validate password confirmation matches
 */
export function passwordMatch(password: string, confirmPassword: string): string | null {
  if (password !== confirmPassword) {
    return "Passwords do not match";
  }
  return null;
}

/**
 * Validate date string (YYYY-MM-DD)
 */
export function dateString(value: string): string | null {
  if (!value) {
    return "Date is required";
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return "Date must be in YYYY-MM-DD format";
  }
  const date = new Date(value);
  if (isNaN(date.getTime())) {
    return "Please enter a valid date";
  }
  return null;
}

/**
 * Validate date is not in the past
 */
export function futureDate(value: string): string | null {
  const error = dateString(value);
  if (error) return error;

  const date = new Date(value);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  if (date < today) {
    return "Date cannot be in the past";
  }
  return null;
}

/**
 * Validate positive number
 */
export function positiveNumber(value: number | string, fieldName = "Value"): string | null {
  const num = typeof value === "string" ? parseFloat(value) : value;
  if (isNaN(num)) {
    return `${fieldName} must be a number`;
  }
  if (num <= 0) {
    return `${fieldName} must be greater than 0`;
  }
  return null;
}

/**
 * Validate number in range
 */
export function numberInRange(
  value: number | string,
  min: number,
  max: number,
  fieldName = "Value"
): string | null {
  const num = typeof value === "string" ? parseFloat(value) : value;
  if (isNaN(num)) {
    return `${fieldName} must be a number`;
  }
  if (num < min || num > max) {
    return `${fieldName} must be between ${min} and ${max}`;
  }
  return null;
}

/**
 * Validate UUID format
 */
export function uuid(value: string): string | null {
  if (!value) {
    return "ID is required";
  }
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(value)) {
    return "Invalid ID format";
  }
  return null;
}

// ============================================================================
// SANITIZERS
// ============================================================================

/**
 * Sanitize string input - remove leading/trailing whitespace and normalize spaces
 */
export function sanitizeString(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

/**
 * Sanitize HTML - escape potentially dangerous characters
 */
export function escapeHtml(value: string): string {
  const escapeMap: Record<string, string> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  };
  return value.replace(/[&<>"']/g, (char) => escapeMap[char]);
}

/**
 * Remove all HTML tags from string
 */
export function stripHtml(value: string): string {
  return value.replace(/<[^>]*>/g, "");
}

/**
 * Sanitize for SQL-like injection (client-side check only - always use parameterized queries)
 */
export function sanitizeSqlInput(value: string): string {
  // Remove common SQL injection characters
  return value.replace(/['";\\]/g, "");
}

// ============================================================================
// COMPOSITE VALIDATORS
// ============================================================================

export interface ValidationResult {
  isValid: boolean;
  errors: Record<string, string>;
}

export type ValidatorFn = (value: unknown) => string | null;

export interface FieldValidation {
  value: unknown;
  validators: ValidatorFn[];
}

/**
 * Validate multiple fields at once
 */
export function validateForm(fields: Record<string, FieldValidation>): ValidationResult {
  const errors: Record<string, string> = {};
  let isValid = true;

  for (const [fieldName, { value, validators }] of Object.entries(fields)) {
    for (const validator of validators) {
      const error = validator(value);
      if (error) {
        errors[fieldName] = error;
        isValid = false;
        break; // Stop at first error for this field
      }
    }
  }

  return { isValid, errors };
}

/**
 * Create a required validator with custom field name
 */
export function requiredField(fieldName: string): ValidatorFn {
  return (value: unknown) => required(value, fieldName);
}

/**
 * Create a min length validator
 */
export function minLengthField(min: number, fieldName: string): ValidatorFn {
  return (value: unknown) => {
    if (typeof value !== "string") return null;
    return minLength(value, min, fieldName);
  };
}

/**
 * Create a max length validator
 */
export function maxLengthField(max: number, fieldName: string): ValidatorFn {
  return (value: unknown) => {
    if (typeof value !== "string") return null;
    return maxLength(value, max, fieldName);
  };
}

// ============================================================================
// HOOKS
// ============================================================================

import { useState, useCallback } from "react";

export interface UseFormValidationOptions {
  validateOnChange?: boolean;
  validateOnBlur?: boolean;
}

export interface UseFormValidationReturn<T> {
  values: T;
  errors: Partial<Record<keyof T, string>>;
  touched: Partial<Record<keyof T, boolean>>;
  isValid: boolean;
  setValue: (field: keyof T, value: T[keyof T]) => void;
  setTouched: (field: keyof T) => void;
  validate: () => boolean;
  reset: () => void;
  getFieldProps: (field: keyof T) => {
    value: T[keyof T];
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
    onBlur: () => void;
    error?: string;
  };
}

/**
 * Hook for form validation
 */
export function useFormValidation<T extends Record<string, unknown>>(
  initialValues: T,
  validators: Partial<Record<keyof T, ValidatorFn[]>>,
  options: UseFormValidationOptions = {}
): UseFormValidationReturn<T> {
  const { validateOnChange = false, validateOnBlur = true } = options;

  const [values, setValues] = useState<T>(initialValues);
  const [errors, setErrors] = useState<Partial<Record<keyof T, string>>>({});
  const [touched, setTouchedState] = useState<Partial<Record<keyof T, boolean>>>({});

  const validateField = useCallback(
    (field: keyof T, value: unknown): string | null => {
      const fieldValidators = validators[field];
      if (!fieldValidators) return null;

      for (const validator of fieldValidators) {
        const error = validator(value);
        if (error) return error;
      }
      return null;
    },
    [validators]
  );

  const setValue = useCallback(
    (field: keyof T, value: T[keyof T]) => {
      setValues((prev) => ({ ...prev, [field]: value }));

      if (validateOnChange) {
        const error = validateField(field, value);
        setErrors((prev) => ({ ...prev, [field]: error || undefined }));
      }
    },
    [validateOnChange, validateField]
  );

  const setTouched = useCallback(
    (field: keyof T) => {
      setTouchedState((prev) => ({ ...prev, [field]: true }));

      if (validateOnBlur) {
        const error = validateField(field, values[field]);
        setErrors((prev) => ({ ...prev, [field]: error || undefined }));
      }
    },
    [validateOnBlur, validateField, values]
  );

  const validate = useCallback((): boolean => {
    const newErrors: Partial<Record<keyof T, string>> = {};
    let isValid = true;

    for (const field of Object.keys(validators) as (keyof T)[]) {
      const error = validateField(field, values[field]);
      if (error) {
        newErrors[field] = error;
        isValid = false;
      }
    }

    setErrors(newErrors);
    return isValid;
  }, [validators, values, validateField]);

  const reset = useCallback(() => {
    setValues(initialValues);
    setErrors({});
    setTouchedState({});
  }, [initialValues]);

  const getFieldProps = useCallback(
    (field: keyof T) => ({
      value: values[field],
      onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
        setValue(field, e.target.value as T[keyof T]);
      },
      onBlur: () => setTouched(field),
      error: touched[field] ? errors[field] : undefined,
    }),
    [values, errors, touched, setValue, setTouched]
  );

  const isValid = Object.keys(errors).length === 0;

  return {
    values,
    errors,
    touched,
    isValid,
    setValue,
    setTouched,
    validate,
    reset,
    getFieldProps,
  };
}
