const db = require('./connection');

const saveInstanceDetails = (instanceId, systemInfo, callback) => {
    const query = `INSERT INTO instances (instance_id, system_info) VALUES (?, ?)`;
    db.query(query, [instanceId, systemInfo], callback);
};

const logMessage = (instanceId, phoneNumber, message, status, error, callback) => {
    const query = `
        INSERT INTO messages (instance_id, phone_number, message, status, error)
        VALUES ((SELECT id FROM instances WHERE instance_id = ?), ?, ?, ?, ?)
    `;
    db.query(query, [instanceId, phoneNumber, message, status, error], callback);
};

module.exports = { saveInstanceDetails, logMessage };


// NOT in USE  //