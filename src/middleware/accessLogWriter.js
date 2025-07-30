import path from 'node:path';
import { promises as fs } from 'node:fs';
import { getRealIpFromHeader } from '../express-common.js';
import { color, getConfigValue, asyncHandler } from '../util.js';

const enableAccessLog = getConfigValue('logging.enableAccessLog', true, 'boolean');

const knownIPs = new Set();

export const getAccessLogPath = () => path.join(globalThis.DATA_ROOT, 'access.log');

async function fileExists(path) {
    try {
        await fs.access(path);
        return true;
    } catch {
        return false;
    }
}

export async function migrateAccessLog() {
    try {
        if (!await fileExists('access.log')) {
            return;
        }
        const logPath = getAccessLogPath();
        if (await fileExists(logPath)) {
            return;
        }
        await fs.rename('access.log', logPath);
        console.log(color.yellow('Migrated access.log to new location:'), logPath);
    } catch (e) {
        console.error('Failed to migrate access log:', e);
        console.info('Please move access.log to the data directory manually.');
    }
}

/**
 * Creates middleware for logging access and new connections
 * @returns {import('express').RequestHandler}
 */
export default function accessLoggerMiddleware() {
    return asyncHandler(async function (req, res, next) {
        const clientIp = getRealIpFromHeader(req);
        const userAgent = req.headers['user-agent'];

        if (!knownIPs.has(clientIp)) {
            // Log new connection
            knownIPs.add(clientIp);

            // Write to access log if enabled
            if (enableAccessLog) {
                console.info(color.yellow(`New connection from ${clientIp}; User Agent: ${userAgent}\n`));
                const logPath = getAccessLogPath();
                const timestamp = new Date().toISOString();
                const log = `${timestamp} ${clientIp} ${userAgent}\n`;

                try {
                    await fs.appendFile(logPath, log);
                } catch (err) {
                    console.error('Failed to write access log:', err);
                }
            }
        }

        next();
    });
}
