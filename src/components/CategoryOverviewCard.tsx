import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronDown, ChevronRight, MapPin, MoreVertical, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  useDeleteCategoryMutation,
  useRenameCategoryMutation,
  type CategoryCompanyTarget,
} from "@/hooks/useOperationalData";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

export type CategorySummary = {
  category: string;
  total: number;
  assigned: number;
  maintenance: number;
  available: number;
};

export type CategoryAssignedSite = {
  id: string;
  name: string;
  unitCount: number;
};

type Props = {
  summary: CategorySummary;
  companyTargets: CategoryCompanyTarget[];
  assignedSites: CategoryAssignedSite[];
  expanded: boolean;
  canManage: boolean;
  onSelect: () => void;
  onCategoryRenamed?: (oldName: string, newName: string) => void;
};

export function CategoryOverviewCard({
  summary,
  companyTargets,
  assignedSites,
  expanded,
  canManage,
  onSelect,
  onCategoryRenamed,
}: Props) {
  const unitCount = summary.total;
  const renameCategory = useRenameCategoryMutation();
  const deleteCategory = useDeleteCategoryMutation();

  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [nameDraft, setNameDraft] = useState(summary.category);

  useEffect(() => {
    if (!editOpen) setNameDraft(summary.category);
  }, [editOpen, summary.category]);

  const saveRename = () => {
    const trimmed = nameDraft.trim();
    if (!trimmed) {
      toast({ title: "Name required", description: "Enter a category name.", variant: "destructive" });
      return;
    }
    renameCategory.mutate(
      { oldCategory: summary.category, newCategory: trimmed, companyTargets },
      {
        onSuccess: () => {
          toast({
            title: "Category updated",
            description: `"${summary.category}" is now "${trimmed}" (${unitCount} units).`,
          });
          setEditOpen(false);
          onCategoryRenamed?.(summary.category, trimmed);
        },
        onError: (err) =>
          toast({
            title: "Could not rename category",
            description: err instanceof Error ? err.message : "Check permissions and try again.",
            variant: "destructive",
          }),
      },
    );
  };

  const confirmDelete = () => {
    deleteCategory.mutate(
      { category: summary.category, companyTargets },
      {
        onSuccess: () => {
          toast({
            title: "Category deleted",
            description: `Removed ${unitCount} unit(s) in "${summary.category}".`,
          });
          setDeleteOpen(false);
        },
        onError: (err) =>
          toast({
            title: "Could not delete category",
            description: err instanceof Error ? err.message : "Check for linked data or permissions.",
            variant: "destructive",
          }),
      },
    );
  };

  const assignedUnitTotal = assignedSites.reduce((sum, site) => sum + site.unitCount, 0);

  return (
    <div className="w-full">
      <div
        className={cn(
          "group relative w-full overflow-hidden rounded-xl border bg-card text-left shadow-card transition-all",
          expanded ? "border-primary/35 shadow-elevated" : "border-border hover:border-primary/30",
        )}
      >
        {canManage && (
          <div className="absolute right-2 top-2 z-20">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="secondary"
                  size="icon"
                  className="h-8 w-8 border border-border/80 bg-card shadow-sm hover:bg-secondary"
                  aria-label={`Category actions for ${summary.category}`}
                  onClick={(e) => e.stopPropagation()}
                >
                  <MoreVertical className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="z-[100] w-48" onCloseAutoFocus={(e) => e.preventDefault()}>
                <DropdownMenuItem
                  className="gap-2"
                  onSelect={(e) => {
                    e.preventDefault();
                    setEditOpen(true);
                  }}
                >
                  <Pencil className="h-3.5 w-3.5" />
                  Edit category
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="gap-2 text-destructive focus:text-destructive"
                  onSelect={(e) => {
                    e.preventDefault();
                    setDeleteOpen(true);
                  }}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Delete category
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}

        <button
          type="button"
          onClick={onSelect}
          aria-expanded={expanded}
          className="block w-full p-4 pr-12 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-inset"
        >
          <div className="flex items-center gap-4 sm:gap-6">
            <div className="font-display text-3xl font-bold leading-none tabular-nums sm:text-4xl">
              {summary.total}
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="truncate text-sm font-semibold text-foreground sm:text-base">{summary.category}</h3>
              <div className="mt-1.5 text-xs text-muted-foreground">
                <span className="tabular-nums">{summary.assigned} deployed</span>
                <span className="mx-2 text-border">•</span>
                <span className="tabular-nums">{summary.maintenance} maintenance</span>
                <span className="mx-2 text-border">•</span>
                <span className="tabular-nums">{summary.available} available</span>
              </div>
            </div>
            <ChevronDown
              className={cn(
                "h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200",
                expanded && "rotate-180 text-foreground",
              )}
              aria-hidden
            />
          </div>
        </button>

        <div
          className={cn(
            "grid transition-[grid-template-rows] duration-200 ease-out",
            expanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
          )}
        >
          <div className="overflow-hidden">
            <div className="border-t border-border bg-secondary/40 px-4 py-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center rounded-md border border-border bg-card px-2.5 py-1 text-xs font-medium">
                  <span className="tabular-nums font-semibold">{summary.total}</span>
                  <span className="ml-1.5 text-muted-foreground">units</span>
                </span>
                <span className="inline-flex items-center rounded-md border border-border bg-card px-2.5 py-1 text-xs font-medium">
                  <span className="tabular-nums font-semibold">{assignedSites.length}</span>
                  <span className="ml-1.5 text-muted-foreground">
                    {assignedSites.length === 1 ? "site" : "sites"}
                  </span>
                </span>
                {assignedUnitTotal > 0 && (
                  <span className="text-xs text-muted-foreground">
                    <span className="tabular-nums font-medium text-foreground">{assignedUnitTotal}</span> deployed across sites
                  </span>
                )}
              </div>

              <div className="mt-3">
                <div className="mb-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                  Assigned sites
                </div>
                {assignedSites.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-border bg-card/60 px-3 py-6 text-center text-sm text-muted-foreground">
                    No sites assigned yet.
                  </div>
                ) : (
                  <ul className="grid max-h-56 gap-2 overflow-auto sm:grid-cols-2 lg:grid-cols-3">
                    {assignedSites.map((site) => (
                      <li key={site.id}>
                        <Link
                          to={`/sites/${site.id}`}
                          className="group/site flex items-center gap-2.5 rounded-lg border border-border/80 bg-card px-3 py-2.5 transition-colors hover:border-primary/35 hover:bg-primary/5 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
                        >
                          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-secondary text-muted-foreground transition-colors group-hover/site:bg-primary/10 group-hover/site:text-primary">
                            <MapPin className="h-3.5 w-3.5" aria-hidden />
                          </span>
                          <span className="min-w-0 flex-1 truncate text-sm font-medium group-hover/site:text-primary">
                            {site.name}
                          </span>
                          <span className="shrink-0 rounded-md bg-secondary px-2 py-0.5 text-xs font-semibold tabular-nums">
                            {site.unitCount}
                          </span>
                          <ChevronRight
                            className="h-3.5 w-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover/site:opacity-100 group-focus-visible/site:opacity-100"
                            aria-hidden
                          />
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="z-[110] sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit category</DialogTitle>
            <DialogDescription>
              Rename <strong>{summary.category}</strong>. All {unitCount} unit(s) in this category will use the new name.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2 py-2">
            <Label htmlFor={`category-name-${summary.category}`}>Category name</Label>
            <Input
              id={`category-name-${summary.category}`}
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              maxLength={120}
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setEditOpen(false)}>
              Cancel
            </Button>
            <Button type="button" onClick={saveRename} disabled={renameCategory.isPending}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="z-[110] sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete category?</DialogTitle>
            <DialogDescription>
              This permanently removes all <strong>{unitCount}</strong> machinery unit(s) in{" "}
              <strong>{summary.category}</strong>. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setDeleteOpen(false)}>
              Cancel
            </Button>
            <Button type="button" variant="destructive" onClick={confirmDelete} disabled={deleteCategory.isPending}>
              Delete category
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
