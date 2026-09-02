import { PrismaClient, Prisma } from "@prisma/client";

export { PrismaClient, Prisma };
export type {
  Cache,
  ChallengeChecker,
  CorrectedCoordinate,
  Find,
  GeocachingProfile,
  Import,
  StatSnapshot,
  Trackable,
  TrackableLog,
  TrackableLogType,
  TrackableState,
  User
} from "@prisma/client";

export function countableFindWhere(userId: string, gcUsername: string | null): Prisma.FindWhereInput {
  const filters: Prisma.FindWhereInput[] = [
    {
      cache: {
        hides: {
          none: { userId }
        }
      }
    }
  ];
  if (gcUsername) {
    filters.push({
      NOT: {
        cache: {
          ownerName: {
            equals: gcUsername,
            mode: "insensitive"
          }
        }
      }
    });
  }
  return { userId, AND: filters };
}
