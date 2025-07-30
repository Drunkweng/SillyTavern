import fs from 'node:fs';
import { promises as fsPromises } from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import process from 'node:process';

import express from 'express';
// @ts-ignore
import sanitize from 'sanitize-filename';
import writeFileAtomic from 'write-file-atomic';
import _ from 'lodash';

import validateAvatarUrlMiddleware from '../middleware/validateFileName.js';
import {
    getConfigValue,
    humanizedISO8601DateTime,
    tryParse,
    generateTimestamp,
    removeOldBackups,
    formatBytes,
    asyncHandler,
} from '../util.js';

const isBackupEnabled = !!getConfigValue('backups.chat.enabled', true, 'boolean');
const maxTotalChatBackups = Number(getConfigValue('backups.chat.maxTotalBackups', -1, 'number'));
const throttleInterval = Number(getConfigValue('backups.chat.throttleInterval', 10_000, 'number'));
const checkIntegrity = !!getConfigValue('backups.chat.checkIntegrity', true, 'boolean');

export const CHAT_BACKUPS_PREFIX = 'chat_';

/**
 * Saves a chat to the backups directory.
 * @param {string} directory The user's backups directory.
 * @param {string} name The name of the chat.
 * @param {string} chat The serialized chat to save.
 */
async function backupChat(directory, name, chat) {
    try {
        if (!isBackupEnabled || !fs.existsSync(directory)) {
            return;
        }

        // replace non-alphanumeric characters with underscores
        name = sanitize(name).replace(/[^a-z0-9]/gi, '_').toLowerCase();

        const backupFile = path.join(directory, `${CHAT_BACKUPS_PREFIX}${name}_${generateTimestamp()}.jsonl`);
        await writeFileAtomic(backupFile, chat, 'utf-8');

        await removeOldBackups(directory, `${CHAT_BACKUPS_PREFIX}${name}_`);

        if (isNaN(maxTotalChatBackups) || maxTotalChatBackups < 0) {
            return;
        }

        await removeOldBackups(directory, CHAT_BACKUPS_PREFIX, maxTotalChatBackups);
    } catch (err) {
        console.error(`Could not backup chat for ${name}`, err);
    }
}

/**
 * @type {Map<string, import('lodash').DebouncedFunc<function(string, string, string): Promise<void>>>}
 */
const backupFunctions = new Map();

/**
 * Gets a backup function for a user.
 * @param {string} handle User handle
 * @returns {function(string, string, string): void} Backup function
 */
function getBackupFunction(handle) {
    if (!backupFunctions.has(handle)) {
        backupFunctions.set(handle, _.throttle(backupChat, throttleInterval, { leading: true, trailing: true }));
    }
    return backupFunctions.get(handle) || (() => { });
}

/**
 * Gets a preview message from an array of chat messages
 * @param {Array<Object>} messages - Array of chat messages, each with a 'mes' property
 * @returns {string} A truncated preview of the last message or empty string if no messages
 */
function getPreviewMessage(messages) {
    const strlen = 400;
    const lastMessage = messages[messages.length - 1]?.mes;

    if (!lastMessage) {
        return '';
    }

    return lastMessage.length > strlen
        ? '...' + lastMessage.substring(lastMessage.length - strlen)
        : lastMessage;
}

process.on('exit', () => {
    for (const func of backupFunctions.values()) {
        func.flush();
    }
});

/**
 * Imports a chat from Ooba's format.
 * @param {string} userName User name
 * @param {string} characterName Character name
 * @param {object} jsonData JSON data
 * @returns {string} Chat data
 */
function importOobaChat(userName, characterName, jsonData) {
    /** @type {object[]} */
    const chat = [{
        user_name: userName,
        character_name: characterName,
        create_date: humanizedISO8601DateTime(),
    }];

    for (const arr of jsonData.data_visible) {
        if (arr[0]) {
            const userMessage = {
                name: userName,
                is_user: true,
                send_date: humanizedISO8601DateTime(),
                mes: arr[0],
            };
            chat.push(userMessage);
        }
        if (arr[1]) {
            const charMessage = {
                name: characterName,
                is_user: false,
                send_date: humanizedISO8601DateTime(),
                mes: arr[1],
            };
            chat.push(charMessage);
        }
    }

    return chat.map(obj => JSON.stringify(obj)).join('\n');
}

