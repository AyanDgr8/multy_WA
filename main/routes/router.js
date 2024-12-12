// main/routes/router.js

const express = require('express');
const { resetQRCode } = require('../utils/auth');
const { generateQRCode } = require('../controllers/qrcode.js');
const { generateMessenger, postMessage, uploadMedia } = require('../controllers/messenger');
const fileUploadController = require('../controllers/fileUpload');



const router = express.Router();

// Route for generating QR code
router.get('/:instanceId/qrcode', generateQRCode);

// Route for getting message container
router.get('/:instanceId/send', generateMessenger);

// Route for sending message
router.post('/:instanceId/send-message', postMessage);

// Route for uploading media
router.post('/:instanceId/send-media', uploadMedia);


// Endpoint to render the upload form
router.get('/:instanceId/upload', async (req, res) => {
    const instanceId = req.params.instanceId;

    if (instances[instanceId]?.isAuthenticated) {
        fileUploadController.renderUploadForm(res, instanceId);
    } else {
        res.send(`
            <div style="width: 60%; margin: 4rem auto; background-color: white; border-radius: 10px; padding: 2rem;">
                <h1 style="text-align: center; color: #364C63;">Instance Not Authenticated</h1>
                <p style="text-align: center;">Please scan the QR code first at <a href="/${instanceId}/qrcode">/${instanceId}/qrcode</a>.</p>
            </div>
        `);
    }
});

// Endpoint to handle CSV file upload
router.post('/:instanceId/upload-csv', async (req, res) => {
    const instanceId = req.params.instanceId;
    await fileUploadController.processCSVFile(req, res, instanceId);
});


// Endpoint to reset the QR code for a specific instance
router.post('/:instanceId/reset', async (req, res) => {
    const instanceId = req.params.instanceId;
    try {
        await resetQRCode(instanceId);
        res.redirect(`/${instanceId}/qrcode`);
    } catch (error) {
        console.error(`Failed to reset QR code for instance ${instanceId}:`, error);
        res.status(500).send('Failed to reset QR code.');
    }
});

export default router;
