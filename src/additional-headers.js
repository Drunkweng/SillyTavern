import { TEXTGEN_TYPES, OPENROUTER_HEADERS, FEATHERLESS_HEADERS } from './constants.js';
import { SECRET_KEYS, readSecret } from './endpoints/secrets.js';
import { getConfigValue } from './util.js';

/**
 * Gets the headers for the Mancer API.
 * @param {import('./users.js').UserDirectoryList} directories User directories
 * @returns {Promise<object>} Headers for the request
 */
async function getMancerHeaders(directories) {
    const apiKey = await readSecret(directories, SECRET_KEYS.MANCER);

    return apiKey ? ({
        'X-API-KEY': apiKey,
        'Authorization': `Bearer ${apiKey}`,
    }) : {};
}

/**
 * Gets the headers for the TogetherAI API.
 * @param {import('./users.js').UserDirectoryList} directories User directories
 * @returns {Promise<object>} Headers for the request
 */
async function getTogetherAIHeaders(directories) {
    const apiKey = await readSecret(directories, SECRET_KEYS.TOGETHERAI);

    return apiKey ? ({
        'Authorization': `Bearer ${apiKey}`,
    }) : {};
}

/**
 * Gets the headers for the InfermaticAI API.
 * @param {import('./users.js').UserDirectoryList} directories User directories
 * @returns {Promise<object>} Headers for the request
 */
async function getInfermaticAIHeaders(directories) {
    const apiKey = await readSecret(directories, SECRET_KEYS.INFERMATICAI);

    return apiKey ? ({
        'Authorization': `Bearer ${apiKey}`,
    }) : {};
}

/**
 * Gets the headers for the DreamGen API.
 * @param {import('./users.js').UserDirectoryList} directories User directories
 * @returns {Promise<object>} Headers for the request
 */
async function getDreamGenHeaders(directories) {
    const apiKey = await readSecret(directories, SECRET_KEYS.DREAMGEN);

    return apiKey ? ({
        'Authorization': `Bearer ${apiKey}`,
    }) : {};
}

/**
 * Gets the headers for the OpenRouter API.
 * @param {import('./users.js').UserDirectoryList} directories User directories
 * @returns {Promise<object>} Headers for the request
 */
async function getOpenRouterHeaders(directories) {
    const apiKey = await readSecret(directories, SECRET_KEYS.OPENROUTER);
    const baseHeaders = { ...OPENROUTER_HEADERS };

    return apiKey ? Object.assign(baseHeaders, { 'Authorization': `Bearer ${apiKey}` }) : baseHeaders;
}

/**
 * Gets the headers for the vLLM API.
 * @param {import('./users.js').UserDirectoryList} directories User directories
 * @returns {Promise<object>} Headers for the request
 */
async function getVllmHeaders(directories) {
    const apiKey = await readSecret(directories, SECRET_KEYS.VLLM);

    return apiKey ? ({
        'Authorization': `Bearer ${apiKey}`,
    }) : {};
}

/**
 * Gets the headers for the Aphrodite API.
 * @param {import('./users.js').UserDirectoryList} directories User directories
 * @returns {Promise<object>} Headers for the request
 */
async function getAphroditeHeaders(directories) {
    const apiKey = await readSecret(directories, SECRET_KEYS.APHRODITE);

    return apiKey ? ({
        'X-API-KEY': apiKey,
        'Authorization': `Bearer ${apiKey}`,
    }) : {};
}

/**
 * Gets the headers for the Tabby API.
 * @param {import('./users.js').UserDirectoryList} directories User directories
 * @returns {Promise<object>} Headers for the request
 */
async function getTabbyHeaders(directories) {
    const apiKey = await readSecret(directories, SECRET_KEYS.TABBY);

    return apiKey ? ({
        'x-api-key': apiKey,
        'Authorization': `Bearer ${apiKey}`,
    }) : {};
}

/**
 * Gets the headers for the LlamaCPP API.
 * @param {import('./users.js').UserDirectoryList} directories User directories
 * @returns {Promise<object>} Headers for the request
 */
async function getLlamaCppHeaders(directories) {
    const apiKey = await readSecret(directories, SECRET_KEYS.LLAMACPP);

    return apiKey ? ({
        'Authorization': `Bearer ${apiKey}`,
    }) : {};
}

/**
 * Gets the headers for the Ooba API.
 * @param {import('./users.js').UserDirectoryList} directories
 * @returns {Promise<object>} Headers for the request
 */
async function getOobaHeaders(directories) {
    const apiKey = await readSecret(directories, SECRET_KEYS.OOBA);

    return apiKey ? ({
        'Authorization': `Bearer ${apiKey}`,
    }) : {};
}