/**
 * Imports a chat from Agnai's format.
 * @param {string} userName User name
 * @param {string} characterName Character name
 * @param {object} jsonData Chat data
 * @returns {string} Chat data
 */
function importAgnaiChat(userName, characterName, jsonData) {
    /** @type {object[]} */
    const chat = [{
        user_name: userName,
        character_name: characterName,
        create_date: humanizedISO8601DateTime(),
    }];

    for (const message of jsonData.messages) {
        const isUser = !!message.userId;
        chat.push({
            name: isUser ? userName : characterName,
            is_user: isUser,
            send_date: humanizedISO8601DateTime(),
            mes: message.msg,
        });
    }

    return chat.map(obj => JSON.stringify(obj)).join('\n');
}

/**
 * Imports a chat from CAI Tools format.
 * @param {string} userName User name
 * @param {string} characterName Character name
 * @param {object} jsonData JSON data
 * @returns {string[]} Converted data
 */
function importCAIChat(userName, characterName, jsonData) {
    /**
     * Converts the chat data to suitable format.
     * @param {object} history Imported chat data
     * @returns {object[]} Converted chat data
     */
    function convert(history) {
        const starter = {
            user_name: userName,
            character_name: characterName,
            create_date: humanizedISO8601DateTime(),
        };

        const historyData = history.msgs.map((msg) => ({
            name: msg.src.is_human ? userName : characterName,
            is_user: msg.src.is_human,
            send_date: humanizedISO8601DateTime(),
            mes: msg.text,
        }));

        return [starter, ...historyData];
    }

    const newChats = (jsonData.histories.histories ?? []).map(history => newChats.push(convert(history).map(obj => JSON.stringify(obj)).join('\n')));
    return newChats;
}

/**
 * Imports a chat from Kobold Lite format.
 * @param {string} _userName User name
 * @param {string} _characterName Character name
 * @param {object} data JSON data
 * @returns {string} Chat data
 */
function importKoboldLiteChat(_userName, _characterName, data) {
    const inputToken = '{{[INPUT]}}';
    const outputToken = '{{[OUTPUT]}}';

    /** @type {function(string): object} */
    function processKoboldMessage(msg) {
        const isUser = msg.includes(inputToken);
        return {
            name: isUser ? header.user_name : header.character_name,
            is_user: isUser,
            mes: msg.replaceAll(inputToken, '').replaceAll(outputToken, '').trim(),
            send_date: Date.now(),
        };
    }

    // Create the header
    const header = {
        user_name: String(data.savedsettings.chatname),
        character_name: String(data.savedsettings.chatopponent).split('||$||')[0],
    };
    // Format messages
    const formattedMessages = data.actions.map(processKoboldMessage);
    // Add prompt if available
    if (data.prompt) {
        formattedMessages.unshift(processKoboldMessage(data.prompt));
    }
    // Combine header and messages
    const chatData = [header, ...formattedMessages];
    return chatData.map(obj => JSON.stringify(obj)).join('\n');
}

/**
 * Flattens `msg` and `swipes` data from Chub Chat format.
 * Only changes enough to make it compatible with the standard chat serialization format.
 * @param {string} userName User name
 * @param {string} characterName Character name
 * @param {string[]} lines serialised JSONL data
 * @returns {string} Converted data
 */
function flattenChubChat(userName, characterName, lines) {
    function flattenSwipe(swipe) {
        return swipe.message ? swipe.message : swipe;
    }

    function convert(line) {
        const lineData = tryParse(line);
        if (!lineData) return line;

        if (lineData.mes && lineData.mes.message) {
            lineData.mes = lineData?.mes.message;
        }

        if (lineData?.swipes && Array.isArray(lineData.swipes)) {
            lineData.swipes = lineData.swipes.map(swipe => flattenSwipe(swipe));
        }

        return JSON.stringify(lineData);
    }

    return (lines ?? []).map(convert).join('\n');
}

