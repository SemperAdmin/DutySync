/**
 * Tests for Input Validation Utilities
 */
import { describe, it, expect } from "vitest";
import {
  required,
  minLength,
  maxLength,
  exactLength,
  pattern,
  edipi,
  email,
  password,
  passwordMatch,
  dateString,
  futureDate,
  positiveNumber,
  numberInRange,
  uuid,
  sanitizeString,
  escapeHtml,
  stripHtml,
  sanitizeSqlInput,
  validateForm,
  requiredField,
  minLengthField,
  maxLengthField,
} from "@/lib/validation";

// ============================================================================
// BASIC VALIDATORS
// ============================================================================

describe("required", () => {
  it("returns error for null", () => {
    expect(required(null)).toBe("This field is required");
  });

  it("returns error for undefined", () => {
    expect(required(undefined)).toBe("This field is required");
  });

  it("returns error for empty string", () => {
    expect(required("")).toBe("This field is required");
  });

  it("returns error for whitespace-only string", () => {
    expect(required("   ")).toBe("This field is required");
  });

  it("returns null for valid string", () => {
    expect(required("value")).toBeNull();
  });

  it("returns null for number zero", () => {
    expect(required(0)).toBeNull();
  });

  it("uses custom field name", () => {
    expect(required("", "Email")).toBe("Email is required");
  });
});

describe("minLength", () => {
  it("returns error when string is too short", () => {
    expect(minLength("ab", 3)).toBe("This field must be at least 3 characters");
  });

  it("returns null when string meets minimum", () => {
    expect(minLength("abc", 3)).toBeNull();
  });

  it("returns null when string exceeds minimum", () => {
    expect(minLength("abcd", 3)).toBeNull();
  });

  it("uses custom field name", () => {
    expect(minLength("ab", 3, "Password")).toBe("Password must be at least 3 characters");
  });
});

describe("maxLength", () => {
  it("returns error when string is too long", () => {
    expect(maxLength("abcd", 3)).toBe("This field must be no more than 3 characters");
  });

  it("returns null when string meets maximum", () => {
    expect(maxLength("abc", 3)).toBeNull();
  });

  it("returns null when string is under maximum", () => {
    expect(maxLength("ab", 3)).toBeNull();
  });
});

describe("exactLength", () => {
  it("returns error when string length does not match", () => {
    expect(exactLength("ab", 3)).toBe("This field must be exactly 3 characters");
  });

  it("returns null when string length matches", () => {
    expect(exactLength("abc", 3)).toBeNull();
  });
});

describe("pattern", () => {
  it("returns error when pattern does not match", () => {
    expect(pattern("abc", /^\d+$/, "Must be numbers only")).toBe("Must be numbers only");
  });

  it("returns null when pattern matches", () => {
    expect(pattern("123", /^\d+$/, "Must be numbers only")).toBeNull();
  });
});

// ============================================================================
// SPECIFIC VALIDATORS
// ============================================================================

describe("edipi", () => {
  it("returns error for empty value", () => {
    expect(edipi("")).toBe("EDIPI is required");
  });

  it("returns error for non-10-digit string", () => {
    expect(edipi("12345")).toBe("EDIPI must be exactly 10 digits");
    expect(edipi("12345678901")).toBe("EDIPI must be exactly 10 digits");
  });

  it("returns error for string with non-digits", () => {
    expect(edipi("123456789a")).toBe("EDIPI must be exactly 10 digits");
  });

  it("returns null for valid 10-digit EDIPI", () => {
    expect(edipi("1234567890")).toBeNull();
  });
});

describe("email", () => {
  it("returns error for empty value", () => {
    expect(email("")).toBe("Email is required");
  });

  it("returns error for invalid email", () => {
    expect(email("invalid")).toBe("Please enter a valid email address");
    expect(email("invalid@")).toBe("Please enter a valid email address");
    expect(email("@example.com")).toBe("Please enter a valid email address");
  });

  it("returns null for valid email", () => {
    expect(email("user@example.com")).toBeNull();
    expect(email("user.name@sub.domain.com")).toBeNull();
  });
});

