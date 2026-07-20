"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Database } from "@/lib/supabase/database.types";

export type Profile = Database["public"]["Tables"]["profiles"]["Row"];
export type Family = Database["public"]["Tables"]["families"]["Row"];

interface FamilyContextValue {
  me: Profile;
  members: Profile[];
  family: Family;
  isParent: boolean;
  isFamilyAdmin: boolean;
  memberById: (id: string) => Profile | undefined;
}

const FamilyContext = createContext<FamilyContextValue | null>(null);

export function FamilyProvider({
  meId,
  initialMembers,
  family,
  children,
}: {
  meId: string;
  initialMembers: Profile[];
  family: Family;
  children: React.ReactNode;
}) {
  const [members, setMembers] = useState(initialMembers);

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel("profiles-changes")
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "profiles",
          filter: `family_id=eq.${family.id}`,
        },
        (payload) => {
          setMembers((prev) =>
            prev.map((m) =>
              m.id === payload.new.id ? (payload.new as Profile) : m,
            ),
          );
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [family.id]);

  const value = useMemo<FamilyContextValue | null>(() => {
    const me = members.find((m) => m.id === meId);
    if (!me) return null;
    return {
      me,
      members,
      family,
      isParent: me.role === "parent",
      isFamilyAdmin: me.family_member_role === "admin",
      memberById: (id: string) => members.find((m) => m.id === id),
    };
  }, [members, meId, family]);

  if (!value) return null;

  return (
    <FamilyContext.Provider value={value}>{children}</FamilyContext.Provider>
  );
}

export function useFamily(): FamilyContextValue {
  const ctx = useContext(FamilyContext);
  if (!ctx) throw new Error("useFamily must be used within FamilyProvider");
  return ctx;
}
