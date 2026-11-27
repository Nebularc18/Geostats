CREATE TABLE "personal_goals" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "target" INTEGER NOT NULL,
    "config" JSONB,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "personal_goals_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "personal_goals_user_id_archived_created_at_idx" ON "personal_goals"("user_id", "archived", "created_at");

ALTER TABLE "personal_goals" ADD CONSTRAINT "personal_goals_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "saved_friends" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "friend_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "saved_friends_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "saved_friends_user_id_friend_user_id_key" ON "saved_friends"("user_id", "friend_user_id");
CREATE INDEX "saved_friends_user_id_created_at_idx" ON "saved_friends"("user_id", "created_at");

ALTER TABLE "saved_friends" ADD CONSTRAINT "saved_friends_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "saved_friends" ADD CONSTRAINT "saved_friends_friend_user_id_fkey" FOREIGN KEY ("friend_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
