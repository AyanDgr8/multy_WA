const { saveInstanceDetails } = require('../db/queries');
const qrcode = require('qrcode');
const instances = {};

const initializeSock = async (instanceId) => {
    if (!instances[instanceId]) {
        // Initialize a new instance and save to database
        saveInstanceDetails(instanceId, `System info for ${instanceId}`, (err) => {
            if (err) console.error('Error saving instance details:', err);
        });

        // Generate and return the QR code
        const qr = "sample_qr_code"; // Replace with actual QR code generation
        instances[instanceId] = { qrCode: qr };
        return qrcode.toDataURL(qr);
    }
    return instances[instanceId].qrCode;
};

module.exports = { initializeSock };


// NOT in USE  //