'use strict';

// This file demonstrates how to properly use the Radio class.

const Radio = require('./Radio.js');

// === Configuration ===
// IMPORTANT: Replace 'your-device-mac-address' with the actual MAC address of your Bluetooth device.
// The format should be "XX:XX:XX:XX:XX:XX".
const RADIO_MAC_ADDRESS = '38:D2:00:00:EF:24';
const RADIO_CALLSIGN = 'NOCALL';
const RADIO_STATIONID = 1;

// === Main Application Logic ===
console.log('Starting the app...');

// To disable channel info loading, set loadChannels to false
const radio = new Radio(RADIO_MAC_ADDRESS, { loadChannels: false });

// Event listeners to receive updates from the radio
radio.on('infoUpdate', (info) => {
    /*
    if (info.type === 'ChannelInfo') {
        console.log(`[App] Channel ${info.value.channel_id} loaded.`);
    } else if (info.type === 'AllChannelsLoaded') {
        console.log(`[App] All channels loaded.`);
    } else {
        console.log('[App] Received info update:', info);
    }
    */
});

// New handler for received TNC data frames
const AX25Packet = require('./AX25Packet');

radio.on('data', (frame) => {
    // Attempt to decode AX.25 packet
    const packet = AX25Packet.decodeAX25Packet(frame);
    if (packet) {
        console.log('[App] Decoded AX.25 packet:', packet.toString());
        // Check if first address matches our station
        const firstAddr = packet.addresses[0];
        if (firstAddr.address === RADIO_CALLSIGN && firstAddr.SSID === RADIO_STATIONID) {
            // Prepare reply: flip first and second address
            if (packet.addresses.length > 1) {
                const replyAddresses = [...packet.addresses];
                [replyAddresses[0], replyAddresses[1]] = [replyAddresses[1], replyAddresses[0]];
                // Create reply packet
                const AX25PacketClass = require('./AX25Packet');
                const replyPacket = new AX25PacketClass(replyAddresses, packet.nr, packet.ns, packet.pollFinal, packet.command, packet.type, packet.data);
                replyPacket.pid = packet.pid;
                replyPacket.channel_id = packet.channel_id;
                replyPacket.channel_name = packet.channel_name;
                // Serialize replyPacket with header and addresses
                const serialized = replyPacket.ToByteArray ? replyPacket.ToByteArray() : (replyPacket.toByteArray ? replyPacket.toByteArray() : null);
                if (!serialized) {
                    console.warn('[App] AX.25 packet serialization failed:', replyPacket);
                } else if (typeof radio.sendTncFrame !== 'function') {
                    console.warn('[App] radio.sendTncFrame not implemented.');
                } else {
                    radio.sendTncFrame({
                        channel_id: replyPacket.channel_id,
                        data: serialized
                    });
                    console.log('[App] Echoed AX.25 packet back to sender.');
                }
            }
        }
    } else {
        console.log(`[App] Received TNC data frame on channel ${frame.channel_id}${frame.channel_name ? ` (${frame.channel_name})` : ''}:`, frame.data);
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
