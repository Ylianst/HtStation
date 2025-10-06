'use strict';

const path = require('path');
const crypto = require('crypto');
const { loadConfig } = require('./utils/configLoader');
const Radio = require('./Radio.js');
const MqttReporter = require('./utils/MqttReporter');
const RadioController = require('./radioctl.js');

// === Load configuration from config.ini ===
let config;
try {
    config = loadConfig(path.join(__dirname, 'config.ini'));
} catch (err) {
    console.error(`[App] ${err.message}`);
    process.exit(1);
}

console.log('[App] Loaded settings from config.ini:');
for (const [key, value] of Object.entries(config)) {
    if (key === 'AUTH') {
        // Display AUTH entries without revealing passwords
        if (Array.isArray(value)) {
            const maskedAuth = value.map(authEntry => {
                const commaIndex = authEntry.indexOf(',');
                if (commaIndex !== -1) {
                    const callsign = authEntry.substring(0, commaIndex);
                    return `${callsign},***`;
                }
                return authEntry;
            });
            console.log(`  ${key} = ${maskedAuth.join(',')}`);
        } else {
            console.log(`  ${key} = ${value}`);
        }
    } else if (key === 'MQTT_PASSWORD') {
        // Also mask MQTT password for security
        console.log(`  ${key} = ***`);
    } else {
        console.log(`  ${key} = ${value}`);
    }
}

const RADIO_MAC_ADDRESS = config.MACADDRESS;
const RADIO_CALLSIGN = config.CALLSIGN;
const RADIO_STATIONID = config.STATIONID ? parseInt(config.STATIONID, 10) : undefined;
if (!RADIO_MAC_ADDRESS || !RADIO_CALLSIGN || RADIO_STATIONID === undefined || isNaN(RADIO_STATIONID)) {
    console.error('[App] Missing required settings in config.ini (MACADDRESS, CALLSIGN, STATIONID).');
    process.exit(1);
}

// === Background server mode ===
if (process.argv.includes('--server') && !process.env._HTC_BG) {
    const { spawn } = require('child_process');
    const args = process.argv.slice(1).filter(arg => arg !== '--server');
    const child = spawn(process.argv[0], args, {
        detached: true,
        stdio: 'ignore',
        env: { ...process.env, _HTC_BG: '1' }
    });
    child.unref();
    console.log('[App] Started in background (server mode).');
    process.exit(0);
}

// === Main Application Logic ===
console.log('Starting the app...');

// === MQTT Setup ===
const mqttEnabled = config.MQTT_BROKER_URL && config.MQTT_TOPIC;
let mqttReporter = null;
if (mqttEnabled) {
    mqttReporter = new MqttReporter(config);
    try {
        mqttReporter.connect();
    } catch (err) {
        console.error('[App] MQTT setup failed:', err.message);
        mqttReporter = null;
    }
}

// To disable channel info loading, set loadChannels to false
const radio = new Radio(RADIO_MAC_ADDRESS, { loadChannels: true });

// Set the callsign for transmission safety
radio.setCallsign(RADIO_CALLSIGN);

// Initialize Radio Controller for MQTT and Home Assistant integration
const radioController = new RadioController(config, radio, mqttReporter);

// New handler for received TNC data frames
const AX25Packet = require('./AX25Packet');
const { AprsPacket } = require('./aprs');
const AprsHandler = require('./aprs.js');
const EchoServer = require('./echoserver.js');
const BbsServer = require('./bbs.js');
const WebServer = require('./webserver.js');

// Initialize APRS handler
const aprsHandler = new AprsHandler(config, radio, mqttReporter);

// Initialize Echo Server
const echoServer = new EchoServer(config, radio);

// Initialize BBS Server
const bbsServer = new BbsServer(config, radio);

// Initialize Web Server (if enabled)
let webServer = null;
if (config.WEBSERVERPORT) {
    const webServerPort = parseInt(config.WEBSERVERPORT, 10);
    if (webServerPort > 0) {
        try {
            webServer = new WebServer(config, radio, bbsServer, aprsHandler);
            webServer.start(webServerPort)
                .then(() => {
                    console.log(`[App] Web server started successfully on port ${webServerPort}`);
                })
                .catch((error) => {
                    console.error('[App] Failed to start web server:', error.message);
                    webServer = null;
                });
        } catch (error) {
            console.error('[App] Web server initialization failed:', error.message);
            webServer = null;
        }
    } else {
        console.log('[App] Web server disabled (WEBSERVERPORT is 0)');
    }
} else {
    console.log('[App] Web server disabled (WEBSERVERPORT not configured)');
}

radio.on('data', (frame) => {
    // Attempt to decode AX.25 packet
    const packet = AX25Packet.decodeAX25Packet(frame);
    if (packet) {
        console.log('[App] Decoded AX.25 packet:', packet.toString());
        console.log('[App] Formatted packet:', packet.formatAX25PacketString());
        
        // Check if this packet is from the APRS channel
        if (packet.channel_name === 'APRS') {
            aprsHandler.processAprsPacket(packet);
            return;
        }
        
        // Handle echo server functionality
        if (config.SERVER && config.SERVER.toLowerCase() === 'echo') {
            echoServer.processPacket(packet);
            return;
        }
        
        // Handle BBS server functionality
        if (config.SERVER && config.SERVER.toLowerCase() === 'bbs') {
            bbsServer.processPacket(packet);
            return;
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

        // Publish Home Assistant MQTT Discovery configs
        if (mqttReporter && config.MQTT_TOPIC) {
            mqttReporter.publishAllDiscoveryConfigs();
        }
        
        // Setup status polling (battery, volume)
        radioController.setupStatusPolling();
    })
    .catch((err) => {
        console.error('Failed to connect:', err.message);
    });
