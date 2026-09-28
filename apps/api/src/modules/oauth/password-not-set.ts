import { ApiError } from '../../common/errors/api-error';
import type { PrismaService } from '../../common/prisma/prisma.service';

const LABEL: Record<string, string> = { google: 'Google', microsoft: 'Microsoft' };

/** Password sign in for an account that only has Google or Microsoft: say which button to use. */
export async function passwordNotSet(prisma: PrismaService, userId: string) {
  const ids = await prisma.oAuthIdentity.findMany({ where: { userId }, select: { provider: true }, distinct: ['provider'] });
  const names = ids.map((i) => LABEL[i.provider] ?? i.provider);
  const how = names.length ? `Continue with ${names.join(' or ')}` : 'the sign in button of the provider you signed up with';
  return new ApiError(401, 'password_not_set', `This account has no password. Sign in with ${how}, or choose Forgot password to set one.`, { providers: ids.map((i) => i.provider) });
}
