"use client";

import { createContext, useCallback, useContext, useRef, useState } from "react";

type ToastTone = "success" | "danger" | "neutral";

interface Toast {
  id: number;
  message: string;
  tone: ToastTone;
}

interface ToastContextValue {
  showToast: (message: string, tone?: ToastTone) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const TONE_CLASSES: Record<ToastTone, string> = {
  success: "border-success/30 bg-surface text-foreground",
  danger: "border-danger/30 bg-surface text-foreground",
  neutral: "border-border bg-surface text-foreground",
};

const TONE_DOT: Record<ToastTone, string> = {
  success: "bg-success",
  danger: "bg-danger",
  neutral: "bg-muted",
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(0);

  const showToast = useCallback((message: string, tone: ToastTone = "neutral") => {
    const id = nextId.current++;
    setToasts((prev) => [...prev, { id, message, tone }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  }, []);

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed bottom-4 right-4 z-50 flex flex-col gap-2"
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            role="status"
            className={`pointer-events-auto flex items-center gap-2 rounded-md border px-4 py-2.5 text-sm shadow-lg ${TONE_CLASSES[toast.tone]}`}
          >
            <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${TONE_DOT[toast.tone]}`} />
            {toast.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within a ToastProvider");
  return ctx;
}