/**
 * Imports a chat from RisuAI format.
 * @param {string} userName User name
 * @param {string} characterName Character name
 * @param {object} jsonData Imported chat data
 * @returns {string} Chat data
 */
function importRisuChat(userName, characterName, jsonData) {
    /** @type {object[]} */
    const chat = [{
        user_name: userName,
        character_name: characterName,
        create_date: humanizedISO8601DateTime(),
    }];

    for (const message of jsonData.data.message) {
        const isUser = message.role === 'user';
        chat.push({
            name: message.name ?? (isUser ? userName : characterName),
            is_user: isUser,
            send_date: Number(message.time ?? Date.now()),
            mes: message.data ?? '',
        });
    }

    return chat.map(obj => JSON.stringify(obj)).join('\n');
}

/**
 * Reads the first line of a file asynchronously.
 * @param {string} filePath Path to the file
 * @returns {Promise<string>} The first line of the file
 */
function readFirstLine(filePath) {
    const stream = fs.createReadStream(filePath, { encoding: 'utf8' });
    const rl = readline.createInterface({ input: stream });
    return new Promise((resolve, reject) => {
        let resolved = false;
        rl.on('line', line => {
            resolved = true;
            rl.close();
            stream.close();
            resolve(line);
        });

        rl.on('error', error => {
            resolved = true;
            reject(error);
        });

        // Handle empty files
        stream.on('end', () => {
            if (!resolved) {
                resolved = true;
                resolve('');
            }
        });
    });
}

/**
 * Checks if the chat being saved has the same integrity as the one being loaded.
 * @param {string} filePath Path to the chat file
 * @param {string} integritySlug Integrity slug
 * @returns {Promise<boolean>} Whether the chat is intact
 */
async function checkChatIntegrity(filePath, integritySlug) {
    // If the chat file doesn't exist, assume it's intact
    try {
        await fsPromises.access(filePath);
    } catch {
        return true;
    }

    // Parse the first line of the chat file as JSON
    const firstLine = await readFirstLine(filePath);
    const jsonData = tryParse(firstLine);
    const chatIntegrity = jsonData?.chat_metadata?.integrity;

    // If the chat has no integrity metadata, assume it's intact
    if (!chatIntegrity) {
        return true;
    }

    // Check if the integrity matches
    return chatIntegrity === integritySlug;
}

/**
 * @typedef {Object} ChatInfo
 * @property {string} [file_name] - The name of the chat file
 * @property {string} [file_size] - The size of the chat file
 * @property {number} [chat_items] - The number of chat items in the file
 * @property {string} [mes] - The last message in the chat
 * @property {number} [last_mes] - The timestamp of the last message
 */

/**
 * Reads the information from a chat file.
 * @param {string} pathToFile
 * @param {object} additionalData
 * @returns {Promise<ChatInfo>}
 */
export async function getChatInfo(pathToFile, additionalData = {}, isGroup = false) {
    return new Promise(async (res) => {
        const stats = await fsPromises.stat(pathToFile);
        const fileSizeInKB = `${(stats.size / 1024).toFixed(2)}kb`;

        const chatData = {
            file_name: path.parse(pathToFile).base,
            file_size: fileSizeInKB,
            chat_items: 0,
            mes: '[The chat is empty]',
            last_mes: stats.mtimeMs,
            ...additionalData,
        };

        if (stats.size === 0 && !isGroup) {
            console.warn(`Found an empty chat file: ${pathToFile}`);
            res({});
            return;
        }

        if (stats.size === 0 && isGroup) {
            res(chatData);
            return;
        }

        const fileStream = fs.createReadStream(pathToFile);
        const rl = readline.createInterface({
            input: fileStream,
            crlfDelay: Infinity,
        });

        let lastLine;
        let itemCounter = 0;
        rl.on('line', (line) => {
            itemCounter++;
            lastLine = line;
        });
        rl.on('close', () => {
            rl.close();

            if (lastLine) {
                const jsonData = tryParse(lastLine);
                if (jsonData && (jsonData.name || jsonData.character_name)) {
                    chatData.chat_items = isGroup ? itemCounter : (itemCounter - 1);
                    chatData.mes = jsonData['mes'] || '[The message is empty]';
                    chatData.last_mes = jsonData['send_date'] || stats.mtimeMs;

                    res(chatData);
                } else {
                    console.warn('Found an invalid or corrupted chat file:', pathToFile);
                    res({});
                }
            }
        });
    });
}

