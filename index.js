// index.js

const { default: makeWASocket, DisconnectReason, useMultiFileAuthState } = require('@whiskeysockets/baileys');
const express = require('express');
const qrcode = require('qrcode');
const bodyParser = require('body-parser');
const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');
const Busboy = require('busboy');

const multer = require('multer');
const fileUpload = require('express-fileupload');
const csvParser = require('csv-parser');

const app = express();
app.use(express.json());
const PORT = process.env.PORT || 9999;

// Middleware to parse URL-encoded form data
app.use(bodyParser.urlencoded({ extended: true }));
app.use(fileUpload());

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

// Function to log sent messages to database
async function logMessageToDB(instanceId, numbers, message, status) {
    const connection = await mysql.createConnection(dbConfig);
    const query = `INSERT INTO messages (instance_id, recipient, message, status, sent_at)
    VALUES (?, ?, ?, ?, NOW());`;

    for (const number of numbers) {
        await connection.execute(query, [instanceId, number, message, status]);
    }
    await connection.end();
}

// Function to log sent media messages to database
async function logMediaMessageToDB(instanceId, numbers, message, mediaPath, caption, schedule_time, status) {
    const connection = await mysql.createConnection(dbConfig);
    const query = `INSERT INTO scheduled_messages (instance_id, recipient, message, media, caption, schedule_time, status, created_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, NOW());`;

    for (const number of numbers) {
        await connection.execute(query, [instanceId, number, message, mediaPath, caption, schedule_time, status]);
    }
    await connection.end();
}


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
                    <input type="file" name="csvFile" id="csvFile" style="display: none;" required>
                    <button type="button" style="${uploadStyle}" onclick="document.getElementById('csvFile').click();">Upload Phone Numbers</button>
                </form>

            </div>
            <script>

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


// Serve the form to schedule messages for a specific instance
app.get('/:instanceId/post', async (req, res) => {
    const instanceId = req.params.instanceId;
    
    const bodyStyle = `
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
        margin:auto;
        margin-top: 20px;
    `;
    const uploadStyle = `
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
                    <h1 style="${headerStyle}">Schedule Message for Instance: ${instanceId}</h1>
                    <form action="/${instanceId}/send-media" method="POST" enctype="multipart/form-data" style="${formStyle}">
                        <label for="numbers" style="${labelStyle}">Phone Numbers (comma separated):</label>
                        <input type="text" id="numbers" name="numbers" required style="${inputStyle}">
    
                        <label for="message" style="${labelStyle}">Message:</label>
                        <textarea id="message" name="message" required style="${inputStyle}"></textarea>
    
                        <label for="mediaFile" style="${labelStyle}">Media File:</label>
                        <input type="file" id="mediaFile" name="mediaFile" accept=".jpg,.jpeg,.png,.mp4,.avi,.pdf,.doc,.docx,.xls,.xlsx" required style="${inputStyle}">
                        <button type="button" id="uploadButton" style="${btnStyle}">Upload File</button>
                        <p id="fileNameDisplay"></p>
    
                        <label for <label for="caption" style="${labelStyle}">Caption (optional):</label>
                        <input type="text" id="caption" name="caption" style="${inputStyle}">
    
                        <label for="schedule_time" style="${labelStyle}">Scheduled time (optional):</label>
                        <input type="datetime-local" id="schedule_time" name="schedule_time" style="${inputStyle}">
    
                        <button type="submit" style="${btnStyle}">Schedule Message</button>
                    </form>
                    <script>
                        const mediaFileInput = document.getElementById('mediaFile');
                        const uploadButton = document.getElementById('uploadButton');
                        const fileNameDisplay = document.getElementById('fileNameDisplay');
    
                        uploadButton.addEventListener('click', () => {
                            mediaFileInput.click();
                        });
    
                        mediaFileInput.addEventListener('change', () => {
                            const fileName = mediaFileInput.files[0]?.name || "No file selected";
                            fileNameDisplay.textContent = "Selected File: " + fileName;
                        });
                    </script>
    
                </div>
                <div style="${footerStyle}">
                    Powered by MultyComm &copy; 2024
                </div>
    
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

// ***************
// Allowed extensions


// Allowed extensions
const allowedExtensions = ['.jpg', '.jpeg', '.png', '.mp4', '.avi', '.pdf', '.doc', '.docx', '.xls', '.xlsx'];

const uploadDir = path.join(__dirname, './uploads/media/');

// Ensure the uploads directory exists
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

// Handle sending media messages
app.post('/:instanceId/send-media', async (req, res) => {
    const instanceId = req.params.instanceId;
    const phoneNumbers = req.body.numbers.split(',').map((num) => num.trim());
    const message = req.body.message || '';
    const caption = req.body.caption || '';
    
    try {
        // Busboy parser
        const busboy = new Busboy({ headers: req.headers });
        let uploadedFilePath = '';

        busboy.on('file', (fieldname, file, filename, encoding, mimetype) => {
            const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
            const filepath = path.join(uploadDir, uniqueSuffix + path.extname(filename));
            
            uploadedFilePath = filepath;
            
            file.pipe(fs.createWriteStream(filepath));
        });

        busboy.on('finish', async () => {
            if (!uploadedFilePath) {
                return res.status(400).send('No file uploaded.');
            }

            // Validate the instance socket
            const instanceSock = instances[instanceId]?.sock;
            if (!instanceSock) throw new Error(`Instance ${instanceId} is not connected`);

            const fileExtension = path.extname(uploadedFilePath).toLowerCase();

            console.log('File uploaded at:', uploadedFilePath);

            // Prepare the message payload
            let messagePayload = { caption };
            const media = await prepareWAMessageMedia({ url: uploadedFilePath }, { upload: instanceSock.upload });

            // Determine the type of media to send
            if (fileExtension === '.mp3') {
                messagePayload.audio = media; // Send as audio
            } else if (fileExtension === '.mp4') {
                messagePayload.video = media; // Send as video
            } else {
                messagePayload.document = media; // Treat as document
            }

            // Send the message to all phone numbers
            for (const number of phoneNumbers) {
                const jid = `${number}@s.whatsapp.net`;
                await instanceSock.sendMessage(jid, messagePayload);
            }

            // Log media message as sent (replace with your DB logic)
            await logMediaMessageToDB(instanceId, phoneNumbers, message, uploadedFilePath, caption, req.body.schedule_time, 'success');

            res.send({
                message: 'Media messages sent successfully!',
                filePath: uploadedFilePath
            });
        });

        req.pipe(busboy);

    } catch (error) {
        console.error(`Failed to send media message for instance ${instanceId}:`, error);

        // Log the message as failed (replace with your DB logic)
        const schedule_time = req.body.schedule_time || null;
        await logMediaMessageToDB(instanceId, phoneNumbers, caption, null, schedule_time, 'failed');

        res.status(500).send('Failed to send media message.');
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
            await instanceSock.sendMessage(jid, { text: message });
        }

        await logMessageToDB(instanceId, phoneNumbers, message, 'success');
        res.send('Text messages sent successfully!');
    } catch (error) {
        console.error(`Failed to send text message for instance ${instanceId}:`, error);
        await logMessageToDB(instanceId, phoneNumbers, message, 'failed');
    res.status(500).send('Failed to send text message.');
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
