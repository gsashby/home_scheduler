import type { TaskCategory } from "@/lib/supabase/database.types";

// Matches the prototype's CATS map exactly (category select options, minus
// "school" which is driven by the subjects table instead of a fixed label).
export const CATEGORY_LABELS: Record<
  Exclude<TaskCategory, "school">,
  string
> = {
  work: "Work",
  home: "Home",
  personal: "Personal",
  goal: "Goal",
  zone: "Zone / Chore",
};

export function categoryLabel(
  category: TaskCategory,
  subjectName: string | null,
): string {
  if (category === "school") {
    return "School · " + (subjectName ?? "Other");
  }
  return CATEGORY_LABELS[category];
}

// The four top-level groupings tasks are bucketed under on the Tasks tab.
// Categories that don't match any group (there are none) simply wouldn't render.
export const TOP_CATEGORIES: {
  label: string;
  icon: string;
  match: (category: TaskCategory) => boolean;
}[] = [
  { label: "School", icon: "📚", match: (c) => c === "school" },
  { label: "Work", icon: "💼", match: (c) => c === "work" },
  { label: "Home", icon: "🏠", match: (c) => c === "home" || c === "zone" },
  {
    label: "Personal",
    icon: "⭐",
    match: (c) => c === "personal" || c === "goal",
  },
];
