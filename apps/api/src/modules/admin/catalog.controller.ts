import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsOptional, IsString, Length, Matches, Max, Min } from 'class-validator';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CurrentActor, RequireScopes, StaffAreas } from '../../common/auth/decorators';
import type { Actor } from '../../common/auth/actor';
import { EventsService } from '../events/events.service';
import { ApiError } from '../../common/errors/api-error';

class CreateIpBlockDto {
  @Matches(/^\d{1,3}(\.\d{1,3}){3}\/\d{1,2}$/, { message: 'cidr must be an IPv4 block like 203.0.113.0/24' }) cidr: string;
  @IsString() regionId: string;
  @Matches(/^\d{1,3}(\.\d{1,3}){3}$/, { message: 'gateway must be an IPv4 address' }) gateway: string;
  @IsOptional() @IsBoolean() owned?: boolean;
}

class CreateImageDto {
  @IsString() @Length(1, 80) name: string;
  /** Becomes the image id customers pass as `image`, e.g. "ubuntu-24-04". */
  @Matches(/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/, { message: 'slug must be lowercase letters, digits and dashes' }) slug: string;
  @IsString() @Length(1, 40) distribution: string;
  @IsString() @Length(1, 40) version: string;
  @IsOptional() @IsString() regionId?: string;
  /** Proxmox template VMID the image clones from. */
  @IsInt() @Min(100) @Max(999_999_999) templateId: number;
  @IsOptional() @IsBoolean() available?: boolean;
  @IsOptional() @IsInt() @Min(1) minDiskGb?: number;
  @IsOptional() @IsInt() @Min(128) minMemoryMb?: number;
}

class UpdateImageDto {
  @IsOptional() @IsString() @Length(1, 80) name?: string;
  @IsOptional() @IsString() @Length(1, 40) distribution?: string;
  @IsOptional() @IsString() @Length(1, 40) version?: string;
  /** Empty string makes the image available in every region. */
  @IsOptional() @IsString() regionId?: string;
  @IsOptional() @IsInt() @Min(100) @Max(999_999_999) templateId?: number;
  @IsOptional() @IsBoolean() available?: boolean;
  @IsOptional() @IsInt() @Min(1) minDiskGb?: number;
  @IsOptional() @IsInt() @Min(128) minMemoryMb?: number;
}

/** Largest block expanded into PublicIp rows in one call (a /20). */
const MIN_PREFIX = 20;

/**
 * Back office catalog: public IPv4 blocks and operating system images. Until these existed
 * only the seed could add them.
 */
@ApiTags('admin')
@ApiBearerAuth()
@Controller('admin/v1')
@RequireScopes('admin')
export class AdminCatalogController {
  constructor(private readonly prisma: PrismaService, private readonly events: EventsService) {}

  // ---- IP blocks ----

  @StaffAreas('ops')
  @Get('ip-blocks')
  async ipBlocks(@Query('region') region?: string) {
    const blocks = await this.prisma.ipBlock.findMany({ where: region ? { regionId: region } : {}, orderBy: { cidr: 'asc' } });
    const counts = await this.prisma.publicIp.groupBy({ by: ['blockId', 'status'], _count: true });
    return {
      data: blocks.map((b) => {
        const mine = counts.filter((c) => c.blockId === b.id);
        const total = mine.reduce((n, c) => n + c._count, 0);
        const free = mine.find((c) => c.status === 'free')?._count ?? 0;
        return { ...b, total, free, allocated: total - free };
      }),
    };
  }

  /** Registers a block and expands it into one free PublicIp per usable address. */
  @StaffAreas('ops')
  @Post('ip-blocks')
  async createIpBlock(@CurrentActor() actor: Actor, @Body() dto: CreateIpBlockDto) {
    const [base, prefix] = parseCidr(dto.cidr);
    if (prefix < MIN_PREFIX || prefix > 32) throw ApiError.invalid(`Prefix must be between /${MIN_PREFIX} and /32`);
    const network = (base & mask(prefix)) >>> 0;
    if (network !== base) throw ApiError.invalid(`${dto.cidr} is not a network address; did you mean ${toIp(network)}/${prefix}?`);
    const size = 2 ** (32 - prefix);
    const gateway = parseIp(dto.gateway);
    if (gateway < network || gateway >= network + size) throw ApiError.invalid('The gateway must be inside the block');
    if (!(await this.prisma.region.findUnique({ where: { id: dto.regionId } }))) throw ApiError.invalid(`Unknown region "${dto.regionId}"`);
    for (const other of await this.prisma.ipBlock.findMany({ select: { cidr: true } })) {
      const [ob, op] = parseCidr(other.cidr);
      const oStart = (ob & mask(op)) >>> 0;
      if (network < oStart + 2 ** (32 - op) && oStart < network + size) throw ApiError.conflict('ip_block_overlap', `${dto.cidr} overlaps ${other.cidr}`);
    }
    // Skip the network and broadcast addresses (except on /31 and /32) and the gateway.
    const addresses: string[] = [];
    for (let i = 0; i < size; i++) {
      const a = network + i;
      if (prefix < 31 && (i === 0 || i === size - 1)) continue;
      if (a === gateway) continue;
      addresses.push(toIp(a));
    }
    const block = await this.prisma.$transaction(async (tx) => {
      const b = await tx.ipBlock.create({ data: { cidr: `${toIp(network)}/${prefix}`, regionId: dto.regionId, gateway: dto.gateway, owned: !!dto.owned } });
      await tx.publicIp.createMany({ data: addresses.map((address) => ({ address, regionId: dto.regionId, blockId: b.id })), skipDuplicates: true });
      return b;
    });
    await this.events.emit('admin.ip_block_created', { blockId: block.id, cidr: block.cidr, addresses: addresses.length }, { actor });
    return { ...block, total: addresses.length, free: addresses.length, allocated: 0 };
  }

