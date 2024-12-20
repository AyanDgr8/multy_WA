// index.js

const { default: makeWASocket, DisconnectReason, useMultiFileAuthState } = require('@whiskeysockets/baileys');
// const { prepareWAMessageMedia } = require('@adiwajshing/baileys'); // Example import
const express = require('express');
const qrcode = require('qrcode');
const bodyParser = require('body-parser');
const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');


const fileUpload = require('express-fileupload');
const csvParser = require('csv-parser');

const app = express();
app.use(express.json({ limit: '10mb' }));

const PORT = process.env.PORT || 9999;

// Middleware to parse URL-encoded form data
app.use(express.urlencoded({ extended: true }));
app.use(fileUpload());
// app.use(express.static('uploads'));

let instances = {}; // Store sockets for multiple instances

// Function to initialize WhatsApp connection for a specific instance
async function initializeSock(instanceId) {
    const authFolder = path.join(__dirname, `auth_${instanceId}`);
    if (!fs.existsSync(authFolder)) {
        fs.mkdirSync(authFolder);
    }

    const { state, saveCreds } = await useMultiFileAuthState(authFolder);

    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: false, // QR code will be displayed on the web
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
    const { connection, qr } = update;

    if (qr) {
        qrcode.toDataURL(qr, (err, url) => {
            if (err) console.error(`Error generating QR Code for instance ${instanceId}:`, err);
            else {
            console.log(`QR Code for instance ${instanceId} generated!`);
            instances[instanceId].qrCode = url;
            instances[instanceId].isAuthenticated = false;
            }
        });
    }

    if (connection === 'close') {
        const shouldReconnect = update.lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
        console.log(`Instance ${instanceId}: Connection closed. Reconnecting: ${shouldReconnect}`);
        if (shouldReconnect) initializeSock(instanceId);
        await saveInstanceToDB(instanceId, 'disconnected');
        } 
        else if (connection === 'open') {
        console.log(`Instance ${instanceId}: Connected to WhatsApp!`);
        instances[instanceId].isAuthenticated = true;
        await saveInstanceToDB(instanceId, 'connected');
        }
    });

    instances[instanceId] = { sock, qrCode: null, isAuthenticated: false };
}

// Database configuration
const dbConfig = {
    host: 'localhost',
    user: 'root',
    password: 'Ayan@1012',
    database: 'multyWhatsapp',
};

// Function to save instance to database
async function saveInstanceToDB(instanceId, status) {
    const connection = await mysql.createConnection(dbConfig);
    const query = `INSERT INTO instances (instance_id, status, created_at)
    VALUES (?, ?, NOW())
    ON DUPLICATE KEY UPDATE status = ?, updated_at = NOW();`;

    await connection.execute(query, [instanceId, status, status]);
    await connection.end();
}

// Function to log sent messages to the database
async function logMessageToDB(instanceId, numbers, message, status, messageDelivered = 'unread') {
    const connection = await mysql.createConnection(dbConfig);
    const query = `
        INSERT INTO messages (instance_id, recipient, message, status, sent_at, message_delivered)
        VALUES (?, ?, ?, ?, NOW(), ?);
    `;

    for (const number of numbers) {
        await connection.execute(query, [instanceId, number, message, status, messageDelivered]);
    }
    await connection.end();
}


// Function to update the delivery status in the database
async function updateMessageDeliveryStatus(instanceId, recipient, deliveryStatus) {
    const connection = await mysql.createConnection(dbConfig);
    const query = `
        UPDATE messages
        SET message_delivered = ?
        WHERE instance_id = ? AND recipient = ? AND message_delivered = 'unread';
    `;

    await connection.execute(query, [deliveryStatus, instanceId, recipient]);
    await connection.end();
}

// Function to mark a chat as read/unread
async function markChatReadOrUnread(sock, jid, markRead = true) {
    const lastMsgInChat = await getLastMessageInChat(jid); // You need to implement this function
    await sock.chatModify({ markRead, lastMessages: [lastMsgInChat] }, jid);
}