export const router = express.Router();

router.post('/save', validateAvatarUrlMiddleware, asyncHandler(async function (request, response) {
    try {
        const directoryName = String(request.body.avatar_url).replace('.png', '');
        const chatData = request.body.chat;
        const jsonlData = chatData.map(JSON.stringify).join('\n');
        const fileName = `${String(request.body.file_name)}.jsonl`;
        const filePath = path.join(request.user.directories.chats, directoryName, sanitize(fileName));
        if (checkIntegrity && !request.body.force) {
            const integritySlug = chatData?.[0]?.chat_metadata?.integrity;
            const isIntact = await checkChatIntegrity(filePath, integritySlug);
            if (!isIntact) {
                console.error(`Chat integrity check failed for ${filePath}`);
                return response.status(400).send({ error: 'integrity' });
            }
        }
        await writeFileAtomic(filePath, jsonlData, 'utf8');
        getBackupFunction(request.user.profile.handle)(request.user.directories.backups, directoryName, jsonlData);
        response.send({ result: 'ok' });
    } catch (error) {
        console.error(error);
        response.send(error);
    }
}));

router.post('/get', validateAvatarUrlMiddleware, asyncHandler(async function (request, response) {
    try {
        const dirName = String(request.body.avatar_url).replace('.png', '');
        const directoryPath = path.join(request.user.directories.chats, dirName);

        // Check if chat directory exists, create if it doesn't
        try {
            await fsPromises.access(directoryPath);
        } catch {
            //if no chat dir for the character is found, make one with the character name
            await fsPromises.mkdir(directoryPath);
            return response.send({});
        }

        if (!request.body.file_name) {
            return response.send({});
        }

        const fileName = `${String(request.body.file_name)}.jsonl`;
        const filePath = path.join(directoryPath, sanitize(fileName));

        // Check if chat file exists
        try {
            await fsPromises.access(filePath);
        } catch {
            return response.send({});
        }

        const data = await fsPromises.readFile(filePath, 'utf8');
        const lines = data.split('\n');

        // Iterate through the array of strings and parse each line as JSON
        const jsonData = lines.map((l) => { try { return JSON.parse(l); } catch (_) { return; } }).filter(x => x);
        return response.send(jsonData);
    } catch (error) {
        console.error(error);
        // Only send response if headers haven't been sent yet
        if (!response.headersSent) {
            return response.send({});
        }
    }
}));

router.post('/rename', validateAvatarUrlMiddleware, asyncHandler(async function (request, response) {
    try {
        if (!request.body || !request.body.original_file || !request.body.renamed_file) {
            response.sendStatus(400);
        }

        const pathToFolder = request.body.is_group
            ? request.user.directories.groupChats
            : path.join(request.user.directories.chats, String(request.body.avatar_url).replace('.png', ''));
        const pathToOriginalFile = path.join(pathToFolder, sanitize(request.body.original_file));
        const pathToRenamedFile = path.join(pathToFolder, sanitize(request.body.renamed_file));
        const sanitizedFileName = path.parse(pathToRenamedFile).name;
        console.debug('Old chat name', pathToOriginalFile);
        console.debug('New chat name', pathToRenamedFile);

        try {
            await fsPromises.access(pathToOriginalFile);
        } catch {
            console.error('Either Source or Destination files are not available');
            return response.status(400).send({ error: true });
        }
        try {
            await fsPromises.access(pathToRenamedFile);
            console.error('Either Source or Destination files are not available');
            return response.status(400).send({ error: true });
        } catch {
            // new file does not exist, this is good
        }

        await fsPromises.copyFile(pathToOriginalFile, pathToRenamedFile);
        await fsPromises.unlink(pathToOriginalFile);
        console.info('Successfully renamed chat file.');
        response.send({ ok: true, sanitizedFileName });
    } catch (error) {
        console.error('Error renaming chat file:', error);
        response.status(500).send({ error: true });
    }
}));

