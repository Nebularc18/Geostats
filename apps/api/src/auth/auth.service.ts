import { ConflictException, Injectable, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { PrismaService } from "../common/prisma.service";
import { AuthUser } from "@geostats/shared";
import bcrypt from "bcryptjs";

export interface AuthTokenPayload {
  sub: string;
  email: string;
  username: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService
  ) {}

  async register(email: string, username: string, password: string): Promise<AuthUser> {
    const normalizedEmail = email.trim().toLowerCase();
    const normalizedUsername = username.trim();
    const existing = await this.prisma.user.findFirst({
      where: { OR: [{ email: normalizedEmail }, { username: normalizedUsername }] }
    });
    if (existing) {
      throw new ConflictException("Email or username is already registered");
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const user = await this.prisma.user.create({
      data: {
        email: normalizedEmail,
        username: normalizedUsername,
        passwordHash
      }
    });
    return this.toAuthUser(user);
  }

  async login(email: string, password: string): Promise<AuthUser> {
    const user = await this.prisma.user.findUnique({ where: { email: email.trim().toLowerCase() } });
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      throw new UnauthorizedException("Invalid email or password");
    }
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
}
