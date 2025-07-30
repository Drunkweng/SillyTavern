import { promises as fs } from 'node:fs';
import path from 'node:path';

import express from 'express';
import sanitize from 'sanitize-filename';
import writeFileAtomic from 'write-file-atomic';
import { asyncHandler } from '../util.js';

export const router = express.Router();

router.post('/save', asyncHandler(async (request, response) => {
    if (!request.body || !request.body.name) {
        return response.sendStatus(400);
    }

    const filename = path.join(request.user.directories.quickreplies, sanitize(`${request.body.name}.json`));
    await writeFileAtomic(filename, JSON.stringify(request.body, null, 4));

    return response.sendStatus(200);
}));

router.post('/delete', asyncHandler(async (request, response) => {
    if (!request.body || !request.body.name) {
        return response.sendStatus(400);
    }

    const filename = path.join(request.user.directories.quickreplies, sanitize(`${request.body.name}.json`));
    try {
        await fs.unlink(filename);
    } catch (error) {
        if (error.code !== 'ENOENT') {
            throw error;
        }
    }

    return response.sendStatus(200);
}));
