import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { AuthenticatedRequest } from "../auth/auth.guard";
import { AuthService } from "../auth/auth.service";

@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!request.user) {
      throw new UnauthorizedException("Authentication required");
    }
    if (!this.auth.isAdmin(request.user)) {
      throw new ForbiddenException("Administrator access required");
    }
    return true;
  }
}
