import { Info } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

interface AlertBannerProps {
  title: string;
  children?: ReactNode;
  tone?: "info" | "warning" | "success" | "danger";
  className?: string;
}

const toneMap = {
  info: "border-info/30 bg-info/10 text-info",
  warning: "border-warning/40 bg-warning/10 text-warning-foreground",
  success: "border-success/30 bg-success/10 text-success",
  danger: "border-destructive/30 bg-destructive/10 text-destructive",
};

export function StaffAlert({ title, children, tone = "info", className }: AlertBannerProps) {
  return (
    <div
      className={cn("flex items-start gap-3 rounded-lg border p-4", toneMap[tone], className)}
      role="alert"
    >
      <Info className="mt-0.5 size-5 shrink-0" aria-hidden />
      <div>
        <p className="font-semibold">{title}</p>
        {children && <div className="mt-1 text-sm opacity-90">{children}</div>}
      </div>
    </div>
  );
}

export function GuestAlert(props: AlertBannerProps) {
  return <StaffAlert {...props} />;
}
