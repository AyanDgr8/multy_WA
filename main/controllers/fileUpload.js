// main/controllers/fileUpload.js

const fs = require('fs');
const path = require('path');
const mysql = require('mysql2');
const csvParser = require('csv-parser');
const { instances } = require('./auth');  // Assuming `instances` comes from the auth logic
const dbConfig = require('../config/dbConfig');  // Assuming dbConfig holds your database config

// Helper function to validate CSV row
function validateCSVRow(row) {
    if (!row.recipient || !row.message || !row.schedule_time) {
        console.error('Validation Error: Missing required fields in row:', row);
        return false;
    }
    return true;
}

// Helper function to save CSV data to DB
async function saveCSVDataToDB(instanceId, csvData) {
    const validData = csvData.filter(validateCSVRow);
    if (validData.length === 0) {
        console.error('No valid data found in the uploaded CSV file.');
        return;
    }

    const connection = await mysql.createConnection(dbConfig);
    const query = `
        INSERT INTO scheduled_messages (instance_id, recipient, message, schedule_time, status)
        VALUES (?, ?, ?, ?, 'pending')
    `;

    for (const row of validData) {
        const { recipient, message, schedule_time } = row;
        try {
            await connection.execute(query, [instanceId, recipient, message, schedule_time]);
        } catch (error) {
            console.error('Database Error:', error.message, 'Row:', row);
        }
    }

    await connection.end();
    console.log('Valid CSV data saved to the database successfully.');
}

// Helper function to send scheduled messages
async function sendScheduledMessages() {
    const connection = await mysql.createConnection(dbConfig);
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

// Helper function to handle the upload form response
function renderUploadForm(res, instanceId) {
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
    const uploadStyle = `
        background-color: #EF6F53;
        color: white;
        border: none;
        border-radius: 5px;
        padding: 10px;
        font-size: 0.9rem;
        font-weight: 500;
        cursor: pointer;
        text-align:center;
    `;
    const footerStyle = `
        text-align: center;
        padding: 15px;
        font-size: 0.85rem;
        margin-top: 20px;
    `;

    res.send(`
        <div style="${bodyStyle}">
            <div style="${containerStyle}">
                <h1 style="${headerStyle}">Upload File for Instance: ${instanceId}</h1>
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
}

// Helper function to process the uploaded CSV file
async function processCSVFile(req, res, instanceId) {
    if (!req.files || !req.files.csvFile) {
        return res.status(400).send('No CSV file uploaded.');
    }

    const file = req.files.csvFile;
    const filePath = path.join(__dirname, 'uploads', file.name);

    if (!fs.existsSync('uploads')) fs.mkdirSync('uploads');
    await file.mv(filePath);

    const csvData = [];
    fs.createReadStream(filePath)
        .pipe(csvParser())
        .on('data', (row) => csvData.push(row))
        .on('end', async () => {
            await saveCSVDataToDB(instanceId, csvData);
            fs.unlinkSync(filePath); // Delete file after processing
            res.send('Contacts and messages saved to the database successfully!');
        });
}

module.exports = {
    validateCSVRow, saveCSVDataToDB, sendScheduledMessages, renderUploadForm, processCSVFile
};
