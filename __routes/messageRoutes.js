// const express = require('express');
// const { sendMessage } = require('../__services/messageService');
// const router = express.Router();

// // Send message endpoint
// router.post('/:instanceId/send-message', async (req, res) => {
//     const { instanceId } = req.params;
//     const { numbers, message } = req.body;
//     const phoneNumbers = numbers.split(',').map(num => num.trim());
//     await sendMessage(instanceId, phoneNumbers, message);
//     res.send('Messages sent successfully!');
// });

// module.exports = router;


// // NOT in USE  //