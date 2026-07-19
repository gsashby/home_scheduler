import type { NotifKind } from "@/lib/supabase/database.types";

export const NOTIF_KIND_LABELS: Record<NotifKind, string> = {
  brief: "Daily brief",
  deadline: "Deadline alert",
  nudge: "Nudge",
  update: "Update",
  sync: "Google sync",
  job: "Job board",
};
