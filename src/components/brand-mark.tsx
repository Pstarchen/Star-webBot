import { Bot } from "lucide-react";
import { cn } from "@/lib/utils";

export function BrandMark({ compact = false, className }: { compact?: boolean; className?: string }) {
  return (
    <div className={cn("flex items-center gap-3", className)}>
      <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground shadow-sm" aria-hidden="true">
        <Bot size={17} strokeWidth={2} />
      </div>
      {!compact && (
        <div className="leading-none">
          <div className="text-[15px] font-bold text-foreground">StarBot</div>
          <div className="mt-1 text-[9px] font-medium text-muted-foreground">QQ Bot Console</div>
        </div>
      )}
    </div>
  );
}
