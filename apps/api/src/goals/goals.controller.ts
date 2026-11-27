import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from "@nestjs/common";
import { AuthUser } from "@geostats/shared";
import { AuthGuard } from "../auth/auth.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import { GoalsService, type GoalInput } from "./goals.service";

@Controller("goals")
@UseGuards(AuthGuard)
export class GoalsController {
  constructor(private readonly goals: GoalsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.goals.list(user.id);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() body: Partial<GoalInput>) {
    return this.goals.create(user.id, body);
  }

  @Patch(":id")
  update(@CurrentUser() user: AuthUser, @Param("id") id: string, @Body() body: Partial<GoalInput>) {
    return this.goals.update(user.id, id, body);
  }

  @Delete(":id")
  remove(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.goals.remove(user.id, id);
  }
}
