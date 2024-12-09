// index.js
const express = require('express');
const fileUpload = require('express-fileupload');
const csvParser = require('csv-parser');
const { default: makeWASocket, DisconnectReason, useMultiFileAuthState } = require('@whiskeysockets/baileys');
const bodyParser = require('body-parser');
const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 2000;

// Middleware
app.use(bodyParser.urlencoded({ extended: true }));
app.use(fileUpload());

// Database configuration
const dbConfig = {
host: 'localhost',
user: 'root',
password: 'Ayan@1012',
database: 'multyWhatsapp',
};

let instances = {}; // Store active WhatsApp instances

// Function to save CSV data into the database
async function saveCSVDataToDB(instanceId, csvData) {
const connection = await mysql.createConnection(dbConfig);

const query = `
INSERT INTO scheduled_messages (instance_id, recipient, message, schedule_time)
VALUES (?, ?, ?, ?)
`;

for (const row of csvData) {
const { recipient, message, schedule_time } = row;
await connection.execute(query, [instanceId, recipient, message, schedule_time]);
}

await connection.end();
}

// Function to initialize WhatsApp socket
async function initializeSock(instanceId) {
const authFolder = path.join(__dirname, `auth_${instanceId}`);
if (!fs.existsSync(authFolder)) fs.mkdirSync(authFolder);

const { state, saveCreds } = await useMultiFileAuthState(authFolder);

const sock = makeWASocket({ auth: state });

sock.ev.on('creds.update', saveCreds);
sock.ev.on('connection.update', (update) => {
const { connection, qr } = update;
if (connection === 'open') {
console.log(`Instance ${instanceId} connected!`);
} else if (connection === 'close') {
console.log(`Reconnecting ${instanceId}...`);
initializeSock(instanceId);
}
});

instances[instanceId] = sock;
}

// Endpoint to upload CSV file
app.post('/:instanceId/upload-csv', async (req, res) => {
const instanceId = req.params.instanceId;

if (!req.files || !req.files.csvFile) {
return res.status(400).send('No CSV file uploaded.');
}

const file = req.files.csvFile;
const filePath = path.join(__dirname, 'uploads', file.name);

// Save uploaded file temporarily
if (!fs.existsSync('uploads')) fs.mkdirSync('uploads');
await file.mv(filePath);

// Parse CSV file
const csvData = [];
fs.createReadStream(filePath)
.pipe(csvParser())
.on('data', (row) => csvData.push(row))
.on('end', async () => {
await saveCSVDataToDB(instanceId, csvData);
fs.unlinkSync(filePath); // Delete file after processing
res.send('Contacts and messages saved to the database successfully!');
});
});

// Function to send scheduled messages
async function sendScheduledMessages() {
const connection = await mysql.createConnection(dbConfig);

// Fetch pending messages scheduled for delivery
const [rows] = await connection.execute(
`SELECT * FROM scheduled_messages WHERE status = 'pending' AND schedule_time <= NOW()`
);

for (const message of rows) {
const instanceSock = instances[message.instance_id]?.sock;
if (!instanceSock) continue; // Skip if instance is not connected

try {
const jid = `${message.recipient}@s.whatsapp.net`;
await instanceSock.sendMessage(jid, { text: message.message });

// Update status to 'sent'
await connection.execute(
`UPDATE scheduled_messages SET status = 'sent' WHERE id = ?`,
[message.id]
);
console.log(`Message sent to ${message.recipient}`);
} catch (error) {
console.error(`Failed to send message to ${message.recipient}:`, error);
await connection.execute(
`UPDATE scheduled_messages SET status = 'failed' WHERE id = ?`,
[message.id]
);
}
}

await connection.end();
}

// Schedule the message sender to run every minute
setInterval(sendScheduledMessages, 60000); // Check for messages every 1 minute

// Start server
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));