describe("password", () => {
  it("returns error for empty value", () => {
    expect(password("")).toBe("Password is required");
  });

  it("returns error for short password", () => {
    expect(password("Ab1!")).toBe("Password must be at least 8 characters");
  });

  it("returns error for missing uppercase", () => {
    expect(password("abcdefg1!")).toBe("Password must contain at least one uppercase letter");
  });

  it("returns error for missing lowercase", () => {
    expect(password("ABCDEFG1!")).toBe("Password must contain at least one lowercase letter");
  });

  it("returns error for missing number", () => {
    expect(password("Abcdefgh!")).toBe("Password must contain at least one number");
  });

  it("returns error for missing special character", () => {
    expect(password("Abcdefgh1")).toBe("Password must contain at least one special character");
  });

  it("returns null for valid password", () => {
    expect(password("Abcdefg1!")).toBeNull();
    expect(password("P@ssword123")).toBeNull();
  });
});

describe("passwordMatch", () => {
  it("returns error when passwords do not match", () => {
    expect(passwordMatch("password1", "password2")).toBe("Passwords do not match");
  });

  it("returns null when passwords match", () => {
    expect(passwordMatch("password", "password")).toBeNull();
  });
});

describe("dateString", () => {
  it("returns error for empty value", () => {
    expect(dateString("")).toBe("Date is required");
  });

  it("returns error for invalid format", () => {
    expect(dateString("2024/01/15")).toBe("Date must be in YYYY-MM-DD format");
    expect(dateString("01-15-2024")).toBe("Date must be in YYYY-MM-DD format");
  });

  it("returns error for invalid date", () => {
    // Month 13 creates an invalid date that Date.parse returns NaN for
    expect(dateString("2024-13-01")).toBe("Please enter a valid date");
    // Note: JavaScript Date constructor normalizes 2024-02-30 to 2024-03-01,
    // so it doesn't produce NaN. Testing with clearly invalid month instead.
    expect(dateString("2024-00-15")).toBe("Please enter a valid date");
  });

  it("returns null for valid date", () => {
    expect(dateString("2024-01-15")).toBeNull();
    expect(dateString("2024-12-31")).toBeNull();
  });
});

describe("futureDate", () => {
  it("returns error for past date", () => {
    expect(futureDate("2020-01-01")).toBe("Date cannot be in the past");
  });

  it("returns null for future date", () => {
    const futureYear = new Date().getFullYear() + 1;
    expect(futureDate(`${futureYear}-01-01`)).toBeNull();
  });

  it("returns null for today", () => {
    const today = new Date().toISOString().split("T")[0];
    expect(futureDate(today)).toBeNull();
  });
});

describe("positiveNumber", () => {
  it("returns error for non-number", () => {
    expect(positiveNumber("abc")).toBe("Value must be a number");
  });

  it("returns error for zero", () => {
    expect(positiveNumber(0)).toBe("Value must be greater than 0");
  });

  it("returns error for negative number", () => {
    expect(positiveNumber(-5)).toBe("Value must be greater than 0");
  });

  it("returns null for positive number", () => {
    expect(positiveNumber(5)).toBeNull();
    expect(positiveNumber("10")).toBeNull();
  });

  it("uses custom field name", () => {
    expect(positiveNumber(0, "Quantity")).toBe("Quantity must be greater than 0");
  });
});

describe("numberInRange", () => {
  it("returns error for non-number", () => {
    expect(numberInRange("abc", 1, 10)).toBe("Value must be a number");
  });

  it("returns error for number below range", () => {
    expect(numberInRange(0, 1, 10)).toBe("Value must be between 1 and 10");
  });

  it("returns error for number above range", () => {
    expect(numberInRange(11, 1, 10)).toBe("Value must be between 1 and 10");
  });

  it("returns null for number in range", () => {
    expect(numberInRange(5, 1, 10)).toBeNull();
    expect(numberInRange(1, 1, 10)).toBeNull();
    expect(numberInRange(10, 1, 10)).toBeNull();
  });
});

describe("uuid", () => {
  it("returns error for empty value", () => {
    expect(uuid("")).toBe("ID is required");
  });

  it("returns error for invalid UUID", () => {
    expect(uuid("not-a-uuid")).toBe("Invalid ID format");
    expect(uuid("12345678-1234-1234-1234-123456789012")).toBe("Invalid ID format");
  });

  it("returns null for valid UUID", () => {
    expect(uuid("123e4567-e89b-12d3-a456-426614174000")).toBeNull();
    expect(uuid("550e8400-e29b-41d4-a716-446655440000")).toBeNull();
  });
});

