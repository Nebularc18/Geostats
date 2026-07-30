import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Logger,
  Post,
  Query,
  Res,
  ServiceUnavailableException,
  UnauthorizedException,
  UseGuards
} from "@nestjs/common";
import { Response } from "express";
import { AuthUser } from "@geostats/shared";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { AuthService } from "./auth.service";
import { AuthGuard } from "./auth.guard";
import { CurrentUser } from "./current-user.decorator";
import { envOrDefault } from "../common/env";

@Controller("auth")
export class AuthController {
  private readonly logger = new Logger(AuthController.name);
  private readonly mobileExchangeCodes = new Map<string, { codeChallenge: string; expiresAt: number; token: string; user: AuthUser }>();

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
  mobileExternal(
    @Query("redirectUri") redirectUri: string | undefined,
    @Query("codeChallenge") mobileCodeChallenge: string | undefined,
    @Res({ passthrough: true }) response: Response
  ) {
    if (!redirectUri || !this.isAllowedMobileRedirectUri(redirectUri)) {
      throw new BadRequestException("Invalid mobile redirect URI");
    }
    if (!mobileCodeChallenge || !this.isValidCodeVerifier(mobileCodeChallenge)) {
      throw new BadRequestException("Invalid mobile code challenge");
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
    response.cookie("geostats_mobile_code_challenge", mobileCodeChallenge, {
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

  @Post("mobile/exchange")
  async mobileExchange(@Body() body: { code?: unknown; codeVerifier?: unknown }) {
    if (typeof body.code !== "string" || typeof body.codeVerifier !== "string") {
      throw new BadRequestException("Mobile auth code and verifier are required");
    }
    const record = this.mobileExchangeCodes.get(body.code);
    if (!record || record.expiresAt < Date.now()) {
      if (record) {
        this.mobileExchangeCodes.delete(body.code);
      }
      throw new UnauthorizedException("Invalid or expired mobile auth code");
    }
    if (!this.isValidCodeVerifier(body.codeVerifier) || !this.safeEqual(record.codeChallenge, body.codeVerifier)) {
      throw new UnauthorizedException("Invalid mobile auth verifier");
    }
    this.mobileExchangeCodes.delete(body.code);
    return { user: record.user, token: record.token };
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
    const mobileCodeChallenge = response.req.cookies?.geostats_mobile_code_challenge;
    response.clearCookie("geostats_oauth_state");
    response.clearCookie("geostats_oauth_code_verifier");
    if (mobileRedirectUri) {
      response.clearCookie("geostats_mobile_redirect_uri");
    }
    if (mobileCodeChallenge) {
      response.clearCookie("geostats_mobile_code_challenge");
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
        if (!this.isValidCodeVerifier(mobileCodeChallenge)) {
          response.redirect(this.mobileLoginUrl(mobileRedirectUri, "external"));
          return;
        }
        const mobileCode = this.createMobileExchangeCode(token, user, mobileCodeChallenge);
        response.redirect(this.mobileLoginUrl(mobileRedirectUri, undefined, mobileCode));
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

  private webRedirectUrl(returnTo?: string): string {
    if (returnTo && returnTo.startsWith("/") && !returnTo.startsWith("//")) {
      return new URL(returnTo, envOrDefault("WEB_ORIGIN", "http://localhost:3000")).toString();
    }
    return new URL("/dashboard", envOrDefault("WEB_ORIGIN", "http://localhost:3000")).toString();
  }

  private mobileLoginUrl(redirectUri: string, authError?: string, code?: string): string {
    const url = new URL(redirectUri);
    const params = new URLSearchParams();
    if (authError) params.set("authError", authError);
    if (code) params.set("code", code);
    url.hash = params.toString();
    return url.toString();
  }

  private createMobileExchangeCode(token: string, user: AuthUser, codeChallenge: string) {
    this.pruneMobileExchangeCodes();
    const code = this.base64Url(randomBytes(32));
    this.mobileExchangeCodes.set(code, {
      codeChallenge,
      expiresAt: Date.now() + 2 * 60 * 1000,
      token,
      user
    });
    return code;
  }

  private pruneMobileExchangeCodes() {
    const now = Date.now();
    for (const [code, record] of this.mobileExchangeCodes) {
      if (record.expiresAt < now) {
        this.mobileExchangeCodes.delete(code);
      }
    }
  }

  private isValidCodeVerifier(value: unknown): value is string {
    return typeof value === "string" && /^[A-Za-z0-9._~-]{43,128}$/.test(value);
  }

  private safeEqual(left: string, right: string) {
    const leftBuffer = Buffer.from(left);
    const rightBuffer = Buffer.from(right);
    return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
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
    if (process.env.NODE_ENV === "production") {
      return false;
    }
    if (url.protocol === "geostats:" && url.hostname === "auth" && (url.pathname === "" || url.pathname === "/")) {
      return true;
    }
    return this.isAllowedExpoGoRedirectUri(url);
  }

  private isAllowedExpoGoRedirectUri(url: URL): boolean {
    if (url.protocol !== "exp:" && url.protocol !== "exps:") {
      return false;
    }
    if (url.pathname !== "/--/auth") {
      return false;
    }
    const hostname = url.hostname.toLowerCase();
    return hostname === "localhost" || hostname === "127.0.0.1" || this.isPrivateIpv4Host(hostname);
  }

  private isPrivateIpv4Host(hostname: string): boolean {
    const parts = hostname.split(".");
    if (parts.length !== 4 || parts.some((part) => !/^\d+$/.test(part))) {
      return false;
    }
    const octets = parts.map(Number);
    if (octets.some((octet) => octet > 255)) {
      return false;
    }
    return octets[0] === 10
      || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31)
      || (octets[0] === 192 && octets[1] === 168);
  }
}
