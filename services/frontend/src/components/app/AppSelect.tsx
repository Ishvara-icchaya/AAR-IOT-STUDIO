import { forwardRef } from "react";
import type { SelectHTMLAttributes } from "react";

export const AppSelect = forwardRef<
  HTMLSelectElement,
  Omit<SelectHTMLAttributes<HTMLSelectElement>, "size"> & { size?: "md" | "sm" }
>(function AppSelect({ className, size = "md", ...rest }, ref) {
    const cls = ["app-select", size === "sm" && "app-select--sm", className].filter(Boolean).join(" ");
    return <select ref={ref} className={cls} {...rest} />;
});
