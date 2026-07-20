-- Closes a pre-existing gap discovered while verifying the multi-tenant
-- migrations end-to-end against a real local Postgres/PostgREST stack:
-- none of the schema's tables (old or new) ever received explicit
-- GRANT SELECT/INSERT/UPDATE/DELETE TO authenticated. RLS policies control
-- *which rows* a role can see or touch, but Postgres still requires a
-- table-level GRANT before the role can attempt the operation at all — RLS
-- alone doesn't imply it. Without this, PostgREST requests from the actual
-- client SDK (`supabase.from("tasks").select()`, etc.) fail with
-- "permission denied for table tasks" regardless of how correct the RLS
-- policies are. This was invisible until now because every write already
-- goes through SECURITY DEFINER RPCs (which run as the function owner,
-- bypassing table grants entirely), and nothing had previously been
-- exercised against a live PostgREST connection (see README: "has not been
-- exercised in a browser against a real backend yet"). Predates this
-- migration set entirely — applies equally to tables from
-- 20260719000001_init_schema.sql.
--
-- google_tokens intentionally gets no grants here — it has zero RLS
-- policies by design (service-role only) and must stay completely
-- inaccessible to authenticated/anon.

-- Read-only-via-RLS tables — all writes go through SECURITY DEFINER RPCs,
-- which bypass table grants entirely as the function owner.
grant select on public.profiles to authenticated;
grant select on public.families to authenticated;
grant select on public.zones to authenticated;
grant select on public.zone_rotation to authenticated;
grant select on public.zone_dismissals to authenticated;
grant select on public.jobs to authenticated;
grant select on public.tasks to authenticated;
grant select on public.subtasks to authenticated;
grant select on public.notifications to authenticated;
grant select on public.family_invites to authenticated;

-- Direct client read/write tables — RLS policies already restrict which
-- rows/values are allowed; these grants just allow the attempt.
grant select, insert, update, delete on public.subjects to authenticated;
grant select, insert, update, delete on public.calendar_events to authenticated;
grant select, insert, update, delete on public.push_subscriptions to authenticated;
