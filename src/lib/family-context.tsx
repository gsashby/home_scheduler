"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Database } from "@/lib/supabase/database.types";

export type Profile = Database["public"]["Tables"]["profiles"]["Row"];

interface FamilyContextValue {
  me: Profile;
  members: Profile[];
  isParent: boolean;
  memberById: (id: string) => Profile | undefined;
}

const FamilyContext = createContext<FamilyContextValue | null>(null);

export function FamilyProvider({
  meId,
  initialMembers,
  children,
}: {
  meId: string;
  initialMembers: Profile[];
  children: React.ReactNode;
}) {
  const [members, setMembers] = useState(initialMembers);

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel("profiles-changes")
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "profiles" },
        (payload) => {
          setMembers((prev) =>
            prev.map((m) => (m.id === payload.new.id ? (payload.new as Profile) : m)),
          );
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const value = useMemo<FamilyContextValue | null>(() => {
    const me = members.find((m) => m.id === meId);
    if (!me) return null;
    return {
      me,
      members,
      isParent: me.role === "parent",
      memberById: (id: string) => members.find((m) => m.id === id),
    };
  }, [members, meId]);

  if (!value) return null;

  return <FamilyContext.Provider value={value}>{children}</FamilyContext.Provider>;
}

export function useFamily(): FamilyContextValue {
  const ctx = useContext(FamilyContext);
  if (!ctx) throw new Error("useFamily must be used within FamilyProvider");
  return ctx;
}