  /** Removes a block and its addresses. Refused while any address is reserved or assigned. */
  @StaffAreas('ops')
  @Delete('ip-blocks/:id') @HttpCode(204)
  async deleteIpBlock(@CurrentActor() actor: Actor, @Param('id') id: string) {
    const block = await this.prisma.ipBlock.findUnique({ where: { id } });
    if (!block) throw ApiError.notFound('ip block', id);
    const allocated = await this.prisma.publicIp.count({ where: { blockId: id, status: { not: 'free' } } });
    if (allocated) throw ApiError.invalidState(`${allocated} addresses in ${block.cidr} are still allocated; release them first`);
    await this.prisma.$transaction([this.prisma.publicIp.deleteMany({ where: { blockId: id, status: 'free' } }), this.prisma.ipBlock.delete({ where: { id } })]);
    await this.events.emit('admin.ip_block_deleted', { blockId: id, cidr: block.cidr }, { actor });
  }

  // ---- images ----

  @StaffAreas('ops')
  @Get('images')
  async images() {
    const rows = await this.prisma.image.findMany({ include: { _count: { select: { servers: true } } }, orderBy: [{ kind: 'asc' }, { id: 'asc' }] });
    return { data: rows.map(presentImage) };
  }

  @StaffAreas('ops')
  @Post('images')
  async createImage(@CurrentActor() actor: Actor, @Body() dto: CreateImageDto) {
    if (await this.prisma.image.findUnique({ where: { id: dto.slug } })) throw ApiError.conflict('image_exists', `An image with slug "${dto.slug}" already exists`);
    if (dto.regionId && !(await this.prisma.region.findUnique({ where: { id: dto.regionId } }))) throw ApiError.invalid(`Unknown region "${dto.regionId}"`);
    const image = await this.prisma.image.create({
      data: {
        id: dto.slug,
        kind: 'distribution',
        name: dto.name,
        distribution: dto.distribution,
        version: dto.version,
        regionId: dto.regionId || null,
        driverRef: templateRef(dto.templateId),
        deprecated: dto.available === false,
        minDiskGb: dto.minDiskGb,
        minMemoryMb: dto.minMemoryMb,
      },
      include: { _count: { select: { servers: true } } },
    });
    await this.events.emit('admin.image_created', { imageId: image.id, templateId: dto.templateId }, { actor });
    return presentImage(image);
  }

  @StaffAreas('ops')
  @Patch('images/:id')
  async updateImage(@CurrentActor() actor: Actor, @Param('id') id: string, @Body() dto: UpdateImageDto) {
    if (!(await this.prisma.image.findUnique({ where: { id } }))) throw ApiError.notFound('image', id);
    if (dto.regionId && !(await this.prisma.region.findUnique({ where: { id: dto.regionId } }))) throw ApiError.invalid(`Unknown region "${dto.regionId}"`);
    const image = await this.prisma.image.update({
      where: { id },
      data: {
        name: dto.name,
        distribution: dto.distribution,
        version: dto.version,
        regionId: dto.regionId === undefined ? undefined : dto.regionId || null,
        driverRef: dto.templateId === undefined ? undefined : templateRef(dto.templateId),
        deprecated: dto.available === undefined ? undefined : !dto.available,
        minDiskGb: dto.minDiskGb,
        minMemoryMb: dto.minMemoryMb,
      },
      include: { _count: { select: { servers: true } } },
    });
    await this.events.emit('admin.image_updated', { imageId: id, ...dto }, { actor });
    return presentImage(image);
  }
}

function templateRef(templateId: number) {
  return JSON.stringify({ template: templateId });
}

function presentImage<T extends { driverRef: string | null; deprecated: boolean }>(image: T) {
  let templateId: number | null = null;
  try {
    templateId = image.driverRef ? (JSON.parse(image.driverRef).template ?? null) : null;
  } catch {
    templateId = null;
  }
  return { ...image, templateId, available: !image.deprecated };
}

function parseIp(s: string): number {
  const parts = s.split('.').map(Number);
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) throw ApiError.invalid(`"${s}" is not an IPv4 address`);
  return ((parts[0] << 24) >>> 0) + (parts[1] << 16) + (parts[2] << 8) + parts[3];
}

function parseCidr(cidr: string): [number, number] {
  const [ip, p] = cidr.split('/');
  return [parseIp(ip), Number(p)];
}

function mask(prefix: number) {
  return prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
}

function toIp(n: number) {
  return [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');
}
