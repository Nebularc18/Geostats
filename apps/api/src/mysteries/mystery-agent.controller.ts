import { BadRequestException, Body, Controller, Get, Headers, NotFoundException, Param, Post } from "@nestjs/common";
import { Prisma } from "@geostats/db";
import { randomUUID } from "node:crypto";
import { CollectorTokenAuthService } from "../collector/collector-token-auth.service";
import { PrismaService } from "../common/prisma.service";
import { lockMystery } from "./mysteries.controller";

type AttemptState = "correct" | "wrong" | "unchecked" | "planned";
type AttemptKind = "coordinate" | "keyword" | "approach";

type AgentAttemptBody = {
  kind?: unknown;
  state?: unknown;
  answer?: unknown;
  latitude?: unknown;
  longitude?: unknown;
  finalLatitude?: unknown;
  finalLongitude?: unknown;
  note?: unknown;
  source?: unknown;
};

const MAX_SNAPSHOT_BYTES = 256 * 1024;

function gcCode(value: string) {
  const normalized = value.trim().toUpperCase();
  if (!/^GC[A-Z0-9]+$/.test(normalized)) throw new BadRequestException("A valid GC code is required");
  return normalized;
}

function optionalText(value: unknown, name: string, maxLength: number) {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") throw new BadRequestException(`${name} must be text`);
  const normalized = value.trim();
  if (normalized.length > maxLength) throw new BadRequestException(`${name} cannot exceed ${maxLength} characters`);
  return normalized || undefined;
}

function coordinate(value: unknown, name: string, limit: number) {
  if (typeof value !== "number" || !Number.isFinite(value) || Math.abs(value) > limit) {
    throw new BadRequestException(`${name} must be a valid coordinate`);
  }
  return value;
}

function normalizedAttempt(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new BadRequestException("Attempt data is required");
  }
  const body = value as AgentAttemptBody;
  const kind = body.kind as AttemptKind;
  const state = body.state as AttemptState;
  if (!(["coordinate", "keyword", "approach"] as unknown[]).includes(kind)) {
    throw new BadRequestException("kind must be coordinate, keyword, or approach");
  }
  if (!(["correct", "wrong", "unchecked", "planned"] as unknown[]).includes(state)) {
    throw new BadRequestException("state must be correct, wrong, unchecked, or planned");
  }

  const answer = optionalText(body.answer, kind === "approach" ? "Approach" : "Answer", 2_000);
  if (kind !== "coordinate" && !answer) throw new BadRequestException(`${kind} requires an answer`);

  const hasFinalLatitude = body.finalLatitude !== undefined;
  const hasFinalLongitude = body.finalLongitude !== undefined;
  if (hasFinalLatitude !== hasFinalLongitude) throw new BadRequestException("Final latitude and longitude must be supplied together");
  const note = optionalText(body.note, "Note", 4_000);
  const source = optionalText(body.source, "Source", 100);

  return {
    kind,
    state,
    ...(kind === "coordinate" ? {
      latitude: coordinate(body.latitude, "latitude", 90),
      longitude: coordinate(body.longitude, "longitude", 180)
    } : { answer }),
    ...(hasFinalLatitude ? {
      finalLatitude: coordinate(body.finalLatitude, "finalLatitude", 90),
      finalLongitude: coordinate(body.finalLongitude, "finalLongitude", 180)
    } : {}),
    ...(note ? { note } : {}),
    ...(source ? { source } : {})
  };
}

function record(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value) ? { ...(value as Record<string, any>) } : {};
}

function attemptKey(attempt: Record<string, any>) {
  return attempt.kind === "coordinate"
    ? `coordinate:${Number(attempt.latitude).toFixed(6)}:${Number(attempt.longitude).toFixed(6)}`
    : `${attempt.kind}:${String(attempt.answer ?? "").trim().toLocaleLowerCase()}`;
}

