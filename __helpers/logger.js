const fs = require('fs');

const log = (message) => {
    const logFile = 'app.log';
    const timestamp = new Date().toISOString();
    fs.appendFileSync(logFile, `[${timestamp}] ${message}\n`);
};

module.exports = { log };


// NOT in USE  //