const formatScheduledAt = (scheduledAt) => {
    if (!scheduledAt) return null; // Return null for missing or undefined values

    const date = new Date(scheduledAt);
    if (isNaN(date.getTime())) {
        console.error('Invalid date provided:', scheduledAt);
        return null; // Return null if the date is invalid
    }

    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');

    return `${year}-${month}-${day}T${hours}:${minutes}`; // ISO 8601 format
};

const logMediaMessageToDB = async (instanceId, phoneNumbers, message, filePath, caption, scheduleTime, message_sent) => {
    const connection = await mysql.createConnection(dbConfig);

    const query = `
        INSERT INTO media_messages (instance_id, recipient, message, media, caption, schedule_time, message_sent, created_at) 
        VALUES (?, ?, ?, ?, ?, ?, ?, NOW());
    `;

    const formattedScheduleTime = formatScheduledAt(scheduleTime);
    const values = [
        instanceId || 'default', // Default to 'default' for instance_id if null
        Array.isArray(phoneNumbers) ? phoneNumbers.join(',') : '', // Ensure it's a comma-separated string
        message || '', // Default to empty string for message
        filePath || '', // Default to empty string for filePath
        caption || '', // Default to empty string for caption
        formattedScheduleTime, // Pass formatted time or null
        message_sent || 'success' // Default to 'success' for status
    ];

    try {
        await connection.execute(query, values);
        console.log('Message logged successfully:', values);
    } catch (error) {
        console.error('Failed to log message to DB:', {
            error: error.message,
            code: error.code,
            sqlState: error.sqlState,
            sqlMessage: error.sqlMessage,
            values,
        });
    } finally {
        await connection.end();
    }
};


// Function to send scheduled messages
async function sendScheduledMessages() {
    const connection = await mysql.createConnection(dbConfig);

    // Fetch pending messages scheduled for delivery
    const [rows] = await connection.execute(
        `SELECT * FROM scheduled_messages WHERE message_sent = 'pending' AND schedule_time <= NOW()`
    );

    for (const message of rows) {
        const instanceSock = instances[message.instance_id]?.sock;
        if (!instanceSock) continue; // Skip if instance is not connected

        try {
            const jid = `${message.recipient}@s.whatsapp.net`;
            await instanceSock.sendMessage(jid, { text: message.message });

            // Update status to 'sent'
            await connection.execute(
                `UPDATE scheduled_messages SET message_sent = 'sent' WHERE id = ?`,
                [message.id]
            );
            console.log(`Message sent to ${message.recipient}`);
        } catch (error) {
            console.error(`Failed to send message to ${message.recipient}:`, error);
            await connection.execute(
                `UPDATE scheduled_messages SET message_sent = 'failed' WHERE id = ?`,
                [message.id]
            );
        }
    }

    await connection.end();
}
// Schedule the message sender to run every minute
setInterval(sendScheduledMessages, 60000); // Check for messages every 1 minute


