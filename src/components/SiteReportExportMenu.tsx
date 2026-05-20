import { useMemo } from "react";
import { Download, FileSpreadsheet, FileText } from "lucide-react";
import type { LedgerEntry, Machine, Site } from "@/domain/types";
import { buildSiteReport } from "@/lib/site-report";
import { downloadSiteReportExcel, openSiteReportPdf } from "@/lib/site-report-export";
import { resolveSiteClosureSummary } from "@/lib/site-closure-summary";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "@/hooks/use-toast";

type Props = {
  site: Site;
  ledger: LedgerEntry[];
  machines: Machine[];
};

export function SiteReportExportMenu({ site, ledger, machines }: Props) {
  const report = useMemo(() => {
    const closure = resolveSiteClosureSummary(site, ledger);
    return buildSiteReport(site, ledger, machines, closure);
  }, [site, ledger, machines]);

  const exportExcel = () => {
    try {
      downloadSiteReportExcel(report);
      toast({
        title: "Report downloaded",
        description: "Excel-compatible CSV saved to your downloads folder.",
      });
    } catch (err) {
      toast({
        title: "Export failed",
        description: err instanceof Error ? err.message : "Try again.",
        variant: "destructive",
      });
    }
  };

  const exportPdf = () => {
    try {
      openSiteReportPdf(report);
      toast({
        title: "Opening print view",
        description: "Use Save as PDF in the print dialog if needed.",
      });
    } catch (err) {
      toast({
        title: "Export failed",
        description: err instanceof Error ? err.message : "Allow pop-ups and try again.",
        variant: "destructive",
      });
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="outline" size="sm" className="gap-1.5">
          <Download className="h-4 w-4" />
          Export report
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>Site machinery report</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem className="gap-2 cursor-pointer" onSelect={exportExcel}>
          <FileSpreadsheet className="h-4 w-4" />
          Download Excel (CSV)
        </DropdownMenuItem>
        <DropdownMenuItem className="gap-2 cursor-pointer" onSelect={exportPdf}>
          <FileText className="h-4 w-4" />
          Print / save as PDF
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <p className="px-2 py-1.5 text-[10px] leading-snug text-muted-foreground">
          Simple table: machinery, on-site count, IN/OUT with gate pass &amp; date
        </p>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
