import path from 'node:path';
import express from 'express';
// @ts-ignore
import sanitize from 'sanitize-filename';
import writeFileAtomic from 'write-file-atomic';

import { asyncHandler } from '../util.js';

export const router = express.Router();

router.post('/save', asyncHandler(async (request, response) => {
    if (!request.body || !request.body.name) {
        response.sendStatus(400);
        return;
    }

    const filename = path.join(request.user.directories.movingUI, sanitize(`${request.body.name}.json`));
    await writeFileAtomic(filename, JSON.stringify(request.body, null, 4));

    response.sendStatus(200);
}));
