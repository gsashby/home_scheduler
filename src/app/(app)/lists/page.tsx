import { createClient } from "@/lib/supabase/server";

export default async function ListsPage() {
  const supabase = await createClient();
  const { data: lists } = await supabase
    .from("lists")
    .select("id, title, list_items(id, content, done)")
    .order("created_at", { ascending: false });

  return (
    <div>
      <h1 className="text-lg font-semibold">My lists</h1>
      <p className="mt-1 text-sm text-gray-500">
        Personal, self-managed lists — only you can see these.
      </p>
      <div className="mt-4 space-y-4">
        {lists?.map((list) => (
          <div key={list.id}>
            <h2 className="text-sm font-medium">{list.title}</h2>
            <ul className="mt-1 space-y-1">
              {list.list_items?.map(
                (item: { id: string; content: string; done: boolean }) => (
                  <li key={item.id} className="text-sm text-gray-600">
                    {item.done ? "☑" : "☐"} {item.content}
                  </li>
                ),
              )}
            </ul>
          </div>
        ))}
        {!lists?.length && (
          <p className="text-sm text-gray-500">
            No lists yet — create your own to-do lists here.
          </p>
        )}
      </div>
    </div>
  );
}