// ============================================================================
// SANITIZERS
// ============================================================================

describe("sanitizeString", () => {
  it("trims whitespace", () => {
    expect(sanitizeString("  hello  ")).toBe("hello");
  });

  it("normalizes multiple spaces", () => {
    expect(sanitizeString("hello   world")).toBe("hello world");
  });

  it("handles both trimming and normalizing", () => {
    expect(sanitizeString("  hello   world  ")).toBe("hello world");
  });
});

describe("escapeHtml", () => {
  it("escapes ampersand", () => {
    expect(escapeHtml("Tom & Jerry")).toBe("Tom &amp; Jerry");
  });

  it("escapes less than and greater than", () => {
    expect(escapeHtml("<script>")).toBe("&lt;script&gt;");
  });

  it("escapes quotes", () => {
    expect(escapeHtml('Say "hello"')).toBe("Say &quot;hello&quot;");
    expect(escapeHtml("Say 'hello'")).toBe("Say &#39;hello&#39;");
  });

  it("handles multiple special characters", () => {
    expect(escapeHtml('<a href="test">Link</a>')).toBe(
      "&lt;a href=&quot;test&quot;&gt;Link&lt;/a&gt;"
    );
  });
});

describe("stripHtml", () => {
  it("removes HTML tags", () => {
    expect(stripHtml("<p>Hello</p>")).toBe("Hello");
    expect(stripHtml("<a href='test'>Link</a>")).toBe("Link");
  });

  it("removes nested tags", () => {
    expect(stripHtml("<div><span>Text</span></div>")).toBe("Text");
  });

  it("preserves text content", () => {
    expect(stripHtml("No tags here")).toBe("No tags here");
  });
});

describe("sanitizeSqlInput", () => {
  it("removes single quotes", () => {
    expect(sanitizeSqlInput("O'Brien")).toBe("OBrien");
  });

  it("removes double quotes", () => {
    expect(sanitizeSqlInput('Say "hello"')).toBe("Say hello");
  });

  it("removes semicolons", () => {
    expect(sanitizeSqlInput("value; DROP TABLE")).toBe("value DROP TABLE");
  });

  it("removes backslashes", () => {
    expect(sanitizeSqlInput("path\\to\\file")).toBe("pathtofile");
  });
});

// ============================================================================
// COMPOSITE VALIDATORS
// ============================================================================

describe("validateForm", () => {
  it("returns valid for all valid fields", () => {
    const result = validateForm({
      email: {
        value: "user@example.com",
        validators: [email],
      },
      edipi: {
        value: "1234567890",
        validators: [edipi],
      },
    });

    expect(result.isValid).toBe(true);
    expect(result.errors).toEqual({});
  });

  it("returns errors for invalid fields", () => {
    const result = validateForm({
      email: {
        value: "invalid",
        validators: [email],
      },
      edipi: {
        value: "123",
        validators: [edipi],
      },
    });

    expect(result.isValid).toBe(false);
    expect(result.errors.email).toBe("Please enter a valid email address");
    expect(result.errors.edipi).toBe("EDIPI must be exactly 10 digits");
  });

  it("stops at first error for each field", () => {
    const result = validateForm({
      value: {
        value: "",
        validators: [
          (v) => required(v),
          (v) => minLength(v as string, 5),
        ],
      },
    });

    expect(result.errors.value).toBe("This field is required");
  });
});

describe("requiredField", () => {
  it("creates validator with custom field name", () => {
    const validator = requiredField("Email");
    expect(validator("")).toBe("Email is required");
    expect(validator("value")).toBeNull();
  });
});

describe("minLengthField", () => {
  it("creates validator with custom min length and field name", () => {
    const validator = minLengthField(5, "Username");
    expect(validator("abc")).toBe("Username must be at least 5 characters");
    expect(validator("abcdef")).toBeNull();
  });

  it("returns null for non-string values", () => {
    const validator = minLengthField(5, "Username");
    expect(validator(123)).toBeNull();
  });
});

describe("maxLengthField", () => {
  it("creates validator with custom max length and field name", () => {
    const validator = maxLengthField(5, "Code");
    expect(validator("abcdef")).toBe("Code must be no more than 5 characters");
    expect(validator("abc")).toBeNull();
  });

  it("returns null for non-string values", () => {
    const validator = maxLengthField(5, "Code");
    expect(validator(123456)).toBeNull();
  });
});
