// utils/db.js

const mysql = require('mysql2/promise');

const dbConfig = {
    host: 'localhost',
    user: 'root',
    password: 'Ayan@1012',
    database: 'multyWhatsapp',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
};

async function queryDB(query, params) {
    const connection = await mysql.createConnection(dbConfig);
    const [results] = await connection.execute(query, params);
    await connection.end();
    return results;
}


module.exports = { queryDB };
