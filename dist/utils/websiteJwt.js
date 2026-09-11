"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.verifyWebsiteAccessToken = exports.generateWebsiteAccessToken = void 0;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const WEBSITE_JWT_SECRET = process.env.WEBSITE_JWT_SECRET;
if (!WEBSITE_JWT_SECRET) {
    throw new Error('FATAL: WEBSITE_JWT_SECRET must be provided.');
}
const generateWebsiteAccessToken = (payload) => {
    return jsonwebtoken_1.default.sign(payload, WEBSITE_JWT_SECRET, { expiresIn: '30d' });
};
exports.generateWebsiteAccessToken = generateWebsiteAccessToken;
const verifyWebsiteAccessToken = (token) => {
    return jsonwebtoken_1.default.verify(token, WEBSITE_JWT_SECRET);
};
exports.verifyWebsiteAccessToken = verifyWebsiteAccessToken;
