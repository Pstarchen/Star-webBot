import Image from "next/image";
import { Bot } from "lucide-react";
import { cn } from "@/lib/utils";
import type { SitePublicSettings } from "@/types/platform";

export function BrandMark({ compact = false, className, site }: { compact?: boolean; className?: string; site?: SitePublicSettings }) {
  return (
    <div className={cn("flex items-center gap-3", className)}>
      <div className="grid h-8 w-8 shrink-0 place-items-center overflow-hidden rounded-lg bg-primary text-primary-foreground shadow-sm" aria-hidden="true">
        {site?.logoUrl ? <Image src={site.logoUrl} alt="" width={32} height={32} unoptimized className="h-full w-full object-cover" /> : <Bot size={17} strokeWidth={2} />}
      </div>
      {!compact && (
        <div className="leading-none">
          <div className="text-[15px] font-bold text-foreground">{site?.siteName || "StarBot"}</div>
          <div className="mt-1 max-w-32 truncate text-[9px] font-medium text-muted-foreground">{site?.siteTagline || "QQ Bot Console"}</div>
        </div>
      )}
    </div>
  );
}