router.post('/delete', validateAvatarUrlMiddleware, asyncHandler(async function (request, response) {
    const dirName = String(request.body.avatar_url).replace('.png', '');
    const fileName = String(request.body.chatfile);
    const filePath = path.join(request.user.directories.chats, dirName, sanitize(fileName));

    try {
        await fsPromises.access(filePath);
    } catch {
        console.error(`Chat file not found '${filePath}'`);
        response.sendStatus(400);
    }

    await fsPromises.unlink(filePath);
    console.info(`Deleted chat file: ${filePath}`);
    response.send('ok');
}));

router.post('/export', validateAvatarUrlMiddleware, asyncHandler(async function (request, response) {
    if (!request.body.file || (!request.body.avatar_url && request.body.is_group === false)) {
        response.sendStatus(400);
    }
    const pathToFolder = request.body.is_group
        ? request.user.directories.groupChats
        : path.join(request.user.directories.chats, String(request.body.avatar_url).replace('.png', ''));
    let filename = path.join(pathToFolder, request.body.file);
    let exportfilename = request.body.exportfilename;
    try {
        await fsPromises.access(filename);
    } catch {
        const errorMessage = {
            message: `Could not find JSONL file to export. Source chat file: ${filename}.`,
        };
        console.error(errorMessage.message);
        response.status(404).json(errorMessage);
        return;
    }
    try {
        // Short path for JSONL files
        if (request.body.format === 'jsonl') {
            try {
                const rawFile = await fsPromises.readFile(filename, 'utf8');
                const successMessage = {
                    message: `Chat saved to ${exportfilename}`,
                    result: rawFile,
                };

                console.info(`Chat exported as ${exportfilename}`);
                response.status(200).json(successMessage);
                return;
            } catch (err) {
                console.error(err);
                const errorMessage = {
                    message: `Could not read JSONL file to export. Source chat file: ${filename}.`,
                };
                console.error(errorMessage.message);
                response.status(500).json(errorMessage);
                return;
            }
        }

        const readStream = fs.createReadStream(filename);
        const rl = readline.createInterface({
            input: readStream,
        });
        let buffer = '';
        rl.on('line', (line) => {
            const data = JSON.parse(line);
            // Skip non-printable/prompt-hidden messages
            if (data.is_system) {
                return;
            }
            if (data.mes) {
                const name = data.name;
                const message = (data?.extra?.display_text || data?.mes || '').replace(/\r?\n/g, '\n');
                buffer += (`${name}: ${message}\n\n`);
            }
        });
        rl.on('close', () => {
            const successMessage = {
                message: `Chat saved to ${exportfilename}`,
                result: buffer,
            };
            console.info(`Chat exported as ${exportfilename}`);
            response.status(200).json(successMessage);
        });
    } catch (err) {
        console.error('chat export failed.', err);
        response.sendStatus(400);
    }
}));

router.post('/group/import', asyncHandler(async function (request, response) {
    try {
        const filedata = request.file;

        if (!filedata) {
            response.sendStatus(400);
            return;
        }

        const chatname = humanizedISO8601DateTime();
        const pathToUpload = path.join(filedata.destination, filedata.filename);
        const pathToNewFile = path.join(request.user.directories.groupChats, `${chatname}.jsonl`);
        await fsPromises.copyFile(pathToUpload, pathToNewFile);
        await fsPromises.unlink(pathToUpload);
        response.send({ res: chatname });
    } catch (error) {
        console.error(error);
        response.send({ error: true });
    }
}));

