import {
  Body,
  Controller,
  Get,
  Post,
  Req,
  Query,
  Res,
  UnauthorizedException,
  UseGuards
} from "@nestjs/common";
import { Request, Response } from "express";
import { AuthUser } from "@geostats/shared";
import { Throttle } from "@nestjs/throttler";
import { AuthService } from "./auth.service";
import { AuthGuard } from "./auth.guard";
import { CurrentUser } from "./current-user.decorator";
import { envOrDefault } from "../common/env";

@Controller("auth")
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post("register")
  async register(
    @Body() body: { email?: string; username?: string; password?: string },
    @Res({ passthrough: true }) response: Response
  ) {
    const user = await this.auth.register(body.email ?? "", body.username ?? "", body.password ?? "");
    this.setCookie(response, user);
    return { user };
  }

  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post("login")
  async login(
    @Body() body: { email?: string; password?: string },
    @Res({ passthrough: true }) response: Response
  ) {
    const user = await this.auth.login(body.email ?? "", body.password ?? "");
    this.setCookie(response, user);
    return { user };
  }

  @Get("config")
  config() {
    return {
      mode: this.auth.authMode(),
      providerName: process.env.NEXT_PUBLIC_AUTH_PROVIDER_NAME?.trim() || "Clerk"
    };
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post("clerk/exchange")
  async clerkExchange(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    const user = await this.auth.loginWithClerkToken(this.bearerToken(request));
    this.setCookie(response, user);
    return { user };
  }

  @Get("mobile/dev")
  async mobileDev() {
    const user = await this.auth.devUser();
    return { user, token: this.auth.sign(user) };
  }

  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post("mobile/register")
  async mobileRegister(@Body() body: { email?: string; username?: string; password?: string }) {
    const user = await this.auth.register(body.email ?? "", body.username ?? "", body.password ?? "");
    return { user, token: this.auth.sign(user) };
  }

  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post("mobile/login")
  async mobileLogin(@Body() body: { email?: string; password?: string }) {
    const user = await this.auth.login(body.email ?? "", body.password ?? "");
    return { user, token: this.auth.sign(user) };
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post("mobile/clerk")
  async mobileClerk(@Req() request: Request) {
    const user = await this.auth.loginWithClerkToken(this.bearerToken(request));
    return { user, token: this.auth.sign(user) };
  }

  @Get("dev")
  async dev(@Query("returnTo") returnTo: string | undefined, @Res({ passthrough: true }) response: Response) {
    const user = await this.auth.devUser();
    this.setCookie(response, user);
    response.redirect(this.webRedirectUrl(returnTo));
  }

  @Post("logout")
  logout(@Res({ passthrough: true }) response: Response) {
    response.clearCookie("geostats_session");
    return { ok: true };
  }

  @Get("me")
  @UseGuards(AuthGuard)
  me(@CurrentUser() user: AuthUser) {
    return { user };
  }

  @Get("users")
  @UseGuards(AuthGuard)
  async users(@CurrentUser() user: AuthUser, @Query("query") query = "") {
    return { users: await this.auth.searchUsers(query, user.id) };
  }

  private setCookie(response: Response, user: AuthUser) {
    const token = this.auth.sign(user);
    response.cookie("geostats_session", token, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 30 * 24 * 60 * 60 * 1000
    });
    return token;
  }

  private webRedirectUrl(returnTo?: string): string {
    if (returnTo && returnTo.startsWith("/") && !returnTo.startsWith("//")) {
      return new URL(returnTo, envOrDefault("WEB_ORIGIN", "http://localhost:3000")).toString();
    }
    return new URL("/dashboard", envOrDefault("WEB_ORIGIN", "http://localhost:3000")).toString();
  }

  private bearerToken(request: Request): string {
    const authorization = request.headers.authorization;
    if (!authorization?.startsWith("Bearer ")) {
      throw new UnauthorizedException("Clerk bearer token is required");
    }
    return authorization.slice("Bearer ".length).trim();
  }
}
