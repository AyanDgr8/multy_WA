// main/controllers/scheduledMessages.js

const fs = require('fs');
const csv = require('csv-parser'); 
const { format } = require('date-fns'); 
const { queryDB } = require('../utils/db');
const path = require('path');

// Function to parse CSV and extract recipient, message, schedule_time, and instance_id
function parseCSV(filePath, callback) {
    const results = [];
    fs.createReadStream(filePath)
        .pipe(csv())
        .on('data', (data) => {
            const { recipient, message, schedule_time, instance_id } = data;
            if (recipient && message && schedule_time && instance_id) {
                results.push({ recipient, message, schedule_time, instance_id });
            }
        })
        .on('end', () => {
            callback(null, results);
        })
        .on('error', (err) => {
            callback(err, null);
        });
}

// Function to validate schedule_time format
function validateScheduleTime(scheduleTime) {
    const datePattern = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/; // YYYY-MM-DD HH:mm:ss
    return datePattern.test(scheduleTime);
}

// Function to insert data into MySQL database
function insertIntoDB(data, callback) {
    const sql = 'INSERT INTO scheduled_messages (instance_id, recipient, message, schedule_time, status) VALUES ?';
    const values = data.map(item => [
        item.instance_id,  // Insert instance_id
        item.recipient,
        item.message,
        item.schedule_time,
        'pending', // default status
    ]);
    
    queryDB(sql, [values], (err, results) => {
        if (err) {
            callback(err, null);
        } else {
            callback(null, results);
        }
    });
}

// Export the functions for use in the router
exports.handleFileUpload = async (req, res) => {
    const file = req.file; // Assuming you're using a file upload middleware like multer
    
    if (!file) {
        return res.status(400).send('No file uploaded.');
    }
    
    parseCSV(file.path, (err, results) => {
        if (err) {
            return res.status(500).send('Error parsing CSV file.');
        }

        const validData = results.filter(item => validateScheduleTime(item.schedule_time));

        if (validData.length === 0) {
            return res.status(400).send('No valid schedule time in the file.');
        }

        insertIntoDB(validData, (err, results) => {
            if (err) {
                return res.status(500).send('Error inserting data into the database.');
            }
            res.send('File uploaded and data inserted successfully!');
        });
    });
};
