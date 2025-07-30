import { promises as fs } from 'node:fs';
import path from 'node:path';

import express from 'express';
import writeFileAtomic from 'write-file-atomic';
import { color, getConfigValue, uuidv4, asyncHandler } from '../util.js';

export const SECRETS_FILE = 'secrets.json';
export const SECRET_KEYS = {
    _MIGRATED: '_migrated',
    HORDE: 'api_key_horde',
    MANCER: 'api_key_mancer',
    VLLM: 'api_key_vllm',
    APHRODITE: 'api_key_aphrodite',
    TABBY: 'api_key_tabby',
    OPENAI: 'api_key_openai',
    NOVEL: 'api_key_novel',
    CLAUDE: 'api_key_claude',
    DEEPL: 'deepl',
    LIBRE: 'libre',
    LIBRE_URL: 'libre_url',
    LINGVA_URL: 'lingva_url',
    OPENROUTER: 'api_key_openrouter',
    AI21: 'api_key_ai21',
    ONERING_URL: 'oneringtranslator_url',
    DEEPLX_URL: 'deeplx_url',
    MAKERSUITE: 'api_key_makersuite',
    VERTEXAI: 'api_key_vertexai',
    SERPAPI: 'api_key_serpapi',
    TOGETHERAI: 'api_key_togetherai',
    MISTRALAI: 'api_key_mistralai',
    CUSTOM: 'api_key_custom',
    OOBA: 'api_key_ooba',
    INFERMATICAI: 'api_key_infermaticai',
    DREAMGEN: 'api_key_dreamgen',
    NOMICAI: 'api_key_nomicai',
    KOBOLDCPP: 'api_key_koboldcpp',
    LLAMACPP: 'api_key_llamacpp',
    COHERE: 'api_key_cohere',
    PERPLEXITY: 'api_key_perplexity',
    GROQ: 'api_key_groq',
    AZURE_TTS: 'api_key_azure_tts',
    FEATHERLESS: 'api_key_featherless',
    HUGGINGFACE: 'api_key_huggingface',
    STABILITY: 'api_key_stability',
    CUSTOM_OPENAI_TTS: 'api_key_custom_openai_tts',
    TAVILY: 'api_key_tavily',
    ELECTRONHUB: 'api_key_electronhub',
    NANOGPT: 'api_key_nanogpt',
    BFL: 'api_key_bfl',
    FALAI: 'api_key_falai',
    GENERIC: 'api_key_generic',
    DEEPSEEK: 'api_key_deepseek',
    SERPER: 'api_key_serper',
    AIMLAPI: 'api_key_aimlapi',
    XAI: 'api_key_xai',
    FIREWORKS: 'api_key_fireworks',
    VERTEXAI_SERVICE_ACCOUNT: 'vertexai_service_account_json',
    MINIMAX: 'api_key_minimax',
    MINIMAX_GROUP_ID: 'minimax_group_id',
    MOONSHOT: 'api_key_moonshot',
    COMETAPI: 'api_key_cometapi',
    AZURE_OPENAI: 'api_key_azure_openai',
};

/**
 * @typedef {object} SecretValue
 * @property {string} id The unique identifier for the secret
 * @property {string} value The secret value
 * @property {string} label The label for the secret
 * @property {boolean} active Whether the secret is currently active
 */

/**
 * @typedef {object} SecretState
 * @property {string} id The unique identifier for the secret
 * @property {string} value The secret value, masked for security
 * @property {string} label The label for the secret
 * @property {boolean} active Whether the secret is currently active
 */

/**
 * @typedef {Record<string, SecretState[]|null>} SecretStateMap
 */

/**
 * @typedef {{[key: string]: SecretValue[]}} SecretKeys
 * @typedef {{[key: string]: string}} FlatSecretKeys
 */

// These are the keys that are safe to expose, even if allowKeysExposure is false
const EXPORTABLE_KEYS = [
    SECRET_KEYS.LIBRE_URL,
    SECRET_KEYS.LINGVA_URL,
    SECRET_KEYS.ONERING_URL,
    SECRET_KEYS.DEEPLX_URL,
];

const allowKeysExposure = !!getConfigValue('allowKeysExposure', false, 'boolean');

/**
 * SecretManager class to handle all secret operations
 */
export class SecretManager {
    /**
     * @param {import('../users.js').UserDirectoryList} directories
     */
    constructor(directories) {
        this.directories = directories;
        this.filePath = path.join(directories.root, SECRETS_FILE);
        this.defaultSecrets = {};
    }

    /**
     * Ensures the secrets file exists, creating an empty one if necessary
     * @private
     */
    async _ensureSecretsFile() {
        try {
            await fs.access(this.filePath);
        } catch {
            await writeFileAtomic(this.filePath, JSON.stringify(this.defaultSecrets));
        }
    }

