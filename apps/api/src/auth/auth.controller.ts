import { Body, Controller, Get, Logger, Post, Query, Res, UseGuards } from "@nestjs/common";
import { Response } from "express";
import { AuthUser } from "@geostats/shared";
import { createHash, randomBytes } from "node:crypto";
import { AuthService } from "./auth.service";
import { AuthGuard } from "./auth.guard";
import { CurrentUser } from "./current-user.decorator";
import { envOrDefault } from "../common/env";

@Controller("auth")
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(private readonly auth: AuthService) {}

  @Post("register")
  async register(
    @Body() body: { email?: string; username?: string; password?: string },
    @Res({ passthrough: true }) response: Response
  ) {
    const user = await this.auth.register(body.email ?? "", body.username ?? "", body.password ?? "");
    this.setCookie(response, user);
    return { user };
  }

  @Post("login")
  async login(
    @Body() body: { email?: string; password?: string },
    @Res({ passthrough: true }) response: Response
  ) {
    const user = await this.auth.login(body.email ?? "", body.password ?? "");
    this.setCookie(response, user);
    return { user };
  }

  @Get("external")
  external(@Res({ passthrough: true }) response: Response) {
    const state = randomBytes(32).toString("hex");
    const codeVerifier = this.base64Url(randomBytes(32));
    const codeChallenge = this.base64Url(createHash("sha256").update(codeVerifier).digest());
    response.cookie("geostats_oauth_state", state, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 10 * 60 * 1000
    });
    response.cookie("geostats_oauth_code_verifier", codeVerifier, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 10 * 60 * 1000
    });
    response.redirect(this.auth.externalAuthorizationUrl(state, codeChallenge));
  }

  @Get("external/callback")
  async externalCallback(
    @Query("code") code: string | undefined,
    @Query("state") state: string | undefined,
    @Res({ passthrough: true }) response: Response
  ) {
    const expectedState = response.req.cookies?.geostats_oauth_state;
    const codeVerifier = response.req.cookies?.geostats_oauth_code_verifier;
    response.clearCookie("geostats_oauth_state");
    response.clearCookie("geostats_oauth_code_verifier");
    if (!code || !state || !expectedState || state !== expectedState || !codeVerifier) {
      response.redirect(this.loginUrl("external"));
      return;
    }

    try {
      const user = await this.auth.loginWithExternalProvider(code, codeVerifier);
      this.setCookie(response, user);
      response.redirect(`${envOrDefault("WEB_ORIGIN", "http://localhost:3000")}/dashboard`);
    } catch (error) {
      this.logger.error("External OAuth callback error", error);
      response.redirect(this.loginUrl("external"));
    }
  }

  @Get("dev")
  async dev(@Res({ passthrough: true }) response: Response) {
    const user = await this.auth.devUser();
    this.setCookie(response, user);
    response.redirect(`${envOrDefault("WEB_ORIGIN", "http://localhost:3000")}/dashboard`);
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

  private setCookie(response: Response, user: AuthUser) {
    response.cookie("geostats_session", this.auth.sign(user), {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 30 * 24 * 60 * 60 * 1000
    });
  }

  private base64Url(value: Buffer): string {
    return value.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  }

  private loginUrl(authError?: string): string {
    const url = new URL("/login", envOrDefault("WEB_ORIGIN", "http://localhost:3000"));
    if (authError) {
      url.searchParams.set("authError", authError);
    }
    return url.toString();
  }
}