// Endpoint to serve the QR code for a specific instance
app.get('/:instanceId/qrcode', async (req, res) => {
    const instanceId = req.params.instanceId;

    if (!instances[instanceId]) {
        console.log(`Initializing new instance: ${instanceId}`);
        await initializeSock(instanceId);
    }

    const bodyStyle=`
        margin: 0;
        padding: 0;
        font-family: Verdana, Arial, Helvetica, sans-serif;
        background-color: black;
    `;

    const containerStyle = `
        width: 60%; margin: 5rem auto; background-color: white; border-radius: 10px; 
        box-shadow: 0 4px 10px rgba(0, 0, 0, 0.2); overflow: hidden; position: relative; padding: 2rem;
    `;
    const headerStyle = `
        background-color: #364C63; color: white; padding: 15px 20px; text-align: center; 
        font-size: 1.5rem; font-weight: 700; letter-spacing: 1px; border-bottom: 3px solid #EF6F53;
    `;
    const btnStyle = `
        background-color: #EF6F53; color: white; border: none; border-radius: 5px; 
        padding: 10px 20px; font-size: 1rem; font-weight: bold; cursor: pointer; display: inline-block; 
        text-align: center; margin: auto;
    `;

    const footerStyle = `
        text-align: center;
        padding: 15px;
        font-size: 0.85rem;
        margin:auto;
        margin-top: 20px;
    `;

    if (instances[instanceId] && instances[instanceId].qrCode) {
        if (instances[instanceId].isAuthenticated) {
            // If authenticated, redirect to send page
            return res.redirect(`/${instanceId}/send`);
        }
        res.send(`
            <div style="${bodyStyle}"></div>
            <div style="${containerStyle}">
                <div style="${headerStyle}">
                    <h1>QR Code for Instance: ${instanceId}</h1>
                </div>
                <img src="${instances[instanceId].qrCode}" alt="QR Code" style="display: block; margin: 20px auto; width: 100%; max-width: 300px;" />
                <p style="text-align: center; font-size: 1rem;">Scan the QR code with WhatsApp to log in.</p>
                <form action="/${instanceId}/reset" method="POST" style="text-align: center;">
                    <button type="submit" style="${btnStyle}">Reset QR Code</button>
                </form>
                
                <div style="${footerStyle}">
                    Powered by MultyComm &copy; 2024
                </div>
            </div>
        `);
    } else {
        res.send(`
            <div style="${containerStyle}">
                <h1 style="${headerStyle}">QR Code Not Ready for Instance: ${instanceId}</h1>
                <p style="text-align: center; font-size: 1rem;">Please wait for the QR code to generate. Try refreshing the page in a few seconds.</p>
            </div>
        `);
    }
});

// Endpoint to reset the QR code for a specific instance
app.post('/:instanceId/reset', async (req, res) => {
    const instanceId = req.params.instanceId;
    console.log(`Resetting QR code for instance: ${instanceId}`);
    instances[instanceId] = null;
    await initializeSock(instanceId);
    res.redirect(`/${instanceId}/qrcode`);
});

