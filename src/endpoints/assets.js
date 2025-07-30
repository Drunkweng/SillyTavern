import path from 'node:path';
import fs from 'node:fs';
import { promises as fsPromises } from 'node:fs';
import { finished } from 'node:stream/promises';

import mime from 'mime-types';
import express from 'express';
import sanitize from 'sanitize-filename';
import fetch from 'node-fetch';

import { UNSAFE_EXTENSIONS } from '../constants.js';
import { clientRelativePath, asyncHandler } from '../util.js';

const VALID_CATEGORIES = ['bgm', 'ambient', 'blip', 'live2d', 'vrm', 'character', 'temp'];

/**
 * Validates the input filename for the asset.
 * @param {string} inputFilename Input filename
 * @returns {{error: boolean, message?: string}} Whether validation failed, and why if so
 */
export function validateAssetFileName(inputFilename) {
    if (!/^[a-zA-Z0-9_\-.]+$/.test(inputFilename)) {
        return {
            error: true,
            message: 'Illegal character in filename; only alphanumeric, \'_\', \'-\' are accepted.',
        };
    }

    const inputExtension = path.extname(inputFilename).toLowerCase();
    if (UNSAFE_EXTENSIONS.some(ext => ext === inputExtension)) {
        return {
            error: true,
            message: 'Forbidden file extension.',
        };
    }

    if (inputFilename.startsWith('.')) {
        return {
            error: true,
            message: 'Filename cannot start with \'.\'',
        };
    }

    if (sanitize(inputFilename) !== inputFilename) {
        return {
            error: true,
            message: 'Reserved or long filename.',
        };
    }

    return { error: false };
}

/**
 * Recursive function to get files
 * @param {string} dir - The directory to search for files
 * @param {string[]} files - The array of files to return
 * @returns {Promise<string[]>} - The array of files
 */
async function getFiles(dir, files = []) {
    try {
        const fileList = await fsPromises.readdir(dir, { withFileTypes: true });
        for (const file of fileList) {
            const name = path.join(dir, file.name);
            if (file.isDirectory()) {
                await getFiles(name, files);
            } else {
                files.push(name);
            }
        }
    } catch (error) {
        if (error.code !== 'ENOENT') {
            throw error;
        }
    }
    return files;
}

/**
 * Ensure that the asset folders exist.
 * @param {import('../users.js').UserDirectoryList} directories - The user's directories
 */
async function ensureFoldersExist(directories) {
    const folderPath = path.join(directories.assets);

    for (const category of VALID_CATEGORIES) {
        const assetCategoryPath = path.join(folderPath, category);
        try {
            const stats = await fsPromises.stat(assetCategoryPath);
            if (!stats.isDirectory()) {
                await fsPromises.unlink(assetCategoryPath);
                await fsPromises.mkdir(assetCategoryPath, { recursive: true });
            }
        } catch (error) {
            if (error.code === 'ENOENT') {
                await fsPromises.mkdir(assetCategoryPath, { recursive: true });
            } else {
                throw error;
            }
        }
    }
}

export const router = express.Router();

/**
 * HTTP POST handler function to retrieve name of all files of a given folder path.
 *
 * @param {Object} request - HTTP Request object. Require folder path in query
 * @param {Object} response - HTTP Response object will contain a list of file path.
 *
 * @returns {void}
 */
router.post('/get', asyncHandler(async (request, response) => {
    const folderPath = path.join(request.user.directories.assets);
    let output = {};

    try {
        const stats = await fsPromises.stat(folderPath);
        if (stats.isDirectory()) {
            await ensureFoldersExist(request.user.directories);

            const folders = (await fsPromises.readdir(folderPath, { withFileTypes: true }))
                .filter(file => file.isDirectory());

            for (const { name: folder } of folders) {
                if (folder === 'temp') continue;

                if (folder === 'live2d') {
                    output[folder] = [];
                    const live2d_folder = path.normalize(path.join(folderPath, folder));
                    const files = await getFiles(live2d_folder);
                    for (let file of files) {
                        if (file.includes('model') && file.endsWith('.json')) {
                            output[folder].push(clientRelativePath(request.user.directories.root, file));
                        }
                    }
                    continue;
                }

                if (folder === 'vrm') {
                    output[folder] = { 'model': [], 'animation': [] };
                    const vrm_model_folder = path.normalize(path.join(folderPath, 'vrm', 'model'));
                    let files = await getFiles(vrm_model_folder);
                    for (let file of files) {
                        if (!file.endsWith('.placeholder')) {
                            output['vrm']['model'].push(clientRelativePath(request.user.directories.root, file));
                        }
                    }

                    const vrm_animation_folder = path.normalize(path.join(folderPath, 'vrm', 'animation'));
                    files = await getFiles(vrm_animation_folder);
                    for (let file of files) {
                        if (!file.endsWith('.placeholder')) {
                            output['vrm']['animation'].push(clientRelativePath(request.user.directories.root, file));
                        }
                    }
                    continue;
                }

                const files = (await fsPromises.readdir(path.join(folderPath, folder)))
                    .filter(filename => filename !== '.placeholder');
                output[folder] = files.map(file => `assets/${folder}/${file}`);
            }
        }
    }
    catch (err) {
        console.error(err);
    }
    return response.send(output);
}));

