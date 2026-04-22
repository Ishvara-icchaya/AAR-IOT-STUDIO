import { forwardRef } from "react";
import type { TextareaHTMLAttributes } from "react";

export const AppTextarea = forwardRef<
  HTMLTextAreaElement,
  Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "size"> & { size?: "md" | "sm"; mono?: boolean }
>(function AppTextarea({ className, size = "md", mono, ...rest }, ref) {
  const cls = ["app-textarea", size === "sm" && "app-textarea--sm", mono && "app-textarea--mono", className]
    .filter(Boolean)
    .join(" ");
  return <textarea ref={ref} className={cls} {...rest} />;
});
