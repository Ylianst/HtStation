'use strict';

const path = require('path');
const crypto = require('crypto');
const { loadConfig } = require('./utils/configLoader');
const { initializeLogger, getLogger } = require('./utils/consoleLogger');

// === Check for command line arguments ===
if (process.argv.includes('--help') || process.argv.includes('-h')) {
    console.log(`Handi-Talky Station v${require('../package.json').version}`);
    console.log('https://github.com/Ylianst/HtStation');
    console.log('');
    console.log('Usage: node htstation.js [options]');
    console.log('');
    console.log('Options:');
    console.log('  --help, -h       Display this help message');
    console.log('  --server         Run in background (detached) server mode');
    console.log('  --showconfig     Display current configuration and exit');
    console.log('');
    process.exit(0);
}

// === Load configuration from config.ini ===
let config;
try {
    config = loadConfig(path.join(__dirname, '..', 'config.ini'));
} catch (err) {
    console.error(`[App] ${err.message}`);
    process.exit(1);
}

// === Handle --showconfig argument ===
if (process.argv.includes('--showconfig')) {
    console.log('Current Configuration:');
    console.log('='.repeat(50));
    
    // Display all config settings except sensitive info
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
                console.log(`  ${key} = ${maskedAuth.join(', ')}`);
            } else {
                console.log(`  ${key} = ${value}`);
            }
        } else if (key === 'MQTT_PASSWORD' || key === 'WINLINK_PASSWORD') {
            // Mask all password fields
            console.log(`  ${key} = ***`);
        } else {
            console.log(`  ${key} = ${value}`);
        }
    }
    
    console.log('='.repeat(50));
    process.exit(0);
}

// === Initialize Console Logger ===
initializeLogger(config);
const logger = getLogger();

// Make logger available globally for other modules
global.logger = logger;

// NOW load modules that depend on global.logger
const Radio = require('./radio/Radio.js');
const MqttReporter = require('./utils/MqttReporter');
const RadioController = require('./radioctl.js');
const DataBroker = require('./utils/DataBroker');
const FrameDeduplicator = require('./utils/FrameDeduplicator');
const PacketStore = require('./utils/PacketStore');

// Initialize the Data Broker with file-based persistence for device 0 (Linux equivalent of Windows registry)
DataBroker.initialize(path.join(__dirname, '../data/databroker.json'));

// Display welcome message
console.log(`Handi-Talky Station v${require('../package.json').version}`);
console.log('https://github.com/Ylianst/HtStation');

// Get App logger instance
const appLogger = logger.getLogger('App');

const RADIO_MAC_ADDRESS = config.MACADDRESS;
const RADIO_CALLSIGN = config.CALLSIGN;

// Parse station IDs for servers (0-15 are valid, -1 means disabled)
const BBS_STATION_ID = config.BBS_STATION_ID ? parseInt(config.BBS_STATION_ID, 10) : -1;
const ECHO_STATION_ID = config.ECHO_STATION_ID ? parseInt(config.ECHO_STATION_ID, 10) : -1;
const WINLINK_STATION_ID = config.WINLINK_STATION_ID ? parseInt(config.WINLINK_STATION_ID, 10) : -1;

if (!RADIO_MAC_ADDRESS || !RADIO_CALLSIGN) {
    appLogger.error('[App] Missing required settings in config.ini (MACADDRESS, CALLSIGN).');
    process.exit(1);
}

// Validate station IDs
const isBbsEnabled = BBS_STATION_ID >= 0 && BBS_STATION_ID <= 15;
const isEchoEnabled = ECHO_STATION_ID >= 0 && ECHO_STATION_ID <= 15;
const isWinlinkEnabled = WINLINK_STATION_ID >= 0 && WINLINK_STATION_ID <= 15;

if (!isBbsEnabled && !isEchoEnabled && !isWinlinkEnabled) {
    appLogger.error('[App] At least one server must be enabled. Set BBS_STATION_ID, ECHO_STATION_ID, or WINLINK_STATION_ID to a value between 0 and 15.');
    process.exit(1);
}

appLogger.log(`[App] BBS Server: ${isBbsEnabled ? `ENABLED on ${RADIO_CALLSIGN}-${BBS_STATION_ID}` : 'DISABLED'}`);
appLogger.log(`[App] Echo Server: ${isEchoEnabled ? `ENABLED on ${RADIO_CALLSIGN}-${ECHO_STATION_ID}` : 'DISABLED'}`);
appLogger.log(`[App] WinLink Server: ${isWinlinkEnabled ? `ENABLED on ${RADIO_CALLSIGN}-${WINLINK_STATION_ID}` : 'DISABLED'}`);

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
    console.log('Started in background (server mode).');
    process.exit(0);
} else {
    console.log('Starting in console mode, --help for additional options.');
}

