// main/controllers/messenger.js

const { instances } = require('../utils/auth');
const { queryDB } = require('../utils/db');
const fs = require('fs');
const path = require('path');

// Function to log sent messages to database
async function logMessageToDB(instanceId, numbers, message, status) {
    try {
        const query = `INSERT INTO messages (instance_id, recipient, message, status, sent_at)
                       VALUES (?, ?, ?, ?, NOW());`;
        for (const number of numbers) {
            await queryDB(query, [instanceId, number, message, status]);
        }
    } catch (error) {
        console.error(`Error logging message: ${error.message}`);
    }
}

// Function to generate the messenger page
async function generateMessenger(req, res) {
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
                        <label for="numbers" style="font-size: 1rem; color: white; font-weight: bold; display: block; margin-bottom: 10px;">Phone Numbers (comma separated):</label>
                        <input type="text" id="numbers" name="numbers" required style="${inputStyle}">
                        <label for="message" style="font-size: 1rem; color: white; font-weight: bold; display: block; margin-bottom: 10px;">Message:</label>
                        <textarea id="message" name="message" required style="${inputStyle}"></textarea>
                        <button type="submit" style="${btnStyle}">Send Text Message</button>
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
            document.querySelector('form').addEventListener('submit', function(event) {
                const numbers = document.getElementById('numbers').value.trim();
                const message = document.getElementById('message').value.trim();
                
                if (!numbers || !message) {
                    event.preventDefault();
                    alert('Please enter both phone numbers and a message.');
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
}

// Function to handle sending text messages
async function postMessage(req, res) {
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
}

// Function to handle sending media messages
async function uploadMedia(req, res) {
    const instanceId = req.params.instanceId;
    const phoneNumbers = req.body.numbers.split(',').map((num) => num.trim());
    const caption = req.body.caption || '';
    const filePath = req.body.filePath;

    try {
        if (!filePath || !fs.existsSync(filePath)) {
            return res.status(400).send('File does not exist.');
        }

        const fileExtension = path.extname(filePath).toLowerCase();
        const instanceSock = instances[instanceId]?.sock;
        if (!instanceSock) throw new Error(`Instance ${instanceId} is not connected`);

        let messagePayload = { caption };

        // Determine if the file is an audio (MP3) or video (MP4) or document
        if (fileExtension === '.mp3') {
            const fileData = fs.readFileSync(filePath);
            messagePayload = {
                ...messagePayload,
                audio: fileData,  // Send as audio
            };
        } else if (fileExtension === '.mp4') {
            const fileData = fs.readFileSync(filePath);
            messagePayload = {
                ...messagePayload,
                video: fileData,  // Send as video
            };
        } else {
            const fileData = fs.readFileSync(filePath);
            messagePayload = {
                ...messagePayload,
                document: fileData,  // Treat as document if not MP3 or MP4
            };
        }

        // Send the message to all phone numbers
        for (const number of phoneNumbers) {
            const jid = `${number}@s.whatsapp.net`;
            await instanceSock.sendMessage(jid, messagePayload);
        }

        res.send('Media messages sent successfully!');
    } catch (error) {
        console.error(`Failed to send media message for instance ${instanceId}:`, error);
        res.status(500).send('Failed to send media message.');
    }
}

module.exports = { generateMessenger, postMessage, uploadMedia };
