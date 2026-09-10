import jwt from 'jsonwebtoken';

const WEBSITE_JWT_SECRET = process.env.WEBSITE_JWT_SECRET;

if (!WEBSITE_JWT_SECRET) {
  throw new Error('FATAL: WEBSITE_JWT_SECRET must be provided.');
}

/** Deliberately its own payload shape and secret, kept separate from
 * utils/jwt.ts's employee TokenPayload — a WebsiteAccount token must never
 * verify successfully against an internal/employee-only route. */
export interface WebsiteTokenPayload {
  accountId: number;
  companyId: number;
  email: string;
  tokenVersion: number;
}

export const generateWebsiteAccessToken = (payload: WebsiteTokenPayload): string => {
  return jwt.sign(payload, WEBSITE_JWT_SECRET, { expiresIn: '30d' });
};

export const verifyWebsiteAccessToken = (token: string): WebsiteTokenPayload => {
  return jwt.verify(token, WEBSITE_JWT_SECRET) as WebsiteTokenPayload;
};