// === Main Application Logic ===
appLogger.log('[App] Starting the app...');

// === MQTT Setup ===
const mqttEnabled = config.MQTT_BROKER_URL && config.MQTT_TOPIC;
let mqttReporter = null;
if (mqttEnabled) {
    mqttReporter = new MqttReporter(config);
    try {
        mqttReporter.connect();
    } catch (err) {
        appLogger.error('[App] MQTT setup failed:', err.message);
        mqttReporter = null;
    }
}

// To disable channel info loading, set loadChannels to false
const radio = new Radio(2, RADIO_MAC_ADDRESS, { loadChannels: true });

// Set the callsign for transmission safety
radio.setCallsign(RADIO_CALLSIGN);

// Initialize Radio Controller for MQTT and Home Assistant integration
const radioController = new RadioController(config, radio, mqttReporter);
DataBroker.addDataHandler('RadioController', radioController);

// Handler modules - each subscribes to DataBroker events independently
const AprsHandler = require('./aprs.js');
const EchoServer = require('./echoserver.js');
const BbsServer = require('./bbs/bbs.js');
const WinLinkServer = require('./winlink/winlinkserver.js');
const WebServer = require('./webserver.js');
const Storage = require('./storage.js');
const WinlinkGatewayRelay = require('./winlink/WinlinkGatewayRelay.js');
const DataBrokerClient = require('./utils/DataBrokerClient');

// Register the FrameDeduplicator as a Data Handler (deduplicates DataFrame -> UniqueDataFrame)
const frameDeduplicator = new FrameDeduplicator();
DataBroker.addDataHandler('FrameDeduplicator', frameDeduplicator);

// Register the PacketStore as a Data Handler (stores raw packets for viewing)
const packetStore = new PacketStore(path.join(__dirname, '../data'));
DataBroker.addDataHandler('PacketStore', packetStore);

// === Global Session Registry ===
// Coordinates sessions between BBS, Echo, and WinLink servers to ensure only one server
// handles a connection with a remote station at a time
const activeSessionRegistry = {
    sessions: new Map(), // Maps callsign -> server type ('bbs', 'echo', 'winlink')
    
    canCreateSession(callsign, serverType) {
        const existingServer = this.sessions.get(callsign);
        if (!existingServer) return true;
        if (existingServer === serverType) return true;
        console.log(`[Session Registry] ${callsign} is busy with ${existingServer} server, cannot create ${serverType} session`);
        return false; // Different server has this session
    },
    
    isStationConnected(callsign) {
        return this.sessions.has(callsign);
    },
    
    registerSession(callsign, session, serverType) {
        console.log(`[Session Registry] Registering ${callsign} with ${serverType} server`);
        this.sessions.set(callsign, serverType);
    },
    
    unregisterSession(callsign) {
        console.log(`[Session Registry] Unregistering ${callsign}`);
        this.sessions.delete(callsign);
    },
    
    getActiveServer(callsign) {
        return this.sessions.get(callsign);
    }
};

// Initialize APRS handler
const aprsHandler = new AprsHandler(config, radio, mqttReporter);
DataBroker.addDataHandler('AprsHandler', aprsHandler);

// Initialize Echo Server (conditionally)
let echoServer = null;
if (isEchoEnabled) {
    const echoConfig = { ...config, CALLSIGN: RADIO_CALLSIGN, STATIONID: ECHO_STATION_ID };
    echoServer = new EchoServer(echoConfig, radio, activeSessionRegistry);
    DataBroker.addDataHandler('EchoServer', echoServer);
    appLogger.log(`[App] Echo Server initialized on ${RADIO_CALLSIGN}-${ECHO_STATION_ID}`);
}

// Initialize BBS Server (conditionally)
let bbsServer = null;
if (isBbsEnabled) {
    const bbsConfig = { ...config, CALLSIGN: RADIO_CALLSIGN, STATIONID: BBS_STATION_ID };
    bbsServer = new BbsServer(bbsConfig, radio, activeSessionRegistry);
    DataBroker.addDataHandler('BbsServer', bbsServer);
    appLogger.log(`[App] BBS Server initialized on ${RADIO_CALLSIGN}-${BBS_STATION_ID}`);
}

