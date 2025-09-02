'use strict';

// This file demonstrates how to properly use the Radio class.

const Radio = require('./Radio.js');

// === Configuration ===
// IMPORTANT: Replace 'your-device-mac-address' with the actual MAC address of your Bluetooth device.
// The format should be "XX:XX:XX:XX:XX:XX".
const RADIO_MAC_ADDRESS = '38:D2:00:00:EF:24';

// === Main Application Logic ===
console.log('Starting the app...');

const radio = new Radio(RADIO_MAC_ADDRESS);

// Event listeners to receive updates from the radio
radio.on('infoUpdate', (info) => {
    if (info.type === 'ChannelInfo') {
        // Indicate channel loaded
        console.log(`[App] Channel ${info.value.channel_id} loaded.`);
    } else if (info.type === 'AllChannelsLoaded') {
        // Indicate all channels loaded
        console.log(`[App] All channels loaded.`);
    } else {
        // Display full info for other types
        console.log('[App] Received info update:', info);
    }
});

radio.on('rawCommand', (data) => {
    //console.log('[App] Received raw command data.');
});

radio.on('disconnected', () => {
    console.log('[App] Disconnected from radio.');
});

// Attempt to connect to the radio
radio.connect(RADIO_MAC_ADDRESS)
    .then(() => {
        console.log('Successfully connected to radio!');
    })
    .catch((err) => {
        console.error('Failed to connect:', err.message);
    });
