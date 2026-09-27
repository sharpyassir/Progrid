import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Actor } from './actor';

export const SCOPES_KEY = 'pgcloud:scopes';
export const PUBLIC_KEY = 'pgcloud:public';

/** Scopes required to call this handler. An actor needs every listed scope. */
export const RequireScopes = (...scopes: string[]) => SetMetadata(SCOPES_KEY, scopes);

/** Marks a route as not requiring authentication (signup, login, health). */
export const Public = () => SetMetadata(PUBLIC_KEY, true);

export const CurrentActor = createParamDecorator((_: unknown, ctx: ExecutionContext): Actor => {
  return ctx.switchToHttp().getRequest().actor;
});

export const STAFF_AREA_KEY = 'staffArea';
export type StaffArea = 'support' | 'finance' | 'ops' | 'any';
/**
 * Marks a back office route with the staff areas that may use it. Full staff (the `admin`
 * scope) can use every route; staff limited to some areas get `admin:<area>` scopes instead.
 * Routes without an area stay full staff only.
 */
export const StaffAreas = (...areas: StaffArea[]) => SetMetadata(STAFF_AREA_KEY, areas);
