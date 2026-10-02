import type { INestApplication } from '@nestjs/common';
import type { CorsOptions, CorsOptionsDelegate } from '@nestjs/common/interfaces/external/cors-options.interface';
import type { Request } from 'express';
import { allowedOrigins } from '../entities/entities';
import { requestContextMiddleware } from '../entities/request-context';

/**
 * CORS for both public domains. Our own pages (www, console and ops on progrid.co and progrid.sa,
 * plus the configured URLs) may call the API with credentials: the ops console uses a cookie.
 * Any other origin still gets a CORS answer without credentials, so customer apps can call the
 * API from a browser with a bearer token (Connect run endpoints, for example).
 */
export const corsDelegate: CorsOptionsDelegate<Request> = (req, cb) => {
  const origin = typeof req.headers.origin === 'string' ? req.headers.origin.replace(/\/+$/, '') : undefined;
  const ours = !!origin && allowedOrigins().has(origin);
  const options: CorsOptions = { origin: origin ? [origin] : false, credentials: ours, maxAge: 600 };
  cb(null, options);
};

/** HTTP setup shared by main.ts and the integration harness. */
export function configureHttp(app: INestApplication) {
  app.use(requestContextMiddleware);
  app.enableCors(corsDelegate as CorsOptionsDelegate<unknown>);
}