    /**
     * Reads and parses the secrets file
     * @private
     * @returns {Promise<SecretKeys>}
     */
    async _readSecretsFile() {
        await this._ensureSecretsFile();
        const fileContents = await fs.readFile(this.filePath, 'utf-8');
        return /** @type {SecretKeys} */ (JSON.parse(fileContents));
    }

    /**
     * Writes secrets to the file atomically
     * @private
     * @param {SecretKeys} secrets
     */
    async _writeSecretsFile(secrets) {
        await writeFileAtomic(this.filePath, JSON.stringify(secrets, null, 4));
    }

    /**
     * Deactivates all secrets for a given key
     * @private
     * @param {SecretValue[]} secretArray
     */
    _deactivateAllSecrets(secretArray) {
        secretArray.forEach(secret => {
            secret.active = false;
        });
    }

    /**
     * Validates that the secret key exists and has valid structure
     * @private
     * @param {SecretKeys} secrets
     * @param {string} key
     * @returns {boolean}
     */
    _validateSecretKey(secrets, key) {
        return Object.hasOwn(secrets, key) && Array.isArray(secrets[key]);
    }

    /**
     * Masks a secret value with asterisks in the middle
     * @param {string} value The secret value to mask
     * @param {string} key The secret key
     * @returns {string} A masked version of the value for peeking
     */
    getMaskedValue(value, key) {
        // No masking if exposure is allowed
        if (allowKeysExposure || EXPORTABLE_KEYS.includes(key)) {
            return value;
        }
        const threshold = 10;
        const exposedChars = 3;
        const placeholder = '*';
        if (value.length <= threshold) {
            return placeholder.repeat(threshold);
        }
        const visibleEnd = value.slice(-exposedChars);
        const maskedMiddle = placeholder.repeat(threshold - exposedChars);
        return `${maskedMiddle}${visibleEnd}`;
    }

    /**
     * Writes a secret to the secrets file
     * @param {string} key Secret key
     * @param {string} value Secret value
     * @param {string} label Label for the secret
     * @returns {Promise<string>} The ID of the newly created secret
     */
    async writeSecret(key, value, label = 'Unlabeled') {
        const secrets = await this._readSecretsFile();

        if (!Array.isArray(secrets[key])) {
            secrets[key] = [];
        }

        this._deactivateAllSecrets(secrets[key]);

        const secret = {
            id: uuidv4(),
            value: value,
            label: label,
            active: true,
        };
        secrets[key].push(secret);

        await this._writeSecretsFile(secrets);
        return secret.id;
    }

    /**
     * Deletes a secret from the secrets file by its ID
     * @param {string} key Secret key
     * @param {string?} id Secret ID to delete
     */
    async deleteSecret(key, id) {
        try {
            await fs.access(this.filePath);
        } catch {
            return;
        }

        const secrets = await this._readSecretsFile();

        if (!this._validateSecretKey(secrets, key)) {
            return;
        }

        const secretArray = secrets[key];
        const targetIndex = secretArray.findIndex(s => id ? s.id === id : s.active);

        // Delete the secret if found
        if (targetIndex !== -1) {
            secretArray.splice(targetIndex, 1);
        }

        // Reactivate the first secret if none are active
        if (secretArray.length && !secretArray.some(s => s.active)) {
            secretArray[0].active = true;
        }

        // Remove the key if no secrets left
        if (secretArray.length === 0) {
            delete secrets[key];
        }

        await this._writeSecretsFile(secrets);
    }

    /**
     * Reads the active secret value for a given key
     * @param {string} key Secret key
     * @param {string?} id ID of the secret to read (optional)
     * @returns {Promise<string>} Secret value or empty string if not found
     */
    async readSecret(key, id) {
        try {
            await fs.access(this.filePath);
        } catch {
            return '';
        }

        const secrets = await this._readSecretsFile();
        const secretArray = secrets[key];

        if (Array.isArray(secretArray) && secretArray.length > 0) {
            const activeSecret = secretArray.find(s => id ? s.id === id : s.active);
            return activeSecret?.value || '';
        }

        return '';
    }

    /**
     * Activates a specific secret by ID for a given key
     * @param {string} key Secret key to rotate
     * @param {string} id ID of the secret to activate
     */
    async rotateSecret(key, id) {
        try {
            await fs.access(this.filePath);
        } catch {
            return;
        }

        const secrets = await this._readSecretsFile();

        if (!this._validateSecretKey(secrets, key)) {
            return;
        }

        const secretArray = secrets[key];
        const targetIndex = secretArray.findIndex(s => s.id === id);

        if (targetIndex === -1) {
            console.warn(`Secret with ID ${id} not found for key ${key}`);
            return;
        }

        this._deactivateAllSecrets(secretArray);
        secretArray[targetIndex].active = true;

        await this._writeSecretsFile(secrets);
    }

