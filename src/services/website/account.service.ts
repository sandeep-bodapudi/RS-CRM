import bcrypt from 'bcryptjs';
import { prisma } from '../../lib/prisma';
import { generateWebsiteAccessToken } from '../../utils/websiteJwt';
import { WebsiteAccountRegisterInput, WebsiteAccountLoginInput } from '../../shared';

const p = prisma;

function toPublicAccount(account: {
  id: number;
  email: string;
  full_name: string;
  phone: string | null;
}) {
  return {
    id: account.id,
    email: account.email,
    full_name: account.full_name,
    phone: account.phone,
  };
}

export class WebsiteAccountService {
  static async register(companyId: number, data: WebsiteAccountRegisterInput) {
    const existing = await p.websiteAccount.findUnique({
      where: { company_id_email: { company_id: companyId, email: data.email } },
    });
    if (existing) throw { status: 409, message: 'An account with this email already exists' };

    const password_hash = await bcrypt.hash(data.password, 10);
    const account = await p.websiteAccount.create({
      data: {
        company_id: companyId,
        email: data.email,
        phone: data.phone || null,
        full_name: data.full_name,
        password_hash,
      },
    });

    const token = generateWebsiteAccessToken({
      accountId: account.id,
      companyId: account.company_id,
      email: account.email,
      tokenVersion: account.token_version,
    });
    return { token, account: toPublicAccount(account) };
  }

  static async login(companyId: number, data: WebsiteAccountLoginInput) {
    const account = await p.websiteAccount.findUnique({
      where: { company_id_email: { company_id: companyId, email: data.email } },
    });
    if (!account) throw { status: 401, message: 'Invalid email or password' };

    const valid = await bcrypt.compare(data.password, account.password_hash);
    if (!valid) throw { status: 401, message: 'Invalid email or password' };

    const token = generateWebsiteAccessToken({
      accountId: account.id,
      companyId: account.company_id,
      email: account.email,
      tokenVersion: account.token_version,
    });
    return { token, account: toPublicAccount(account) };
  }

  static me(account: { id: number; email: string; full_name: string; phone: string | null }) {
    return toPublicAccount(account);
  }
}
