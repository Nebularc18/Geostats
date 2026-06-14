import { BadRequestException, Body, Controller, Get, Logger, Post, Query, Res, ServiceUnavailableException, UseGuards } from "@nestjs/common";
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
    const directLoginUrl = process.env.EXTERNAL_AUTH_DIRECT_LOGIN_URL?.trim();
    if (directLoginUrl) {
      if (!this.isAbsoluteHttpUrl(directLoginUrl)) {
        this.logger.error(`EXTERNAL_AUTH_DIRECT_LOGIN_URL is not an absolute HTTP(S) URL: ${directLoginUrl}`);
        throw new ServiceUnavailableException("External auth direct login URL is invalid");
      }
      response.type("html").send(this.externalLoginForm(directLoginUrl, this.auth.externalAuthorizationUrl(state, codeChallenge)));
      return;
    }
    response.redirect(this.auth.externalAuthorizationUrl(state, codeChallenge));
  }

  @Get("config")
  config() {
    return {
      mode: this.auth.authMode(),
      providerName: envOrDefault("NEXT_PUBLIC_AUTH_PROVIDER_NAME", "Home Auth")
    };
  }

  @Get("mobile/external")
  mobileExternal(@Query("redirectUri") redirectUri: string | undefined, @Res({ passthrough: true }) response: Response) {
    if (!redirectUri || !this.isAllowedMobileRedirectUri(redirectUri)) {
      throw new BadRequestException("Invalid mobile redirect URI");
    }

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
    response.cookie("geostats_mobile_redirect_uri", redirectUri, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 10 * 60 * 1000
    });
    response.redirect(this.auth.externalAuthorizationUrl(state, codeChallenge));
  }

  @Get("mobile/dev")
  async mobileDev() {
    const user = await this.auth.devUser();
    return { user, token: this.auth.sign(user) };
  }

  @Post("mobile/register")
  async mobileRegister(@Body() body: { email?: string; username?: string; password?: string }) {
    const user = await this.auth.register(body.email ?? "", body.username ?? "", body.password ?? "");
    return { user, token: this.auth.sign(user) };
  }

  @Post("mobile/login")
  async mobileLogin(@Body() body: { email?: string; password?: string }) {
    const user = await this.auth.login(body.email ?? "", body.password ?? "");
    return { user, token: this.auth.sign(user) };
  }

  @Get("external/callback")
  async externalCallback(
    @Query("code") code: string | undefined,
    @Query("state") state: string | undefined,
    @Res({ passthrough: true }) response: Response
  ) {
    const expectedState = response.req.cookies?.geostats_oauth_state;
    const codeVerifier = response.req.cookies?.geostats_oauth_code_verifier;
    const mobileRedirectUri = response.req.cookies?.geostats_mobile_redirect_uri;
    response.clearCookie("geostats_oauth_state");
    response.clearCookie("geostats_oauth_code_verifier");
    if (mobileRedirectUri) {
      response.clearCookie("geostats_mobile_redirect_uri");
    }
    if (!code || !state || !expectedState || state !== expectedState || !codeVerifier) {
      if (mobileRedirectUri && this.isAllowedMobileRedirectUri(mobileRedirectUri)) {
        response.redirect(this.mobileLoginUrl(mobileRedirectUri, "external"));
        return;
      }
      response.redirect(this.loginUrl("external"));
      return;
    }

    try {
      const user = await this.auth.loginWithExternalProvider(code, codeVerifier);
      const token = this.setCookie(response, user);
      if (mobileRedirectUri && this.isAllowedMobileRedirectUri(mobileRedirectUri)) {
        response.redirect(this.mobileLoginUrl(mobileRedirectUri, undefined, token));
        return;
      }
      response.redirect(`${envOrDefault("WEB_ORIGIN", "http://localhost:3000")}/dashboard`);
    } catch (error) {
      this.logger.error("External OAuth callback error", error);
      if (mobileRedirectUri && this.isAllowedMobileRedirectUri(mobileRedirectUri)) {
        response.redirect(this.mobileLoginUrl(mobileRedirectUri, "external"));
        return;
      }
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
    const token = this.auth.sign(user);
    response.cookie("geostats_session", token, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 30 * 24 * 60 * 60 * 1000
    });
    return token;
  }

  private base64Url(value: Buffer): string {
    return value.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  }

  private externalLoginForm(action: string, returnTo: string): string {
    return `<!doctype html><html><head><meta charset="utf-8"><title>Redirecting</title></head><body><form method="post" action="${this.escapeHtml(action)}"><input type="hidden" name="returnTo" value="${this.escapeHtml(returnTo)}"><button type="submit">Continue</button></form><script>document.forms[0].submit();</script></body></html>`;
  }

  private escapeHtml(value: string): string {
    return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  private isAbsoluteHttpUrl(value: string): boolean {
    try {
      const url = new URL(value);
      return url.protocol === "http:" || url.protocol === "https:";
    } catch {
      return false;
    }
  }

  private loginUrl(authError?: string): string {
    const url = new URL("/login", envOrDefault("WEB_ORIGIN", "http://localhost:3000"));
    if (authError) {
      url.searchParams.set("authError", authError);
    }
    return url.toString();
  }

  private mobileLoginUrl(redirectUri: string, authError?: string, token?: string): string {
    const url = new URL(redirectUri);
    const params = new URLSearchParams();
    if (authError) params.set("authError", authError);
    if (token) params.set("token", token);
    url.hash = params.toString();
    return url.toString();
  }

  private isAllowedMobileRedirectUri(redirectUri: string): boolean {
    let url: URL;
    try {
      url = new URL(redirectUri);
    } catch {
      return false;
    }
    const configured = process.env.MOBILE_AUTH_REDIRECT_URI?.trim();
    if (configured) {
      return redirectUri === configured;
    }
    return url.protocol === "geostats:" && url.hostname === "auth" && (url.pathname === "" || url.pathname === "/");
  }
}