router.post('/import', validateAvatarUrlMiddleware, asyncHandler(async function (request, response) {
    if (!request.body) {
        response.sendStatus(400);
        return;
    }

    const format = request.body.file_type;
    const avatarUrl = (request.body.avatar_url).replace('.png', '');
    const characterName = request.body.character_name;
    const userName = request.body.user_name || 'User';

    if (!request.file) {
        response.sendStatus(400);
        return;
    }

    try {
        const pathToUpload = path.join(request.file.destination, request.file.filename);
        const data = await fsPromises.readFile(pathToUpload, 'utf8');

        if (format === 'json') {
            await fsPromises.unlink(pathToUpload);
            const jsonData = JSON.parse(data);

            /** @type {function(string, string, object): string|string[]} */
            let importFunc;

            if (jsonData.savedsettings !== undefined) { // Kobold Lite format
                importFunc = importKoboldLiteChat;
            } else if (jsonData.histories !== undefined) { // CAI Tools format
                importFunc = importCAIChat;
            } else if (Array.isArray(jsonData.data_visible)) { // oobabooga's format
                importFunc = importOobaChat;
            } else if (Array.isArray(jsonData.messages)) { // Agnai's format
                importFunc = importAgnaiChat;
            } else if (jsonData.type === 'risuChat') { // RisuAI format
                importFunc = importRisuChat;
            } else { // Unknown format
                console.error('Incorrect chat format .json');
                response.send({ error: true });
                return;
            }

            const handleChat = async (chat) => {
                const fileName = `${characterName} - ${humanizedISO8601DateTime()} imported.jsonl`;
                const filePath = path.join(request.user.directories.chats, avatarUrl, fileName);
                await writeFileAtomic(filePath, chat, 'utf8');
            };

            const chat = importFunc(userName, characterName, jsonData);

            if (Array.isArray(chat)) {
                for (const c of chat) {
                    await handleChat(c);
                }
            } else {
                await handleChat(chat);
            }

            response.send({ res: true });
            return;
        }

        if (format === 'jsonl') {
            let lines = data.split('\n');
            const header = lines[0];

            const jsonData = JSON.parse(header);

            if (!(jsonData.user_name !== undefined || jsonData.name !== undefined)) {
                console.error('Incorrect chat format .jsonl');
                response.send({ error: true });
                return;
            }

            // Do a tiny bit of work to import Chub Chat data
            // Processing the entire file is so fast that it's not worth checking if it's a Chub chat first
            let flattenedChat = data;
            try {
                // flattening is unlikely to break, but it's not worth failing to
                // import normal chats in an attempt to import a Chub chat
                flattenedChat = flattenChubChat(userName, characterName, lines);
            } catch (error) {
                console.warn('Failed to flatten Chub Chat data: ', error);
            }

            const fileName = `${characterName} - ${humanizedISO8601DateTime()} imported.jsonl`;
            const filePath = path.join(request.user.directories.chats, avatarUrl, fileName);
            if (flattenedChat !== data) {
                await writeFileAtomic(filePath, flattenedChat, 'utf8');
            } else {
                await fsPromises.copyFile(pathToUpload, filePath);
            }
            await fsPromises.unlink(pathToUpload);
            response.send({ res: true });
        }
    } catch (error) {
        console.error(error);
        response.send({ error: true });
    }
}));

router.post('/group/get', asyncHandler(async function (request, response) {
    if (!request.body || !request.body.id) {
        response.sendStatus(400);
        return;
    }

    const id = request.body.id;
    const pathToFile = path.join(request.user.directories.groupChats, `${id}.jsonl`);

    try {
        await fsPromises.access(pathToFile);
        const data = await fsPromises.readFile(pathToFile, 'utf8');
        const lines = data.split('\n');

        // Iterate through the array of strings and parse each line as JSON
        const jsonData = lines.map(line => tryParse(line)).filter(x => x);
        response.send(jsonData);
    } catch {
        response.send([]);
    }
}));