/**
 * Gets the headers for the KoboldCpp API.
 * @param {import('./users.js').UserDirectoryList} directories
 * @returns {Promise<object>} Headers for the request
 */
async function getKoboldCppHeaders(directories) {
    const apiKey = await readSecret(directories, SECRET_KEYS.KOBOLDCPP);

    return apiKey ? ({
        'Authorization': `Bearer ${apiKey}`,
    }) : {};
}

/**
 * Gets the headers for the Featherless API.
 * @param {import('./users.js').UserDirectoryList} directories
 * @returns {Promise<object>} Headers for the request
 */
async function getFeatherlessHeaders(directories) {
    const apiKey = await readSecret(directories, SECRET_KEYS.FEATHERLESS);
    const baseHeaders = { ...FEATHERLESS_HEADERS };

    return apiKey ? Object.assign(baseHeaders, { 'Authorization': `Bearer ${apiKey}` }) : baseHeaders;
}

/**
 * Gets the headers for the HuggingFace API.
 * @param {import('./users.js').UserDirectoryList} directories
 * @returns {Promise<object>} Headers for the request
 */
async function getHuggingFaceHeaders(directories) {
    const apiKey = await readSecret(directories, SECRET_KEYS.HUGGINGFACE);

    return apiKey ? ({
        'Authorization': `Bearer ${apiKey}`,
    }) : {};
}

/**
 * Gets the headers for the Generic text completion API.
 * @param {import('./users.js').UserDirectoryList} directories
 * @returns {Promise<object>} Headers for the request
 */
async function getGenericHeaders(directories) {
    const apiKey = await readSecret(directories, SECRET_KEYS.GENERIC);

    return apiKey ? ({
        'Authorization': `Bearer ${apiKey}`,
    }) : {};
}

export function getOverrideHeaders(urlHost) {
    const requestOverrides = getConfigValue('requestOverrides', []);
    const overrideHeaders = requestOverrides?.find((e) => e.hosts?.includes(urlHost))?.headers;
    if (overrideHeaders && urlHost) {
        return overrideHeaders;
    } else {
        return {};
    }
}

/**
 * Sets additional headers for the request.
 * @param {import('express').Request} request Original request body
 * @param {object} args New request arguments
 * @param {string|null} server API server for new request
 */
export async function setAdditionalHeaders(request, args, server) {
    await setAdditionalHeadersByType(args.headers, request.body.api_type, server, request.user.directories);
}

/**
 *
 * @param {object} requestHeaders Request headers
 * @param {string} type API type
 * @param {string|null} server API server for new request
 * @param {import('./users.js').UserDirectoryList} directories User directories
 */
export async function setAdditionalHeadersByType(requestHeaders, type, server, directories) {
    const headerGetters = {
        [TEXTGEN_TYPES.MANCER]: getMancerHeaders,
        [TEXTGEN_TYPES.VLLM]: getVllmHeaders,
        [TEXTGEN_TYPES.APHRODITE]: getAphroditeHeaders,
        [TEXTGEN_TYPES.TABBY]: getTabbyHeaders,
        [TEXTGEN_TYPES.TOGETHERAI]: getTogetherAIHeaders,
        [TEXTGEN_TYPES.OOBA]: getOobaHeaders,
        [TEXTGEN_TYPES.INFERMATICAI]: getInfermaticAIHeaders,
        [TEXTGEN_TYPES.DREAMGEN]: getDreamGenHeaders,
        [TEXTGEN_TYPES.OPENROUTER]: getOpenRouterHeaders,
        [TEXTGEN_TYPES.KOBOLDCPP]: getKoboldCppHeaders,
        [TEXTGEN_TYPES.LLAMACPP]: getLlamaCppHeaders,
        [TEXTGEN_TYPES.FEATHERLESS]: getFeatherlessHeaders,
        [TEXTGEN_TYPES.HUGGINGFACE]: getHuggingFaceHeaders,
        [TEXTGEN_TYPES.GENERIC]: getGenericHeaders,
    };

    const getHeaders = headerGetters[type];
    const headers = getHeaders ? await getHeaders(directories) : {};

    if (typeof server === 'string' && server.length > 0) {
        try {
            const url = new URL(server);
            const overrideHeaders = getOverrideHeaders(url.host);

            if (overrideHeaders && Object.keys(overrideHeaders).length > 0) {
                Object.assign(headers, overrideHeaders);
            }
        } catch {
            // Do nothing
        }
    }

    Object.assign(requestHeaders, headers);
}
