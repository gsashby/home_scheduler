"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/lib/toast";
import { Button, Card, Empty } from "@/components/ui";
import type { Profile } from "@/lib/family-context";

type Status =
  | "loading"
  | "unsupported"
  | "denied"
  | "disabled"
  | "enabled"
  | "error";

// VAPID public keys are base64url, but PushManager wants a raw Uint8Array.
function urlBase64ToUint8Array(base64: string) {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const base64Safe = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64Safe);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

function subscriptionToRow(subscription: PushSubscription, profileId: string) {
  const json = subscription.toJSON();
  return {
    profile_id: profileId,
    endpoint: subscription.endpoint,
    p256dh: json.keys?.p256dh ?? "",
    auth: json.keys?.auth ?? "",
  };
}

export function PushNotificationsCard({ me }: { me: Profile }) {
  const toast = useToast();
  const [status, setStatus] = useState<Status>("loading");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function check() {
      if (
        typeof window === "undefined" ||
        !("serviceWorker" in navigator) ||
        !("PushManager" in window)
      ) {
        setStatus("unsupported");
        return;
      }
      if (Notification.permission === "denied") {
        setStatus("denied");
        return;
      }
      try {
        const registration = await navigator.serviceWorker.ready;
        const subscription = await registration.pushManager.getSubscription();
        if (cancelled) return;
        setStatus(subscription ? "enabled" : "disabled");
      } catch {
        if (!cancelled) setStatus("error");
      }
    }

    check();
    return () => {
      cancelled = true;
    };
  }, []);

  async function enable() {
    const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
    if (!vapidPublicKey) {
      toast("Push isn't configured for this deployment yet");
      return;
    }
    setBusy(true);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setStatus("denied");
        return;
      }
      const registration = await navigator.serviceWorker.ready;
      const subscription =
        (await registration.pushManager.getSubscription()) ??
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
        }));
      const { error } = await createClient()
        .from("push_subscriptions")
        .upsert(subscriptionToRow(subscription, me.id), {
          onConflict: "endpoint",
        });
      if (error) {
        toast("Couldn't save your push subscription");
        setStatus("error");
        return;
      }
      setStatus("enabled");
      toast("Push notifications enabled on this device");
    } catch {
      toast("Couldn't enable push notifications");
      setStatus("error");
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        await createClient()
          .from("push_subscriptions")
          .delete()
          .eq("endpoint", subscription.endpoint);
        await subscription.unsubscribe();
      }
      setStatus("disabled");
      toast("Push notifications disabled on this device");
    } catch {
      toast("Couldn't disable push notifications");
      setStatus("error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <h2 className="mb-2.5 flex flex-wrap items-center gap-2 text-[15px] font-semibold">
        🔔 Push notifications
        <span className="text-xs font-normal text-gray-600">
          this device only — daily brief, deadline alerts, nudges
        </span>
      </h2>

      {status === "loading" && (
        <p className="text-sm text-gray-600">Checking status…</p>
      )}

      {status === "unsupported" && (
        <Empty>
          This browser doesn&rsquo;t support push notifications. In-app
          notifications (the bell) still work.
        </Empty>
      )}

      {status === "denied" && (
        <Empty>
          Notifications are blocked for this site. Allow them in your
          browser&rsquo;s site settings, then reload this page.
        </Empty>
      )}

      {status === "error" && (
        <Empty>Couldn&rsquo;t check this device&rsquo;s push status.</Empty>
      )}

      {status === "disabled" && (
        <div>
          <Empty>Not enabled on this device yet.</Empty>
          <div className="mt-3">
            <Button size="sm" onClick={enable} disabled={busy}>
              Enable push notifications
            </Button>
          </div>
        </div>
      )}

      {status === "enabled" && (
        <div>
          <p className="text-sm text-gray-600">
            Enabled on this device for {me.display_name}.
          </p>
          <div className="mt-3">
            <Button
              size="sm"
              variant="danger"
              onClick={disable}
              disabled={busy}
            >
              Disable on this device
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}
