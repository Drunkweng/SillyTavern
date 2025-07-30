import { promises as fs } from 'node:fs';
import path from 'node:path';

import express from 'express';
// @ts-ignore
import sanitize from 'sanitize-filename';
import writeFileAtomic from 'write-file-atomic';

import { humanizedISO8601DateTime, asyncHandler } from '../util.js';
import { getFileNameValidationFunction } from '../middleware/validateFileName.js';

export const router = express.Router();

router.post('/all', asyncHandler(async (request, response) => {
    const groups = [];

    try {
        await fs.access(request.user.directories.groups);
    } catch {
        await fs.mkdir(request.user.directories.groups);
    }

    const files = (await fs.readdir(request.user.directories.groups)).filter(x => path.extname(x) === '.json');
    const chats = (await fs.readdir(request.user.directories.groupChats)).filter(x => path.extname(x) === '.jsonl');

    for (const file of files) {
        try {
            const filePath = path.join(request.user.directories.groups, file);
            const fileContents = await fs.readFile(filePath, 'utf8');
            const group = JSON.parse(fileContents);
            const groupStat = await fs.stat(filePath);
            group['date_added'] = groupStat.birthtimeMs;
            group['create_date'] = humanizedISO8601DateTime(groupStat.birthtimeMs);

            let chat_size = 0;
            let date_last_chat = 0;

            if (Array.isArray(group.chats) && Array.isArray(chats)) {
                for (const chat of chats) {
                    if (group.chats.includes(path.parse(chat).name)) {
                        const chatStat = await fs.stat(path.join(request.user.directories.groupChats, chat));
                        chat_size += chatStat.size;
                        date_last_chat = Math.max(date_last_chat, chatStat.mtimeMs);
                    }
                }
            }

            group['date_last_chat'] = date_last_chat;
            group['chat_size'] = chat_size;
            groups.push(group);
        }
        catch (error) {
            console.error(error);
        }
    }

    response.send(groups);
}));

router.post('/create', asyncHandler(async (request, response) => {
    if (!request.body) {
        response.sendStatus(400);
        return;
    }

    const id = String(Date.now());
    const groupMetadata = {
        id: id,
        name: request.body.name ?? 'New Group',
        members: request.body.members ?? [],
        avatar_url: request.body.avatar_url,
        allow_self_responses: !!request.body.allow_self_responses,
        activation_strategy: request.body.activation_strategy ?? 0,
        generation_mode: request.body.generation_mode ?? 0,
        disabled_members: request.body.disabled_members ?? [],
        chat_metadata: request.body.chat_metadata ?? {},
        fav: request.body.fav,
        chat_id: request.body.chat_id ?? id,
        chats: request.body.chats ?? [id],
        auto_mode_delay: request.body.auto_mode_delay ?? 5,
        generation_mode_join_prefix: request.body.generation_mode_join_prefix ?? '',
        generation_mode_join_suffix: request.body.generation_mode_join_suffix ?? '',
    };
    const pathToFile = path.join(request.user.directories.groups, sanitize(`${id}.json`));
    const fileData = JSON.stringify(groupMetadata, null, 4);

    try {
        await fs.access(request.user.directories.groups);
    } catch {
        await fs.mkdir(request.user.directories.groups);
    }

    await writeFileAtomic(pathToFile, fileData);
    response.send(groupMetadata);
}));

router.post('/edit', getFileNameValidationFunction('id'), asyncHandler(async (request, response) => {
    if (!request.body || !request.body.id) {
        response.sendStatus(400);
        return;
    }
    const id = request.body.id;
    const pathToFile = path.join(request.user.directories.groups, sanitize(`${id}.json`));
    const fileData = JSON.stringify(request.body, null, 4);

    await writeFileAtomic(pathToFile, fileData);
    response.send({ ok: true });
}));

router.post('/delete', getFileNameValidationFunction('id'), asyncHandler(async (request, response) => {
    if (!request.body || !request.body.id) {
        response.sendStatus(400);
        return;
    }

    const id = request.body.id;
    const pathToGroup = path.join(request.user.directories.groups, sanitize(`${id}.json`));

    try {
        // Delete group chats
        const group = JSON.parse(await fs.readFile(pathToGroup, 'utf8'));

        if (group && Array.isArray(group.chats)) {
            for (const chat of group.chats) {
                console.info('Deleting group chat', chat);
                const pathToFile = path.join(request.user.directories.groupChats, sanitize(`${chat}.jsonl`));

                try {
                    await fs.access(pathToFile);
                    await fs.unlink(pathToFile);
                } catch {
                    // ignore files that don't exist
                }
            }
        }
    } catch (error) {
        console.error('Could not delete group chats. Clean them up manually.', error);
    }

    try {
        await fs.access(pathToGroup);
        await fs.unlink(pathToGroup);
    } catch {
        // ignore files that don't exist
    }

    response.send({ ok: true });
}));
