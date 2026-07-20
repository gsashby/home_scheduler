import Link from "next/link";

const REASON_MESSAGES: Record<string, string> = {
  oauth:
    "We couldn't complete your Google sign-in. This can happen if the link was already used or expired — please try again.",
  otp: "That confirmation link is invalid or has expired. Please request a new one.",
  missing_profile:
    "Your account signed in, but we couldn't find a matching profile. Contact your family admin — this shouldn't normally happen.",
};

export default async function AuthErrorPage({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string }>;
}) {
  const { reason } = await searchParams;
  const message =
    (reason && REASON_MESSAGES[reason]) ??
    "Something went wrong finishing sign-in. Please try again.";

  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-4 text-center">
        <h1 className="text-2xl font-semibold">Sign-in problem</h1>
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {message}
        </p>
        <p className="text-sm text-gray-600">
          <Link href="/login" className="font-semibold text-indigo-600">
            Back to sign in
          </Link>
        </p>
      </div>
    </main>
  );
}
