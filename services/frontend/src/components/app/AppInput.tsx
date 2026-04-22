import { forwardRef } from "react";
import type { InputHTMLAttributes } from "react";

export const AppInput = forwardRef<
  HTMLInputElement,
  Omit<InputHTMLAttributes<HTMLInputElement>, "size"> & { size?: "md" | "sm" }
>(function AppInput({ className, size = "md", ...rest }, ref) {
    const cls = ["app-input", size === "sm" && "app-input--sm", className].filter(Boolean).join(" ");
    return <input ref={ref} className={cls} {...rest} />;
});