// Serve the form to send messages for a specific instance
app.get('/:instanceId/send', async (req, res) => {
    const instanceId = req.params.instanceId;

    const bodyStyle=`
        margin: 0;
        padding: 0;
        font-family: Verdana, Arial, Helvetica, sans-serif;
        background-color: black;
        color:white;
    `;
    const containerStyle = `
        width: 60%;
        margin: 5rem auto;
        border-radius: 10px;
        box-shadow: 0 4px 10px rgba(0, 0, 0, 0.2);
        overflow: hidden;
        position: relative;
        padding: 2rem;
        font-family: Verdana, Arial, Helvetica, sans-serif;
        background-color: black;
        color:white;
    `;
    const headerStyle = `
        background-color: #364C63;
        color: white;
        padding: 15px 20px;
        text-align: center;
        font-size: 1.5rem;
        font-weight: 700;
        letter-spacing: 1px;
        border-bottom: 3px solid #EF6F53;
    `;
    const formStyle = `
        margin-top: 20px; 
        padding: 20px; 
        width: 100%; 
        box-sizing: 
        border-box;
    `;
    const inputStyle = `
        width: 100%; 
        padding: 12px; 
        font-size: 1rem; 
        border: 1px solid #ccc; 
        border-radius: 5px; 
        margin-bottom: 15px; 
        outline: none; 
        transition: border-color 0.3s ease;
    `;
    const labelStyle = `
        font-size: 1rem; 
        color: white; 
        font-weight: bold; 
        display: block; 
        margin-bottom: 10px;
    `;
    const btnStyle = `
        background-color: #EF6F53; 
        color: white; 
        border: none; 
        border-radius: 5px; 
        padding: 10px 20px; 
        font-size: 1rem; 
        font-weight: bold; 
        cursor: pointer; 
        display: inline-block; 
        text-align: center; 
        margin: auto;
    `;
    const footerStyle = `
        text-align: center;
        padding: 15px;
        font-size: 0.85rem;
        margin:auto;
        margin-top: 20px;
    `;
    const uploadStyle= `
        position: fixed;
        top: 15px;
        right: 20px;
        background-color: #EF6F53;
        color: white;
        border: none;
        border-radius: 5px;
        padding: 8px 15px;
        font-size: 0.9rem;
        font-weight: 500;
        cursor: pointer;
        width:10%;
    `;

    if (instances[instanceId]?.isAuthenticated) {
        res.send(`
            <div style="${bodyStyle}">
                <div style="${containerStyle}">
                    <h1 style="${headerStyle}">Send Message for Instance: ${instanceId}</h1>
                    <form action="/${instanceId}/send-message" method="POST" style="${formStyle}">

                        <label for="numbers" style="${labelStyle}">Phone Numbers (comma separated):</label>
                        <input type="text" id="numbers" name="numbers" required style="${inputStyle}">

                        <label for="message"  style="${labelStyle}">Message:</label>
                        <textarea id="message" name="message" required style="${inputStyle}"></textarea>

                        <label for="caption"  style="${labelStyle}">Caption (optional):</label>
                        <input type="text" id="caption" name="caption" style="${inputStyle}">

                        <label for="filePath"  style="${labelStyle}">Media File Path:</label>
                        <input type="text" id="filePath" name="filePath" style="${inputStyle}">

                        <label for="datetime-local"  style="${labelStyle}">Schdule time (optional):</label>
                        <input type="datetime-local" id="datetime-local" name="datetime-local" style="${inputStyle}">
                        
                        <button type="submit" style="${btnStyle}">Send Message</button>
                    </form>  

                </div>
                <div style="${footerStyle}">
                    Powered by MultyComm &copy; 2024
                </div>
                <!-- File Upload Form -->
                <form id="uploadForm" action="/${instanceId}/upload-csv" method="POST" enctype="multipart/form-data" style="display: inline-block;">
                    <input type="file" name="csvFile" id="csvFile" >
                    <button type="button" style="${uploadStyle}" onclick="document.getElementById('csvFile').click();">Upload Phone Numbers</button>
                </form>

            </div>
        `);
    } else {
        res.send(`
            <div style="width: 60%; margin: 4rem auto; background-color: white; border-radius: 10px; padding: 2rem;">
                <h1 style="text-align: center; color: #364C63;">Instance Not Authenticated</h1>
                <p style="text-align: center;">Please scan the QR code first at <a href="/${instanceId}/qrcode">/${instanceId}/qrcode</a>.</p>
            </div>
        `);
    }
});


// Handle sending text messages
app.post('/:instanceId/send-message', async (req, res) => {
    const instanceId = req.params.instanceId;
    const phoneNumbers = req.body.numbers.split(',').map((num) => num.trim());
    const message = req.body.message;

    try {
        const instanceSock = instances[instanceId]?.sock;
        if (!instanceSock) throw new Error(`Instance ${instanceId} is not connected`);

        for (const number of phoneNumbers) {
            const jid = `${number}@s.whatsapp.net`;

            // Send the message and get the result
            const result = await instanceSock.sendMessage(jid, { text: message });

            if (result && result.id) {
                // Log the message with initial status as 'unread'
                await logMessageToDB(instanceId, [number], message, 'success', 'unread');

                // Simulate marking as read/unread based on user action
                setTimeout(async () => {
                    try {
                        // Mark chat as read
                        await markChatReadOrUnread(instanceSock, jid, true);

                        // Update the database to reflect the read status
                        await updateMessageDeliveryStatus(instanceId, number, 'read');
                    } catch (error) {
                        console.error(`Failed to mark chat as read for ${jid}:`, error);
                    }
                }, 5000); // Simulate a 5-second delay
            } else {
                // Log the message as failed
                await logMessageToDB(instanceId, [number], message, 'failed', 'unread');
            }
        }

        res.send('Text messages sent successfully!');
    } catch (error) {
        console.error(`Failed to send text message for instance ${instanceId}:`, error);
        await logMessageToDB(instanceId, phoneNumbers, message, 'failed', 'unread');
        res.status(500).send('Failed to send text message.');
    }
});

