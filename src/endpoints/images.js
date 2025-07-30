import { promises as fs } from 'node:fs';
import path from 'node:path';
import { Buffer } from 'node:buffer';

import express from 'express';
// @ts-ignore
import sanitize from 'sanitize-filename';

import { clientRelativePath, removeFileExtension, getImages, isPathUnderParent, asyncHandler } from '../util.js';
import { MEDIA_EXTENSIONS, UPLOADS_DIRECTORY } from '../constants.js';
import multer from 'multer';

/**
 * Ensure the directory for the provided file path exists.
 * If not, it will recursively create the directory.
 *
 * @param {string} filePath - The full path of the file for which the directory should be ensured.
 */
async function ensureDirectoryExistence(filePath) {
    const dirname = path.dirname(filePath);
    try {
        await fs.access(dirname);
        return true;
    } catch {
        await ensureDirectoryExistence(dirname);
        await fs.mkdir(dirname);
    }
}

export const router = express.Router();

// Uploader for multipart/form-data image uploads
const upload = multer({
    dest: path.join(globalThis.DATA_ROOT, UPLOADS_DIRECTORY),
    limits: { fileSize: 16 * 1024 * 1024 },
});

/**
 * Endpoint to handle image uploads.
 * The image should be provided in the request body in base64 format.
 * Optionally, a character name can be provided to save the image in a sub-folder.
 *
 * @route POST /api/images/upload
 * @param {Object} request.body - The request payload.
 * @param {string} request.body.image - The base64 encoded image data.
 * @param {string} [request.body.ch_name] - Optional character name to determine the sub-directory.
 * @returns {Object} response - The response object containing the path where the image was saved.
 */
// Deprecated: base64 upload path may cause memory spikes. Prefer multipart /upload-file
router.post('/upload', asyncHandler(async (request, response) => {
    try {
        if (!request.body) {
            response.status(400).send({ error: 'No data provided' });
            return;
        }

        const { image, format } = request.body;

        if (!image) {
            response.status(400).send({ error: 'No image data provided' });
            return;
        }

        const validFormat = MEDIA_EXTENSIONS.includes(format);
        if (!validFormat) {
            response.status(400).send({ error: 'Invalid image format' });
            return;
        }

        // Constructing filename and path
        let filename;
        if (request.body.filename) {
            filename = `${removeFileExtension(request.body.filename)}.${format}`;
        } else {
            filename = `${Date.now()}.${format}`;
        }

        // if character is defined, save to a sub folder for that character
        let pathToNewFile = path.join(request.user.directories.userImages, sanitize(filename));
        if (request.body.ch_name) {
            pathToNewFile = path.join(request.user.directories.userImages, sanitize(request.body.ch_name), sanitize(filename));
        }

        await ensureDirectoryExistence(pathToNewFile);
        const imageBuffer = Buffer.from(image, 'base64');
        await fs.writeFile(pathToNewFile, new Uint8Array(imageBuffer));
        response.send({ path: clientRelativePath(request.user.directories.root, pathToNewFile) });
    } catch (error) {
        console.error(error);
        response.status(500).send({ error: 'Failed to save the image' });
    }
}));

// New: multipart/form-data upload endpoint to avoid base64 JSON bloat
// field name: 'file', optional 'ch_name' for subfolder, optional 'filename' to override name
router.post('/upload-file', upload.single('file'), asyncHandler(async (request, response) => {
    try {
        if (!request.file) {
            response.status(400).send({ error: 'No file provided' });
            return;
        }

        const format = (request.file.mimetype || '').split('/').pop();
        const validFormat = MEDIA_EXTENSIONS.includes(format);
        if (!validFormat) {
            response.status(400).send({ error: 'Invalid file format' });
            return;
        }

        const tempPath = request.file.path;
        const originalBase = request.body.filename ? removeFileExtension(request.body.filename) : Date.now().toString();
        const filename = sanitize(`${originalBase}.${format}`);

        let pathToNewFile = path.join(request.user.directories.userImages, filename);
        if (request.body.ch_name) {
            pathToNewFile = path.join(request.user.directories.userImages, sanitize(request.body.ch_name), filename);
        }

        await ensureDirectoryExistence(pathToNewFile);
        const buffer = await fs.readFile(tempPath);
        await fs.writeFile(pathToNewFile, buffer);
        await fs.unlink(tempPath).catch(() => {});

        response.send({ path: clientRelativePath(request.user.directories.root, pathToNewFile) });
    } catch (error) {
        console.error(error);
        response.status(500).send({ error: 'Failed to save the file' });
    }
}));

router.post('/list/:folder?', asyncHandler(async (request, response) => {
    try {
        if (request.params.folder) {
            if (request.body.folder) {
                response.status(400).send({ error: 'Folder specified in both URL and body' });
                return;
            }

            console.warn('Deprecated: Use POST /api/images/list with folder in request body');
            request.body.folder = request.params.folder;
        }

        if (!request.body.folder) {
            response.status(400).send({ error: 'No folder specified' });
            return;
        }

        const directoryPath = path.join(request.user.directories.userImages, sanitize(request.body.folder));
        const sort = request.body.sortField || 'date';
        const order = request.body.sortOrder || 'asc';

        try {
            await fs.access(directoryPath);
        } catch {
            await fs.mkdir(directoryPath, { recursive: true });
        }

        const images = await getImages(directoryPath, sort);
        if (order === 'desc') {
            images.reverse();
        }
        response.send(images);
    } catch (error) {
        console.error(error);
        response.status(500).send({ error: 'Unable to retrieve files' });
    }
}));

router.post('/folders', asyncHandler(async (request, response) => {
    try {
        const directoryPath = request.user.directories.userImages;
        try {
            await fs.access(directoryPath);
        } catch {
            await fs.mkdir(directoryPath, { recursive: true });
        }

        const folders = (await fs.readdir(directoryPath, { withFileTypes: true }))
            .filter(dirent => dirent.isDirectory())
            .map(dirent => dirent.name);

        response.send(folders);
    } catch (error) {
        console.error(error);
        response.status(500).send({ error: 'Unable to retrieve folders' });
    }
}));

router.post('/delete', asyncHandler(async (request, response) => {
    try {
        if (!request.body.path) {
            response.status(400).send('No path specified');
            return;
        }

        const pathToDelete = path.join(request.user.directories.root, request.body.path);
        if (!isPathUnderParent(request.user.directories.userImages, pathToDelete)) {
            response.status(400).send('Invalid path');
            return;
        }

        try {
            await fs.access(pathToDelete);
        } catch {
            response.status(404).send('File not found');
            return;
        }

        await fs.unlink(pathToDelete);
        console.info(`Deleted image: ${request.body.path} from ${request.user.profile.handle}`);
        response.sendStatus(200);
    } catch (error) {
        console.error(error);
        response.sendStatus(500);
    }
}));
