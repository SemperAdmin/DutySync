import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Input from "@/components/ui/Input";

describe("Input", () => {
  describe("basic rendering", () => {
    it("renders an input element", () => {
      render(<Input />);
      expect(screen.getByRole("textbox")).toBeInTheDocument();
    });

    it("renders with a label when provided", () => {
      render(<Input label="Email" name="email" />);
      expect(screen.getByLabelText("Email")).toBeInTheDocument();
    });

    it("associates label with input via htmlFor", () => {
      render(<Input label="Username" name="username" />);
      const input = screen.getByRole("textbox");
      const label = screen.getByText("Username");
      expect(input.id).toBe("username");
      expect(label).toHaveAttribute("for", "username");
    });

    it("uses custom id when provided", () => {
      render(<Input label="Test" id="custom-id" name="test" />);
      const input = screen.getByRole("textbox");
      expect(input.id).toBe("custom-id");
    });
  });

  describe("error state", () => {
    it("displays error message when error prop is provided", () => {
      render(<Input error="This field is required" />);
      expect(screen.getByText("This field is required")).toBeInTheDocument();
    });

    it("sets aria-invalid to true when error is present", () => {
      render(<Input error="Invalid input" />);
      expect(screen.getByRole("textbox")).toHaveAttribute("aria-invalid", "true");
    });

    it("associates error message with input via aria-describedby", () => {
      render(<Input name="email" error="Invalid email" />);
      const input = screen.getByRole("textbox");
      const errorMessage = screen.getByText("Invalid email");
      expect(input).toHaveAttribute("aria-describedby", "email-error");
      expect(errorMessage.id).toBe("email-error");
    });

    it("renders error with role=alert for screen readers", () => {
      render(<Input error="Required field" />);
      expect(screen.getByRole("alert")).toHaveTextContent("Required field");
    });

    it("applies error styling to input", () => {
      render(<Input error="Error" />);
      const input = screen.getByRole("textbox");
      expect(input.className).toContain("border-error");
    });
  });

  describe("helper text", () => {
    it("displays helper text when provided", () => {
      render(<Input helperText="Enter your email address" />);
      expect(screen.getByText("Enter your email address")).toBeInTheDocument();
    });

    it("associates helper text with input via aria-describedby", () => {
      render(<Input name="email" helperText="We'll never share your email" />);
      const input = screen.getByRole("textbox");
      expect(input).toHaveAttribute("aria-describedby", "email-helper");
    });

    it("hides helper text when error is present", () => {
      render(
        <Input
          name="email"
          helperText="Helper text"
          error="Error message"
        />
      );
      expect(screen.queryByText("Helper text")).not.toBeInTheDocument();
      expect(screen.getByText("Error message")).toBeInTheDocument();
    });
  });

  describe("required field", () => {
    it("shows asterisk for required fields", () => {
      render(<Input label="Name" required />);
      expect(screen.getByText("*")).toBeInTheDocument();
    });

    it("hides asterisk from screen readers", () => {
      render(<Input label="Name" required />);
      const asterisk = screen.getByText("*");
      expect(asterisk).toHaveAttribute("aria-hidden", "true");
    });
  });

  describe("disabled state", () => {
    it("applies disabled attribute when disabled", () => {
      render(<Input disabled />);
      expect(screen.getByRole("textbox")).toBeDisabled();
    });

    it("applies disabled styling", () => {
      render(<Input disabled />);
      expect(screen.getByRole("textbox").className).toContain("disabled:opacity-50");
    });
  });

  describe("user interaction", () => {
    it("accepts user input", async () => {
      const user = userEvent.setup();
      render(<Input />);

      const input = screen.getByRole("textbox");
      await user.type(input, "Hello World");

      expect(input).toHaveValue("Hello World");
    });

    it("calls onChange when value changes", async () => {
      const user = userEvent.setup();
      const handleChange = vi.fn();
      render(<Input onChange={handleChange} />);

      const input = screen.getByRole("textbox");
      await user.type(input, "A");

      expect(handleChange).toHaveBeenCalled();
    });
  });

  describe("forwarded ref", () => {
    it("forwards ref to the input element", () => {
      const ref = { current: null as HTMLInputElement | null };
      render(<Input ref={ref} />);
      expect(ref.current).toBeInstanceOf(HTMLInputElement);
    });
  });

  describe("custom className", () => {
    it("applies custom className to input", () => {
      render(<Input className="custom-class" />);
      expect(screen.getByRole("textbox").className).toContain("custom-class");
    });
  });

  describe("input types", () => {
    it("supports password type", () => {
      render(<Input type="password" />);
      const input = screen.getByDisplayValue("");
      expect(input).toHaveAttribute("type", "password");
    });

    it("supports email type", () => {
      render(<Input type="email" />);
      expect(screen.getByRole("textbox")).toHaveAttribute("type", "email");
    });

    it("supports number type", () => {
      render(<Input type="number" />);
      expect(screen.getByRole("spinbutton")).toHaveAttribute("type", "number");
    });
  });
});