// Function to get the last message in a chat
async function getLastMessageInChat(jid) {
    // Implement logic to retrieve the last message in a chat
    // Example placeholder: You will need to use WhatsApp's API or database to get this info
    return { key: { remoteJid: jid, id: 'last-message-id' } };
}




// ************
// Serve the form to schedule messages for a specific instance
app.get('/:instanceId/post', async (req, res) => {
    const instanceId = req.params.instanceId;

    const bodyStyle = `
        margin: 0;
        padding: 0;
        font-family: Verdana, Arial, Helvetica, sans-serif;
        background-color: black;
        color: white;
    `;
    const containerStyle = `
        width: 60%;
        margin: 5rem auto;
        border-radius: 10px;
        box-shadow: 0 4px 10px rgba(0, 0, 0, 0.2);
        overflow: hidden;
        position: relative;
        padding: 2rem;
        font-family: Verdana, Arial, Helvetica, sans-serif;
        background-color: black;
        color: white;
    `;
    const headerStyle = `
        background-color: #364C63;
        color: white;
        padding: 15px 20px;
        text-align: center;
        font-size: 1.5rem;
        font-weight: 700;
        letter-spacing: 1px;
        border-bottom: 3px solid #EF6F53;
    `;
    const formStyle = `
        margin-top: 20px; 
        padding: 20px; 
        width: 100%; 
        box-sizing: border-box;
    `;
    const inputStyle = `
        width: 100%; 
        padding: 12px; 
        font-size: 1rem; 
        border: 1px solid #ccc; 
        border-radius: 5px; 
        margin-bottom: 15px; 
        outline: none; 
        transition: border-color 0.3s ease;
    `;
    const labelStyle = `
        font-size: 1rem; 
        color: white; 
        font-weight: bold; 
        display: block; 
        margin-bottom: 10px;
    `;
    const btnStyle = `
        background-color: #EF6F53; 
        color: white; 
        border: none; 
        border-radius: 5px; 
        padding: 10px 20px; 
        font-size: 1rem; 
        font-weight: bold; 
        cursor: pointer; 
        display: inline-block; 
        text-align: center; 
        margin: auto;
    `;
    const footerStyle = `
        text-align: center;
        padding: 15px;
        font-size: 0.85rem;
        margin: auto;
        margin-top: 20px;
    `;


    if (instances[instanceId]?.isAuthenticated) {
        res.send(`
            <div style="${bodyStyle}">
                <div style="${containerStyle}">
                    <h1 style="${headerStyle}">Schedule Message for Instance: ${instanceId}</h1>

                    <!-- File Upload Form -->
                    <form id="uploadForm" enctype="multipart/form-data" style="${formStyle}">
                        <label for="file" style="${labelStyle}">Upload Media File:</label>
                        <input type="file" id="file" name="file" required style="${inputStyle}">
                        <button type="button" id="uploadButton" style="${btnStyle}">Upload File</button>
                        <p id="filePathDisplay"></p>
                    </form>

                    <!-- Schedule Message Form -->
                    <form action="/${instanceId}/send-media" method="POST" enctype="application/x-www-form-urlencoded" style="${formStyle}">
                        <label for="numbers" style="${labelStyle}">Phone Numbers (comma separated):</label>
                        <input type="text" id="numbers" name="numbers" required style="${inputStyle}">

                        <label for="message" style="${labelStyle}">Message:</label>
                        <textarea id="message" name="message" required style="${inputStyle}"></textarea>

                        <label for="filePath" style="${labelStyle}">Media File Path:</label>
                        <input type="text" id="filePath" name="filePath" readonly required style="${inputStyle}">

                        <label for="caption" style="${labelStyle}">Caption (optional):</label>
                        <input type="text" id="caption" name="caption" style="${inputStyle}">

                        <label for="schedule_time" style="${labelStyle}">Scheduled Time (optional):</label>
                        <input type="datetime-local" id="schedule_time" name="schedule_time" style="${inputStyle}">

                        <button type="submit" style="${btnStyle}">Schedule Message</button>
                    </form>

                    <!-- CSV Upload for Phone Numbers -->
                    <form id="csvUploadForm" enctype="multipart/form-data" style="${formStyle}">
                        <label for="csvFile" style="${labelStyle}">Upload CSV of Phone Numbers:</label>
                        <input type="file" id="csvFile" name="csvFile" required style="${inputStyle}">
                        <button type="button" id="csvUploadButton" style="${btnStyle}">Upload CSV</button>
                    </form>
                </div>
                <div style="${footerStyle}">
                    Powered by MultyComm &copy; 2024
                </div>
            </div>
            <script>
                document.getElementById('uploadButton').addEventListener('click', async () => {
                    const formData = new FormData(document.getElementById('uploadForm'));
                    try {
                        const response = await fetch('/${instanceId}/upload-media', {
                            method: 'POST',
                            body: formData,
                        });
                        const result = await response.json();
                        document.getElementById('filePath').value = result.filePath;
                        document.getElementById('filePathDisplay').textContent = "File uploaded successfully!";
                    } catch (error) {
                        alert("Media upload failed: " + error.message);
                    }
                });

                document.getElementById('csvUploadButton').addEventListener('click', async () => {
                    const formData = new FormData(document.getElementById('csvUploadForm'));
                    try {
                        const response = await fetch('/${instanceId}/upload-csv', {
                            method: 'POST',
                            body: formData,
                        });
                        const result = await response.json();
                        document.getElementById('numbers').value = result.phoneNumbers.join(', ');
                    } catch (error) {
                        alert("CSV upload failed: " + error.message);
                    }
                });
            </script>
        `);
    } else {
        res.send(`
            <div style="width: 60%; margin: 4rem auto; background-color: white; border-radius: 10px; padding: 2rem;">
                <h1 style="text-align: center; color: #364C63;">Instance Not Authenticated</h1>
                <p style="text-align: center;">Please scan the QR code first at <a href="/${instanceId}/qrcode">/${instanceId}/qrcode</a>.</p>
            </div>
        `);
    }
});

