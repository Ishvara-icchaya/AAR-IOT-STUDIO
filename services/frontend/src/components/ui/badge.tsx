import { cva, type VariantProps } from "class-variance-authority";
import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary/90 text-primary-foreground shadow-glow-cyan-sm",
        secondary: "border-cyan-500/30 bg-muted text-muted-foreground",
        outline: "border-cyan-500/40 text-foreground",
        destructive: "border-transparent bg-red-500/20 text-red-300 border-red-500/40",
        warning: "border-transparent bg-amber-500/15 text-amber-200 border-amber-500/35",
        success: "border-transparent bg-emerald-500/15 text-emerald-200 border-emerald-500/35",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export interface BadgeProps extends HTMLAttributes<HTMLDivElement>, VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
