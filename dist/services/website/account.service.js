"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.WebsiteAccountService = void 0;
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const prisma_1 = require("../../lib/prisma");
const websiteJwt_1 = require("../../utils/websiteJwt");
const p = prisma_1.prisma;
function toPublicAccount(account) {
    return {
        id: account.id,
        email: account.email,
        full_name: account.full_name,
        phone: account.phone,
    };
}
class WebsiteAccountService {
    static async register(companyId, data) {
        const existing = await p.websiteAccount.findUnique({
            where: { company_id_email: { company_id: companyId, email: data.email } },
        });
        if (existing)
            throw { status: 409, message: 'An account with this email already exists' };
        const password_hash = await bcryptjs_1.default.hash(data.password, 10);
        const account = await p.websiteAccount.create({
            data: {
                company_id: companyId,
                email: data.email,
                phone: data.phone || null,
                full_name: data.full_name,
                password_hash,
            },
        });
        const token = (0, websiteJwt_1.generateWebsiteAccessToken)({
            accountId: account.id,
            companyId: account.company_id,
            email: account.email,
            tokenVersion: account.token_version,
        });
        return { token, account: toPublicAccount(account) };
    }
    static async login(companyId, data) {
        const account = await p.websiteAccount.findUnique({
            where: { company_id_email: { company_id: companyId, email: data.email } },
        });
        if (!account)
            throw { status: 401, message: 'Invalid email or password' };
        const valid = await bcryptjs_1.default.compare(data.password, account.password_hash);
        if (!valid)
            throw { status: 401, message: 'Invalid email or password' };
        const token = (0, websiteJwt_1.generateWebsiteAccessToken)({
            accountId: account.id,
            companyId: account.company_id,
            email: account.email,
            tokenVersion: account.token_version,
        });
        return { token, account: toPublicAccount(account) };
    }
    static me(account) {
        return toPublicAccount(account);
    }
}
exports.WebsiteAccountService = WebsiteAccountService;
