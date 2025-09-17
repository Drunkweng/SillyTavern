import { promises as fsPromises } from 'node:fs';

import storage from 'node-persist';
import express from 'express';
import lodash from 'lodash';
import { checkForNewContent, CONTENT_TYPES } from './content-manager.js';
import {
    KEY_PREFIX,
    toKey,
    requireAdminMiddleware,
    getUserAvatar,
    getAllUserHandles,
    getPasswordSalt,
    getPasswordHash,
    getUserDirectories,
    ensurePublicDirectoriesExist,
} from '../users.js';
import { DEFAULT_USER } from '../constants.js';
import { asyncHandler } from '../util.js';

export const router = express.Router();

router.post('/get', requireAdminMiddleware, asyncHandler(async (_request, response) => {
    /** @type {import('../users.js').User[]} */
    const users = await storage.values(x => x.key.startsWith(KEY_PREFIX));

    /** @type {Promise<import('../users.js').UserViewModel>[]} */
    const viewModelPromises = users
        .map(user => new Promise(resolve => {
            getUserAvatar(user.handle).then(avatar =>
                resolve({
                    handle: user.handle,
                    name: user.name,
                    avatar: avatar,
                    admin: user.admin,
                    enabled: user.enabled,
                    created: user.created,
                    password: !!user.password,
                }),
            );
        }));

    const viewModels = await Promise.all(viewModelPromises);
    viewModels.sort((x, y) => (x.created ?? 0) - (y.created ?? 0));
    return response.json(viewModels);
}));

router.post('/disable', requireAdminMiddleware, asyncHandler(async (request, response) => {
    if (!request.body.handle) {
        console.warn('Disable user failed: Missing required fields');
        return response.status(400).json({ error: 'Missing required fields' });
    }

    if (request.body.handle === request.user.profile.handle) {
        console.warn('Disable user failed: Cannot disable yourself');
        return response.status(400).json({ error: 'Cannot disable yourself' });
    }

    /** @type {import('../users.js').User} */
    const user = await storage.getItem(toKey(request.body.handle));

    if (!user) {
        console.error('Disable user failed: User not found');
        return response.status(404).json({ error: 'User not found' });
    }

    user.enabled = false;
    await storage.setItem(toKey(request.body.handle), user);
    return response.sendStatus(204);
}));

router.post('/enable', requireAdminMiddleware, asyncHandler(async (request, response) => {
    if (!request.body.handle) {
        console.warn('Enable user failed: Missing required fields');
        return response.status(400).json({ error: 'Missing required fields' });
    }

    /** @type {import('../users.js').User} */
    const user = await storage.getItem(toKey(request.body.handle));

    if (!user) {
        console.error('Enable user failed: User not found');
        return response.status(404).json({ error: 'User not found' });
    }

    user.enabled = true;
    await storage.setItem(toKey(request.body.handle), user);
    return response.sendStatus(204);
}));

router.post('/promote', requireAdminMiddleware, asyncHandler(async (request, response) => {
    if (!request.body.handle) {
        console.warn('Promote user failed: Missing required fields');
        return response.status(400).json({ error: 'Missing required fields' });
    }

    /** @type {import('../users.js').User} */
    const user = await storage.getItem(toKey(request.body.handle));

    if (!user) {
        console.error('Promote user failed: User not found');
        return response.status(404).json({ error: 'User not found' });
    }

    user.admin = true;
    await storage.setItem(toKey(request.body.handle), user);
    return response.sendStatus(204);
}));

router.post('/demote', requireAdminMiddleware, asyncHandler(async (request, response) => {
    if (!request.body.handle) {
        console.warn('Demote user failed: Missing required fields');
        return response.status(400).json({ error: 'Missing required fields' });
    }

    if (request.body.handle === request.user.profile.handle) {
        console.warn('Demote user failed: Cannot demote yourself');
        return response.status(400).json({ error: 'Cannot demote yourself' });
    }

    /** @type {import('../users.js').User} */
    const user = await storage.getItem(toKey(request.body.handle));

    if (!user) {
        console.error('Demote user failed: User not found');
        return response.status(404).json({ error: 'User not found' });
    }

    user.admin = false;
    await storage.setItem(toKey(request.body.handle), user);
    return response.sendStatus(204);
}));

router.post('/create', requireAdminMiddleware, asyncHandler(async (request, response) => {
    if (!request.body.handle || !request.body.name) {
        console.warn('Create user failed: Missing required fields');
        return response.status(400).json({ error: 'Missing required fields' });
    }

    const handles = await getAllUserHandles();
    const handle = lodash.kebabCase(String(request.body.handle).toLowerCase().trim());

    if (!handle) {
        console.warn('Create user failed: Invalid handle');
        return response.status(400).json({ error: 'Invalid handle' });
    }

    if (handles.some(x => x === handle)) {
        console.warn('Create user failed: User with that handle already exists');
        return response.status(409).json({ error: 'User already exists' });
    }

    const salt = getPasswordSalt();
    const password = request.body.password ? await getPasswordHash(request.body.password, salt) : '';

    const newUser = {
        handle: handle,
        name: request.body.name || 'Anonymous',
        created: Date.now(),
        password: password,
        salt: salt,
        admin: !!request.body.admin,
        enabled: true,
    };

    await storage.setItem(toKey(handle), newUser);

    // Create user directories
    console.info('Creating data directories for', newUser.handle);
    await ensurePublicDirectoriesExist();
    const directories = getUserDirectories(newUser.handle);
    await checkForNewContent([directories], [CONTENT_TYPES.SETTINGS]);
    return response.json({ handle: newUser.handle });
}));

router.post('/delete', requireAdminMiddleware, asyncHandler(async (request, response) => {
    if (!request.body.handle) {
        console.warn('Delete user failed: Missing required fields');
        return response.status(400).json({ error: 'Missing required fields' });
    }

    if (request.body.handle === request.user.profile.handle) {
        console.warn('Delete user failed: Cannot delete yourself');
        return response.status(400).json({ error: 'Cannot delete yourself' });
    }

    if (request.body.handle === DEFAULT_USER.handle) {
        console.warn('Delete user failed: Cannot delete default user');
        return response.status(400).json({ error: 'Sorry, but the default user cannot be deleted. It is required as a fallback.' });
    }

    await storage.removeItem(toKey(request.body.handle));

    if (request.body.purge) {
        const directories = getUserDirectories(request.body.handle);
        console.info('Deleting data directories for', request.body.handle);
        await fsPromises.rm(directories.root, { recursive: true, force: true });
    }

    return response.sendStatus(204);
}));

router.post('/slugify', requireAdminMiddleware, asyncHandler(async (request, response) => {
    if (!request.body.text) {
        console.warn('Slugify failed: Missing required fields');
        return response.status(400).json({ error: 'Missing required fields' });
    }

    const text = lodash.kebabCase(String(request.body.text).toLowerCase().trim());

    return response.send(text);
}));
