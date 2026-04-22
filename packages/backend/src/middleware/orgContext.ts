/**
 * Attach the active Organization to every request.
 *
 * Resolution order:
 *   1. X-Organization header (explicit, for debugging/admin override)
 *   2. Request origin/host → match against Organization.primaryDomain or
 *      additionalDomains (the main mechanism once HPL app is live)
 *   3. Fallback: 'ppl' (current default, safe for today's single-tenant state)
 *
 * The middleware populates `req.org` for downstream handlers. Routes filter
 * by `req.org.id` when they want org-scoped data. See ARCHITECTURE.md.
 *
 * Deliberately tolerant: a missing/unknown header or an unrecognized host
 * falls back to PPL instead of 403'ing. Once HPL is live we can tighten
 * this to strict matching.
 */

import { Request, Response, NextFunction } from 'express';
import { getOrgBySlug, getOrgByDomain, ActiveOrg } from '../services/orgService';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      org: ActiveOrg;
    }
  }
}

const DEFAULT_ORG_SLUG = 'ppl';

export async function orgContext(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  try {
    // 1. Explicit header
    const headerSlug = (req.headers['x-organization'] || req.headers['x-org']) as
      | string
      | undefined;
    if (headerSlug) {
      const byHeader = await getOrgBySlug(headerSlug);
      if (byHeader) {
        req.org = byHeader;
        return next();
      }
    }

    // 2. Domain-based (origin first, then host header)
    const originHeader = req.headers.origin as string | undefined;
    let host: string | null = null;
    if (originHeader) {
      try {
        host = new URL(originHeader).hostname;
      } catch {
        /* ignore */
      }
    }
    if (!host) host = (req.headers.host || '').split(':')[0] || null;
    if (host) {
      const byDomain = await getOrgByDomain(host);
      if (byDomain) {
        req.org = byDomain;
        return next();
      }
    }

    // 3. Fallback to PPL — safe during rollout. Once HPL is live and every
    //    request should carry either a matching header or a known domain,
    //    consider returning 400 when no match is found.
    const fallback = await getOrgBySlug(DEFAULT_ORG_SLUG);
    if (fallback) {
      req.org = fallback;
      return next();
    }

    // If even PPL isn't present, something's very wrong — the bootstrap
    // script should have seeded it on startup. Fail loud so we notice.
    throw new Error(
      `orgContext: default org '${DEFAULT_ORG_SLUG}' not found in database. ` +
        `Check that scripts/bootstrap-organizations.ts ran on this deploy.`
    );
  } catch (err) {
    next(err);
  }
}
