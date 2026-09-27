import { Controller, Get, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ApiTags } from '@nestjs/swagger';
import { Public } from './common/auth/decorators';
import { PrismaService } from './common/prisma/prisma.service';
import { NatsService } from './common/nats/nats.service';

@ApiTags('meta')
@Controller()
export class HealthController {
  constructor(private readonly prisma: PrismaService, private readonly nats: NatsService) {}

  @Public() @Get('healthz')
  /** 200 when the database answers, 503 otherwise, so Docker, the deploy script and uptime checks see a real failure. */
  async health(@Res({ passthrough: true }) res: Response) {
    const db = await this.prisma.$queryRaw`SELECT 1`.then(() => 'ok').catch(() => 'down');
    const status = db === 'ok' ? 'ok' : 'degraded';
    if (status !== 'ok') res.status(503);
    return { status, db, nats: this.nats.connected ? 'ok' : 'down', version: process.env.npm_package_version ?? 'dev' };
  }
}
