-- Legacy Clerk links were established by email alone. Retire the credentials
-- that could still grant the prior password holder access to the linked user.
BEGIN;

DELETE FROM "collector_tokens" AS token
USING "users" AS account
WHERE token."user_id" = account."id"
  AND account."password_hash" IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM "oauth_accounts" AS identity
    WHERE identity."user_id" = account."id" AND identity."provider" = 'clerk'
  );

UPDATE "users" AS account
SET "password_hash" = NULL, "updated_at" = CURRENT_TIMESTAMP
WHERE account."password_hash" IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM "oauth_accounts" AS identity
    WHERE identity."user_id" = account."id" AND identity."provider" = 'clerk'
  );

COMMIT;
