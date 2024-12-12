// main/controllers/qrcode.js

const qrcode = require('qrcode');
const { initializeSock, instances } = require('../utils/auth.js');

// Define the route handler for generating the QR code
exports.generateQRCode = async (req, res) => {
    const instanceId = req.params.instanceId;
    if (!instances[instanceId]) {
        console.log(`Initializing new instance: ${instanceId}`);
        await initializeSock(instanceId);
    }

    const bodyStyle = `
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
};
