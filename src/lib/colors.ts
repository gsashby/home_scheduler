// Suggested swatches for the per-person color picker when setting up a
// profile. The actual color lives on `profiles.color` in the database — this
// is just a starting palette, seeded with the household's initial picks
// (Dad black, Mom yellow, Sara pink, David blue, JJ green).
export const SUGGESTED_MEMBER_COLORS = [
  { name: "Black", value: "#1f2937" },
  { name: "Yellow", value: "#eab308" },
  { name: "Pink", value: "#ec4899" },
  { name: "Blue", value: "#3b82f6" },
  { name: "Green", value: "#22c55e" },
  { name: "Purple", value: "#a855f7" },
  { name: "Orange", value: "#f97316" },
  { name: "Teal", value: "#14b8a6" },
] as const;
