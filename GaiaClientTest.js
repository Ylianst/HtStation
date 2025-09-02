// This script demonstrates and test how to use the GaiaClient module
// to connect to a Bluetooth radio, send a command, and receive data.

const GaiaClient = require('./GaiaClient');

// The MAC address of your radio.
const radioAddress = '38:D2:00:00:EF:24';

// Create a new instance of the GaiaClient.
const client = new GaiaClient(radioAddress);

// Define the raw command payload you want to send.
const rawCommandPayload = Buffer.from('0002000403', 'hex');

// Set up the listener for incoming frames.
client.onFrameReceived = (frame) => {
    // You can process the decoded frame here.
    console.log(`Application received and processed a decoded frame: ${frame.toString('hex')}`);
};

// Start the connection process in an asynchronous function.
async function start() {
    try {
        await client.connect();

        // Send the command every 2 seconds after the connection is established.
        client.commandInterval = setInterval(() => {
            client.sendFrame(rawCommandPayload);
        }, 2000);

        // Disconnect after 20 seconds for demonstration purposes.
        setTimeout(() => {
            console.log('20 seconds elapsed. Disconnecting...');
            client.disconnect();
            // Clear the interval after disconnecting to prevent memory leaks.
            if (client.commandInterval) clearInterval(client.commandInterval);
        }, 20000);

    } catch (error) {
        console.error('An error occurred during connection:', error.message);
    }
}

start();

// Clean up on process exit.
process.on('SIGINT', () => {
    console.log('Exiting...');
    client.disconnect();
    process.exit();
});
