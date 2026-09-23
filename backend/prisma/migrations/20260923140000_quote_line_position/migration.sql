-- AlterTable
ALTER TABLE "QuoteLineItem" ADD COLUMN     "position" INTEGER NOT NULL DEFAULT 0;


-- Bestehende Positionen in der Reihenfolge nummerieren, in der sie
-- gespeichert wurden (physische Zeilenreihenfolge, dieselbe wie bisher
-- beim Lesen ohne ORDER BY).
UPDATE "QuoteLineItem" li
SET "position" = numbered.n
FROM (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY "quoteId" ORDER BY ctid) AS n
  FROM "QuoteLineItem"
) numbered
WHERE li.id = numbered.id;
