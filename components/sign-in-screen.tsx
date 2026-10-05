import Image from "next/image";
import Link from "next/link";
import { canOpenSetup } from "@/lib/auth/access";
import { Button, Card, Field, inputClass } from "@/components/ui";

export async function SignInScreen({
  nextPath,
  error,
}: {
  nextPath: string;
  error?: boolean;
}) {
  let showSetup = false;
  try {
    showSetup = await canOpenSetup();
  } catch {
    showSetup = true;
  }

  return (
    <div className="flex min-h-dvh items-center justify-center px-4 py-10">
      <Card className="w-full max-w-md overflow-hidden">
        <div className="h-1.5 bg-[var(--diy-yellow)]" />
        <div className="px-6 py-7 sm:px-8">
          <div className="text-center">
            <Image
              src="/brand/mr-diy-logo.png"
              alt="MR.DIY"
              width={88}
              height={80}
              priority
              className="mx-auto h-auto w-14"
            />
            <h1 className="mt-3 text-2xl font-bold tracking-tight">Sign in</h1>
            <p className="mt-2 text-sm leading-relaxed text-[var(--hub-muted-strong)]">
              Use your email and password when you are not opening Lingo from
              Joget. Joget still signs you in with its token.
            </p>
          </div>

          <form action="/auth/password" method="post" className="mt-6 space-y-3">
            <input type="hidden" name="next" value={nextPath} />
            <Field label="Email" htmlFor="email">
              <input
                id="email"
                name="email"
                type="email"
                required
                autoComplete="email"
                className={inputClass}
                placeholder="alan.wongsh@mrdiy.com"
              />
            </Field>
            <Field label="Password" htmlFor="password">
              <input
                id="password"
                name="password"
                type="password"
                required
                autoComplete="current-password"
                className={inputClass}
              />
            </Field>
            {error ? (
              <p className="text-sm text-red-700">Email or password is incorrect.</p>
            ) : null}
            <Button type="submit" className="w-full">
              Sign in
            </Button>
          </form>

          {showSetup ? (
            <p className="mt-5 text-center text-sm">
              <Link href="/setup" className="font-semibold text-[var(--hub-accent)]">
                Database setup
              </Link>
            </p>
          ) : null}
        </div>
      </Card>
    </div>
  );
}
