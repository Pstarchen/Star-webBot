import type { SitePublicSettings } from "@/types/platform";

export function SiteFooter({ site, compact = false }: { site: SitePublicSettings; compact?: boolean }) {
  if (!site.copyrightText && !site.icpCode && !site.policeCode) return null;
  return (
    <footer className={compact ? "mt-5 text-center text-[10px] leading-5 text-muted-foreground" : "border-t px-4 py-4 text-center text-[11px] leading-5 text-muted-foreground"}>
      <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1">
        {site.copyrightText && <span>© {new Date().getFullYear()} {site.copyrightText}</span>}
        {site.icpCode && <a href={site.icpUrl || "https://beian.miit.gov.cn/"} target="_blank" rel="noreferrer" className="hover:text-foreground">{site.icpCode}</a>}
        {site.policeCode && <a href={site.policeUrl || undefined} target={site.policeUrl ? "_blank" : undefined} rel={site.policeUrl ? "noreferrer" : undefined} className="hover:text-foreground">{site.policeCode}</a>}
      </div>
    </footer>
  );
}
