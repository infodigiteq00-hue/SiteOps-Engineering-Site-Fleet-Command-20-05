ALTER TABLE public.machinery
  ADD COLUMN IF NOT EXISTS invoice_number text;

ALTER TABLE public.machinery
  ADD COLUMN IF NOT EXISTS purchase_date date;

COMMENT ON COLUMN public.machinery.invoice_number IS 'Purchase invoice number for newly added machinery.';
COMMENT ON COLUMN public.machinery.purchase_date IS 'Purchase date for newly added machinery.';
