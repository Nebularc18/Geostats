-- Existing snapshots may have come from portable archives. Regenerate them on demand.
ALTER TABLE "stat_snapshots" ADD COLUMN "server_generated" BOOLEAN NOT NULL DEFAULT false;
