import { describe, it, expect } from "vitest";
import { SITE_BULK_SAMPLE_CSV } from "@/lib/site-bulk-upload";
import { MACHINERY_BULK_CSV_HEADER, parseBulkStructural } from "@/lib/machinery-bulk-upload";

describe("SITE_BULK_SAMPLE_CSV", () => {
  it("uses the shared 6-column machinery template", () => {
    expect(SITE_BULK_SAMPLE_CSV.startsWith(MACHINERY_BULK_CSV_HEADER)).toBe(true);
    const result = parseBulkStructural(SITE_BULK_SAMPLE_CSV, [], "co-1");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.rows.length).toBeGreaterThan(0);
    }
  });
});
