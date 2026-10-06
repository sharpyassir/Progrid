import { ValidationPipe, type INestApplication } from '@nestjs/common';
import type { CorsOptions, CorsOptionsDelegate } from '@nestjs/common/interfaces/external/cors-options.interface';
import type { NextFunction, Request, Response } from 'express';
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

/**
 * Security headers for an API (what helmet would set that matters for JSON responses), without
 * the dependency. No Cross-Origin-Resource-Policy: the consoles call the API cross origin.
 */
export function securityHeaders(_req: Request, res: Response, next: NextFunction) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-DNS-Prefetch-Control', 'off');
  res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  res.removeHeader('X-Powered-By');
  next();
}

/**
 * Request body validation for every route: unknown properties are refused (400) rather than
 * silently dropped, so a typo or an injected field never goes unnoticed.
 */
export function validationPipe() {
  return new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true, forbidUnknownValues: false });
}

/** HTTP setup shared by main.ts and the integration harness. */
export function configureHttp(app: INestApplication) {
  (app.getHttpAdapter().getInstance() as { disable?: (k: string) => void }).disable?.('x-powered-by');
  app.use(securityHeaders);
  app.use(requestContextMiddleware);
  app.enableCors(corsDelegate as CorsOptionsDelegate<unknown>);
}
