import { Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import type { MarketplaceApp } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ApiError } from '../../common/errors/api-error';
import { CloudConfigMergeError, mergeCloudConfig } from './cloud-config-merge';

export interface AppVariable {
  name: string;
  label: string;
  type: 'string' | 'email' | 'password' | 'number' | 'boolean';
  required?: boolean;
  default?: string;
  generate?: 'password'; // auto-generate a secret if not supplied
}

/**
 * A marketplace app = image + cloud-init template + variables. One-click deploy is a
 * normal server create from the app's image (see ServersService.create).
 */
@Injectable()
export class MarketplaceService {
  constructor(private readonly prisma: PrismaService) {}

  list(category?: string) {
    return this.prisma.marketplaceApp.findMany({
      where: { status: 'published', ...(category ? { category } : {}) },
      select: { id: true, slug: true, name: true, category: true, summary: true, version: true, iconUrl: true, minSizeId: true, ports: true, variables: true, vendorName: true, priceMonthlyMinor: true, imageId: true },
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
    });
  }

  async get(slug: string) {
    const app = await this.prisma.marketplaceApp.findFirst({ where: { OR: [{ slug }, { id: slug }], status: 'published' }, include: { image: true } });
    if (!app) throw ApiError.notFound('app', slug);
    const { cloudInit: _omit, ...rest } = app;
    return rest;
  }

  async categories() {
    const rows = await this.prisma.marketplaceApp.groupBy({ by: ['category'], where: { status: 'published' }, _count: true });
    return rows.map((r) => ({ category: r.category, count: r._count }));
  }

  /**
   * Renders the app's cloud-init with the customer's variables. Unknown variables are
   * rejected; required ones must be present; `generate: password` fills in a secret.
   * Customer user-data, if any, is merged in: list keys (write_files, runcmd, packages,
   * bootcmd) are concatenated after the app's, and the app's value wins for every other key,
   * so user-data can add to the install but not replace it.
   */
  renderCloudInit(app: MarketplaceApp, supplied: Record<string, string>, customerUserData?: string): string {
    const vars = (app.variables as unknown as AppVariable[]) ?? [];
    const known = new Set(vars.map((v) => v.name));
    const unknown = Object.keys(supplied).filter((k) => !known.has(k));
    if (unknown.length) throw ApiError.invalid(`Unknown app variables: ${unknown.join(', ')}`);

    const values: Record<string, string> = {};
    for (const v of vars) {
      let val = supplied[v.name] ?? v.default;
      if (val == null && v.generate === 'password') val = generatePassword();
      if (val == null && v.required) throw ApiError.invalid(`App variable "${v.name}" (${v.label}) is required`);
      if (v.type === 'email' && val && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(val)) throw ApiError.invalid(`"${v.name}" must be an email`);
      values[v.name] = val ?? '';
    }

    let rendered = app.cloudInit.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, k: string) => values[k] ?? '');
    if (customerUserData?.trim()) {
      try {
        rendered = mergeCloudConfig(rendered, customerUserData);
      } catch (err) {
        if (err instanceof CloudConfigMergeError) throw ApiError.invalid(err.message);
        throw err;
      }
    }
    return rendered;
  }
}

function generatePassword(len = 20) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  // Bytes at or above the largest multiple of the alphabet size are skipped so every character is equally likely.
  const limit = 256 - (256 % alphabet.length);
  let out = '';
  while (out.length < len) {
    for (const b of randomBytes(len * 2)) {
      if (b < limit && out.length < len) out += alphabet[b % alphabet.length];
    }
  }
  return out;
}
