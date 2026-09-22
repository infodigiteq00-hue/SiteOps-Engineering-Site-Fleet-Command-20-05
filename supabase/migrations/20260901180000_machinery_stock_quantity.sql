-- Stock quantity for aggregated single-row machinery (e.g. 209 nos in one record).
ALTER TABLE public.machinery
  ADD COLUMN IF NOT EXISTS stock_quantity integer NOT NULL DEFAULT 1;

ALTER TABLE public.machinery
  DROP CONSTRAINT IF EXISTS machinery_stock_quantity_positive;

ALTER TABLE public.machinery
  ADD CONSTRAINT machinery_stock_quantity_positive CHECK (stock_quantity >= 1);

COMMENT ON COLUMN public.machinery.stock_quantity IS 'On-hand quantity for this machinery row (default 1 per piece).';
