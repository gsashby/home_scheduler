import type { TaskStatus } from "@/lib/supabase/database.types";

type ButtonVariant = "primary" | "secondary" | "ok" | "warn" | "danger";

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: "bg-indigo-600 text-white hover:bg-indigo-500",
  secondary: "bg-white text-gray-900 border border-gray-200 hover:bg-gray-50",
  ok: "bg-green-600 text-white hover:bg-green-500",
  warn: "bg-amber-600 text-white hover:bg-amber-500",
  danger: "bg-red-600 text-white hover:bg-red-500",
};

export function Button({
  variant = "primary",
  size = "md",
  className = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: "sm" | "md";
}) {
  const sizeClass =
    size === "sm"
      ? "px-2.5 py-1.5 text-xs rounded-lg"
      : "px-3.5 py-2 text-sm rounded-lg";
  return (
    <button
      {...props}
      className={`font-semibold disabled:cursor-not-allowed disabled:opacity-50 ${sizeClass} ${VARIANT_CLASSES[variant]} ${className}`}
    />
  );
}

export function Card({
  className = "",
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      {...props}
      className={`mb-3.5 rounded-xl border border-gray-200 bg-white p-4 shadow-sm ${className}`}
    />
  );
}

export function Chip({
  active,
  color,
  className = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  active?: boolean;
  color?: string;
}) {
  return (
    <button
      {...props}
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-semibold ${
        active
          ? "border-gray-900 bg-gray-900 text-white"
          : "border-gray-200 bg-white text-gray-900"
      } ${className}`}
    >
      {color && <Swatch color={color} />}
      {props.children}
    </button>
  );
}

export function Swatch({ color, size = 10 }: { color: string; size?: number }) {
  return (
    <span
      className="inline-block shrink-0 rounded-full"
      style={{ backgroundColor: color, width: size, height: size }}
      aria-hidden
    />
  );
}

export function Tag({
  children,
  tone = "indigo",
}: {
  children: React.ReactNode;
  tone?: "indigo" | "green";
}) {
  const cls =
    tone === "green"
      ? "bg-green-50 text-green-800"
      : "bg-indigo-50 text-indigo-700";
  return (
    <span
      className={`rounded-md px-1.5 py-0.5 text-[11px] font-semibold ${cls}`}
    >
      {children}
    </span>
  );
}

export function StatusBadge({ status }: { status: TaskStatus }) {
  const cls =
    status === "assigned"
      ? "bg-orange-50 text-orange-700"
      : status === "done"
        ? "bg-blue-50 text-blue-700"
        : "bg-emerald-50 text-emerald-700";
  const label = status === "assigned" ? "to do" : status;
  return (
    <span className={`rounded-md px-2 py-0.5 text-[11px] font-bold ${cls}`}>
      {label}
    </span>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-gray-200 p-3.5 text-center text-sm text-gray-600">
      {children}
    </div>
  );
}
