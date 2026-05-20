-- Support lost/damaged machinery during site closure workflows.
ALTER TABLE public.machinery DROP CONSTRAINT IF EXISTS machinery_status_check;

ALTER TABLE public.machinery
  ADD CONSTRAINT machinery_status_check
  CHECK (status IN ('available', 'assigned', 'maintenance', 'lost_damaged'));

ALTER TABLE public.machinery ADD COLUMN IF NOT EXISTS closure_notes text;
