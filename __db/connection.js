const mysql = require('mysql2');

// Create a MySQL connection pool
const db = mysql.createPool({
    host: '192.168.101.8',
    user: 'root',        // Update with your username
    password: 'WELcome@123', // Update with your password
    database: 'whatsapp_instance_logs',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
});

module.exports = db;

// NOT in USE  //