function solverView(workspace: { clientId: string; data: unknown; snapshotRevision: number }) {
  const mystery = record(workspace.data);
  const attempts = Array.isArray(mystery.attempts) ? mystery.attempts.map(record) : [];
  const safe = {
    id: workspace.clientId,
    gcCode: mystery.gcCode,
    name: mystery.name,
    status: mystery.status,
    publishedLatitude: mystery.publishedLatitude,
    publishedLongitude: mystery.publishedLongitude,
    area: mystery.area,
    country: mystery.country,
    notes: typeof mystery.notes === "string" ? mystery.notes : "",
    clues: Array.isArray(mystery.clues) ? mystery.clues.filter((value): value is string => typeof value === "string") : [],
    attempts
  };
  return {
    revision: workspace.snapshotRevision,
    mystery: safe,
    tried: attempts.filter((attempt) => attempt.state !== "planned"),
    notTried: attempts.filter((attempt) => attempt.state === "planned")
  };
}

@Controller("agent/mysteries")
export class MysteryAgentController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly collectorTokenAuth: CollectorTokenAuthService
  ) {}

  @Get()
  async list(@Headers("authorization") authorization?: string) {
    const userId = await this.collectorTokenAuth.userId(authorization);
    const workspaces = await this.prisma.mysteryWorkspace.findMany({
      where: { ownerId: userId },
      select: { clientId: true, data: true, snapshotRevision: true },
      orderBy: { createdAt: "asc" }
    });
    return { mysteries: workspaces.map(solverView) };
  }

  @Get(":gcCode")
  async get(@Headers("authorization") authorization: string | undefined, @Param("gcCode") code: string) {
    const userId = await this.collectorTokenAuth.userId(authorization);
    const workspace = await this.prisma.mysteryWorkspace.findUnique({
      where: { ownerId_gcCode: { ownerId: userId, gcCode: gcCode(code) } },
      select: { clientId: true, data: true, snapshotRevision: true }
    });
    if (!workspace) throw new NotFoundException("Mystery was not found in your synced workspace");
    return solverView(workspace);
  }

  @Post(":gcCode/attempts")
  async addAttempt(
    @Headers("authorization") authorization: string | undefined,
    @Param("gcCode") code: string,
    @Body() body: unknown
  ) {
    const userId = await this.collectorTokenAuth.userId(authorization);
    const normalizedCode = gcCode(code);
    const input = normalizedAttempt(body);

    const workspace = await this.prisma.$transaction(async (tx) => {
      await lockMystery(tx, userId, normalizedCode);
      const existing = await tx.mysteryWorkspace.findUnique({
        where: { ownerId_gcCode: { ownerId: userId, gcCode: normalizedCode } },
        select: { id: true, clientId: true, data: true, snapshotRevision: true }
      });
      if (!existing) throw new NotFoundException("Mystery was not found in your synced workspace");

      const mystery = record(existing.data);
      const attempts = Array.isArray(mystery.attempts) ? mystery.attempts.map(record) : [];
      const duplicateIndex = attempts.findIndex((attempt) => attemptKey(attempt) === attemptKey(input));
      const attempt = duplicateIndex >= 0
        ? { ...attempts[duplicateIndex], ...input, updatedAt: new Date().toISOString() }
        : { id: `agent-${randomUUID()}`, ...input, createdAt: new Date().toISOString() };
      if (duplicateIndex >= 0) attempts[duplicateIndex] = attempt;
      else attempts.push(attempt);

      const revealsSolution = input.state === "correct" && (input.kind === "coordinate" || "finalLatitude" in input);
      const data = { ...mystery, attempts, ...(revealsSolution ? { status: "solved" } : {}) } as Prisma.InputJsonObject;
      if (Buffer.byteLength(JSON.stringify(data), "utf8") > MAX_SNAPSHOT_BYTES) {
        throw new BadRequestException("Mystery data is too large");
      }
      const updated = await tx.mysteryWorkspace.update({
        where: { id: existing.id },
        data: { data, snapshotRevision: { increment: 1 } },
        select: { clientId: true, data: true, snapshotRevision: true }
      });
      return { updated, attempt, created: duplicateIndex < 0 };
    });

    return { ok: true, created: workspace.created, attempt: workspace.attempt, ...solverView(workspace.updated) };
  }
}
