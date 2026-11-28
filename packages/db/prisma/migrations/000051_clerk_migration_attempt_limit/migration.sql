ALTER TABLE "users"
  ADD COLUMN "clerk_migration_attempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "clerk_migration_window_ends_at" TIMESTAMP(3);
