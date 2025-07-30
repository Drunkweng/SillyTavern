import mysql from 'mysql2/promise';
import { getConfigValue } from './util.js';

let pool;

async function initializeDatabase() {
    try {
        const dbConfig = {
            host: await getConfigValue('database.host', 'localhost'),
            user: await getConfigValue('database.user', 'root'),
            password: await getConfigValue('database.password', ''),
            database: await getConfigValue('database.database', 'sillytavern'),
            port: await getConfigValue('database.port', 3306, 'number'),
            waitForConnections: true,
            connectionLimit: 10,
            queueLimit: 0,
        };

        pool = mysql.createPool(dbConfig);
        console.log('Database pool created successfully.');
    } catch (error) {
        console.error('Failed to initialize database pool:', error);
        process.exit(1);
    }
}

initializeDatabase();

/**
 * Executes a SQL query.
 * @param {string} sql The SQL query to execute.
 * @param {any[]} [params] The parameters to bind to the query.
 * @returns {Promise<[any[], any]>}
 */
export async function query(sql, params) {
    if (!pool) {
        throw new Error('Database pool is not initialized.');
    }
    const [results, fields] = await pool.execute(sql, params);
    return [results, fields];
}
