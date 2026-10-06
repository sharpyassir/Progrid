import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RequireScopes, StaffAreas } from '../../common/auth/decorators';
import { verifyAuditChain } from './audit-chain';

/** Back office: integrity check of the audit log hash chain (also `prisma/verify-audit-chain.ts`). */
@ApiTags('admin')
@ApiBearerAuth()
@Controller('admin/v1/audit')
@RequireScopes('admin')
export class AuditAdminController {
  constructor(private readonly prisma: PrismaService) {}

  @StaffAreas('support')
  @Get('verify')
  verify() {
    return verifyAuditChain(this.prisma);
  }
}