// Endpoint for uploading the csv file for phone numbers 
app.post('/:instanceId/upload-phone', async (req, res) => {
    const uploadedFile = req.files?.file;

    if (!uploadedFile) {
        return res.status(400).send('No file uploaded.');
    }

    const fileExtension = path.extname(uploadedFile.name).toLowerCase();
    const allowedExtensions = ['.csv', '.xlsx'];

    if (!allowedExtensions.includes(fileExtension)) {
        return res.status(400).send('Unsupported file format.');
    }

    const uploadPath = path.join(__dirname, 'uploads', 'list', uploadedFile.name);

    try {
        await uploadedFile.mv(uploadPath);
        res.json({ filePath: uploadPath });
    } catch (error) {
        console.error('Error saving file:', error);
        res.status(500).send('File upload failed.');
    }
});


// Endpoint for uploading the file
app.post('/:instanceId/upload-media', async (req, res) => {
    const uploadedFile = req.files?.file;

    if (!uploadedFile) {
        return res.status(400).send('No file uploaded.');
    }

    const fileExtension = path.extname(uploadedFile.name).toLowerCase();
    const allowedExtensions = ['.jpg', '.jpeg', '.png', '.mp4', '.mp3', '.pdf', '.doc', '.docx', '.xls', '.xlsx'];

    if (!allowedExtensions.includes(fileExtension)) {
        return res.status(400).send('Unsupported file format.');
    }

    const uploadPath = path.join(__dirname, 'uploads', 'media', uploadedFile.name);

    try {
        await uploadedFile.mv(uploadPath);
        res.json({ filePath: uploadPath });
    } catch (error) {
        console.error('Error saving file:', error);
        res.status(500).send('File upload failed.');
    }
});

