"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useFamily } from "@/lib/family-context";
import { useToast } from "@/lib/toast";
import { fmtTime, relDay, todayISO } from "@/lib/date";
import { categoryLabel, TOP_CATEGORIES } from "@/lib/categories";
import {
  Button,
  Card,
  Chip,
  Empty,
  StatusBadge,
  Swatch,
  Tag,
} from "@/components/ui";
import { Field, Modal, Select, TextArea, TextInput } from "@/components/modal";
import { downloadFile, toCSV } from "@/lib/export";
import type { Database, TaskCategory } from "@/lib/supabase/database.types";

type Task = Database["public"]["Tables"]["tasks"]["Row"] & {
  subtasks: Database["public"]["Tables"]["subtasks"]["Row"][];
};
type Subject = Database["public"]["Tables"]["subjects"]["Row"];

export default function TasksPage() {
  const { me, isParent, members, memberById } = useFamily();
  const toast = useToast();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [filter, setFilter] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    const supabase = createClient();
    const [tasksRes, subjectsRes] = await Promise.all([
      supabase.from("tasks").select("*, subtasks(*)").order("date"),
      supabase.from("subjects").select("*").order("position"),
    ]);
    setTasks((tasksRes.data as Task[]) ?? []);
    setSubjects(subjectsRes.data ?? []);
    setLoading(false);
  }

  useEffect(() => {
    load();
    const supabase = createClient();
    const channel = supabase
      .channel("tasks-changes")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "tasks" },
        load,
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "subtasks" },
        load,
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  // Generic dispatcher for the task-mutation RPCs below — each has a
  // different Args shape, so the precise per-function typing is bypassed
  // here deliberately; call sites pass the right args for the function name.
  async function call(
    fn: keyof Database["public"]["Functions"],
    args: Record<string, unknown>,
    successMsg?: string,
  ) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await createClient().rpc(fn as any, args as any);
    if (error) {
      toast(error.message);
      return false;
    }
    if (successMsg) toast(successMsg);
    return true;
  }

  if (loading) return null;

  const visible = filter ? tasks.filter((t) => t.member_id === filter) : tasks;
  const active = visible.filter((t) => t.status !== "verified");
  const done = visible.filter((t) => t.status === "verified");
  const overdueCount = active.filter(
    (t) => t.date < todayISO() && t.status === "assigned",
  ).length;

  function exportCSV() {
    const csv = toCSV(visible, [
      { header: "Title", value: (t) => t.title },
      {
        header: "Assigned to",
        value: (t) => memberById(t.member_id)?.display_name ?? "",
      },
      {
        header: "Category",
        value: (t) =>
          categoryLabel(
            t.category,
            subjects.find((s) => s.id === t.subject_id)?.name ?? null,
          ),
      },
      { header: "Date", value: (t) => t.date },
      { header: "Deadline", value: (t) => fmtTime(t.deadline) },
      { header: "Status", value: (t) => t.status },
      { header: "Created", value: (t) => t.created_at },
    ]);
    downloadFile("tasks.csv", csv, "text/csv;charset=utf-8");
  }

  return (
    <div>
      <Card>
        <h2 className="mb-2.5 flex flex-wrap items-center gap-2 text-[15px] font-semibold">
          {isParent ? "All family tasks" : "My tasks"}
          <span className="text-xs font-normal text-gray-600">
            {isParent
              ? "parents see and manage everything"
              : "you only see tasks assigned to you"}
          </span>
        </h2>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={() => setModalOpen(true)}>
            + {isParent ? "Assign task" : "Add my own item"}
          </Button>
          <Button size="sm" variant="secondary" onClick={exportCSV}>
            Export CSV
          </Button>
          {isParent && overdueCount > 0 && (
            <Button
              size="sm"
              variant="warn"
              onClick={async () => {
                const { data } = await createClient().rpc("roll_all_tasks");
                toast(`${data ?? 0} incomplete task(s) rolled to today`);
                load();
              }}
            >
              ↻ Roll {overdueCount} incomplete to today
            </Button>
          )}
        </div>

        {isParent && (
          <div className="mb-3 flex flex-wrap gap-2">
            <Chip active={!filter} onClick={() => setFilter(null)}>
              Everyone
            </Chip>
            {members.map((m) => (
              <Chip
                key={m.id}
                active={filter === m.id}
                color={m.color}
                onClick={() => setFilter(m.id)}
              >
                {m.display_name}
              </Chip>
            ))}
          </div>
        )}

        {(() => {
          const groups = TOP_CATEGORIES.map((g) => ({
            ...g,
            list: active.filter((t) => g.match(t.category)),
          })).filter((g) => g.list.length > 0);

          if (groups.length === 0) {
            return (
              <Empty>
                {isParent
                  ? "No open tasks."
                  : "No tasks — enjoy it while it lasts 😄"}
              </Empty>
            );
          }

          return groups.map((g) => (
            <div key={g.label}>
              <h2 className="mt-3.5 text-[15px] font-semibold">
                {g.icon} {g.label}{" "}
                <span className="text-xs font-normal text-gray-600">
                  {g.list.length}
                </span>
              </h2>
              {g.list.map((t) => (
                <TaskCard
                  key={t.id}
                  task={t}
                  subjects={subjects}
                  meId={me.id}
                  isParent={isParent}
                  owner={memberById(t.member_id)}
                  call={call}
                  reload={load}
                  onEdit={() => setEditingTask(t)}
                />
              ))}
            </div>
          ));
        })()}
      </Card>

      {isParent && done.length > 0 && (
        <Card>
          <h2 className="mb-2.5 text-[15px] font-semibold">
            ✅ Verified{" "}
            <span className="text-xs font-normal text-gray-600">
              delete to clear them out
            </span>
          </h2>
          {done.map((t) => (
            <TaskCard
              key={t.id}
              task={t}
              subjects={subjects}
              meId={me.id}
              isParent={isParent}
              owner={memberById(t.member_id)}
              call={call}
              reload={load}
            />
          ))}
        </Card>
      )}

      <TaskModal
        open={modalOpen || !!editingTask}
        onClose={() => {
          setModalOpen(false);
          setEditingTask(null);
        }}
        isParent={isParent}
        me={me}
        members={members}
        subjects={subjects}
        editingTask={editingTask}
        onSaved={(assignedToSelf, memberName) => {
          toast(
            editingTask
              ? "Task updated"
              : assignedToSelf
                ? "Added to your list"
                : `Task assigned to ${memberName}`,
          );
          load();
        }}
      />
    </div>
  );
}

