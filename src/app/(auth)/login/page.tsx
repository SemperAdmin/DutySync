"use client";

import { Suspense, useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import Card, {
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "@/components/ui/Card";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get("callbackUrl") || "/";
  const error = searchParams.get("error");

  const [isLoading, setIsLoading] = useState(false);
  const [formError, setFormError] = useState<string | null>(
    error === "CredentialsSignin" ? "Invalid username or password" : null
  );

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setIsLoading(true);
    setFormError(null);

    const formData = new FormData(e.currentTarget);
    const username = formData.get("username") as string;
    const password = formData.get("password") as string;

    try {
      const result = await signIn("credentials", {
        username,
        password,
        redirect: false,
        callbackUrl,
      });

      if (result?.error) {
        setFormError("Invalid username or password");
        setIsLoading(false);
      } else if (result?.ok) {
        router.push(callbackUrl);
        router.refresh();
      }
    } catch {
      setFormError("An unexpected error occurred. Please try again.");
      setIsLoading(false);
    }
  };

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
            name="username"
            label="Username"
            placeholder="Enter your username"
            autoComplete="username"
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
          >
            Sign In
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
        <p className="text-xs text-foreground-muted text-center">
          Demo credentials: admin / admin123
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