router.post('/group/delete', asyncHandler(async function (request, response) {
    if (!request.body || !request.body.id) {
        response.sendStatus(400);
        return;
    }

    const id = request.body.id;
    const pathToFile = path.join(request.user.directories.groupChats, `${id}.jsonl`);

    try {
        await fsPromises.access(pathToFile);
        await fsPromises.unlink(pathToFile);
        response.send({ ok: true });
    } catch {
        response.send({ error: true });
    }
}));

router.post('/group/save', asyncHandler(async function (request, response) {
    if (!request.body || !request.body.id) {
        response.sendStatus(400);
        return;
    }

    const id = request.body.id;
    const pathToFile = path.join(request.user.directories.groupChats, `${id}.jsonl`);

    try {
        await fsPromises.access(request.user.directories.groupChats);
    } catch {
        await fsPromises.mkdir(request.user.directories.groupChats);
    }

    let chat_data = request.body.chat;
    let jsonlData = chat_data.map(JSON.stringify).join('\n');
    await writeFileAtomic(pathToFile, jsonlData, 'utf8');
    getBackupFunction(request.user.profile.handle)(request.user.directories.backups, String(id), jsonlData);
    response.send({ ok: true });
}));

router.post('/search', validateAvatarUrlMiddleware, asyncHandler(async function (request, response) {
    try {
        const { query, avatar_url, group_id } = request.body;
        let chatFiles = [];

        if (group_id) {
            // Find group's chat IDs first
            const groupDir = path.join(request.user.directories.groups);
            const groupFiles = (await fsPromises.readdir(groupDir))
                .filter(file => file.endsWith('.json'));

            let targetGroup;
            for (const groupFile of groupFiles) {
                try {
                    const groupData = JSON.parse(await fsPromises.readFile(path.join(groupDir, groupFile), 'utf8'));
                    if (groupData.id === group_id) {
                        targetGroup = groupData;
                        break;
                    }
                } catch (error) {
                    console.warn(groupFile, 'group file is corrupted:', error);
                }
            }

            if (!targetGroup?.chats) {
                response.send([]);
                return;
            }

            // Find group chat files for given group ID
            const groupChatsDir = path.join(request.user.directories.groupChats);
            chatFiles = (await Promise.all(targetGroup.chats
                .map(async (chatId) => {
                    const filePath = path.join(groupChatsDir, `${chatId}.jsonl`);
                    try {
                        await fsPromises.access(filePath);
                        const stats = await fsPromises.stat(filePath);
                        return {
                            file_name: chatId,
                            file_size: formatBytes(stats.size),
                            path: filePath,
                        };
                    } catch {
                        return null;
                    }
                })))
                .filter(x => x);
        } else {
            // Regular character chat directory
            const character_name = avatar_url.replace('.png', '');
            const directoryPath = path.join(request.user.directories.chats, character_name);

            try {
                await fsPromises.access(directoryPath);
            } catch {
                response.send([]);
                return;
            }

            chatFiles = (await Promise.all((await fsPromises.readdir(directoryPath))
                .filter(file => file.endsWith('.jsonl'))
                .map(async (fileName) => {
                    const filePath = path.join(directoryPath, fileName);
                    const stats = await fsPromises.stat(filePath);
                    return {
                        file_name: fileName,
                        file_size: formatBytes(stats.size),
                        path: filePath,
                    };
                })));
        }

        const results = [];

        // Search logic
        for (const chatFile of chatFiles) {
            const data = await fsPromises.readFile(chatFile.path, 'utf8');
            const messages = data.split('\n')
                .map(line => { try { return JSON.parse(line); } catch (_) { return null; } })
                .filter(x => x && typeof x.mes === 'string');

            if (query && messages.length === 0) {
                continue;
            }

            const lastMessage = messages[messages.length - 1];
            const lastMesDate = lastMessage?.send_date || Math.round((await fsPromises.stat(chatFile.path)).mtimeMs);

            // If no search query, just return metadata
            if (!query) {
                results.push({
                    file_name: chatFile.file_name,
                    file_size: chatFile.file_size,
                    message_count: messages.length,
                    last_mes: lastMesDate,
                    preview_message: getPreviewMessage(messages),
                });
                continue;
            }

            // Search through title and messages of the chat
            const fragments = query.trim().toLowerCase().split(/\s+/).filter(x => x);
            const text = [path.parse(chatFile.path).name, ...messages.map(message => message?.mes)].join('\n').toLowerCase();
            const hasMatch = fragments.every(fragment => text.includes(fragment));

            if (hasMatch) {
                results.push({
                    file_name: chatFile.file_name,
                    file_size: chatFile.file_size,
                    message_count: messages.length,
                    last_mes: lastMesDate,
                    preview_message: getPreviewMessage(messages),
                });
            }
        }

        // Sort by last message date descending
        results.sort((a, b) => new Date(b.last_mes).getTime() - new Date(a.last_mes).getTime());
        response.send(results);

    } catch (error) {
        console.error('Chat search error:', error);
        response.status(500).json({ error: 'Search failed' });
    }
}));

