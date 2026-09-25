-- GAEB: Ordnungszahl je Angebotsposition und LV-Angaben am Angebot
ALTER TABLE "Quote" ADD COLUMN "gaebInfo" JSONB;
ALTER TABLE "QuoteLineItem" ADD COLUMN "gaebOz" TEXT;
