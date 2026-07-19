import { createClient } from "@/lib/supabase/server";

export default async function TasksPage() {
  const supabase = await createClient();
  // RLS scopes this automatically: kids see only their own tasks, parents
  // see everyone's (see supabase/migrations for the policies).
  const { data: tasks } = await supabase
    .from("tasks")
    .select(
      "id, title, category, subject, status, due_at, owner_id, profiles(display_name, color)",
    )
    .order("due_at", { ascending: true, nullsFirst: false })
    .limit(50);

  return (
    <div>
      <h1 className="text-lg font-semibold">Tasks</h1>
      <p className="mt-1 text-sm text-gray-500">
        Assign → mark done → verify → delete. Subtasks and category filters are
        next up.
      </p>
      <ul className="mt-4 divide-y divide-gray-200">
        {tasks?.map((task) => (
          <li key={task.id} className="flex items-center gap-3 py-3">
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-full"
              style={{
                backgroundColor:
                  (task as { profiles?: { color?: string } }).profiles?.color ??
                  "#9ca3af",
              }}
              aria-hidden
            />
            <div className="flex-1">
              <p className="text-sm font-medium">{task.title}</p>
              <p className="text-xs text-gray-500">
                {task.category}
                {task.subject ? ` · ${task.subject}` : ""}
                {task.due_at
                  ? ` · due ${new Date(task.due_at).toLocaleString()}`
                  : ""}
              </p>
            </div>
            <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
              {task.status}
            </span>
          </li>
        ))}
        {!tasks?.length && (
          <li className="py-3 text-sm text-gray-500">
            No tasks yet — assigned tasks will show up here.
          </li>
        )}
      </ul>
    </div>
  );
}
