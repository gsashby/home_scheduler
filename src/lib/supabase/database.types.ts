// Hand-written to match supabase/migrations/20260719000001_init_schema.sql
// exactly (no live Supabase project to run `supabase gen types` against
// yet). Once a real project exists, regenerate with:
//   npx supabase gen types typescript --project-id <project-ref> > src/lib/supabase/database.types.ts
// and diff against this file before overwriting — some hand-tuned bits
// (function arg/return shapes) may need to be re-applied.

export type FamilyRole = "parent" | "kid";
export type TaskStatus = "assigned" | "done" | "verified";
export type TaskCategory = "school" | "work" | "home" | "personal" | "goal" | "zone";
export type EventSource = "app" | "google";
export type JobStatus = "open" | "taken" | "done" | "paid";
export type NotifKind = "brief" | "deadline" | "nudge" | "update" | "sync" | "job";
export type CalendarSharing = "family" | "parents" | "private";

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          display_name: string;
          role: FamilyRole;
          color: string;
          google_sync_enabled: boolean;
          calendar_sharing: CalendarSharing;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["profiles"]["Row"]> & {
          id: string;
          display_name: string;
          role: FamilyRole;
          color: string;
        };
        Update: Partial<Database["public"]["Tables"]["profiles"]["Row"]>;
      };
      subjects: {
        Row: { id: string; name: string; position: number; created_at: string };
        Insert: Partial<Database["public"]["Tables"]["subjects"]["Row"]> & { name: string };
        Update: Partial<Database["public"]["Tables"]["subjects"]["Row"]>;
      };
      calendar_events: {
        Row: {
          id: string;
          member_id: string;
          title: string;
          date: string;
          start_time: string;
          end_time: string;
          source: EventSource;
          google_calendar_id: string | null;
          google_event_id: string | null;
          created_by: string;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["calendar_events"]["Row"]> & {
          member_id: string;
          title: string;
          date: string;
          start_time: string;
          end_time: string;
          created_by: string;
        };
        Update: Partial<Database["public"]["Tables"]["calendar_events"]["Row"]>;
      };
      zones: {
        Row: {
          id: string;
          name: string;
          subzones: string[];
          assigned_to: string | null;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["zones"]["Row"]> & { name: string };
        Update: Partial<Database["public"]["Tables"]["zones"]["Row"]>;
      };
      zone_rotation: {
        Row: {
          id: boolean;
          start_date: string;
          interval_days: number | null;
          offset_cycles: number;
          member_order: string[];
        };
        Insert: Partial<Database["public"]["Tables"]["zone_rotation"]["Row"]> & { start_date: string };
        Update: Partial<Database["public"]["Tables"]["zone_rotation"]["Row"]>;
      };
      zone_dismissals: {
        Row: { zone_id: string; cycle: number };
        Insert: { zone_id: string; cycle: number };
        Update: Partial<Database["public"]["Tables"]["zone_dismissals"]["Row"]>;
      };
      jobs: {
        Row: {
          id: string;
          title: string;
          amount: number;
          status: JobStatus;
          taken_by: string | null;
          task_id: string | null;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["jobs"]["Row"]> & { title: string; amount: number };
        Update: Partial<Database["public"]["Tables"]["jobs"]["Row"]>;
      };
      tasks: {
        Row: {
          id: string;
          title: string;
          member_id: string;
          category: TaskCategory;
          subject_id: string | null;
          date: string;
          deadline: string | null;
          remind_minutes: number;
          status: TaskStatus;
          created_by: string;
          zone_id: string | null;
          zone_cycle: number | null;
          job_id: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["tasks"]["Row"]> & {
          title: string;
          member_id: string;
          category: TaskCategory;
          date: string;
          created_by: string;
        };
        Update: Partial<Database["public"]["Tables"]["tasks"]["Row"]>;
      };
      subtasks: {
        Row: { id: string; task_id: string; title: string; done: boolean; position: number };
        Insert: Partial<Database["public"]["Tables"]["subtasks"]["Row"]> & { task_id: string; title: string };
        Update: Partial<Database["public"]["Tables"]["subtasks"]["Row"]>;
      };
      notifications: {
        Row: {
          id: string;
          to_profile_id: string;
          kind: NotifKind;
          text: string;
          dedupe_key: string | null;
          read: boolean;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["notifications"]["Row"]> & {
          to_profile_id: string;
          kind: NotifKind;
          text: string;
        };
        Update: Partial<Database["public"]["Tables"]["notifications"]["Row"]>;
      };
      push_subscriptions: {
        Row: {
          id: string;
          profile_id: string;
          endpoint: string;
          p256dh: string;
          auth: string;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["push_subscriptions"]["Row"]> & {
          profile_id: string;
          endpoint: string;
          p256dh: string;
          auth: string;
        };
        Update: Partial<Database["public"]["Tables"]["push_subscriptions"]["Row"]>;
      };
      google_tokens: {
        Row: {
          profile_id: string;
          access_token: string;
          refresh_token: string;
          expiry: string;
          calendar_id: string | null;
          sync_token: string | null;
          watch_channel_id: string | null;
          watch_resource_id: string | null;
          watch_expiration: string | null;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["google_tokens"]["Row"]> & {
          profile_id: string;
          access_token: string;
          refresh_token: string;
          expiry: string;
        };
        Update: Partial<Database["public"]["Tables"]["google_tokens"]["Row"]>;
      };
    };
    Views: Record<string, never>;
    Functions: {
      is_member: { Args: Record<string, never>; Returns: boolean };
      is_parent: { Args: Record<string, never>; Returns: boolean };
      cycle_num: { Args: Record<string, never>; Returns: number };
      next_rotation_date: { Args: Record<string, never>; Returns: string | null };
      zone_assignee: { Args: { p_zone_id: string }; Returns: string | null };
      ensure_zone_tasks: { Args: Record<string, never>; Returns: void };
      rotate_now: { Args: Record<string, never>; Returns: void };
      set_zone_interval: { Args: { p_interval_days: number | null }; Returns: void };
      set_zone_assignee: { Args: { p_zone_id: string; p_member_id: string | null }; Returns: void };
      save_zone: { Args: { p_zone_id: string | null; p_name: string; p_subzones: string[] }; Returns: string };
      delete_zone: { Args: { p_zone_id: string }; Returns: void };
      create_task: {
        Args: {
          p_title: string;
          p_member_id: string;
          p_category: TaskCategory;
          p_subject_id: string | null;
          p_date: string;
          p_deadline: string | null;
          p_remind_minutes: number | null;
          p_subtasks: string[] | null;
        };
        Returns: string;
      };
      toggle_subtask: { Args: { p_subtask_id: string }; Returns: void };
      mark_task_done: { Args: { p_task_id: string }; Returns: void };
      verify_task: { Args: { p_task_id: string }; Returns: void };
      delete_task: { Args: { p_task_id: string }; Returns: void };
      move_task: { Args: { p_task_id: string }; Returns: void };
      roll_all_tasks: { Args: Record<string, never>; Returns: number };
      nudge_task: { Args: { p_task_id: string }; Returns: void };
      create_job: { Args: { p_title: string; p_amount: number }; Returns: string };
      take_job: { Args: { p_job_id: string }; Returns: string };
      job_done: { Args: { p_job_id: string }; Returns: void };
      pay_job: { Args: { p_job_id: string }; Returns: void };
      delete_job: { Args: { p_job_id: string }; Returns: void };
      set_member_settings: {
        Args: { p_member_id: string; p_google_sync: boolean | null; p_sharing: CalendarSharing | null };
        Returns: void;
      };
      mark_all_read: { Args: Record<string, never>; Returns: void };
      brief_line_for: { Args: { p_member_id: string }; Returns: string };
      send_daily_brief_all: { Args: Record<string, never>; Returns: void };
    };
    Enums: {
      family_role: FamilyRole;
      task_status: TaskStatus;
      task_category: TaskCategory;
      event_source: EventSource;
      job_status: JobStatus;
      notif_kind: NotifKind;
      calendar_sharing: CalendarSharing;
    };
  };
}
