import { Body, Controller, Get, Headers, Param, Post, Query, Req, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { Public } from '../../common/auth/decorators';
import { RunsService, type PublicResult } from './runs.service';
import { PublicRunDto } from './dto';

/**
 * Public Connect endpoints: the run API every deployed agent has, and inbound webhooks. No
 * console session; agent keys (prgd_ca_...), team API tokens with connect:write, or the
 * webhook's URL token (plus an optional HMAC signature).
 */
@ApiTags('connect-public')
@Controller('v1/connect')
export class ConnectPublicController {
  constructor(private readonly runs: RunsService) {}

  private send(res: Response, r: PublicResult) {
    res.status(r.status);
    for (const [k, v] of Object.entries(r.headers ?? {})) res.setHeader(k, v);
    return r.body;
  }

  @Public()
  @Post('agents/:id/run')
  async run(@Param('id') id: string, @Headers('authorization') authorization: string | undefined, @Headers('idempotency-key') idem: string | undefined, @Body() dto: PublicRunDto, @Res({ passthrough: true }) res: Response) {
    return this.send(res, await this.runs.publicRun(id, authorization, dto, idem));
  }

  @Public()
  @Get('agents/:id/runs/:runId')
  publicRun(@Param('id') id: string, @Param('runId') runId: string, @Headers('authorization') authorization: string | undefined, @Query('steps') steps?: string) {
    return this.runs.publicGet(id, runId, authorization, steps === '1' || steps === 'true');
  }

  @Public()
  @Post('hooks/:hookId/:token')
  async hook(@Param('hookId') hookId: string, @Param('token') token: string, @Req() req: Request & { rawBody?: Buffer }, @Res({ passthrough: true }) res: Response) {
    return this.send(res, await this.runs.hook(hookId, token, { rawBody: req.rawBody, body: req.body, headers: req.headers }));
  }
}
