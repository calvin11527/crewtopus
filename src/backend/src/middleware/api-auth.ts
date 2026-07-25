import type { Request, Response, NextFunction } from 'express';

/**
 * Optional API authentication for LAN / shared-machine hardening.
 * Set CREWTOPUS_API_TOKEN or AGENTHUB_API_TOKEN; clients send:
 *   Authorization: Bearer <token>
 *   or X-Api-Token: <token>
 *
 * Health and metrics stay open for probes unless CREWTOPUS_AUTH_LOCKDOWN=true.
 */
export function resolveApiToken(): string | undefined {
  const t = process.env.CREWTOPUS_API_TOKEN || process.env.AGENTHUB_API_TOKEN;
  return t && t.trim() ? t.trim() : undefined;
}

const OPEN_PATHS = new Set(['/health', '/ready', '/status']);

export function apiAuthMiddleware(req: Request, res: Response, next: NextFunction): void {
  const expected = resolveApiToken();
  if (!expected) {
    next();
    return;
  }

  const lockdown = process.env.CREWTOPUS_AUTH_LOCKDOWN === 'true';
  const path = req.path.startsWith('/') ? req.path : `/${req.path}`;
  // Mounted at /api → req.path is relative to mount (e.g. /health)
  if (!lockdown && (OPEN_PATHS.has(path) || path.startsWith('/health'))) {
    next();
    return;
  }

  const header = req.headers.authorization;
  const bearer =
    typeof header === 'string' && header.toLowerCase().startsWith('bearer ')
      ? header.slice(7).trim()
      : undefined;
  const xToken = req.headers['x-api-token'];
  const provided = bearer || (typeof xToken === 'string' ? xToken : undefined);

  if (!provided || provided !== expected) {
    res.status(401).json({
      message: 'Unauthorized. Set Authorization: Bearer <CREWTOPUS_API_TOKEN> or X-Api-Token.',
    });
    return;
  }
  next();
}