    /**
     * Renames a secret by its ID
     * @param {string} key Secret key to rename
     * @param {string} id ID of the secret to rename
     * @param {string} label New label for the secret
     */
    async renameSecret(key, id, label) {
        const secrets = await this._readSecretsFile();

        if (!this._validateSecretKey(secrets, key)) {
            return;
        }

        const secretArray = secrets[key];
        const targetIndex = secretArray.findIndex(s => s.id === id);

        if (targetIndex === -1) {
            console.warn(`Secret with ID ${id} not found for key ${key}`);
            return;
        }

        secretArray[targetIndex].label = label;
        await this._writeSecretsFile(secrets);
    }

    /**
     * Gets the state of all secrets (whether they exist or not)
     * @returns {Promise<SecretStateMap>} Secret state
     */
    async getSecretState() {
        const secrets = await this._readSecretsFile();
        /** @type {SecretStateMap} */
        const state = {};

        for (const key of Object.values(SECRET_KEYS)) {
            // Skip migration marker
            if (key === SECRET_KEYS._MIGRATED) {
                continue;
            }
            const value = secrets[key];
            if (value && Array.isArray(value) && value.length > 0) {
                state[key] = value.map(secret => ({
                    id: secret.id,
                    value: this.getMaskedValue(secret.value, key),
                    label: secret.label,
                    active: secret.active,
                }));
            } else {
                // No secrets for this key
                state[key] = null;
            }
        }

        return state;
    }

    /**
     * Gets all secrets (for admin viewing)
     * @returns {Promise<SecretKeys>} All secrets
     */
    async getAllSecrets() {
        return await this._readSecretsFile();
    }

    /**
     * Migrates legacy flat secrets format to new format
     */
    async migrateFlatSecrets() {
        try {
            await fs.access(this.filePath);
        } catch {
            return;
        }

        const fileContents = await fs.readFile(this.filePath, 'utf8');
        const secrets = /** @type {FlatSecretKeys} */ (JSON.parse(fileContents));
        const values = Object.values(secrets);

        // Check if already migrated
        if (secrets[SECRET_KEYS._MIGRATED] || values.length === 0 || values.some(v => Array.isArray(v))) {
            return;
        }

        /** @type {SecretKeys} */
        const migratedSecrets = {};

        for (const [key, value] of Object.entries(secrets)) {
            if (typeof value === 'string' && value.trim()) {
                migratedSecrets[key] = [{
                    id: uuidv4(),
                    value: value,
                    label: key,
                    active: true,
                }];
            }
        }

        // Mark as migrated
        migratedSecrets[SECRET_KEYS._MIGRATED] = [];

        // Save backup of the old secrets file
        const backupFilePath = path.join(this.directories.backups, `secrets_migration_${Date.now()}.json`);
        await fs.copyFile(this.filePath, backupFilePath);

        await this._writeSecretsFile(migratedSecrets);
        console.info(color.green('Secrets migrated successfully, old secrets backed up to:'), backupFilePath);
    }
}

//#region Backwards compatibility
/**
 * Writes a secret to the secrets file
 * @param {import('../users.js').UserDirectoryList} directories User directories
 * @param {string} key Secret key
 * @param {string} value Secret value
 */
export async function writeSecret(directories, key, value) {
    return await new SecretManager(directories).writeSecret(key, value);
}

/**
 * Deletes a secret from the secrets file
 * @param {import('../users.js').UserDirectoryList} directories User directories
 * @param {string} key Secret key
 */
export async function deleteSecret(directories, key) {
    return await new SecretManager(directories).deleteSecret(key, null);
}

/**
 * Reads a secret from the secrets file
 * @param {import('../users.js').UserDirectoryList} directories User directories
 * @param {string} key Secret key
 * @returns {Promise<string>} Secret value
 */
export async function readSecret(directories, key) {
    return await new SecretManager(directories).readSecret(key, null);
}

/**
 * Reads the secret state from the secrets file
 * @param {import('../users.js').UserDirectoryList} directories User directories
 * @returns {Promise<Record<string, boolean>>} Secret state
 */
export async function readSecretState(directories) {
    const state = await new SecretManager(directories).getSecretState();
    const result = /** @type {Record<string, boolean>} */ ({});
    for (const key of Object.values(SECRET_KEYS)) {
        // Skip migration marker
        if (key === SECRET_KEYS._MIGRATED) {
            continue;
        }
        result[key] = Array.isArray(state[key]) && state[key].length > 0;
    }
    return result;
}

