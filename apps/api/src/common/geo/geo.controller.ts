import { Controller, Get, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { Public } from '../auth/decorators';
import { clientIpOf } from '../net/client-ip';
import { BILLING_ENTITY, currencyForCountry, domainOfHost, entityProfile, vatFor } from '../entities/entities';
import { geoIpAvailable } from './geoip';
import { suggestedCountry } from './signup-country';

/**
 * Prefill for the signup form: the country to preselect (SA on progrid.sa, else from the caller's
 * address) and what it means: Progrid Arabia bills every account, the country decides currency and
 * VAT. Uses the local DB-IP database; nothing leaves the server.
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
    const vat = vatFor(s.country);
    return { country: s.country, source: s.source, billingEntity: BILLING_ENTITY, legalName: entityProfile(BILLING_ENTITY).legalName, currency: currencyForCountry(s.country), taxRate: vat.rate, vatCategory: vat.category, database: geoIpAvailable() };
  }
}
