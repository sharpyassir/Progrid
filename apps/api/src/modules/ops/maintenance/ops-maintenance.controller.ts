import { Controller, Get, HttpCode, Param, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { IsIn, IsOptional, IsString } from 'class-validator';
import type { MaintenanceRunStatus } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { ApiError } from '../../../common/errors/api-error';
import { MaintenanceService } from '../../managed/maintenance/maintenance.service';
import { AssignmentGuard, EngineerGuard, ResidencyGuard } from '../guards/ops.guards';
import { Ops, OpsRefs, Residency, contractFilter, type OpsContext } from '../guards/ops-context';
import { OpsAudit } from '../ops-audit.service';
import { OpsHooks } from '../ops-hooks.service';
import { opsRun, opsTask } from '../serializers/ops-dto';

class TaskQuery {
  @IsOptional() @IsString() contractId?: string;
  @IsOptional() @IsString() assetId?: string;
}

class RunQuery {
  @IsOptional() @IsString() taskId?: string;
  @IsOptional() @IsString() contractId?: string;
  @IsOptional() @IsIn(['QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED']) status?: MaintenanceRunStatus;
}

const runInclude = { task: { select: { id: true, name: true, kind: true, contractId: true, assetId: true } } } as const;

/**
 * Maintenance from the ops console (spec 5.5): tasks on the engineer's contracts, run now,
 * retry a failed run, and the live log. Runs always execute on the platform (Temporal and the
 * configured runner), never from the engineer's machine; a failed run opens a P3 ticket
 * assigned to the engineer who started it.
 */
@ApiTags('ops')
@ApiBearerAuth()
@UseGuards(EngineerGuard, AssignmentGuard, ResidencyGuard)
@Controller('ops/v1/maintenance')
export class OpsMaintenanceController {
  constructor(private readonly prisma: PrismaService, private readonly maintenance: MaintenanceService, private readonly audit: OpsAudit, private readonly hooks: OpsHooks) {}

  @Get('tasks')
  async tasks(@Ops() ops: OpsContext, @Query() q: TaskQuery) {
    const rows = await this.prisma.maintenanceTask.findMany({
      where: { contractId: q.contractId ?? contractFilter(ops), ...(q.assetId ? { assetId: q.assetId } : {}), contract: { status: { in: ['ONBOARDING', 'ACTIVE', 'SUSPENDED'] } } },
      include: { asset: { select: { id: true, name: true } } },
      orderBy: [{ nextRunAt: 'asc' }],
    });
    return { data: rows.map(opsTask) };
  }

  @OpsRefs({ id: 'task' })
  @Residency()
  @Post('tasks/:id/run') @HttpCode(202)
  async run(@Ops() ops: OpsContext, @Param('id') id: string) {
    const run = await this.maintenance.runNow(ops.actor, id);
    await this.started(ops, run.id, 'ops.maintenance_run_started');
    return this.get(ops, run.id);
  }

  @Get('runs')
  async runs(@Ops() ops: OpsContext, @Query() q: RunQuery) {
    const rows = await this.prisma.maintenanceRun.findMany({
      where: { ...(q.taskId ? { taskId: q.taskId } : {}), ...(q.status ? { status: q.status } : {}), task: { contractId: q.contractId ?? contractFilter(ops) } },
      include: runInclude,
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    return { data: rows.map((r) => opsRun(r)) };
  }

  @OpsRefs({ id: 'run' })
  @Get('runs/:id')
  async get(@Ops() _ops: OpsContext, @Param('id') id: string) {
    return opsRun(await this.prisma.maintenanceRun.findUniqueOrThrow({ where: { id }, include: runInclude }), true);
  }

  /** Starts the failed run's task again (a new run with trigger retry). */
  @OpsRefs({ id: 'run' })
  @Residency()
  @Post('runs/:id/retry') @HttpCode(202)
  async retry(@Ops() ops: OpsContext, @Param('id') id: string) {
    const failed = await this.prisma.maintenanceRun.findUniqueOrThrow({ where: { id } });
    if (failed.status !== 'FAILED') throw ApiError.invalidState('Only a failed run can be retried');
    const run = await this.maintenance.runNow(ops.actor, failed.taskId, 'retry');
    await this.started(ops, run.id, 'ops.maintenance_run_retried', id);
    return this.get(ops, run.id);
  }

  /**
   * The run's log as Server Sent Events while the runner writes it: `log` events carry
   * {offset, chunk}, a `status` event each status change, and `end` the final status. Send the
   * ops session as a Bearer token (fetch streaming) or rely on the prgd_ops_session cookie
   * (EventSource).
   */
  @OpsRefs({ id: 'run' })
  @Get('runs/:id/stream')
  async stream(@Param('id') id: string, @Req() req: Request, @Res() res: Response) {
    res.status(200);
    res.setHeader('content-type', 'text/event-stream; charset=utf-8');
    res.setHeader('cache-control', 'no-cache, no-transform');
    res.setHeader('x-accel-buffering', 'no');
    res.flushHeaders();
    let closed = false;
    req.on('close', () => {
      closed = true;
    });
    const send = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    let offset = 0;
    let status = '';
    const deadline = Date.now() + 3 * 3600_000;
    while (!closed && Date.now() < deadline) {
      const r = await this.prisma.maintenanceRun.findUnique({ where: { id }, select: { status: true, log: true, error: true, finishedAt: true } });
      if (!r) break;
      if (r.log.length > offset) {
        send('log', { offset, chunk: r.log.slice(offset) });
        offset = r.log.length;
      }
      if (r.status !== status) {
        status = r.status;
        send('status', { status });
      }
      if (r.status === 'SUCCEEDED' || r.status === 'FAILED') {
        send('end', { status: r.status, error: r.error, finishedAt: r.finishedAt });
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
      // Keep proxies from closing an idle stream.
      if (!closed) res.write(': keep-alive\n\n');
    }
    res.end();
  }

  private async started(ops: OpsContext, runId: string, event: string, retryOf?: string) {
    const run = await this.prisma.maintenanceRun.findUniqueOrThrow({ where: { id: runId }, include: { task: true } });
    await this.audit.emit(event, ops, { contractId: run.task.contractId, assetId: run.task.assetId, runId, taskId: run.taskId, retryOf: retryOf ?? null }, `maintenance_task:${run.taskId}`);
    await this.hooks.activity(ops.userId);
  }
}
