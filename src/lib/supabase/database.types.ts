// Hand-written to match supabase/migrations/20260719000001_init_schema.sql,
// 20260719130000_family_invites.sql, 20260720000001_multi_tenant_families.sql,
// and 20260720000002_family_invites_generalize.sql exactly (no live
// Supabase project to run `supabase gen types` against yet). Once a real
// project exists, regenerate with:
//   npx supabase gen types typescript --project-id <project-ref> > src/lib/supabase/database.types.ts
// and diff against this file before overwriting — some hand-tuned bits
// (function arg/return shapes) may need to be re-applied.
//
// Declared as a `type` (not `interface`) with an explicit `Relationships: []`
// on every table — @supabase/postgrest-js's GenericSchema constraint needs
// both to structurally match, or every query/rpc call silently degrades to
// `never`/`undefined` argument types instead of a visible error.

export type FamilyRole = "parent" | "kid";
export type FamilyMemberRole = "admin" | "member";
export type InviteStatus = "pending" | "accepted" | "revoked";
export type TaskStatus = "assigned" | "done" | "verified";
export type TaskCategory =
  "school" | "work" | "home" | "personal" | "goal" | "zone";
export type EventSource = "app" | "google";
export type JobStatus = "open" | "taken" | "done" | "paid";
export type NotifKind =
  "brief" | "deadline" | "nudge" | "update" | "sync" | "job";
export type CalendarSharing = "family" | "parents" | "private";
export type GoogleOutboxOperation = "create" | "update" | "delete";
export type GoogleOutboxStatus = "pending" | "done" | "error";

type FamiliesRow = {
  id: string;
  name: string;
  invite_code: string;
  created_by: string;
  created_at: string;
  updated_at: string;
};

type ProfilesRow = {
  id: string;
  display_name: string;
  role: FamilyRole;
  color: string;
  google_sync_enabled: boolean;
  calendar_sharing: CalendarSharing;
  family_id: string | null;
  family_member_role: FamilyMemberRole;
  created_at: string;
};

type SubjectsRow = {
  id: string;
  name: string;
  position: number;
  family_id: string;
  created_at: string;
};

type CalendarEventsRow = {
  id: string;
  member_id: string;
  title: string;
  date: string;
  start_time: string;
  end_time: string;
  all_day: boolean;
  location: string | null;
  notes: string | null;
  source: EventSource;
  google_calendar_id: string | null;
  google_event_id: string | null;
  created_by: string;
  family_id: string;
  created_at: string;
  updated_at: string;
};

type CalendarEventAttendeesRow = {
  event_id: string;
  member_id: string;
  family_id: string;
  created_at: string;
};

type ZonesRow = {
  id: string;
  name: string;
  subzones: string[];
  assigned_to: string | null;
  family_id: string;
  created_at: string;
};

type ZoneRotationRow = {
  family_id: string;
  start_date: string;
  interval_days: number | null;
  offset_cycles: number;
  member_order: string[];
};

type ZoneDismissalsRow = { zone_id: string; cycle: number; family_id: string };

type JobsRow = {
  id: string;
  title: string;
  amount: number;
  status: JobStatus;
  taken_by: string | null;
  task_id: string | null;
  family_id: string;
  created_at: string;
};

type TasksRow = {
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
  family_id: string;
  created_at: string;
  updated_at: string;
};

type SubtasksRow = {
  id: string;
  task_id: string;
  title: string;
  done: boolean;
  position: number;
  family_id: string;
};

type NotificationsRow = {
  id: string;
  to_profile_id: string;
  kind: NotifKind;
  text: string;
  dedupe_key: string | null;
  read: boolean;
  family_id: string;
  created_at: string;
};

type PushSubscriptionsRow = {
  id: string;
  profile_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  family_id: string;
  created_at: string;
};

type Rel<
  Cols extends string[],
  Ref extends string,
  RefCols extends string[],
> = {
  foreignKeyName: string;
  columns: Cols;
  isOneToOne: boolean;
  referencedRelation: Ref;
  referencedColumns: RefCols;
};

type FamilyInvitesRow = {
  id: string;
  email: string;
  display_name: string;
  role: FamilyRole;
  color: string;
  invited_by: string;
  family_id: string;
  status: InviteStatus;
  accepted_at: string | null;
  created_at: string;
};

