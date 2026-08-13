"use client";

import { forwardRef } from "react";

const fieldClasses =
  "w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-1 focus:ring-accent disabled:cursor-not-allowed disabled:opacity-60";

export const TextInput = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  function TextInput({ className = "", ...props }, ref) {
    return <input ref={ref} className={`${fieldClasses} ${className}`} {...props} />;
  }
);

export const TextArea = forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(function TextArea({ className = "", ...props }, ref) {
  return <textarea ref={ref} className={`${fieldClasses} resize-y ${className}`} {...props} />;
});

export const Select = forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  function Select({ className = "", children, ...props }, ref) {
    return (
      <select ref={ref} className={`${fieldClasses} ${className}`} {...props}>
        {children}
      </select>
    );
  }
);

export function Label({
  children,
  htmlFor,
  className = "",
}: {
  children: React.ReactNode;
  htmlFor?: string;
  className?: string;
}) {
  return (
    <label htmlFor={htmlFor} className={`mb-1.5 block text-sm font-medium text-foreground ${className}`}>
      {children}
    </label>
  );
}

export function FieldError({ children }: { children?: string | null }) {
  if (!children) return null;
  return (
    <p role="alert" className="mt-1.5 text-sm text-danger">
      {children}
    </p>
  );
}
