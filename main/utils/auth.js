// utils/auth.js

// utils/auth.js

const fs = require('fs');
const path = require('path');
const { queryDB } = require('./db');
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');

let instances = {};

async function initializeSock(instanceId) {
    const authFolder = path.join(__dirname, `../auth_${instanceId}`);
    if (!fs.existsSync(authFolder)) {
        fs.mkdirSync(authFolder);
    }

    const { state, saveCreds } = await useMultiFileAuthState(authFolder);

    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: false,
    });

    sock.ev.on('creds.update', saveCreds);
    sock.ev.on('connection.update', async (update) => {
        const { connection, qr } = update;
        if (qr) instances[instanceId].qrCode = qr;
        if (connection === 'close') {
            const shouldReconnect = update.lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log(`Instance ${instanceId}: Connection closed. Reconnecting: ${shouldReconnect}`);
            if (shouldReconnect) initializeSock(instanceId);
            await saveInstanceToDB(instanceId, 'disconnected');
        } else if (connection === 'open') {
            console.log(`Instance ${instanceId}: Connected to WhatsApp!`);
            instances[instanceId].isAuthenticated = true;
            await saveInstanceToDB(instanceId, 'connected');
        }
    });

    instances[instanceId] = { sock, qrCode: null, isAuthenticated: false };
    return sock;
}

// Function to reset QR code for a specific instance
async function resetQRCode(instanceId) {
    console.log(`Resetting QR code for instance: ${instanceId}`);
    instances[instanceId] = null;
    await initializeSock(instanceId);
}

async function saveInstanceToDB(instanceId, status) {
    const query = `
        INSERT INTO instances (instance_id, status, created_at)
        VALUES (?, ?, NOW())
        ON DUPLICATE KEY UPDATE status = ?, updated_at = NOW();
    `;

    try {
        await queryDB(query, [instanceId, status, status]);
        console.log(`Instance ${instanceId} saved to the database with status: ${status}`);
    } catch (error) {
        console.error(`Failed to save instance ${instanceId} to the database:`, error);
    }
}

module.exports = { initializeSock, instances, resetQRCode };
