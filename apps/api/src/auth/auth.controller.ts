import { Body, Controller, Get, Post, Res, UseGuards } from "@nestjs/common";
import { Response } from "express";
import { AuthUser } from "@geostats/shared";
import { IsEmail, IsNotEmpty, MaxLength, MinLength } from "class-validator";
import { AuthService } from "./auth.service";
import { AuthGuard } from "./auth.guard";
import { CurrentUser } from "./current-user.decorator";

class CredentialsDto {
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @IsNotEmpty()
  @MinLength(8)
  @MaxLength(128)
  password!: string;
}

class RegisterDto extends CredentialsDto {
  @IsNotEmpty()
  @MinLength(3)
  @MaxLength(40)
  username!: string;
}

@Controller("auth")
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post("register")
  async register(@Body() body: RegisterDto, @Res({ passthrough: true }) response: Response) {
    const user = await this.auth.register(body.email, body.username, body.password);
    this.setCookie(response, user);
    return { user };
  }

  @Post("login")
  async login(@Body() body: CredentialsDto, @Res({ passthrough: true }) response: Response) {
    const user = await this.auth.login(body.email, body.password);
    this.setCookie(response, user);
    return { user };
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
}