// Handle sending media messages
app.post('/:instanceId/send-media', async (req, res) => {
    const instanceId = req.params.instanceId;
    const phoneNumbers = req.body.numbers.split(',').map(num => num.trim());
    const caption = req.body.caption || ''; // Caption is optional
    const filePath = req.body.filePath; // This should be the path returned from the upload endpoint
    const scheduleTime = req.body.schedule_time || null; // Schedule time is optional
    const messageContent = req.body.message || ''; // Text message content is required here.
    const markReadStatus = req.body.markRead || true; // Default is to mark messages as read

    // Check if filePath is valid
    try {
        if (!filePath) throw new Error('File path is missing.');
        await fs.promises.stat(filePath); // Ensures the file exists
    } catch (error) {
        console.error('File path check error:', error);
        return res.status(400).send('Invalid or missing file path.');
    }

    // Validate and format scheduleTime
    const formattedScheduleTime = formatScheduledAt(scheduleTime);
    if (scheduleTime && !formattedScheduleTime) {
        return res.status(400).send('Invalid schedule time provided.');
    }

    const fileExtension = path.extname(filePath).toLowerCase(); // Extract file extension
    console.log(`File extension detected: ${fileExtension}`);

    try {
        const instanceSock = instances[instanceId]?.sock;
        if (!instanceSock) throw new Error(`Instance ${instanceId} is not connected`);

        let messagePayload;

        // Handling media message based on file extension
        if (['.jpg', '.jpeg', '.png'].includes(fileExtension)) {
            console.log('Image file detected');
            const imageBuffer = await fs.promises.readFile(filePath);
            messagePayload = { image: imageBuffer, caption: `${messageContent}\n${caption}` }; // Append messageContent to caption
        }  

        else if (['.pdf', '.doc', '.docx', '.xls', '.xlsx'].includes(fileExtension)) {
            console.log('Document file detected');
            const documentBuffer = await fs.promises.readFile(filePath);
            messagePayload = { document: documentBuffer, caption: `${messageContent}\n${caption}` };
        } 

        else if (['.mp3'].includes(fileExtension)) {
            console.log('Audio file detected');
            const audioBuffer = await fs.promises.readFile(filePath);
            messagePayload = {
                audio: audioBuffer,
                mimetype: 'audio/mpeg',
                ptt: true, // Set to true if sending as a voice note
                caption: `${messageContent}\n${caption}`
            };
        } 

        else if (['.mp4'].includes(fileExtension)) {
            console.log('Video file detected');
            const videoBuffer = await fs.promises.readFile(filePath);
            messagePayload = {
                video: videoBuffer,
                mimetype: 'video/mp4', // Ensure the correct MIME type is set
                caption: `${messageContent}\n${caption}`,
                gifPlayback: false // Set to true for GIF-like behavior
            };
        } 
        
        else {
            throw new Error('Unsupported media type.');
        }

        for (const number of phoneNumbers) {
            const jid = `${number}@s.whatsapp.net`;
            let message_sent = 'success';
            try {
                console.log(`Sending message to: ${jid}`, messagePayload);
                const sentMessage = await instanceSock.sendMessage(jid, messagePayload);

                // Mark the chat read/unread based on markReadStatus
                if (sentMessage && sentMessage.key) {
                    const lastMsgInChat = sentMessage.message; // Use the sent message as the last message reference
                    await instanceSock.chatModify(
                        { markRead: markReadStatus, lastMessages: [lastMsgInChat] },
                        jid
                    );
                }
            } catch (err) {
                console.error(`Failed to send message to ${jid}:`, err.message);
                message_sent = 'failed';
            }
            // Log the media message to the database for each recipient
            await logMediaMessageToDB(instanceId, [number], messageContent, filePath, caption, formattedScheduleTime, message_sent);
        }

        res.send('Media messages sent successfully!');
    } catch (error) {
        console.error(`Error for instance ${instanceId}:`, error.message);

        // Log the media message to the database with 'failed' status for all recipients
        await logMediaMessageToDB(instanceId, phoneNumbers, null, filePath, caption, formattedScheduleTime, 'failed');

        res.status(500).send(error.message);
    }
});

