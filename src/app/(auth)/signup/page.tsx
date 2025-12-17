"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/lib/supabase-auth";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import Card, {
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "@/components/ui/Card";

export default function SignupPage() {
  const router = useRouter();
  const { signup } = useAuth();
  const [isLoading, setIsLoading] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setIsLoading(true);
    setFormError(null);

    const formData = new FormData(e.currentTarget);
    const edipi = formData.get("edipi") as string;
    const email = formData.get("email") as string;
    const password = formData.get("password") as string;
    const confirmPassword = formData.get("confirmPassword") as string;

    // Client-side validation
    if (password !== confirmPassword) {
      setFormError("Passwords do not match");
      setIsLoading(false);
      return;
    }

    if (password.length < 8) {
      setFormError("Password must be at least 8 characters");
      setIsLoading(false);
      return;
    }

    try {
      const result = await signup(edipi, email, password);

      if (!result.success) {
        setFormError(result.error || "Failed to create account");
        setIsLoading(false);
        return;
      }

      setSuccess(true);

      // Redirect to login after delay (workflow needs time to process)
      setTimeout(() => {
        router.push("/login");
      }, 5000);
    } catch {
      setFormError("An unexpected error occurred. Please try again.");
      setIsLoading(false);
    }
  };

  // Success state: account created via workflow
  if (success) {
    return (
      <Card variant="elevated" className="w-full max-w-md">
        <CardContent className="py-8">
          <div className="text-center mb-6">
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-success/20 flex items-center justify-center">
              <svg
                className="w-8 h-8 text-success"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M5 13l4 4L19 7"
                />
              </svg>
            </div>
            <h2 className="text-xl font-semibold text-foreground mb-2">
              Account Created!
            </h2>
            <p className="text-foreground-muted">
              Your account is being set up automatically.
            </p>
          </div>

          <div className="space-y-4 text-sm">
            <div className="p-4 rounded-lg bg-surface-elevated border border-border">
              <h3 className="font-medium text-foreground mb-2">What happens next:</h3>
              <ol className="list-decimal list-inside space-y-2 text-foreground-muted">
                <li>Your account is being created in the system</li>
                <li>This usually takes 1-2 minutes</li>
                <li>You&apos;ll be redirected to the login page shortly</li>
                <li>If login fails, please wait a moment and try again</li>
              </ol>
            </div>

            <div className="p-4 rounded-lg bg-highlight/10 border border-highlight/20">
              <p className="text-foreground-muted text-center">
                Redirecting to login in a few seconds...
              </p>
            </div>
          </div>

          <div className="mt-6 text-center">
            <Link
              href="/login"
              className="text-highlight hover:text-highlight-muted transition-colors font-medium"
            >
              Go to Login Now
            </Link>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card variant="elevated" className="w-full max-w-md">
      <CardHeader>
        <CardTitle>Create Account</CardTitle>
        <CardDescription>
          Register to access Duty Sync roster management
        </CardDescription>
      </CardHeader>

      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          {formError && (
            <div className="p-3 rounded-lg bg-error/10 border border-error/20 text-error text-sm">
              {formError}
            </div>
          )}

          <Input
            name="edipi"
            label="EDIPI"
            placeholder="Enter your 10-digit EDIPI"
            helperText="Your Electronic Data Interchange Personal Identifier"
            pattern="[0-9]{10}"
            title="EDIPI must be exactly 10 digits"
            autoComplete="username"
            required
            disabled={isLoading}
          />

          <Input
            name="email"
            type="email"
            label="Email"
            placeholder="Enter your email"
            autoComplete="email"
            required
            disabled={isLoading}
          />

          <Input
            name="password"
            type="password"
            label="Password"
            placeholder="Create a password"
            autoComplete="new-password"
            helperText="Minimum 8 characters"
            required
            disabled={isLoading}
          />

          <Input
            name="confirmPassword"
            type="password"
            label="Confirm Password"
            placeholder="Confirm your password"
            autoComplete="new-password"
            required
            disabled={isLoading}
          />

          <Button
            type="submit"
            variant="accent"
            size="lg"
            className="w-full mt-6"
            isLoading={isLoading}
          >
            Create Account
          </Button>
        </form>
      </CardContent>

      <CardFooter>
        <p className="text-sm text-foreground-muted text-center">
          Already have an account?{" "}
          <Link
            href="/login"
            className="text-highlight hover:text-highlight-muted transition-colors font-medium"
          >
            Sign in
          </Link>
        </p>
      </CardFooter>
    </Card>
  );
}
