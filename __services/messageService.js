const { logMessage } = require('../db/queries');
const instances = {}; // Assume this is shared or imported from elsewhere

const sendMessage = async (instanceId, phoneNumbers, message) => {
    try {
        const instanceSock = instances[instanceId]?.sock;
        if (!instanceSock) throw new Error(`Instance ${instanceId} is not connected`);

        for (const number of phoneNumbers) {
            const jid = `${number}@s.whatsapp.net`;
            try {
                await instanceSock.sendMessage(jid, { text: message });
                await logMessage(instanceId, number, message, 'SUCCESS', null, (err) => {
                    if (err) console.error('Error logging message:', err);
                });
            } catch (error) {
                await logMessage(instanceId, number, message, 'FAILED', error.message, (err) => {
                    if (err) console.error('Error logging message:', err);
                });
            }
        }
    } catch (error) {
        console.error(`Error sending messages for instance ${instanceId}:`, error);
    }
};

module.exports = { sendMessage };


// NOT in USE  //