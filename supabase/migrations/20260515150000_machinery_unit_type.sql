-- Unit of measure for machinery quantity (nos, metre, kg, etc.)
ALTER TABLE public.machinery
  ADD COLUMN IF NOT EXISTS unit_type text NOT NULL DEFAULT 'nos';

COMMENT ON COLUMN public.machinery.unit_type IS 'Quantity unit — preset (nos, metre, kg, etc.) or custom text (e.g. tonne, sqm)';
