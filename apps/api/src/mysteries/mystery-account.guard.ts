import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import { AuthenticatedRequest } from "../auth/auth.guard";

@Injectable()
export class MysteryAccountGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    // An ambient browser cookie can change while a different account's
    // workspace stays open. Bearer clients submit their own credential.
    if (request.cookies?.geostats_session && request.headers["x-geostats-account-id"] !== request.user.id) {
      throw new UnauthorizedException("The Mystery workspace account changed. Reload before continuing.");
    }
    return true;
  }
}