type GoogleTokensRow = {
  profile_id: string;
  access_token: string;
  refresh_token: string;
  expiry: string;
  scope: string | null;
  family_id: string;
  updated_at: string;
};

type GoogleCalendarSubscriptionsRow = {
  id: string;
  profile_id: string;
  family_id: string;
  google_calendar_id: string;
  calendar_name: string;
  enabled: boolean;
  is_export_target: boolean;
  sync_token: string | null;
  created_at: string;
  updated_at: string;
};

type GoogleCalendarOutboxRow = {
  id: string;
  family_id: string;
  profile_id: string;
  calendar_event_id: string | null;
  google_calendar_id: string;
  google_event_id: string | null;
  operation: GoogleOutboxOperation;
  title: string;
  date: string;
  start_time: string;
  end_time: string;
  status: GoogleOutboxStatus;
  error_message: string | null;
  created_at: string;
  processed_at: string | null;
};

export type Database = {
  public: {
    Tables: {
      families: {
        Row: FamiliesRow;
        Insert: Partial<FamiliesRow> & {
          name: string;
          invite_code: string;
          created_by: string;
        };
        Update: Partial<FamiliesRow>;
        Relationships: [Rel<["created_by"], "profiles", ["id"]>];
      };
      profiles: {
        Row: ProfilesRow;
        Insert: Partial<ProfilesRow> & {
          id: string;
          display_name: string;
          role: FamilyRole;
          color: string;
        };
        Update: Partial<ProfilesRow>;
        Relationships: [Rel<["family_id"], "families", ["id"]>];
      };
      subjects: {
        Row: SubjectsRow;
        Insert: Partial<SubjectsRow> & { name: string };
        Update: Partial<SubjectsRow>;
        Relationships: [Rel<["family_id"], "families", ["id"]>];
      };
      calendar_events: {
        Row: CalendarEventsRow;
        Insert: Partial<CalendarEventsRow> & {
          member_id: string;
          title: string;
          date: string;
          start_time: string;
          end_time: string;
          created_by: string;
        };
        Update: Partial<CalendarEventsRow>;
        Relationships: [
          Rel<["member_id"], "profiles", ["id"]>,
          Rel<["created_by"], "profiles", ["id"]>,
          Rel<["family_id"], "families", ["id"]>,
        ];
      };
      calendar_event_attendees: {
        Row: CalendarEventAttendeesRow;
        Insert: Partial<CalendarEventAttendeesRow> & {
          event_id: string;
          member_id: string;
        };
        Update: Partial<CalendarEventAttendeesRow>;
        Relationships: [
          Rel<["event_id"], "calendar_events", ["id"]>,
          Rel<["member_id"], "profiles", ["id"]>,
          Rel<["family_id"], "families", ["id"]>,
        ];
      };
      zones: {
        Row: ZonesRow;
        Insert: Partial<ZonesRow> & { name: string };
        Update: Partial<ZonesRow>;
        Relationships: [
          Rel<["assigned_to"], "profiles", ["id"]>,
          Rel<["family_id"], "families", ["id"]>,
        ];
      };
      zone_rotation: {
        Row: ZoneRotationRow;
        Insert: Partial<ZoneRotationRow> & {
          family_id: string;
          start_date: string;
        };
        Update: Partial<ZoneRotationRow>;
        Relationships: [Rel<["family_id"], "families", ["id"]>];
      };
      zone_dismissals: {
        Row: ZoneDismissalsRow;
        Insert: ZoneDismissalsRow;
        Update: Partial<ZoneDismissalsRow>;
        Relationships: [
          Rel<["zone_id"], "zones", ["id"]>,
          Rel<["family_id"], "families", ["id"]>,
        ];
      };
      jobs: {
        Row: JobsRow;
        Insert: Partial<JobsRow> & { title: string; amount: number };
        Update: Partial<JobsRow>;
        Relationships: [
          Rel<["taken_by"], "profiles", ["id"]>,
          Rel<["task_id"], "tasks", ["id"]>,
          Rel<["family_id"], "families", ["id"]>,
        ];
      };
      tasks: {
        Row: TasksRow;
        Insert: Partial<TasksRow> & {
          title: string;
          member_id: string;
          category: TaskCategory;
          date: string;
          created_by: string;
        };
        Update: Partial<TasksRow>;
        Relationships: [
          Rel<["member_id"], "profiles", ["id"]>,
          Rel<["created_by"], "profiles", ["id"]>,
          Rel<["subject_id"], "subjects", ["id"]>,
          Rel<["zone_id"], "zones", ["id"]>,
          Rel<["job_id"], "jobs", ["id"]>,
          Rel<["family_id"], "families", ["id"]>,
        ];
      };
      subtasks: {
        Row: SubtasksRow;
        Insert: Partial<SubtasksRow> & { task_id: string; title: string };
        Update: Partial<SubtasksRow>;
        Relationships: [
          Rel<["task_id"], "tasks", ["id"]>,
          Rel<["family_id"], "families", ["id"]>,
        ];
      };
      notifications: {
        Row: NotificationsRow;
        Insert: Partial<NotificationsRow> & {
          to_profile_id: string;
          kind: NotifKind;
          text: string;
        };
        Update: Partial<NotificationsRow>;
        Relationships: [
          Rel<["to_profile_id"], "profiles", ["id"]>,
          Rel<["family_id"], "families", ["id"]>,
        ];
      };
      push_subscriptions: {
        Row: PushSubscriptionsRow;
        Insert: Partial<PushSubscriptionsRow> & {
          profile_id: string;
          endpoint: string;
          p256dh: string;
          auth: string;
        };
        Update: Partial<PushSubscriptionsRow>;
        Relationships: [
          Rel<["profile_id"], "profiles", ["id"]>,
          Rel<["family_id"], "families", ["id"]>,
        ];
      };
      google_tokens: {
        Row: GoogleTokensRow;
        Insert: Partial<GoogleTokensRow> & {
          profile_id: string;
          access_token: string;
          refresh_token: string;
          expiry: string;
        };
        Update: Partial<GoogleTokensRow>;
        Relationships: [
          Rel<["profile_id"], "profiles", ["id"]>,
          Rel<["family_id"], "families", ["id"]>,
        ];
      };
      google_calendar_subscriptions: {
        Row: GoogleCalendarSubscriptionsRow;
        Insert: Partial<GoogleCalendarSubscriptionsRow> & {
          profile_id: string;
          family_id: string;
          google_calendar_id: string;
          calendar_name: string;
        };
        Update: Partial<GoogleCalendarSubscriptionsRow>;
        Relationships: [
          Rel<["profile_id"], "profiles", ["id"]>,
          Rel<["family_id"], "families", ["id"]>,
        ];
      };
      google_calendar_outbox: {
        Row: GoogleCalendarOutboxRow;
        Insert: Partial<GoogleCalendarOutboxRow> & {
          family_id: string;
          profile_id: string;
          google_calendar_id: string;
          operation: GoogleOutboxOperation;
          title: string;
          date: string;
          start_time: string;
          end_time: string;
        };
        Update: Partial<GoogleCalendarOutboxRow>;
        Relationships: [
          Rel<["profile_id"], "profiles", ["id"]>,
          Rel<["family_id"], "families", ["id"]>,
        ];
      };
      family_invites: {
        Row: FamilyInvitesRow;
        Insert: Partial<FamilyInvitesRow> & {
          email: string;
          display_name: string;
          role: FamilyRole;
          color: string;
          invited_by: string;
        };
        Update: Partial<FamilyInvitesRow>;
        Relationships: [
          Rel<["invited_by"], "profiles", ["id"]>,
          Rel<["family_id"], "families", ["id"]>,
        ];
      };
    };
    Views: Record<string, never>;
    Functions: {
      is_member: { Args: Record<string, never>; Returns: boolean };
      is_parent: { Args: Record<string, never>; Returns: boolean };
      current_family_id: {
        Args: Record<string, never>;
        Returns: string | null;
      };
      is_family_admin: { Args: Record<string, never>; Returns: boolean };
      create_family: { Args: { p_name: string }; Returns: FamiliesRow };
      join_family_by_code: { Args: { p_code: string }; Returns: ProfilesRow };
      regenerate_invite_code: { Args: Record<string, never>; Returns: string };
      set_member_role: {
        Args: { p_member_id: string; p_role: FamilyRole };
        Returns: void;
      };
      cycle_num: { Args: Record<string, never>; Returns: number };
      next_rotation_date: {
        Args: Record<string, never>;
        Returns: string | null;
      };
      zone_assignee: { Args: { p_zone_id: string }; Returns: string | null };
      zones_with_assignee: {
        Args: Record<string, never>;
        Returns: {
          id: string;
          name: string;
          subzones: string[];
          assigned_to: string | null;
          assignee_id: string | null;
        }[];
      };
      ensure_zone_tasks: { Args: Record<string, never>; Returns: void };
      rotate_now: { Args: Record<string, never>; Returns: void };
      set_zone_interval: {
        Args: { p_interval_days: number | null };
        Returns: void;
      };
      set_zone_assignee: {
        Args: { p_zone_id: string; p_member_id: string | null };
        Returns: void;
      };
      save_zone: {
        Args: {
          p_zone_id: string | null;
          p_name: string;
          p_subzones: string[];
        };
        Returns: string;
      };
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
      update_task: {
        Args: {
          p_task_id: string;
          p_title: string;
          p_member_id: string;
          p_category: TaskCategory;
          p_subject_id: string | null;
          p_date: string;
          p_deadline: string | null;
          p_remind_minutes: number | null;
        };
        Returns: void;
      };
      toggle_subtask: { Args: { p_subtask_id: string }; Returns: void };
      mark_task_done: { Args: { p_task_id: string }; Returns: void };
      verify_task: { Args: { p_task_id: string }; Returns: void };
      delete_task: { Args: { p_task_id: string }; Returns: void };
      move_task: { Args: { p_task_id: string }; Returns: void };
      roll_all_tasks: { Args: Record<string, never>; Returns: number };
      nudge_task: { Args: { p_task_id: string }; Returns: void };
      create_job: {
        Args: { p_title: string; p_amount: number };
        Returns: string;
      };
      take_job: { Args: { p_job_id: string }; Returns: string };
      job_done: { Args: { p_job_id: string }; Returns: void };
      pay_job: { Args: { p_job_id: string }; Returns: void };
      delete_job: { Args: { p_job_id: string }; Returns: void };
      set_member_settings: {
        Args: {
          p_member_id: string;
          p_google_sync: boolean | null;
          p_sharing: CalendarSharing | null;
        };
        Returns: void;
      };
      mark_all_read: { Args: Record<string, never>; Returns: void };
      brief_line_for: { Args: { p_member_id: string }; Returns: string };
      send_daily_brief_all: { Args: Record<string, never>; Returns: void };
      create_family_invite: {
        Args: {
          p_email: string;
          p_display_name: string;
          p_role: FamilyRole;
          p_color: string;
        };
        Returns: string;
      };
      cancel_family_invite: { Args: { p_invite_id: string }; Returns: void };
      accept_family_invite: {
        Args: Record<string, never>;
        Returns: ProfilesRow;
      };
      sync_upsert_imported_event: {
        Args: {
          p_family_id: string;
          p_member_id: string;
          p_google_calendar_id: string;
          p_google_event_id: string;
          p_title: string;
          p_date: string;
          p_start_time: string;
          p_end_time: string;
        };
        Returns: string;
      };
      sync_delete_imported_event: {
        Args: { p_google_calendar_id: string; p_google_event_id: string };
        Returns: void;
      };
      sync_link_calendar_event: {
        Args: {
          p_calendar_event_id: string;
          p_google_calendar_id: string;
          p_google_event_id: string;
        };
        Returns: void;
      };
    };
    Enums: {
      family_role: FamilyRole;
      family_member_role: FamilyMemberRole;
      invite_status: InviteStatus;
      task_status: TaskStatus;
      task_category: TaskCategory;
      event_source: EventSource;
      job_status: JobStatus;
      notif_kind: NotifKind;
      calendar_sharing: CalendarSharing;
      google_outbox_operation: GoogleOutboxOperation;
      google_outbox_status: GoogleOutboxStatus;
    };
  };
};
