import path from 'node:path';
import { promises as fs } from 'node:fs';

import express from 'express';
import sanitize from 'sanitize-filename';
import writeFileAtomic from 'write-file-atomic';

import { validateAssetFileName } from './assets.js';
import { clientRelativePath, asyncHandler } from '../util.js';

export const router = express.Router();

router.post('/sanitize-filename', asyncHandler(async (request, response) => {
    try {
        const fileName = String(request.body.fileName);
        if (!fileName) {
            return response.status(400).send('No fileName specified');
        }

        const sanitizedFilename = sanitize(fileName);
        return response.send({ fileName: sanitizedFilename });
    } catch (error) {
        console.error(error);
        return response.sendStatus(500);
    }
}));

router.post('/upload', asyncHandler(async (request, response) => {
    try {
        if (!request.body.name) {
            return response.status(400).send('No upload name specified');
        }

        if (!request.body.data) {
            return response.status(400).send('No upload data specified');
        }

        // Validate filename
        const validation = validateAssetFileName(request.body.name);
        if (validation.error)
            return response.status(400).send(validation.message);

        const pathToUpload = path.join(request.user.directories.files, request.body.name);
        await writeFileAtomic(pathToUpload, request.body.data, { encoding: 'base64' });
        const url = clientRelativePath(request.user.directories.root, pathToUpload);
        console.info(`Uploaded file: ${url} from ${request.user.profile.handle}`);
        return response.send({ path: url });
    } catch (error) {
        console.error(error);
        return response.sendStatus(500);
    }
}));

router.post('/delete', asyncHandler(async (request, response) => {
    try {
        if (!request.body.path) {
            return response.status(400).send('No path specified');
        }

        const pathToDelete = path.join(request.user.directories.root, request.body.path);
        if (!pathToDelete.startsWith(request.user.directories.files)) {
            return response.status(400).send('Invalid path');
        }

        try {
            await fs.access(pathToDelete);
        } catch {
            return response.status(404).send('File not found');
        }

        await fs.unlink(pathToDelete);
        console.info(`Deleted file: ${request.body.path} from ${request.user.profile.handle}`);
        return response.sendStatus(200);
    } catch (error) {
        console.error(error);
        return response.sendStatus(500);
    }
}));

router.post('/verify', asyncHandler(async (request, response) => {
    try {
        if (!Array.isArray(request.body.urls)) {
            return response.status(400).send('No URLs specified');
        }

        const verified = {};

        for (const url of request.body.urls) {
            const pathToVerify = path.join(request.user.directories.root, url);
            if (!pathToVerify.startsWith(request.user.directories.files)) {
                console.warn(`File verification: Invalid path: ${pathToVerify}`);
                continue;
            }
            try {
                await fs.access(pathToVerify);
                verified[url] = true;
            } catch {
                verified[url] = false;
            }
        }

        return response.send(verified);
    } catch (error) {
        console.error(error);
        return response.sendStatus(500);
    }
}));
