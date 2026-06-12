import {
  BadRequestException,
  ConflictException,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
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

type AuthMode = "dev" | "external" | "password";

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

interface OAuthTokenResponse {
  access_token?: string;
  error?: string;
  error_description?: string;
}

interface OidcUserInfoResponse {
  sub: string;
  email?: string | null;
  email_verified?: boolean;
  name?: string | null;
  preferred_username?: string | null;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService
  ) {}

  authMode(): AuthMode {
    if (process.env.AUTH_MODE === "dev") {
      return "dev";
    }
    if (process.env.AUTH_MODE === "external") {
      return "external";
    }
    return "password";
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

  externalAuthorizationUrl(state: string, codeChallenge: string): string {
    this.assertExternalAuthMode();
    const url = new URL(this.requiredExternalEnv("EXTERNAL_AUTH_AUTHORIZE_URL"));
    url.searchParams.set("client_id", this.requiredExternalEnv("EXTERNAL_AUTH_CLIENT_ID"));
    url.searchParams.set("redirect_uri", this.externalCallbackUrl());
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", "openid email profile");
    url.searchParams.set("state", state);
    url.searchParams.set("code_challenge", codeChallenge);
    url.searchParams.set("code_challenge_method", "S256");
    return url.toString();
  }

  async loginWithExternalProvider(code: string, codeVerifier: string): Promise<AuthUser> {
    this.assertExternalAuthMode();
    const accessToken = await this.exchangeExternalCode(code, codeVerifier);
    const profile = await this.fetchExternalProfile(accessToken);
    const email = profile.email?.trim().toLowerCase();
    const requireVerifiedEmail = envOrDefault("EXTERNAL_AUTH_REQUIRE_VERIFIED_EMAIL", "false") === "true";
    if (!email) {
      throw new BadRequestException("External auth account must have an email address");
    }
    if (requireVerifiedEmail && profile.email_verified !== true) {
      throw new BadRequestException("External auth account email must be verified");
    }

    const user = await this.upsertOAuthUser({
      provider: envOrDefault("EXTERNAL_AUTH_PROVIDER_ID", "external"),
      providerAccountId: profile.sub,
      providerUsername: profile.preferred_username ?? profile.email ?? null,
      email,
      username: profile.preferred_username || profile.name || email.split("@")[0]
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
      username
    });
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

  private externalCallbackUrl(): string {
    return envOrDefault(
      "EXTERNAL_AUTH_CALLBACK_URL",
      `${envOrDefault("API_ORIGIN", "http://localhost:3001")}/auth/external/callback`
    );
  }

  private assertExternalAuthMode() {
    if (this.authMode() !== "external") {
      throw new ServiceUnavailableException("External auth is disabled");
    }
  }

  private assertPasswordAuthMode() {
    if (this.authMode() !== "password") {
      throw new ServiceUnavailableException("Password auth is disabled");
    }
  }

  private requiredExternalEnv(name: string): string {
    const value = process.env[name]?.trim();
    if (!value) {
      throw new ServiceUnavailableException("External auth is not configured");
    }
    return value;
  }

  private async exchangeExternalCode(code: string, codeVerifier: string): Promise<string> {
    const body = new URLSearchParams({
      client_id: this.requiredExternalEnv("EXTERNAL_AUTH_CLIENT_ID"),
      code,
      code_verifier: codeVerifier,
      grant_type: "authorization_code",
      redirect_uri: this.externalCallbackUrl()
    });
    const clientSecret = process.env.EXTERNAL_AUTH_CLIENT_SECRET?.trim();
    if (clientSecret) {
      body.set("client_secret", clientSecret);
    }

    const response = await fetch(this.requiredExternalEnv("EXTERNAL_AUTH_TOKEN_URL"), {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: body.toString()
    });
    const json = (await response.json()) as OAuthTokenResponse;
    if (!response.ok || !json.access_token) {
      throw new UnauthorizedException(json.error_description || json.error || "External OAuth token exchange failed");
    }
    return json.access_token;
  }

  private async fetchExternalProfile(accessToken: string): Promise<OidcUserInfoResponse> {
    const response = await fetch(this.requiredExternalEnv("EXTERNAL_AUTH_USERINFO_URL"), {
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    });
    if (!response.ok) {
      throw new UnauthorizedException("Could not fetch external auth profile");
    }
    return (await response.json()) as OidcUserInfoResponse;
  }

  private async upsertOAuthUser(input: {
    provider: string;
    providerAccountId: string;
    providerUsername: string | null;
    email: string;
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
