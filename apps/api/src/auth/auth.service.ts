import {
  BadRequestException,
  ConflictException,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { createClerkClient, verifyToken } from "@clerk/backend";
import { Prisma } from "@geostats/db";
import bcrypt from "bcryptjs";
import { PrismaService } from "../common/prisma.service";
import { AuthUser } from "@geostats/shared";
import { envOrDefault } from "../common/env";
import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

export interface AuthTokenPayload {
  sub: string;
  email: string;
  username: string;
}

export type AuthMode = "dev" | "clerk" | "password";

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: string,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number }
) => Promise<Buffer>;
const PASSWORD_HASH_PREFIX = "scrypt";
const PASSWORD_HASH_KEYLEN = 64;
const PASSWORD_HASH_OPTIONS = { N: 16_384, r: 8, p: 1, maxmem: 32 * 1024 * 1024 };
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService
  ) {}

  authMode(): AuthMode {
    if (process.env.NODE_ENV === "production") {
      return process.env.AUTH_MODE === "password" ? "password" : "clerk";
    }
    if (process.env.AUTH_MODE === "dev") {
      return "dev";
    }
    if (process.env.AUTH_MODE === "clerk") {
      return "clerk";
    }
    return "password";
  }

  isAdmin(user: Pick<AuthUser, "email">): boolean {
    const email = user.email.trim().toLowerCase();
    const configuredAdmins = (process.env.ADMIN_EMAILS ?? "")
      .split(",")
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean);

    if (configuredAdmins.includes(email)) {
      return true;
    }

    return this.authMode() === "dev" && email === envOrDefault("DEV_AUTH_EMAIL", "dev@local.geostats").trim().toLowerCase();
  }

  async register(email: string, username: string, password: string): Promise<AuthUser> {
    this.assertPasswordAuthMode();
    const normalizedEmail = email.trim().toLowerCase();
    const normalizedUsername = username.trim();
    if (!normalizedEmail || !EMAIL_PATTERN.test(normalizedEmail) || normalizedEmail.length > 254) {
      throw new BadRequestException("A valid email address (max 254 characters) is required");
    }
    if (!normalizedUsername || normalizedUsername.length < 3 || normalizedUsername.length > 40) {
      throw new BadRequestException("Username must be between 3 and 40 characters");
    }
    if (password.length < 8 || password.length > 128) {
      throw new BadRequestException("Password must be between 8 and 128 characters");
    }
    const existing = await this.prisma.user.findFirst({
      where: { OR: [{ email: normalizedEmail }, { username: normalizedUsername }] }
    });
    if (existing) {
      throw new ConflictException("Email or username is already registered");
    }

    const passwordHash = await this.hashPassword(password);
    const user = await this.createPasswordUser(normalizedEmail, normalizedUsername, passwordHash);
    return this.toAuthUser(user);
  }

  async login(email: string, password: string): Promise<AuthUser> {
    this.assertPasswordAuthMode();
    const user = await this.prisma.user.findUnique({ where: { email: email.trim().toLowerCase() } });
    if (!user?.passwordHash || !(await this.verifyPassword(password, user.passwordHash))) {
      throw new UnauthorizedException("Invalid email or password");
    }
    return this.toAuthUser(user);
  }

  async searchUsers(query: string, currentUserId: string): Promise<Array<{ id: string; username: string }>> {
    const normalizedQuery = query.trim();
    if (normalizedQuery.length < 2) {
      return [];
    }
    if (normalizedQuery.length > 40) {
      throw new BadRequestException("User search must be 40 characters or fewer");
    }

    return this.prisma.user.findMany({
      where: {
        id: { not: currentUserId },
        username: { contains: normalizedQuery, mode: "insensitive" }
      },
      select: { id: true, username: true },
      orderBy: { username: "asc" },
      take: 10
    });
  }

  async loginWithClerkToken(token: string): Promise<AuthUser> {
    if (this.authMode() !== "clerk") {
      throw new ServiceUnavailableException("Clerk auth is disabled");
    }
    if (!token.trim()) {
      throw new UnauthorizedException("Clerk session token is required");
    }

    const secretKey = this.requiredClerkEnv("CLERK_SECRET_KEY");
    const jwtKey = process.env.CLERK_JWT_KEY?.trim();
    const authorizedParties = (process.env.CLERK_AUTHORIZED_PARTIES ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);

    const verifiedToken = await this.verifyClerkSessionToken(token.trim(), secretKey, jwtKey, authorizedParties);

    if (!verifiedToken.sub) {
      throw new UnauthorizedException("Clerk session token has no user id");
    }

    const clerkUser = await this.getClerkUser(secretKey, verifiedToken.sub);

    const primaryEmail = clerkUser.primaryEmailAddress;
    const email = primaryEmail?.emailAddress.trim().toLowerCase() || null;

    const user = await this.upsertOAuthUser({
      provider: "clerk",
      providerAccountId: clerkUser.id,
      providerUsername: clerkUser.username ?? clerkUser.firstName ?? null,
      email,
      emailVerified: primaryEmail?.verification?.status === "verified",
      username: clerkUser.username || clerkUser.firstName || email?.split("@")[0] || `clerk-${clerkUser.id}`
    });
    return this.toAuthUser(user);
  }

  async devUser(): Promise<AuthUser> {
    if (this.authMode() !== "dev") {
      throw new UnauthorizedException("Development auth is disabled");
    }
    const email = envOrDefault("DEV_AUTH_EMAIL", "dev@local.geostats");
    const username = envOrDefault("DEV_AUTH_USERNAME", "dev");
    const user = await this.upsertOAuthUser({
      provider: "dev",
      providerAccountId: email,
      providerUsername: username,
      email,
      emailVerified: true,
      username
    });
    await this.ensureDevProfile(user.id, username);
    return this.toAuthUser(user);
  }

  sign(user: AuthUser): string {
    return this.jwt.sign({
      sub: user.id,
      email: user.email,
      username: user.username
    } satisfies AuthTokenPayload);
  }

  async verify(token: string): Promise<AuthUser> {
    const payload = await this.jwt.verifyAsync<AuthTokenPayload>(token);
    const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user) {
      throw new UnauthorizedException("User no longer exists");
    }
    return this.toAuthUser(user);
  }

  private toAuthUser(user: { id: string; email: string; username: string }): AuthUser {
    return {
      id: user.id,
      email: user.email,
      username: user.username
    };
  }

  private assertPasswordAuthMode() {
    if (this.authMode() !== "password") {
      throw new ServiceUnavailableException("Password auth is disabled");
    }
  }

  private requiredClerkEnv(name: string): string {
    const value = process.env[name]?.trim();
    if (!value) {
      throw new ServiceUnavailableException("Clerk auth is not configured");
    }
    return value;
  }

  private async verifyClerkSessionToken(
    token: string,
    secretKey: string,
    jwtKey: string | undefined,
    authorizedParties: string[]
  ) {
    try {
      return await verifyToken(token, {
        ...(jwtKey ? { jwtKey } : { secretKey }),
        ...(authorizedParties.length ? { authorizedParties } : {})
      });
    } catch {
      throw new UnauthorizedException("Invalid Clerk session token");
    }
  }

  private async getClerkUser(secretKey: string, userId: string) {
    try {
      const clerk = createClerkClient({ secretKey });
      return await clerk.users.getUser(userId);
    } catch {
      throw new UnauthorizedException("Could not load the Clerk user");
    }
  }

  private async upsertOAuthUser(input: {
    provider: string;
    providerAccountId: string;
    providerUsername: string | null;
    email: string | null;
    emailVerified?: boolean;
    username: string;
  }) {
    const existingAccount = await this.findOAuthAccount(input.provider, input.providerAccountId);
    if (existingAccount) {
      if (input.providerUsername !== existingAccount.providerUsername) {
        await this.prisma.oAuthAccount.update({
          where: { id: existingAccount.id },
          data: { providerUsername: input.providerUsername }
        });
      }
      return existingAccount.user;
    }

    if (!input.email) {
      throw new BadRequestException("Clerk account must have a primary email address");
    }
    if (input.provider === "clerk" && input.emailVerified !== true) {
      throw new BadRequestException("Clerk primary email address must be verified");
    }

    const existingUser = await this.prisma.user.findUnique({ where: { email: input.email } });
    if (existingUser) {
      try {
        await this.prisma.oAuthAccount.create({
          data: {
            userId: existingUser.id,
            provider: input.provider,
            providerAccountId: input.providerAccountId,
            providerUsername: input.providerUsername
          }
        });
      } catch (error) {
        if (this.isUniqueConstraintError(error)) {
          const linkedAccount = await this.findOAuthAccount(input.provider, input.providerAccountId);
          if (linkedAccount) {
            return linkedAccount.user;
          }
        }
        throw error;
      }
      return existingUser;
    }

    const username = await this.availableUsername(input.username);
    try {
      return await this.prisma.user.create({
        data: {
          email: input.email,
          username,
          oauthAccounts: {
            create: {
              provider: input.provider,
              providerAccountId: input.providerAccountId,
              providerUsername: input.providerUsername
            }
          }
        }
      });
    } catch (error) {
      if (this.isUniqueConstraintError(error)) {
        const linkedAccount = await this.findOAuthAccount(input.provider, input.providerAccountId);
        if (linkedAccount) {
          return linkedAccount.user;
        }
        throw new ConflictException("Email or username is already registered");
      }
      throw error;
    }
  }

  private async findOAuthAccount(provider: string, providerAccountId: string) {
    return this.prisma.oAuthAccount.findUnique({
      where: {
        provider_providerAccountId: {
          provider,
          providerAccountId
        }
      },
      include: { user: true }
    });
  }

  private async createPasswordUser(email: string, username: string, passwordHash: string) {
    try {
      return await this.prisma.user.create({
        data: {
          email,
          username,
          passwordHash
        }
      });
    } catch (error) {
      if (this.isUniqueConstraintError(error)) {
        throw new ConflictException("Email or username is already registered");
      }
      throw error;
    }
  }

  private async ensureDevProfile(userId: string, username: string) {
    if (process.env.DEV_AUTH_CREATE_PROFILE === "false") {
      return;
    }
    await this.prisma.geocachingProfile.upsert({
      where: { userId },
      create: {
        userId,
        gcUsername: envOrDefault("DEV_AUTH_GC_USERNAME", username),
        homeLatitude: null,
        homeLongitude: null,
        timeZone: this.devProfileTimeZone()
      },
      update: {}
    });
  }

  private devProfileTimeZone(): string {
    const timeZone = envOrDefault("DEV_AUTH_TIME_ZONE", "Europe/Stockholm");
    try {
      new Intl.DateTimeFormat("en-US", { timeZone }).format(new Date());
      return timeZone;
    } catch {
      return "Europe/Stockholm";
    }
  }

  private isUniqueConstraintError(error: unknown): error is Prisma.PrismaClientKnownRequestError {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
  }

  private async hashPassword(password: string): Promise<string> {
    const salt = randomBytes(16).toString("base64url");
    const key = await scryptAsync(password, salt, PASSWORD_HASH_KEYLEN, PASSWORD_HASH_OPTIONS);
    return `${PASSWORD_HASH_PREFIX}$${PASSWORD_HASH_OPTIONS.N}$${PASSWORD_HASH_OPTIONS.r}$${PASSWORD_HASH_OPTIONS.p}$${salt}$${key.toString("base64url")}`;
  }

  private async verifyPassword(password: string, storedHash: string): Promise<boolean> {
    if (storedHash.startsWith("$2a$") || storedHash.startsWith("$2b$") || storedHash.startsWith("$2y$")) {
      return bcrypt.compare(password, storedHash);
    }

    const [prefix, n, r, p, salt, encodedKey] = storedHash.split("$");
    if (prefix !== PASSWORD_HASH_PREFIX || !n || !r || !p || !salt || !encodedKey) {
      return false;
    }
    const parsedN = Number(n);
    const parsedR = Number(r);
    const parsedP = Number(p);
    if (
      !Number.isInteger(parsedN) ||
      parsedN < 2 ||
      (parsedN & (parsedN - 1)) !== 0 ||
      !Number.isInteger(parsedR) ||
      parsedR < 1 ||
      !Number.isInteger(parsedP) ||
      parsedP < 1
    ) {
      return false;
    }
    const expected = Buffer.from(encodedKey, "base64url");
    const actual = await scryptAsync(password, salt, expected.length, {
      N: parsedN,
      r: parsedR,
      p: parsedP,
      maxmem: PASSWORD_HASH_OPTIONS.maxmem
    });
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  }

  private async availableUsername(value: string): Promise<string> {
    const base = this.normalizeUsername(value);
    for (let i = 0; i < 100; i += 1) {
      const candidate = i === 0 ? base : `${base}${i + 1}`;
      const existing = await this.prisma.user.findUnique({ where: { username: candidate } });
      if (!existing) {
        return candidate;
      }
    }
    return `${base}${Date.now()}`;
  }

  private normalizeUsername(value: string): string {
    const normalized = value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 32);
    return normalized.length >= 3 ? normalized : "user";
  }
}
