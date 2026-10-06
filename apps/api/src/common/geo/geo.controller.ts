import { Controller, Get, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { Public } from '../auth/decorators';
import { clientIpOf } from '../net/client-ip';
import { currencyForEntity, domainOfHost, entityForSignup, entityProfile } from '../entities/entities';
import { geoIpAvailable } from './geoip';
import { suggestedCountry } from './signup-country';

/**
 * Prefill for the signup form: the country to preselect and the company that will bill the account,
 * which follows the domain (progrid.sa or progrid.co). Uses the local DB-IP database; nothing leaves
 * the server.
 */
@ApiTags('auth')
@Controller('v1/geo')
export class GeoController {
  @Public() @Get()
  geo(@Req() req: Request) {
    const host = String(req.headers['x-forwarded-host'] ?? req.headers.host ?? '');
    let domain = domainOfHost(host);
    if (!domain && typeof req.headers.origin === 'string') try { domain = domainOfHost(new URL(req.headers.origin).hostname); } catch { /* not a URL */ }
    const s = suggestedCountry(clientIpOf(req), domain);
    const entity = entityForSignup(domain, s.country);
    return { country: s.country, source: s.source, billingEntity: entity, legalName: entityProfile(entity).legalName, currency: currencyForEntity(entity), database: geoIpAvailable() };
  }
}
