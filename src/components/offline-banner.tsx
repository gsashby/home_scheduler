"use client";

import { useEffect, useState } from "react";

// navigator.onLine can false-positive (reports "online" for any local
// network connection, even with no real internet route) but essentially
// never false-negatives -- if the browser says offline, it is. Good
// enough for "tell the user their data might be stale," not meant as a
// precise connectivity check.
export function OfflineBanner() {
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    setOffline(!navigator.onLine);
    const goOffline = () => setOffline(true);
    const goOnline = () => setOffline(false);
    window.addEventListener("offline", goOffline);
    window.addEventListener("online", goOnline);
    return () => {
      window.removeEventListener("offline", goOffline);
      window.removeEventListener("online", goOnline);
    };
  }, []);

  if (!offline) return null;

  return (
    <div className="border-b border-amber-200 bg-amber-50 px-4 py-1.5 text-center text-xs font-semibold text-amber-800">
      You&rsquo;re offline — showing the last data that loaded. Changes
      won&rsquo;t save until you&rsquo;re back online.
    </div>
  );
}