function TaskCard({
  task,
  subjects,
  meId,
  isParent,
  owner,
  call,
  reload,
  onEdit,
}: {
  task: Task;
  subjects: Subject[];
  meId: string;
  isParent: boolean;
  owner: { display_name: string; color: string } | undefined;
  call: (
    fn: keyof Database["public"]["Functions"],
    args: Record<string, unknown>,
    msg?: string,
  ) => Promise<boolean>;
  reload: () => void;
  onEdit?: () => void;
}) {
  const mine = task.member_id === meId;
  const overdue = task.date < todayISO() && task.status === "assigned";
  const subjectName = task.subject_id
    ? (subjects.find((s) => s.id === task.subject_id)?.name ?? null)
    : null;
  const color = owner?.color ?? "#9ca3af";

  const canSelfManage = mine && task.created_by === meId && !task.zone_id;

  return (
    <div
      className="mb-2.5 rounded-lg border border-gray-200 bg-white p-3"
      style={{ borderLeftWidth: 5, borderLeftColor: color }}
    >
      <div className="flex items-start gap-2">
        <div className="flex-1">
          <div className="flex flex-wrap items-center gap-2 text-[14.5px] font-bold">
            {task.title} <StatusBadge status={task.status} />
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-gray-600">
            <span className="flex items-center gap-1.5 font-semibold">
              <Swatch color={color} />
              {owner?.display_name}
            </span>
            <Tag>{categoryLabel(task.category, subjectName)}</Tag>
            {task.job_id && <Tag tone="green">💵 paid job</Tag>}
            <span>
              {relDay(task.date)}
              {task.deadline ? ` · due ${task.deadline.slice(0, 5)}` : ""}
            </span>
            {overdue && <span className="font-bold text-red-600">overdue</span>}
            {task.zone_id ? (
              <span className="text-gray-600">🧹 zone rotation</span>
            ) : task.created_by !== task.member_id ? (
              <span className="text-gray-600">assigned by parent</span>
            ) : (
              <span className="text-gray-600">self-added</span>
            )}
          </div>
        </div>
      </div>

      {task.subtasks.length > 0 && (
        <div className="mt-2">
          {[...task.subtasks]
            .sort((a, b) => a.position - b.position)
            .map((s) => {
              const nested = /^-\s+/.test(s.title);
              const title = nested ? s.title.replace(/^-\s+/, "") : s.title;
              return (
                <label
                  key={s.id}
                  className={`flex items-center gap-2 py-1 text-[13.5px] ${nested ? "pl-6" : "pl-1"}`}
                >
                  <input
                    type="checkbox"
                    checked={s.done}
                    disabled={!(mine || isParent)}
                    onChange={() =>
                      call("toggle_subtask", { p_subtask_id: s.id }).then(
                        reload,
                      )
                    }
                    className="h-4 w-4 accent-green-600"
                  />
                  <span className={s.done ? "text-gray-600 line-through" : ""}>
                    {title}
                  </span>
                </label>
              );
            })}
        </div>
      )}

      <div className="mt-2.5 flex flex-wrap gap-1.5">
        {mine && task.status === "assigned" && (
          <Button
            size="sm"
            variant="ok"
            onClick={() =>
              call(
                "mark_task_done",
                { p_task_id: task.id },
                "Nice! Sent to your parents to verify.",
              )
            }
          >
            ✓ Mark done
          </Button>
        )}
        {mine && task.status === "done" && (
          <span className="self-center text-sm text-gray-600">
            Waiting for parent to verify…
          </span>
        )}
        {isParent && (
          <>
            {task.status === "done" && (
              <Button
                size="sm"
                variant="ok"
                onClick={() =>
                  call("verify_task", { p_task_id: task.id }, "Verified")
                }
              >
                ✓ Verify
              </Button>
            )}
            {task.status !== "verified" && onEdit && (
              <Button size="sm" variant="secondary" onClick={onEdit}>
                ✎ Edit
              </Button>
            )}
            {task.status === "assigned" && (
              <Button
                size="sm"
                variant="warn"
                onClick={() =>
                  call(
                    "nudge_task",
                    { p_task_id: task.id },
                    `Nudge sent to ${owner?.display_name}`,
                  )
                }
              >
                📣 Nudge {owner?.display_name}
              </Button>
            )}
            {task.status !== "verified" && (
              <Button
                size="sm"
                variant="secondary"
                onClick={() =>
                  call("move_task", { p_task_id: task.id }).then(reload)
                }
              >
                → Move to tomorrow
              </Button>
            )}
            <Button
              size="sm"
              variant="danger"
              onClick={() =>
                call("delete_task", { p_task_id: task.id }, "Task deleted")
              }
            >
              Delete
            </Button>
          </>
        )}
        {!isParent && canSelfManage && (
          <>
            {onEdit && (
              <Button size="sm" variant="secondary" onClick={onEdit}>
                ✎ Edit
              </Button>
            )}
            <Button
              size="sm"
              variant="secondary"
              onClick={() =>
                call("move_task", { p_task_id: task.id }).then(reload)
              }
            >
              → Move to tomorrow
            </Button>
            <Button
              size="sm"
              variant="danger"
              onClick={() =>
                call("delete_task", { p_task_id: task.id }, "Task deleted")
              }
            >
              Delete
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

function TaskModal({
  open,
  onClose,
  isParent,
  me,
  members,
  subjects,
  editingTask,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  isParent: boolean;
  me: { id: string; display_name: string };
  members: { id: string; display_name: string }[];
  subjects: Subject[];
  editingTask?: Task | null;
  onSaved: (assignedToSelf: boolean, memberName: string) => void;
}) {
  const [title, setTitle] = useState("");
  const [ownerId, setOwnerId] = useState(me.id);
  const [catValue, setCatValue] = useState("cat:personal");
  const [date, setDate] = useState(todayISO());
  const [deadline, setDeadline] = useState("");
  const [remind, setRemind] = useState("60");
  const [subtasksText, setSubtasksText] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      if (editingTask) {
        setTitle(editingTask.title);
        setOwnerId(editingTask.member_id);
        setCatValue(
          editingTask.category === "school"
            ? `school:${editingTask.subject_id}`
            : `cat:${editingTask.category}`,
        );
        setDate(editingTask.date);
        setDeadline(editingTask.deadline?.slice(0, 5) ?? "");
        setRemind(String(editingTask.remind_minutes));
        setSubtasksText(
          [...editingTask.subtasks]
            .sort((a, b) => a.position - b.position)
            .map((s) => s.title)
            .join("\n"),
        );
      } else {
        setTitle("");
        setOwnerId(me.id);
        setCatValue("cat:personal");
        setDate(todayISO());
        setDeadline("");
        setRemind("60");
        setSubtasksText("");
      }
    }
  }, [open, me.id, editingTask]);

  async function save() {
    if (!title.trim()) return;
    setSaving(true);
    const memberId = isParent ? ownerId : me.id;
    const [kind, value] = catValue.split(":");
    const category: TaskCategory =
      kind === "school" ? "school" : (value as TaskCategory);
    const subjectId = kind === "school" ? value : null;
    const subtasks = subtasksText
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);

    if (editingTask) {
      const { error } = await createClient().rpc("update_task", {
        p_task_id: editingTask.id,
        p_title: title.trim(),
        p_member_id: memberId,
        p_category: category,
        p_subject_id: subjectId,
        p_date: date,
        p_deadline: deadline || null,
        p_remind_minutes: Number(remind),
        p_subtasks: subtasks,
      });
      setSaving(false);
      if (error) return;
      onClose();
      onSaved(
        memberId === me.id,
        members.find((m) => m.id === memberId)?.display_name ?? "",
      );
      return;
    }

    const { error } = await createClient().rpc("create_task", {
      p_title: title.trim(),
      p_member_id: memberId,
      p_category: category,
      p_subject_id: subjectId,
      p_date: date,
      p_deadline: deadline || null,
      p_remind_minutes: Number(remind),
      p_subtasks: subtasks,
    });
    setSaving(false);
    if (error) return;
    onClose();
    onSaved(
      memberId === me.id,
      members.find((m) => m.id === memberId)?.display_name ?? "",
    );
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={
        editingTask ? "Edit task" : isParent ? "Assign a task" : "Add my own item"
      }
    >
      <Field label="Title">
        <TextInput
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g., Math, Clean your room, Work schedule"
        />
      </Field>
      <div className="grid grid-cols-2 gap-2.5">
        <Field label={isParent ? "Assign to" : "Owner"}>
          {isParent ? (
            <Select
              value={ownerId}
              onChange={(e) => setOwnerId(e.target.value)}
            >
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.display_name}
                </option>
              ))}
            </Select>
          ) : (
            <Select disabled value={me.id}>
              <option value={me.id}>{me.display_name} (you)</option>
            </Select>
          )}
        </Field>
        <Field label="Category">
          <Select
            value={catValue}
            onChange={(e) => setCatValue(e.target.value)}
          >
            {subjects.map((s) => (
              <option key={s.id} value={`school:${s.id}`}>
                School · {s.name}
              </option>
            ))}
            <option value="cat:work">Work</option>
            <option value="cat:home">Home</option>
            <option value="cat:personal">Personal</option>
            <option value="cat:goal">Goal</option>
            <option value="cat:zone">Zone / Chore</option>
          </Select>
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-2.5">
        <Field label="Date">
          <TextInput
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </Field>
        <Field label="Deadline (optional)">
          <TextInput
            type="time"
            value={deadline}
            onChange={(e) => setDeadline(e.target.value)}
          />
        </Field>
      </div>
      <Field label="Remind before deadline">
        <Select value={remind} onChange={(e) => setRemind(e.target.value)}>
          <option value="0">No reminder</option>
          <option value="30">30 minutes</option>
          <option value="60">1 hour</option>
          <option value="120">2 hours</option>
        </Select>
      </Field>
      <Field label="Subtasks (one per line; start a line with - to nest it under the one above)">
        <TextArea
          rows={3}
          value={subtasksText}
          onChange={(e) => setSubtasksText(e.target.value)}
          placeholder={"Do 5.1\n- part a\n- part b\nDo 5.2"}
        />
      </Field>
      <div className="mt-1.5 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={save} disabled={saving}>
          {editingTask ? "Save" : isParent ? "Assign" : "Add"}
        </Button>
      </div>
    </Modal>
  );
}