// Initialize Storage for WinLink
const storage = new Storage();
DataBroker.addDataHandler('Storage', storage);

// Initialize WinLink Server (conditionally)
let winlinkServer = null;
if (isWinlinkEnabled) {
    const winlinkConfig = { 
        ...config, 
        callsign: RADIO_CALLSIGN, 
        winlinkStationId: WINLINK_STATION_ID,
        winlinkPassword: config.WINLINK_PASSWORD || '',
        version: '1.0'
    };
    winlinkServer = new WinLinkServer(winlinkConfig, radio, storage, activeSessionRegistry);
    DataBroker.addDataHandler('WinLinkServer', winlinkServer);
    appLogger.log(`[App] WinLink Server initialized on ${RADIO_CALLSIGN}-${WINLINK_STATION_ID}`);
}

// === Winlink Internet Gateway Sync Handler ===
// Handles WinlinkSync events to connect to the Winlink CMS internet gateway
// Usage: broker.Dispatch(1, "WinlinkSync", { Server: "server.winlink.org", Port: 8773, UseTls: true, Callsign: "CALL" }, store: false);
const winlinkSyncBroker = new DataBrokerClient();
winlinkSyncBroker.subscribe(DataBroker.AllDevices, 'WinlinkSync', async (deviceId, name, data) => {
    try {
        const server = data.Server || data.server || 'server.winlink.org';
        const port = data.Port || data.port || 8773;
        const useTls = data.UseTls !== undefined ? data.UseTls : (data.useTls !== undefined ? data.useTls : true);
        const callsign = data.Callsign || data.callsign;
        
        if (!callsign) {
            appLogger.error('[WinlinkSync] Missing callsign in WinlinkSync request');
            DataBroker.dispatch(deviceId, 'WinlinkSyncResult', { 
                success: false, 
                error: 'Missing callsign',
                server: server,
                port: port
            }, false);
            return;
        }
        
        appLogger.log(`[WinlinkSync] Connecting to Winlink gateway ${server}:${port} for ${callsign}`);
        
        const relay = new WinlinkGatewayRelay(deviceId, server, port, useTls);
        
        const connected = await relay.connectAsync(callsign, 15000);
        
        if (connected && relay.isConnected) {
            appLogger.log(`[WinlinkSync] Connected to Winlink gateway successfully`);
            appLogger.log(`[WinlinkSync] WL2K Banner: ${relay.wl2kBanner || '(none)'}`);
            appLogger.log(`[WinlinkSync] PQ Challenge: ${relay.pqChallenge || '(none)'}`);
            
            // Store the relay for potential use by other modules
            DataBroker.dispatch(deviceId, 'WinlinkSyncResult', { 
                success: true,
                server: server,
                port: port,
                callsign: callsign,
                wl2kBanner: relay.wl2kBanner,
                pqChallenge: relay.pqChallenge,
                relay: relay
            }, false);
            
            // Set up event handlers for the relay
            relay.on('line', (line) => {
                DataBroker.dispatch(deviceId, 'WinlinkRelayLine', { 
                    callsign: callsign,
                    line: line 
                }, false);
            });
            
            relay.on('binaryData', (data) => {
                DataBroker.dispatch(deviceId, 'WinlinkRelayBinary', { 
                    callsign: callsign,
                    data: data 
                }, false);
            });
            
            relay.on('disconnected', () => {
                appLogger.log(`[WinlinkSync] Relay disconnected for ${callsign}`);
                DataBroker.dispatch(deviceId, 'WinlinkRelayDisconnected', { 
                    callsign: callsign 
                }, false);
            });
        } else {
            appLogger.error(`[WinlinkSync] Failed to connect to Winlink gateway`);
            relay.dispose();
            
            DataBroker.dispatch(deviceId, 'WinlinkSyncResult', { 
                success: false, 
                error: 'Failed to connect to CMS gateway',
                server: server,
                port: port
            }, false);
        }
    } catch (ex) {
        appLogger.error(`[WinlinkSync] Error: ${ex.message}`);
        DataBroker.dispatch(deviceId, 'WinlinkSyncResult', { 
            success: false, 
            error: ex.message 
        }, false);
    }
});
appLogger.log('[App] WinlinkSync handler registered');

