"use client";

import { Suspense, useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
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
import { loginRateLimiter, formatRetryTime } from "@/lib/rate-limiter";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get("callbackUrl") || "/admin";
  const { login, user, isLoading: authLoading } = useAuth();

  const [isLoading, setIsLoading] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [isBlocked, setIsBlocked] = useState(false);
  const [blockTimeRemaining, setBlockTimeRemaining] = useState<string | null>(null);

  // Check rate limit status on mount and update countdown
  useEffect(() => {
    const checkStatus = () => {
      const status = loginRateLimiter.check();
      if (!status.allowed && status.retryAfterMs) {
        setIsBlocked(true);
        setBlockTimeRemaining(formatRetryTime(status.retryAfterMs));
      } else {
        setIsBlocked(false);
        setBlockTimeRemaining(null);
      }
    };

    checkStatus();
    const interval = setInterval(checkStatus, 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!authLoading && user) {
      router.push(callbackUrl);
    }
  }, [user, authLoading, router, callbackUrl]);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    // Check rate limit before attempting login
    const rateLimitStatus = loginRateLimiter.check();
    if (!rateLimitStatus.allowed) {
      setIsBlocked(true);
      setBlockTimeRemaining(formatRetryTime(rateLimitStatus.retryAfterMs || 0));
      setFormError(`Too many login attempts. Please try again in ${formatRetryTime(rateLimitStatus.retryAfterMs || 0)}.`);
      return;
    }

    setIsLoading(true);
    setFormError(null);

    const formData = new FormData(e.currentTarget);
    const edipi = formData.get("edipi") as string;
    const password = formData.get("password") as string;

    try {
      const success = await login(edipi, password);

      if (success) {
        loginRateLimiter.recordSuccess();
        router.push(callbackUrl);
      } else {
        const result = loginRateLimiter.recordFailure();
        if (!result.allowed) {
          setIsBlocked(true);
          setBlockTimeRemaining(formatRetryTime(result.retryAfterMs || 0));
          setFormError(`Too many login attempts. Please try again in ${formatRetryTime(result.retryAfterMs || 0)}.`);
        } else {
          setFormError(`Invalid EDIPI or password. ${result.remainingAttempts} attempt${result.remainingAttempts !== 1 ? 's' : ''} remaining.`);
        }
        setIsLoading(false);
      }
    } catch {
      loginRateLimiter.recordFailure();
      setFormError("An unexpected error occurred. Please try again.");
      setIsLoading(false);
    }
  };

  if (authLoading) {
    return <LoginLoading />;
  }

  return (
    <Card variant="elevated" className="w-full max-w-md">
      <CardHeader>
        <CardTitle>Sign In</CardTitle>
        <CardDescription>
          Enter your credentials to access Duty Sync
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
            autoComplete="username"
            pattern="[0-9]{10}"
            title="EDIPI must be exactly 10 digits"
            required
            disabled={isLoading}
          />

          <Input
            name="password"
            type="password"
            label="Password"
            placeholder="Enter your password"
            autoComplete="current-password"
            required
            disabled={isLoading}
          />

          <Button
            type="submit"
            variant="accent"
            size="lg"
            className="w-full mt-6"
            isLoading={isLoading}
            disabled={isBlocked}
          >
            {isBlocked ? `Blocked (${blockTimeRemaining})` : "Sign In"}
          </Button>
        </form>
      </CardContent>

      <CardFooter className="flex flex-col gap-4">
        <p className="text-sm text-foreground-muted text-center">
          Don&apos;t have an account?{" "}
          <Link
            href="/signup"
            className="text-highlight hover:text-highlight-muted transition-colors font-medium"
          >
            Sign up
          </Link>
        </p>
      </CardFooter>
    </Card>
  );
}

function LoginLoading() {
  return (
    <Card variant="elevated" className="w-full max-w-md">
      <CardContent className="py-12 text-center">
        <div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full mx-auto" />
        <p className="text-foreground-muted mt-4">Loading...</p>
      </CardContent>
    </Card>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<LoginLoading />}>
      <LoginForm />
    </Suspense>
  );
}