/**
 * Reads all secrets from the secrets file
 * @param {import('../users.js').UserDirectoryList} directories User directories
 * @returns {Promise<Record<string, string>>} Secrets
 */
export async function getAllSecrets(directories) {
    const secrets = await new SecretManager(directories).getAllSecrets();
    const result = /** @type {Record<string, string>} */ ({});
    for (const [key, values] of Object.entries(secrets)) {
        // Skip migration marker
        if (key === SECRET_KEYS._MIGRATED) {
            continue;
        }
        if (Array.isArray(values) && values.length > 0) {
            const activeSecret = values.find(secret => secret.active);
            if (activeSecret) {
                result[key] = activeSecret.value;
            }
        }
    }
    return result;
}
//#endregion

/**
 * Migrates legacy flat secrets format to the new format for all user directories
 * @param {import('../users.js').UserDirectoryList[]} directoriesList User directories
 */
export async function migrateFlatSecrets(directoriesList) {
    for (const directories of directoriesList) {
        try {
            const manager = new SecretManager(directories);
            await manager.migrateFlatSecrets();
        } catch (error) {
            console.warn(color.red(`Failed to migrate secrets for ${directories.root}:`), error);
        }
    }
}

export const router = express.Router();

router.post('/write', asyncHandler(async (request, response) => {
    try {
        const { key, value, label } = request.body;

        if (!key || typeof value !== 'string') {
            response.status(400).send('Invalid key or value');
            return;
        }

        const manager = new SecretManager(request.user.directories);
        const id = await manager.writeSecret(key, value, label);

        response.send({ id });
    } catch (error) {
        console.error('Error writing secret:', error);
        response.sendStatus(500);
    }
}));

router.post('/read', asyncHandler(async (request, response) => {
    try {
        const manager = new SecretManager(request.user.directories);
        const state = await manager.getSecretState();
        response.send(state);
    } catch (error) {
        console.error('Error reading secret state:', error);
        response.send({});
    }
}));

router.post('/view', asyncHandler(async (request, response) => {
    try {
        if (!allowKeysExposure) {
            console.error('secrets.json could not be viewed unless allowKeysExposure in config.yaml is set to true');
            response.sendStatus(403);
            return;
        }

        const secrets = await getAllSecrets(request.user.directories);

        if (!secrets) {
            response.sendStatus(404);
            return;
        }

        response.send(secrets);
    } catch (error) {
        console.error('Error viewing secrets:', error);
        response.sendStatus(500);
    }
}));

router.post('/find', asyncHandler(async (request, response) => {
    try {
        const { key, id } = request.body;

        if (!key) {
            response.status(400).send('Key is required');
            return;
        }

        if (!allowKeysExposure && !EXPORTABLE_KEYS.includes(key)) {
            console.error('Cannot fetch secrets unless allowKeysExposure in config.yaml is set to true');
            response.sendStatus(403);
            return;
        }

        const manager = new SecretManager(request.user.directories);
        const secretValue = await manager.readSecret(key, id);

        if (!secretValue) {
            response.sendStatus(404);
            return;
        }

        response.send({ value: secretValue });
    } catch (error) {
        console.error('Error finding secret:', error);
        response.sendStatus(500);
    }
}));

router.post('/delete', asyncHandler(async (request, response) => {
    try {
        const { key, id } = request.body;

        if (!key) {
            response.status(400).send('Key and ID are required');
            return;
        }

        const manager = new SecretManager(request.user.directories);
        await manager.deleteSecret(key, id);

        response.sendStatus(204);
    } catch (error) {
        console.error('Error deleting secret:', error);
        response.sendStatus(500);
    }
}));

router.post('/rotate', asyncHandler(async (request, response) => {
    try {
        const { key, id } = request.body;

        if (!key || !id) {
            response.status(400).send('Key and ID are required');
            return;
        }

        const manager = new SecretManager(request.user.directories);
        await manager.rotateSecret(key, id);

        response.sendStatus(204);
    } catch (error) {
        console.error('Error rotating secret:', error);
        response.sendStatus(500);
    }
}));

router.post('/rename', asyncHandler(async (request, response) => {
    try {
        const { key, id, label } = request.body;

        if (!key || !id || !label) {
            response.status(400).send('Key, ID, and label are required');
            return;
        }

        const manager = new SecretManager(request.user.directories);
        await manager.renameSecret(key, id, label);

        response.sendStatus(204);
    } catch (error) {
        console.error('Error renaming secret:', error);
        response.sendStatus(500);
    }
}));