// Initialize Web Server (if enabled)
let webServer = null;
if (config.WEBSERVERPORT) {
    const webServerPort = parseInt(config.WEBSERVERPORT, 10);
    if (webServerPort > 0) {
        try {
            webServer = new WebServer(config, radio, bbsServer, aprsHandler, winlinkServer);
            DataBroker.addDataHandler('WebServer', webServer);
            webServer.start(webServerPort)
                .then(() => {
                    appLogger.log(`[App] Web server started successfully on port ${webServerPort}`);
                })
                .catch((error) => {
                    // Check if the error is due to port already being in use
                    if (error.code === 'EADDRINUSE') {
                        appLogger.error(`[App] ❌ Web server failed to start: Port ${webServerPort} is already in use.`);
                        appLogger.error(`[App] 💡 To fix this issue:`);
                        appLogger.error(`[App]    • Stop the application or service using port ${webServerPort}`);
                        appLogger.error(`[App]    • Or change WEBSERVERPORT in config.ini to a different port number`);
                        appLogger.error(`[App]    • Available ports are typically: 3000, 8080, 8090, 9000, etc.`);
                    } else if (error.code === 'EACCES') {
                        appLogger.error(`[App] ❌ Web server failed to start: Permission denied for port ${webServerPort}.`);
                        appLogger.error(`[App] 💡 To fix this issue:`);
                        appLogger.error(`[App]    • Use a port number above 1024 (non-privileged ports)`);
                        appLogger.error(`[App]    • Or run the application with administrator/root privileges`);
                    } else {
                        appLogger.error(`[App] ❌ Web server failed to start: ${error.message}`);
                        appLogger.error(`[App] 💡 Error details: ${error.code || 'Unknown error code'}`);
                    }
                    appLogger.error(`[App] ⚠️  The application will continue running without the web interface.`);
                    webServer = null;
                    
                    // Exit gracefully with a user-friendly message
                    setTimeout(() => {
                        appLogger.error(`[App] 🛑 Exiting application due to web server startup failure.`);
                        process.exit(1);
                    }, 1000);
                });
        } catch (error) {
            appLogger.error(`[App] ❌ Web server initialization failed: ${error.message}`);
            appLogger.error(`[App] 🛑 Exiting application due to web server initialization failure.`);
            webServer = null;
            process.exit(1);
        }
    } else {
        appLogger.log('[App] Web server disabled (WEBSERVERPORT is 0)');
    }
} else {
    appLogger.log('[App] Web server disabled (WEBSERVERPORT not configured)');
}

// Data Broker Event-Driven Architecture:
// - Radio.js dispatches 'DataFrame' events to the Data Broker
// - FrameDeduplicator receives 'DataFrame' and emits 'UniqueDataFrame' for deduplicated frames
// - Each handler module (APRS, BBS, Echo, WinLink) subscribes to 'UniqueDataFrame' 
//   and processes packets they care about (based on channel_name or destination address)
// - No direct routing needed in htstation.js - handlers self-register via DataBroker

// Set up Radio configuration and start connection
const autoReconnectEnabled = config.BLUETOOTH_AUTO_RECONNECT !== 'false';
radio.setAutoReconnectEnabled(autoReconnectEnabled);
if (autoReconnectEnabled) {
    appLogger.log('[App] Automatic Bluetooth reconnection enabled (15 second interval)');
} else {
    appLogger.log('[App] Automatic Bluetooth reconnection disabled by configuration');
}

// Connect to the radio
radio.connect(RADIO_MAC_ADDRESS)
    .then(() => {
        appLogger.log('[App] Radio connected successfully');
        
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

// === Handle Ctrl+C graceful shutdown ===
process.on('SIGINT', () => {
    appLogger.log('[App] Received SIGINT (Ctrl+C), shutting down...');
    
    // Dispose PacketStore to flush pending writes
    if (packetStore) {
        packetStore.dispose();
    }
    
    // Stop web server
    if (webServer) {
        webServer.stop();
    }
    
    // Disconnect radio
    if (radio) {
        radio.disconnect();
    }
    
    // Disconnect MQTT
    if (mqttReporter && mqttReporter.client) {
        mqttReporter.client.end();
    }
    
    appLogger.log('[App] Shutdown complete.');
    process.exit(0);
});

process.on('SIGTERM', () => {
    appLogger.log('[App] Received SIGTERM, shutting down...');
    
    // Dispose PacketStore to flush pending writes
    if (packetStore) {
        packetStore.dispose();
    }
    
    // Stop web server
    if (webServer) {
        webServer.stop();
    }
    
    // Disconnect radio
    if (radio) {
        radio.disconnect();
    }
    
    // Disconnect MQTT
    if (mqttReporter && mqttReporter.client) {
        mqttReporter.client.end();
    }
    
    appLogger.log('[App] Shutdown complete.');
    process.exit(0);
});
