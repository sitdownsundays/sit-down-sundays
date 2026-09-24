import { Link } from "@tanstack/react-router";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonLinkVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground shadow hover:bg-primary/90",
        outline:
          "border border-input bg-background shadow-sm hover:bg-accent hover:text-accent-foreground",
        secondary: "bg-secondary text-secondary-foreground shadow-sm hover:bg-secondary/80",
        ghost: "hover:bg-accent hover:text-accent-foreground",
        gold: "bg-gold text-gold-foreground shadow hover:bg-gold/90",
      },
      size: {
        default: "h-9 px-4 py-2",
        sm: "h-8 rounded-md px-3 text-xs",
        lg: "h-12 rounded-md px-8 text-base",
        icon: "h-9 w-9",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

interface ButtonLinkProps extends VariantProps<typeof buttonLinkVariants> {
  to: string;
  children: React.ReactNode;
  className?: string;
}

export function ButtonLink({ to, children, variant, size, className }: ButtonLinkProps) {
  return (
    <Link to={to as never} className={cn(buttonLinkVariants({ variant, size }), className)}>
      {children}
    </Link>
  );
}
