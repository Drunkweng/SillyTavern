import fs from 'node:fs/promises';
import path from 'node:path';

import express from 'express';
// @ts-ignore
import sanitize from 'sanitize-filename';

import { dimensions, invalidateThumbnail } from './thumbnails.js';
import { getImages, asyncHandler } from '../util.js';
import { getFileNameValidationFunction } from '../middleware/validateFileName.js';

export const router = express.Router();

router.post('/all', asyncHandler(async function (request, response) {
    const images = await getImages(request.user.directories.backgrounds);
    const config = { width: dimensions.bg[0], height: dimensions.bg[1] };
    response.json({ images, config });
}));

router.post('/delete', getFileNameValidationFunction('bg'), asyncHandler(async function (request, response) {
    if (!request.body) {
        response.sendStatus(400);
        return;
    }

    if (request.body.bg !== sanitize(request.body.bg)) {
        console.error('Malicious bg name prevented');
        response.sendStatus(403);
        return;
    }

    const fileName = path.join(request.user.directories.backgrounds, sanitize(request.body.bg));

    try {
        await fs.access(fileName);
        await fs.unlink(fileName);
        await invalidateThumbnail(request.user.directories, 'bg', request.body.bg);
        response.send('ok');
    } catch (err) {
        if (err.code === 'ENOENT') {
            console.error('BG file not found');
            response.sendStatus(400);
        } else {
            console.error(err);
            response.sendStatus(500);
        }
    }
}));

router.post('/rename', asyncHandler(async function (request, response) {
    if (!request.body) {
        response.sendStatus(400);
        return;
    }

    const oldFileName = path.join(request.user.directories.backgrounds, sanitize(request.body.old_bg));
    const newFileName = path.join(request.user.directories.backgrounds, sanitize(request.body.new_bg));

    try {
        await fs.access(oldFileName);
    } catch {
        console.error('BG file not found');
        response.sendStatus(400);
        return;
    }

    try {
        await fs.access(newFileName);
        console.error('New BG file already exists');
        response.sendStatus(400);
        return;
    } catch {
        // File does not exist, which is what we want
    }

    try {
        await fs.copyFile(oldFileName, newFileName);
        await fs.unlink(oldFileName);
        await invalidateThumbnail(request.user.directories, 'bg', request.body.old_bg);
        response.send('ok');
    } catch (err) {
        console.error(err);
        response.sendStatus(500);
    }
}));

router.post('/upload', asyncHandler(async function (request, response) {
    if (!request.body || !request.file) {
        response.sendStatus(400);
        return;
    }

    const img_path = path.join(request.file.destination, request.file.filename);
    const filename = request.file.originalname;

    try {
        await fs.copyFile(img_path, path.join(request.user.directories.backgrounds, filename));
        await fs.unlink(img_path);
        await invalidateThumbnail(request.user.directories, 'bg', filename);
        response.send(filename);
    } catch (err) {
        console.error(err);
        response.sendStatus(500);
    }
}));
