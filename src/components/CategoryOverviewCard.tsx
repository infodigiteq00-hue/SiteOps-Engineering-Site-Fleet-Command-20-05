import { useEffect, useState } from "react";
import { MoreVertical, Pencil, Trash2 } from "lucide-react";
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

export type CategorySummary = {
  category: string;
  total: number;
  assigned: number;
  maintenance: number;
  available: number;
};

type Props = {
  summary: CategorySummary;
  companyTargets: CategoryCompanyTarget[];
  canManage: boolean;
  onSelect: () => void;
  onCategoryRenamed?: (oldName: string, newName: string) => void;
};

export function CategoryOverviewCard({ summary, companyTargets, canManage, onSelect, onCategoryRenamed }: Props) {
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

  return (
    <>
      <div className="group relative rounded-xl border border-border bg-card p-4 text-left shadow-card transition-colors hover:border-primary/30">
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
          className="block w-full pr-10 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 rounded-md"
        >
          <div className="text-4xl font-display font-bold leading-none tabular-nums">{summary.total}</div>
          <h3 className="mt-2 text-sm font-medium text-muted-foreground">{summary.category}</h3>

          <div className="mt-4 border-t border-border pt-3 text-xs text-muted-foreground">
            <span className="tabular-nums">{summary.assigned} deployed</span>
            <span className="mx-2 text-border">•</span>
            <span className="tabular-nums">{summary.maintenance} maintenance</span>
            <span className="mx-2 text-border">•</span>
            <span className="tabular-nums">{summary.available} available</span>
          </div>
        </button>
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
    </>
  );
}
