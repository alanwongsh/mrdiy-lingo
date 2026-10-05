import { SignInScreen } from "@/components/sign-in-screen";
import { safeNextPath } from "@/lib/auth/actor";

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const { next, error } = await searchParams;
  return (
    <SignInScreen
      nextPath={safeNextPath(next ?? "/")}
      error={error === "1"}
    />
  );
}
