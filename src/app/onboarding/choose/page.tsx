import Link from "next/link";

export default function ChooseFamilyPage() {
  return (
    <div className="space-y-6 text-center">
      <div>
        <h1 className="text-2xl font-semibold">Welcome!</h1>
        <p className="mt-1 text-sm text-gray-600">
          Every account belongs to one family. Create a new one, or join an
          existing family with an invite code.
        </p>
      </div>
      <div className="space-y-3">
        <Link
          href="/onboarding/create"
          className="block w-full rounded-md bg-indigo-600 px-4 py-3 text-sm font-semibold text-white hover:bg-indigo-500"
        >
          Create a new family
        </Link>
        <Link
          href="/onboarding/join"
          className="block w-full rounded-md border border-gray-200 bg-white px-4 py-3 text-sm font-semibold text-gray-900 hover:bg-gray-50"
        >
          Join an existing family
        </Link>
      </div>
      <p className="text-xs text-gray-500">
        🔒 Each family&rsquo;s calendar, tasks, and chores are completely
        private — no other family can ever see or access your data.
      </p>
    </div>
  );
}