// Endpoint to upload CSV file
app.get('/:instanceId/upload',async (req, res) => {
    const instanceId = req.params.instanceId;

    const bodyStyle=`
        margin: 0;
        padding: 0;
        font-family: Verdana, Arial, Helvetica, sans-serif;
        background-color: black;
        color:white;
    `;
    const containerStyle = `
        width: 60%;
        margin: 5rem auto;
        border-radius: 10px;
        box-shadow: 0 4px 10px rgba(0, 0, 0, 0.2);
        overflow: hidden;
        position: relative;
        padding: 2rem;
        font-family: Verdana, Arial, Helvetica, sans-serif;
        background-color: black;
        color:white;
    `;
    const headerStyle = `
        background-color: #364C63;
        color: white;
        padding: 15px 20px;
        text-align: center;
        font-size: 1.5rem;
        font-weight: 700;
        letter-spacing: 1px;
        border-bottom: 3px solid #EF6F53;
    `;
    const uploadStyle= `
        background-color: #EF6F53;
        color: white;
        border: none;
        border-radius: 5px;
        padding: 10px; 
        font-size: 0.9rem;
        font-weight: 500;
        cursor: pointer;
        margn:auto;
        text-align:center;
    `;
    const footerStyle = `
        text-align: center;
        padding: 15px;
        font-size: 0.85rem;
        margin:auto;
        margin-top: 20px;
    `;

    if (instances[instanceId]?.isAuthenticated) {
        res.send(`
            <div style="${bodyStyle}">
                <div style="${containerStyle}">
                    <h1 style="${headerStyle}">Scheduled Messages for Instance: ${instanceId}</h1>
                    <!-- File Upload Form -->
                    <form id="uploadForm" action="/${instanceId}/upload-csv" method="POST" enctype="multipart/form-data" style="display: inline-block;">
                        <input type="file" name="csvFile" id="csvFile" style="display: none;" required>
                        <button type="button" style="${uploadStyle}" onclick="document.getElementById('csvFile').click();">File Upload</button>
                    </form>
                </div>
                <div style="${footerStyle}">
                    Powered by MultyComm &copy; 2024
                </div>

            </div>
            <script>
                function uploadCSV(instanceId) {
                    const input = document.createElement('input');
                    input.type = 'file';
                    input.accept = '.csv';
                    input.onchange = async (event) => {
                        const file = event.target.files[0];
                        if (!file) return;

                        const formData = new FormData();
                        formData.append('csvFile', file);

                        try {
                            const response = await fetch(\`/${instanceId}/upload-csv\`, {
                                method: 'POST',
                                body: formData,
                            });

                            if (response.ok) {
                                alert('CSV file uploaded and processed successfully!');
                            } else {
                                alert('Failed to upload CSV file.');
                            }
                        } catch (error) {
                            console.error('Error uploading CSV:', error);
                            alert('Error uploading CSV file.');
                        }
                    };
                    input.click();
                }
            </script>
        `);
    } else {
        res.send(`
            <div style="width: 60%; margin: 4rem auto; background-color: white; border-radius: 10px; padding: 2rem;">
                <h1 style="text-align: center; color: #364C63;">Instance Not Authenticated</h1>
                <p style="text-align: center;">Please scan the QR code first at <a href="/${instanceId}/qrcode">/${instanceId}/qrcode</a>.</p>
            </div>
        `);
    }
});

// // Handle to upload CSV file
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

// Start the server
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}!`);
    console.log(`To use a new instance, visit http://localhost:${PORT}/<instanceId>/qrcode`);
});

// Initialize the default instance
initializeSock('default');