router.post('/recent', asyncHandler(async function (request, response) {
    try {
        /** @type {{pngFile?: string, groupId?: string, filePath: string, mtime: number}[]} */
        const allChatFiles = [];

        const getCharacterChatFiles = async () => {
            const pngDirents = await fsPromises.readdir(request.user.directories.characters, { withFileTypes: true });
            const pngFiles = pngDirents.filter(e => e.isFile() && path.extname(e.name) === '.png').map(e => e.name);

            for (const pngFile of pngFiles) {
                const chatsDirectory = pngFile.replace('.png', '');
                const pathToChats = path.join(request.user.directories.chats, chatsDirectory);
                try {
                    await fsPromises.access(pathToChats);
                } catch {
                    continue;
                }
                const pathStats = await fsPromises.stat(pathToChats);
                if (pathStats.isDirectory()) {
                    const chatFiles = await fsPromises.readdir(pathToChats);
                    const jsonlFiles = chatFiles.filter(file => path.extname(file) === '.jsonl');

                    for (const file of jsonlFiles) {
                        const filePath = path.join(pathToChats, file);
                        const stats = await fsPromises.stat(filePath);
                        allChatFiles.push({ pngFile, filePath, mtime: stats.mtimeMs });
                    }
                }
            }
        };

        const getGroupChatFiles = async () => {
            const groupDirents = await fsPromises.readdir(request.user.directories.groups, { withFileTypes: true });
            const groups = groupDirents.filter(e => e.isFile() && path.extname(e.name) === '.json').map(e => e.name);

            for (const group of groups) {
                try {
                    const groupPath = path.join(request.user.directories.groups, group);
                    const groupContents = await fsPromises.readFile(groupPath, 'utf8');
                    const groupData = JSON.parse(groupContents);

                    if (Array.isArray(groupData.chats)) {
                        for (const chat of groupData.chats) {
                            const filePath = path.join(request.user.directories.groupChats, `${chat}.jsonl`);
                            try {
                                await fsPromises.access(filePath);
                            } catch {
                                continue;
                            }
                            const stats = await fsPromises.stat(filePath);
                            allChatFiles.push({ groupId: groupData.id, filePath, mtime: stats.mtimeMs });
                        }
                    }
                } catch (error) {
                    // Skip group files that can't be read or parsed
                    continue;
                }
            }
        };

        await Promise.allSettled([getCharacterChatFiles(), getGroupChatFiles()]);

        const max = parseInt(request.body.max ?? Number.MAX_SAFE_INTEGER);
        const recentChats = allChatFiles.sort((a, b) => b.mtime - a.mtime).slice(0, max);
        const jsonFilesPromise = recentChats.map((file) => {
            return file.groupId
                ? getChatInfo(file.filePath, { group: file.groupId }, true)
                : getChatInfo(file.filePath, { avatar: file.pngFile }, false);
        });

        const chatData = (await Promise.allSettled(jsonFilesPromise)).filter(x => x.status === 'fulfilled').map(x => x.value);
        const validFiles = chatData.filter(i => i.file_name);

        response.send(validFiles);
    } catch (error) {
        console.error(error);
        response.sendStatus(500);
    }
}));
