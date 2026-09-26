-- Datenschutz: Kunden und Nutzer auf Anfrage anonymisieren (Zeitpunkt festhalten)
ALTER TABLE "Customer" ADD COLUMN "anonymizedAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN "anonymizedAt" TIMESTAMP(3);
