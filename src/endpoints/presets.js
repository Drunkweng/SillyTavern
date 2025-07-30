import { promises as fs } from 'node:fs';
import path from 'node:path';

import express from 'express';
// @ts-ignore
import sanitize from 'sanitize-filename';
import writeFileAtomic from 'write-file-atomic';

import { getDefaultPresetFile, getDefaultPresets } from './content-manager.js';
import { asyncHandler } from '../util.js';

/**
 * Gets the folder and extension for the preset settings based on the API source ID.
 * @param {string} apiId API source ID
 * @param {import('../users.js').UserDirectoryList} directories User directories
 * @returns {{folder: string?, extension: string?}} Object containing the folder and extension for the preset settings
 */
function getPresetSettingsByAPI(apiId, directories) {
    switch (apiId) {
        case 'kobold':
        case 'koboldhorde':
            return { folder: directories.koboldAI_Settings, extension: '.json' };
        case 'novel':
            return { folder: directories.novelAI_Settings, extension: '.json' };
        case 'textgenerationwebui':
            return { folder: directories.textGen_Settings, extension: '.json' };
        case 'openai':
            return { folder: directories.openAI_Settings, extension: '.json' };
        case 'instruct':
            return { folder: directories.instruct, extension: '.json' };
        case 'context':
            return { folder: directories.context, extension: '.json' };
        case 'sysprompt':
            return { folder: directories.sysprompt, extension: '.json' };
        case 'reasoning':
            return { folder: directories.reasoning, extension: '.json' };
        default:
            return { folder: null, extension: null };
    }
}

export const router = express.Router();

router.post('/save', asyncHandler(async function (request, response) {
    const name = sanitize(request.body.name);
    if (!request.body.preset || !name) {
        response.sendStatus(400);
        return;
    }

    const settings = getPresetSettingsByAPI(request.body.apiId, request.user.directories);
    const filename = name + settings.extension;

    if (!settings.folder) {
        response.sendStatus(400);
        return;
    }

    const fullpath = path.join(settings.folder, filename);
    await writeFileAtomic(fullpath, JSON.stringify(request.body.preset, null, 4), 'utf-8');
    response.send({ name });
}));

router.post('/delete', asyncHandler(async function (request, response) {
    const name = sanitize(request.body.name);
    if (!name) {
        response.sendStatus(400);
        return;
    }

    const settings = getPresetSettingsByAPI(request.body.apiId, request.user.directories);
    const filename = name + settings.extension;

    if (!settings.folder) {
        response.sendStatus(400);
        return;
    }

    const fullpath = path.join(settings.folder, filename);

    try {
        await fs.access(fullpath);
        await fs.unlink(fullpath);
        response.sendStatus(200);
    } catch {
        response.sendStatus(404);
    }
}));

router.post('/restore', asyncHandler(async function (request, response) {
    try {
        const settings = getPresetSettingsByAPI(request.body.apiId, request.user.directories);
        const name = sanitize(request.body.name);
        const defaultPresets = await getDefaultPresets(request.user.directories);

        const defaultPreset = defaultPresets.find(p => p.name === name && p.folder === settings.folder);

        const result = { isDefault: false, preset: {} };

        if (defaultPreset) {
            result.isDefault = true;
            result.preset = await getDefaultPresetFile(defaultPreset.filename) || {};
        }

        response.send(result);
    } catch (error) {
        console.error(error);
        response.sendStatus(500);
    }
}));
