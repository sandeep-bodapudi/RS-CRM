"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.jobManager = exports.JobManager = void 0;
const node_cron_1 = __importDefault(require("node-cron"));
const logger_1 = require("../utils/logger");
class JobManager {
    constructor() {
        this.jobs = [];
    }
    register(config) {
        this.jobs.push(config);
    }
    startAll() {
        this.jobs.forEach((job) => {
            if (process.env[job.envDisableKey] === 'true') {
                logger_1.logger.info(`[Jobs] Skipping ${job.name} (Disabled via ${job.envDisableKey})`);
                return;
            }
            logger_1.logger.info(`[Jobs] Scheduling ${job.name} at ${job.schedule} (Asia/Kolkata)`);
            // Explicit timezone -- without this, node-cron falls back to the
            // process's local timezone, which on this server only happens to be
            // IST because .env sets TZ=Asia/Kolkata. That's an environment
            // dependency, not a guarantee; a deploy target that doesn't load .env
            // (or overrides TZ) would silently shift every job's fire time, the
            // same bug class already found and fixed elsewhere for attendance.
            node_cron_1.default.schedule(job.schedule, async () => {
                try {
                    logger_1.logger.info(`[Jobs] Starting ${job.name}...`);
                    const start = performance.now();
                    await job.handler();
                    const duration = Math.round(performance.now() - start);
                    logger_1.logger.info(`[Jobs] Completed ${job.name} successfully in ${duration}ms.`);
                }
                catch (error) {
                    logger_1.logger.error({ err: error }, `[Jobs] FAILURE in ${job.name}: Alerting system!`);
                }
            }, { timezone: 'Asia/Kolkata' });
        });
    }
    // Used for manual execution & testing idempotency
    async trigger(name) {
        const job = this.jobs.find((j) => j.name === name);
        if (!job)
            throw new Error(`Job ${name} not found`);
        logger_1.logger.info(`[Jobs] Manually triggering ${job.name}...`);
        try {
            const start = performance.now();
            await job.handler();
            const duration = Math.round(performance.now() - start);
            logger_1.logger.info(`[Jobs] Manual execution of ${job.name} completed successfully in ${duration}ms.`);
        }
        catch (error) {
            logger_1.logger.error({ err: error }, `[Jobs] FAILURE in manual execution of ${job.name}: Alerting system!`);
            throw error;
        }
    }
}
exports.JobManager = JobManager;
exports.jobManager = new JobManager();
