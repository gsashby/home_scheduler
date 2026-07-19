"use client";

import { createContext, useCallback, useContext, useRef, useState } from "react";

const ToastContext = createContext<((message: string) => void) | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [message, setMessage] = useState<string | null>(null);
  const [visible, setVisible] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const toast = useCallback((msg: string) => {
    setMessage(msg);
    setVisible(true);
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setVisible(false), 2600);
  }, []);

  return (
    <ToastContext.Provider value={toast}>
      {children}
      <div
        className={`pointer-events-none fixed bottom-5 left-1/2 z-[99] max-w-[90vw] -translate-x-1/2 rounded-full bg-gray-900 px-4 py-2.5 text-center text-sm font-semibold text-white shadow-lg transition-opacity duration-200 ${
          visible ? "opacity-100" : "opacity-0"
        }`}
      >
        {message}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}
