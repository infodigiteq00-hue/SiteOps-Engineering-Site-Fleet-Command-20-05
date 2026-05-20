import { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  label: string;
  value: string | number;
  icon: LucideIcon;
  trend?: string;
  accent?: "blue" | "cyan" | "teal" | "green" | "orange";
}

const accents: Record<NonNullable<Props["accent"]>, { card: string; iconWrap: string; icon: string }> = {
  blue: {
    card: "border-blue-500/20 bg-gradient-to-br from-blue-500 to-blue-600 text-white",
    iconWrap: "bg-white/15 ring-1 ring-white/20",
    icon: "text-white",
  },
  cyan: {
    card: "border-cyan-500/20 bg-gradient-to-br from-cyan-500 to-sky-600 text-white",
    iconWrap: "bg-white/15 ring-1 ring-white/20",
    icon: "text-white",
  },
  teal: {
    card: "border-teal-500/20 bg-gradient-to-br from-teal-500 to-cyan-600 text-white",
    iconWrap: "bg-white/15 ring-1 ring-white/20",
    icon: "text-white",
  },
  orange: {
    card: "border-orange-500/20 bg-gradient-to-br from-orange-500 to-amber-600 text-white",
    iconWrap: "bg-white/15 ring-1 ring-white/20",
    icon: "text-white",
  },
  green: {
    card: "border-emerald-500/20 bg-gradient-to-br from-emerald-500 to-green-600 text-white",
    iconWrap: "bg-white/15 ring-1 ring-white/20",
    icon: "text-white",
  },
};

function valueSizeClass(value: string | number) {
  const text = String(value);
  if (text.length > 12) return "text-lg sm:text-xl";
  if (text.length > 8) return "text-xl sm:text-2xl";
  if (text.length > 5) return "text-2xl sm:text-3xl";
  return "text-3xl sm:text-4xl";
}

export const StatCard = ({ label, value, icon: Icon, trend, accent = "blue" }: Props) => {
  const style = accents[accent];
  const valueText = String(value);

  return (
    <div className={cn("group relative overflow-hidden rounded-2xl border p-4 shadow-elevated transition-all hover:-translate-y-0.5 sm:p-5", style.card)}>
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_80%_20%,rgba(255,255,255,0.22),transparent_45%)]" />
      <div className="relative flex items-start justify-between gap-3 sm:gap-4">
        <div className="min-w-0 flex-1">
          <div className="text-xs font-medium text-white/85">{label}</div>
          <div
            className={cn(
              "mt-1.5 font-display font-bold leading-tight tracking-tight text-white tabular-nums",
              valueSizeClass(value),
            )}
            title={valueText}
          >
            {value}
          </div>
          {trend && <div className="mt-2 line-clamp-2 text-xs font-medium leading-snug text-white/85">{trend}</div>}
        </div>
        <div className="relative flex h-14 w-14 shrink-0 items-center justify-center sm:h-16 sm:w-16">
          <div className="absolute inset-0 rounded-full bg-white/10" />
          <div className={cn("relative flex h-10 w-10 items-center justify-center rounded-full sm:h-11 sm:w-11", style.iconWrap)}>
            <Icon className={cn("h-4 w-4 sm:h-5 sm:w-5", style.icon)} />
          </div>
        </div>
      </div>
    </div>
  );
};
