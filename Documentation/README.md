# Home Scheduler — Documentation

Internal reference docs for the Home Scheduler codebase (a multi-tenant
family calendar / task / chore-zone / paid-job-board PWA built on Next.js +
Supabase). These docs describe **how the system works today**, based on a
read of the code — they're a companion to the top-level [`README.md`](../README.md),
which focuses on first-time setup instructions.

The project is under active development; treat anything marked
**in progress** in [`07-project-status.md`](./07-project-status.md) as
subject to change.

## Contents

| Doc                                                            | Covers                                                                                              |
| -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| [01-architecture.md](./01-architecture.md)                     | Stack, core design principles, request flow, multi-tenancy model                                    |
| [02-database-schema.md](./02-database-schema.md)               | Every table, enum, RLS policy, and RPC function, grouped by feature                                 |
| [03-frontend.md](./03-frontend.md)                             | Route map, layout/auth guard, contexts, shared UI components, realtime patterns                     |
| [04-auth-and-onboarding.md](./04-auth-and-onboarding.md)       | Sign up/login, the family create-or-join flow, email invites                                        |
| [05-notifications-and-push.md](./05-notifications-and-push.md) | Notification kinds, cron jobs, Web Push delivery, Edge Functions                                    |
| [06-setup-guide.md](./06-setup-guide.md)                       | Environment variables, local dev, Supabase project setup, deployment                                |
| [07-project-status.md](./07-project-status.md)                 | What's built, what's in progress, known gaps                                                        |
| [08-backups-and-recovery.md](./08-backups-and-recovery.md)     | What's/isn't backed up, the manual data-backup script, secrets checklist, disaster recovery runbook |

## Quick orientation

- **Business logic lives in Postgres**, not the API layer. Every state
  change (marking a task done, rotating a chore zone, taking a paid job) is
  a `SECURITY DEFINER` RPC function in a migration under
  `supabase/migrations/`, not a Next.js API route. See
  [02-database-schema.md](./02-database-schema.md).
- **The app is multi-tenant.** Every family's data is isolated by
  `family_id`, enforced in Postgres RLS policies and re-derived
  server-side in every RPC — never trusted from the client. See
  [01-architecture.md](./01-architecture.md).
- **The reference spec** for exact UI/behavior is
  [`home-scheduler-prototype.html`](../home-scheduler-prototype.html) at
  the project root — a standalone, fully-interactive HTML mockup. This app
  reimplements it with real auth, a real database, and real push
  notifications.
