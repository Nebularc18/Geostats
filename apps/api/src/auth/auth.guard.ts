import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import { Request } from "express";
import { AuthService } from "./auth.service";

export interface AuthenticatedRequest extends Request {
  user: {
    id: string;
    email: string;
    username: string;
  };
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const bearer = request.headers.authorization?.startsWith("Bearer ")
      ? request.headers.authorization.slice("Bearer ".length)
      : null;
    const token = request.cookies?.geostats_session ?? bearer;
    if (!token) {
      if (this.auth.authMode() === "dev") {
        request.user = await this.auth.devUser();
        return true;
      }
      throw new UnauthorizedException("Authentication required");
    }

    try {
      request.user = await this.auth.verify(token);
    } catch {
      throw new UnauthorizedException("Invalid or expired token");
    }
    return true;
  }
}
