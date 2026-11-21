ALTER TABLE "challenge_checkers" ADD COLUMN "portable_id" TEXT;
CREATE UNIQUE INDEX "challenge_checkers_user_id_portable_id_key" ON "challenge_checkers"("user_id", "portable_id");