/**
 * HTTP POST handler function to download the requested asset.
 *
 * @param {Object} request - HTTP Request object, expects a url, a category and a filename.
 * @param {Object} response - HTTP Response only gives status.
 *
 * @returns {void}
 */
router.post('/download', asyncHandler(async (request, response) => {
    const url = request.body.url;
    const inputCategory = request.body.category;

    // Check category
    let category = null;
    for (let i of VALID_CATEGORIES)
        if (i == inputCategory)
            category = i;

    if (category === null) {
        console.error('Bad request: unsupported asset category.');
        return response.sendStatus(400);
    }

    // Validate filename
    await ensureFoldersExist(request.user.directories);
    const validation = validateAssetFileName(request.body.filename);
    if (validation.error)
        return response.status(400).send(validation.message);

    const temp_path = path.join(request.user.directories.assets, 'temp', request.body.filename);
    const file_path = path.join(request.user.directories.assets, category, request.body.filename);
    console.info('Request received to download', url, 'to', file_path);

    try {
        // Download to temp
        const res = await fetch(url);
        if (!res.ok || res.body === null) {
            throw new Error(`Unexpected response ${res.statusText}`);
        }
        const destination = path.resolve(temp_path);
        // Delete if previous download failed
        try {
            await fsPromises.unlink(temp_path);
        } catch (err) {
            if (err.code !== 'ENOENT') throw err;
        }
        const fileStream = fs.createWriteStream(destination, { flags: 'wx' });
        // @ts-ignore
        await finished(res.body.pipe(fileStream));

        if (category === 'character') {
            const fileContent = await fsPromises.readFile(temp_path);
            const contentType = mime.lookup(temp_path) || 'application/octet-stream';
            response.setHeader('Content-Type', contentType);
            response.send(fileContent);
            await fsPromises.unlink(temp_path);
            return;
        }

        // Move into asset place
        console.info('Download finished, moving file from', temp_path, 'to', file_path);
        await fsPromises.copyFile(temp_path, file_path);
        await fsPromises.unlink(temp_path);
        response.sendStatus(200);
    }
    catch (error) {
        console.error(error);
        response.sendStatus(500);
    }
}));

/**
 * HTTP POST handler function to delete the requested asset.
 *
 * @param {Object} request - HTTP Request object, expects a category and a filename
 * @param {Object} response - HTTP Response only gives stats.
 *
 * @returns {void}
 */
router.post('/delete', asyncHandler(async (request, response) => {
    const inputCategory = request.body.category;

    // Check category
    let category = null;
    for (let i of VALID_CATEGORIES)
        if (i == inputCategory)
            category = i;

    if (category === null) {
        console.error('Bad request: unsupported asset category.');
        return response.sendStatus(400);
    }

    // Validate filename
    const validation = validateAssetFileName(request.body.filename);
    if (validation.error)
        return response.status(400).send(validation.message);

    const file_path = path.join(request.user.directories.assets, category, request.body.filename);
    console.info('Request received to delete', category, file_path);

    try {
        // Delete if previous download failed
        try {
            await fsPromises.unlink(file_path);
            console.info('Asset deleted.');
        } catch (err) {
            if (err.code === 'ENOENT') {
                console.error('Asset not found.');
                return response.sendStatus(400);
            }
            throw err;
        }
        // Move into asset place
        response.sendStatus(200);
    }
    catch (error) {
        console.error(error);
        response.sendStatus(500);
    }
}));

///////////////////////////////
/**
 * HTTP POST handler function to retrieve a character background music list.
 *
 * @param {Object} request - HTTP Request object, expects a character name in the query.
 * @param {Object} response - HTTP Response object will contain a list of audio file path.
 *
 * @returns {void}
 */
router.post('/character', asyncHandler(async (request, response) => {
    if (request.query.name === undefined) return response.sendStatus(400);

    // For backwards compatibility, don't reject invalid character names, just sanitize them
    const name = sanitize(request.query.name.toString());
    const inputCategory = request.query.category;

    // Check category
    let category = null;
    for (let i of VALID_CATEGORIES)
        if (i == inputCategory)
            category = i;

    if (category === null) {
        console.error('Bad request: unsupported asset category.');
        return response.sendStatus(400);
    }

    const folderPath = path.join(request.user.directories.characters, name, category);

    let output = [];
    try {
        const stats = await fsPromises.stat(folderPath);
        if (stats.isDirectory()) {
            if (category === 'live2d') {
                const folders = await fsPromises.readdir(folderPath, { withFileTypes: true });
                for (const folderInfo of folders) {
                    if (!folderInfo.isDirectory()) continue;

                    const modelFolder = folderInfo.name;
                    const live2dModelPath = path.join(folderPath, modelFolder);
                    for (let file of await fsPromises.readdir(live2dModelPath)) {
                        if (file.includes('model') && file.endsWith('.json')) {
                            output.push(path.join('characters', name, category, modelFolder, file));
                        }
                    }
                }
                return response.send(output);
            }

            const files = (await fsPromises.readdir(folderPath))
                .filter(filename => filename !== '.placeholder');

            output = files.map(i => `/characters/${name}/${category}/${i}`);
        }
        return response.send(output);
    }
    catch (err) {
        console.error(err);
        return response.sendStatus(500);
    }
}));
