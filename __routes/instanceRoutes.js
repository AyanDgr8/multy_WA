// const express = require('express');
// const { initializeSock } = require('../services/instanceService');
// const router = express.Router();

// // Endpoint to serve the QR code
// router.get('/:instanceId/qrcode', async (req, res) => {
//     const { instanceId } = req.params;
//     const qrCode = await initializeSock(instanceId);
//     if (qrCode) {
//         res.send(`
//             <h1>QR Code for Instance: ${instanceId}</h1>
//             <img src="${qrCode}" alt="QR Code" />
//             <p>Scan the QR code with WhatsApp to log in.</p>
//         `);
//     } else {
//         res.send('QR Code not ready yet.');
//     }
// });

// module.exports = router;


// // NOT in USE  //