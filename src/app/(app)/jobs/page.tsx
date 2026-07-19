"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useFamily } from "@/lib/family-context";
import { useToast } from "@/lib/toast";
import { Button, Card, Empty } from "@/components/ui";
import { Field, Modal, TextInput } from "@/components/modal";
import type { Database, JobStatus } from "@/lib/supabase/database.types";

type Job = Database["public"]["Tables"]["jobs"]["Row"];

const STATUS_LABELS: Record<JobStatus, string> = {
  open: "Open",
  taken: "In progress",
  done: "Done — awaiting payment",
  paid: "Paid",
};

export default function JobsPage() {
  const { me, isParent, memberById } = useFamily();
  const toast = useToast();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [loading, setLoading] = useState(true);

  async function load() {
    const { data } = await createClient()
      .from("jobs")
      .select("*")
      .order("created_at", { ascending: false });
    setJobs(data ?? []);
    setLoading(false);
  }

  useEffect(() => {
    load();
    const supabase = createClient();
    const channel = supabase
      .channel("jobs-changes")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "jobs" },
        load,
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  async function act(fn: string, jobId: string, msg?: string) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await createClient().rpc(fn as any, { p_job_id: jobId });
    if (error) {
      toast(error.message);
      return;
    }
    if (msg) toast(msg);
    load();
  }

  if (loading) return null;

  return (
    <Card>
      <h2 className="mb-2.5 flex flex-wrap items-center gap-2 text-[15px] font-semibold">
        💵 Work-for-hire board
        <span className="text-xs font-normal text-gray-600">
          paid jobs anyone can take to earn money
        </span>
      </h2>
      {isParent && (
        <div className="mb-3">
          <Button size="sm" onClick={() => setModalOpen(true)}>
            + Post a job
          </Button>
        </div>
      )}

      {jobs.length === 0 ? (
        <Empty>No jobs posted.</Empty>
      ) : (
        jobs.map((j) => {
          const taker = j.taken_by ? memberById(j.taken_by) : undefined;
          return (
            <div
              key={j.id}
              className="mb-2.5 flex flex-wrap items-center gap-2.5 rounded-lg border border-gray-200 bg-white p-3"
            >
              <div className="min-w-[140px] flex-1 font-bold">
                {j.title}
                <div className="text-sm font-normal text-gray-600">
                  {STATUS_LABELS[j.status]}
                  {taker ? ` · ${taker.display_name}` : ""}
                </div>
              </div>
              <div className="text-base font-extrabold text-green-600">
                ${j.amount}
              </div>
              <div className="flex gap-1.5">
                {j.status === "open" && !isParent && (
                  <Button size="sm" onClick={() => act("take_job", j.id)}>
                    I&rsquo;ll take it
                  </Button>
                )}
                {j.status === "taken" && j.taken_by === me.id && (
                  <Button
                    size="sm"
                    variant="ok"
                    onClick={() => act("job_done", j.id)}
                  >
                    ✓ Mark done
                  </Button>
                )}
                {j.status === "done" && isParent && (
                  <Button
                    size="sm"
                    variant="ok"
                    onClick={() =>
                      act(
                        "pay_job",
                        j.id,
                        `Paid ${taker?.display_name} $${j.amount}`,
                      )
                    }
                  >
                    💰 Verify & pay
                  </Button>
                )}
                {isParent && (
                  <Button
                    size="sm"
                    variant="danger"
                    onClick={() => act("delete_job", j.id)}
                  >
                    Remove
                  </Button>
                )}
              </div>
            </div>
          );
        })
      )}

      <JobModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSaved={() => {
          toast("Job posted — kids notified");
          load();
        }}
      />
    </Card>
  );
}

function JobModal({
  open,
  onClose,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState("");
  const [amount, setAmount] = useState("10");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setTitle("");
      setAmount("10");
    }
  }, [open]);

  async function save() {
    if (!title.trim()) return;
    setSaving(true);
    const { error } = await createClient().rpc("create_job", {
      p_title: title.trim(),
      p_amount: Number(amount) || 5,
    });
    setSaving(false);
    if (error) return;
    onClose();
    onSaved();
  }

  return (
    <Modal open={open} onClose={onClose} title="Post a paid job">
      <Field label="Job">
        <TextInput
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g., Mow the lawn"
        />
      </Field>
      <Field label="Pays ($)">
        <TextInput
          type="number"
          min={1}
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
      </Field>
      <div className="mt-1.5 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={save} disabled={saving}>
          Post
        </Button>
      </div>
    </Modal>
  );
}
