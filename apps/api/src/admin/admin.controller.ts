import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { AuthUser } from "@geostats/shared";
import { AuthGuard } from "../auth/auth.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import { AdminGuard } from "./admin.guard";
import { AdminService } from "./admin.service";

@Controller("admin")
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get("access")
  @UseGuards(AuthGuard)
  access(@CurrentUser() user: AuthUser) {
    return { isAdmin: this.admin.isAdmin(user), username: user.username };
  }

  @Get("overview")
  @UseGuards(AuthGuard, AdminGuard)
  overview() {
    return this.admin.overview();
  }

  @Get("caches/missing")
  @UseGuards(AuthGuard, AdminGuard)
  missingCaches() {
    return this.admin.missingCaches();
  }

  @Get("caches")
  @UseGuards(AuthGuard, AdminGuard)
  caches(
    @Query("query") query = "",
    @Query("page") page = "1",
    @Query("pageSize") pageSize = "12",
  ) {
    return this.admin.caches(query, page, pageSize);
  }

  @Post("caches")
  @UseGuards(AuthGuard, AdminGuard)
  addCache(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    return this.admin.addCache(body, user);
  }

  @Get("users")
  @UseGuards(AuthGuard, AdminGuard)
  users(
    @Query("query") query = "",
    @Query("page") page = "1",
    @Query("pageSize") pageSize = "12",
  ) {
    return this.admin.users(query, page, pageSize);
  }

  @Get("imports")
  @UseGuards(AuthGuard, AdminGuard)
  imports(
    @Query("status") status = "",
    @Query("page") page = "1",
    @Query("pageSize") pageSize = "12",
  ) {
    return this.admin.imports(status, page, pageSize);
  }

  @Get("activity")
  @UseGuards(AuthGuard, AdminGuard)
  activity(@Query("page") page = "1", @Query("pageSize") pageSize = "12") {
    return this.admin.activity(page, pageSize);
  }

  @Post("imports/:id/retry")
  @UseGuards(AuthGuard, AdminGuard)
  retryImport(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.admin.retryImport(id, user);
  }

  @Post("users/:id/recalculate")
  @UseGuards(AuthGuard, AdminGuard)
  recalculateUser(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.admin.recalculateUser(id, user);
  }
}
