"use client";

import { forwardRef } from "react";

const VARIANTS = {
  primary: "bg-accent text-accent-foreground hover:opacity-90",
  secondary: "border border-border bg-surface text-foreground hover:bg-surface-hover",
  ghost: "text-foreground hover:bg-surface-hover",
  danger: "bg-danger text-danger-foreground hover:opacity-90",
} as const;

const SIZES = {
  sm: "px-3 py-1.5 text-xs",
  md: "px-4 py-2 text-sm",
} as const;

export type ButtonVariant = keyof typeof VARIANTS;
export type ButtonSize = keyof typeof SIZES;

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  isLoading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", size = "md", isLoading, disabled, className = "", children, ...props },
  ref
) {
  return (
    <button
      ref={ref}
      disabled={disabled || isLoading}
      className={`inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition-opacity disabled:cursor-not-allowed disabled:opacity-60 ${VARIANTS[variant]} ${SIZES[size]} ${className}`}
      {...props}
    >
      {isLoading && (
        <span
          aria-hidden="true"
          className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent"
        />
      )}
      {children}
    </button>
  );
});
