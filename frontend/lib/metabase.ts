
import jwt from 'jsonwebtoken';

export const METABASE_SITE_URL = process.env.METABASE_SITE_URL || 'http://localhost:3001';
export const METABASE_SECRET_KEY = process.env.METABASE_SECRET_KEY || '';

export function signMetabaseToken(dashboardId: number, params: Record<string, unknown> = {}) {
    if (!METABASE_SECRET_KEY) {
        throw new Error('METABASE_SECRET_KEY is not defined');
    }

    const payload = {
        resource: { dashboard: dashboardId },
        params,
        exp: Math.round(Date.now() / 1000) + (10 * 60), // 10 minute expiration
    };

    return jwt.sign(payload, METABASE_SECRET_KEY);
}

export function getMetabaseEmbedUrl(token: string) {
    return `${METABASE_SITE_URL}/embed/dashboard/${token}#bordered=true&titled=true`;
}
