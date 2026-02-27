/*
Copyright 2025 Ylian Saint-Hilaire

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

   http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

'use strict';

// Get logger instance
const logger = global.logger ? global.logger.getLogger('WinLink') : console;

const AX25Session = require('../AX25Session');
const AX25Packet = require('../AX25Packet');
const DataBroker = require('../utils/DataBroker');
const DataBrokerClient = require('../utils/DataBrokerClient');
const WinlinkGatewayRelay = require('./WinlinkGatewayRelay');

/**
 * WinLink Server - Acts as a relay/gateway between radio clients and the Winlink CMS
 * All traffic is forwarded transparently to server.winlink.org
 */
class WinLinkServer {
    // Maximum number of connection log entries to keep
    static MAX_LOG_ENTRIES = 200;
    
    // Minimum interval between log file writes (milliseconds)
    static LOG_WRITE_INTERVAL = 60000; // 1 minute
    
    constructor(config, radio, storage, sessionRegistry) {
        this.config = config;
        this.radio = radio;
        this.storage = storage;
        this.sessionRegistry = sessionRegistry;
        this.callsign = config.callsign;
        this.stationId = config.winlinkStationId;
        this.version = config.version || '1.0';
        
        // CMS Gateway configuration
        this.cmsServer = config.WINLINK_SERVER || 'server.winlink.org';
        this.cmsPort = parseInt(config.WINLINK_PORT, 10) || 8773;
        this.cmsUseTls = config.WINLINK_USE_TLS !== 'false';
        
        // Active AX25 sessions
        this.activeSessions = new Map(); // Map of session keys to session objects
        
        // Active CMS relay connections
        this.activeRelays = new Map(); // Map of session keys to WinlinkGatewayRelay objects
        
        // Connection log (array of log entries, newest first)
        this.connectionLog = [];
        
        // Track last log write time
        this._lastLogWriteTime = 0;
        this._logDirty = false;
        this._logWriteTimer = null;

        // Data Broker client for receiving UniqueDataFrame events and publishing state
        this._broker = new DataBrokerClient();
        this._broker.subscribe(DataBroker.AllDevices, 'UniqueDataFrame', this._onUniqueDataFrame.bind(this));
        
        // Publish initial state
        this._publishState();
        this._publishLog();
        
        // Load existing log from storage
        this._loadLog();
        
        logger.log(`[WinLink] Gateway relay initialized on ${this.callsign}-${this.stationId}`);
        logger.log(`[WinLink] CMS Gateway: ${this.cmsServer}:${this.cmsPort} (TLS: ${this.cmsUseTls})`);
    }
    
    /**
     * Publish current server state to data broker
     * Dispatches the callsign of the connected station, or null if idle
     * Stored so new subscribers can get current state
     */
    _publishState() {
        // Get the connected callsign (first active session) or null
        let connectedCallsign = null;
        if (this.activeSessions.size > 0) {
            // Get the first active session's callsign
            connectedCallsign = this.activeSessions.keys().next().value || null;
        }
        DataBroker.dispatch(DataBroker.AllDevices, 'WinlinkStatus', { connectedCallsign, activeSessions: this.activeSessions.size }, true);
    }
    
    /**
     * Publish connection log to data broker
     * Stored so new subscribers can get current log
     */
    _publishLog() {
        DataBroker.dispatch(DataBroker.AllDevices, 'WinlinkLog', this.connectionLog, true);
    }
    
    /**
     * Publish a new log entry event to data broker
     * Not stored - just a real-time notification
     */
    _publishLogEntry(entry) {
        DataBroker.dispatch(DataBroker.AllDevices, 'WinlinkLogEntry', entry, false);
    }
    
    /**
     * Load connection log from storage
     */
    _loadLog() {
        if (!this.storage) return;
        try {
            const data = this.storage.load('winlink_log');
            if (data && Array.isArray(data)) {
                this.connectionLog = data.slice(0, WinLinkServer.MAX_LOG_ENTRIES);
                this._publishLog();
                logger.log(`[WinLink] Loaded ${this.connectionLog.length} log entries from storage`);
            }
        } catch (ex) {
            logger.error(`[WinLink] Failed to load connection log: ${ex.message}`);
        }
    }
    
    /**
     * Save connection log to storage (rate-limited)
     */
    _saveLog() {
        if (!this.storage) return;
        
        this._logDirty = true;
        const now = Date.now();
        
        // Check if we can write immediately
        if (now - this._lastLogWriteTime >= WinLinkServer.LOG_WRITE_INTERVAL) {
            this._writeLogNow();
        } else if (!this._logWriteTimer) {
            // Schedule a write for later
            const delay = WinLinkServer.LOG_WRITE_INTERVAL - (now - this._lastLogWriteTime);
            this._logWriteTimer = setTimeout(() => {
                this._logWriteTimer = null;
                if (this._logDirty) {
                    this._writeLogNow();
                }
            }, delay);
        }
    }
    
    /**
     * Actually write the log to storage
     */
    _writeLogNow() {
        if (!this.storage || !this._logDirty) return;
        
        try {
            this.storage.save('winlink_log', this.connectionLog);
            this._lastLogWriteTime = Date.now();
            this._logDirty = false;
            logger.log(`[WinLink] Saved ${this.connectionLog.length} log entries to storage`);
        } catch (ex) {
            logger.error(`[WinLink] Failed to save connection log: ${ex.message}`);
        }
    }
    
    /**
     * Add a log entry for a completed session
     */
    _addLogEntry(callsign, connectTime, disconnectTime, bytesSent, bytesReceived) {
        const entry = {
            callsign,
            connectTime: connectTime.toISOString(),
            disconnectTime: disconnectTime.toISOString(),
            durationMs: disconnectTime.getTime() - connectTime.getTime(),
            bytesSent,
            bytesReceived
        };
        
        // Add to beginning of log (newest first)
        this.connectionLog.unshift(entry);
        
        // Trim to max entries
        if (this.connectionLog.length > WinLinkServer.MAX_LOG_ENTRIES) {
            this.connectionLog = this.connectionLog.slice(0, WinLinkServer.MAX_LOG_ENTRIES);
        }
        
        // Publish the new entry and updated log
        this._publishLogEntry(entry);
        this._publishLog();
        
        // Schedule log save
        this._saveLog();
        
        logger.log(`[WinLink] Logged session: ${callsign}, duration: ${entry.durationMs}ms, sent: ${bytesSent}, received: ${bytesReceived}`);
    }

    /**
     * Handle UniqueDataFrame events from the Data Broker.
     */
    _onUniqueDataFrame(deviceId, name, frame) {
        if (!frame || !frame.data) return;

        // Attempt to decode AX.25 packet
        const packet = AX25Packet.decodeAX25Packet(frame);
        if (!packet) return;

        // Skip APRS channel packets
        if (packet.channel_name === 'APRS') return;

        // Check if first address matches our station (WinLink server)
        if (packet.addresses && packet.addresses.length >= 1) {
            const firstAddr = packet.addresses[0];
            if (firstAddr.address === this.callsign && firstAddr.SSID == this.stationId) {
                logger.log(`[WinLink] Routing packet to WinLink Gateway (${this.callsign}-${this.stationId})`);
                this.processPacket(packet, this.radio);
            }
        }
    }

    /**
     * Dispose the handler, cleaning up broker subscriptions.
     */
    dispose() {
        // Write any pending log entries
        if (this._logWriteTimer) {
            clearTimeout(this._logWriteTimer);
            this._logWriteTimer = null;
        }
        if (this._logDirty) {
            this._writeLogNow();
        }
        
        // Clean up all active relays
        for (const [sessionKey, relay] of this.activeRelays) {
            try {
                relay.dispose();
            } catch (ex) {
                // Ignore cleanup errors
            }
        }
        this.activeRelays.clear();
        
        if (this._broker) {
            this._broker.dispose();
            this._broker = null;
        }
    }

    /**
     * Get session key from addresses
     * Uses toString() which only includes SSID if non-zero (e.g. "KK7VZT-7" or "KK7VZT")
     */
    getSessionKey(addresses) {
        if (!addresses || addresses.length < 2) return null;
        const addr = addresses[1];
        // Use address-SSID format for consistency, but only include SSID if non-zero
        return addr.SSID === 0 ? addr.address : `${addr.address}-${addr.SSID}`;
    }

    /**
     * Get or create session for a packet
     */
    getOrCreateSession(packet) {
        if (!packet.addresses || packet.addresses.length < 2) return null;
        
        const sessionKey = this.getSessionKey(packet.addresses);
        if (!sessionKey) return null;
        
        let session = this.activeSessions.get(sessionKey);
        if (!session) {
            // Check if this station is busy with another server
            if (this.sessionRegistry && !this.sessionRegistry.canCreateSession(sessionKey, 'winlink')) {
                logger.log(`[WinLink] ${sessionKey} is busy with another server`);
                this.sendBusyResponse(packet);
                return null;
            }
            
            logger.log(`[WinLink] Creating new session for ${sessionKey}`);
            session = new AX25Session({
                callsign: this.callsign,
                RADIO_CALLSIGN: this.callsign,
                stationId: this.stationId,
                RADIO_STATIONID: this.stationId,
                activeChannelIdLock: packet.channel_id
            }, this.radio);
            
            // Set remote callsign for later use
            session.remoteCallsign = sessionKey;
            
            // Set up session event handlers
            session.on('stateChanged', (state) => {
                logger.log(`[WinLink] ${sessionKey} state changed to ${state}`);
                if (state === AX25Session.ConnectionState.CONNECTED) {
                    this.onConnect(session);
                } else if (state === AX25Session.ConnectionState.DISCONNECTED) {
                    logger.log(`[WinLink] Removing disconnected session for ${sessionKey}`);
                    // Delete from activeSessions BEFORE calling onDisconnect so state update is correct
                    this.activeSessions.delete(sessionKey);
                    this.onDisconnect(session);
                }
            });
            
            session.on('dataReceived', (data) => {
                logger.log(`[WinLink] ${sessionKey} received ${data.length} bytes from radio`);
                this.onRadioData(session, data);
            });
            
            session.on('error', (error) => {
                logger.log(`[WinLink] ${sessionKey} error: ${error}`);
            });
            
            this.activeSessions.set(sessionKey, session);
        }
        
        return session;
    }

    /**
     * Send DM (Disconnect Mode) response to indicate server is busy
     */
    sendBusyResponse(packet) {
        if (!packet.addresses || packet.addresses.length < 2) return;
        
        const replyAddresses = [packet.addresses[1], packet.addresses[0]];
        const dmPacket = new AX25Packet(
            replyAddresses,
            0,
            0,
            true,
            false,
            AX25Packet.FrameType.U_FRAME_DM
        );
        
        dmPacket.channel_id = packet.channel_id;
        dmPacket.channel_name = packet.channel_name;
        
        const serialized = dmPacket.toByteArray ? dmPacket.toByteArray() : (dmPacket.ToByteArray ? dmPacket.ToByteArray() : null);
        if (serialized && this.radio && typeof this.radio.sendTncFrame === 'function') {
            this.radio.sendTncFrame({
                channel_id: packet.channel_id,
                data: serialized
            });
            logger.log('[WinLink] Sent DM (busy) response');
        }
    }

    /**
     * Handle new AX25 session connection - establish relay to CMS
     */
    async onConnect(session) {
        const remoteCallsign = session.remoteCallsign;
        
        logger.log(`[WinLink] ${remoteCallsign} connected via radio`);

        // Register this session
        if (this.sessionRegistry) {
            this.sessionRegistry.registerSession(remoteCallsign, session, 'winlink');
        }
        
        // Initialize session state for relay tracking
        session.relayState = {
            binaryMode: false,
            connected: false,
            connectTime: new Date(),
            bytesSent: 0,
            bytesReceived: 0
        };
        
        // Update server state
        this._publishState();

        // Create CMS gateway relay connection
        const relay = new WinlinkGatewayRelay(1, this.cmsServer, this.cmsPort, this.cmsUseTls);
        this.activeRelays.set(remoteCallsign, relay);
        
        // Extract base callsign (without SSID) for CMS login
        const baseCallsign = remoteCallsign.split('-')[0];
        
        logger.log(`[WinLink] Connecting to CMS gateway for ${baseCallsign}...`);
        
        try {
            const connected = await relay.connectAsync(baseCallsign, 15000);
            
            if (!connected || !relay.isConnected) {
                logger.error(`[WinLink] Failed to connect to CMS gateway for ${remoteCallsign}`);
                this.sendTextToRadio(session, 'CMS Gateway connection failed.\r');
                session.disconnect();
                return;
            }
            
            session.relayState.connected = true;
            logger.log(`[WinLink] CMS connection established for ${remoteCallsign}`);
            
            // Build and send the greeting to the radio client
            // Include the CMS gateway's banner and challenge
            let greeting = '';
            if (relay.wl2kBanner) {
                greeting += relay.wl2kBanner + '\r';
            } else {
                greeting += '[WL2K-5.0-B2FWIHJM$]\r';
            }
            if (relay.pqChallenge) {
                greeting += `;PQ: ${relay.pqChallenge}\r`;
            }
            greeting += '>\r';
            
            this.sendTextToRadio(session, greeting);
            
            // Set up relay event handlers
            relay.on('line', (line) => {
                if (!session || session.currentState !== AX25Session.ConnectionState.CONNECTED) return;
                logger.log(`[WinLink] CMS -> Radio: ${line}`);
                
                // Monitor for protocol signals to switch binary mode
                const key = line.toUpperCase();
                
                // When CMS sends FS with accepted proposals, binary mode starts
                if (key.startsWith('FS') && key.includes('Y')) {
                    session.relayState.binaryMode = true;
                    relay.binaryMode = true;
                    logger.log(`[WinLink] Switching to binary mode (CMS accepted proposals)`);
                }
                
                // FF or FQ signals return to text mode
                if (key.startsWith('FF') || key.startsWith('FQ')) {
                    session.relayState.binaryMode = false;
                    relay.binaryMode = false;
                    logger.log(`[WinLink] Switching to text mode`);
                }
                
                // Send to radio (bytes counted inside sendTextToRadio)
                this.sendTextToRadio(session, line + '\r');
            });
            
            relay.on('binaryData', (data) => {
                if (!session || session.currentState !== AX25Session.ConnectionState.CONNECTED) return;
                logger.log(`[WinLink] CMS -> Radio: ${data.length} binary bytes`);
                // Track bytes received from CMS (sent to radio client)
                if (session.relayState) {
                    session.relayState.bytesReceived += data.length;
                }
                session.send(data, true);
            });
            
            relay.on('disconnected', () => {
                logger.log(`[WinLink] CMS relay disconnected for ${remoteCallsign}`);
                this.activeRelays.delete(remoteCallsign);
                
                // Disconnect the radio session if still connected
                if (session && session.currentState === AX25Session.ConnectionState.CONNECTED) {
                    session.disconnect();
                }
            });
            
        } catch (ex) {
            logger.error(`[WinLink] CMS connection error for ${remoteCallsign}: ${ex.message}`);
            this.sendTextToRadio(session, 'CMS Gateway error.\r');
            session.disconnect();
        }
    }

    /**
     * Handle session disconnect
     */
    onDisconnect(session) {
        const remoteCallsign = session.remoteCallsign;
        logger.log(`[WinLink] ${remoteCallsign} disconnected`);
        
        // Log the completed session
        if (session.relayState && session.relayState.connectTime) {
            this._addLogEntry(
                remoteCallsign,
                session.relayState.connectTime,
                new Date(),
                session.relayState.bytesSent || 0,
                session.relayState.bytesReceived || 0
            );
        }
        
        // Unregister session
        if (this.sessionRegistry) {
            this.sessionRegistry.unregisterSession(remoteCallsign);
        }
        
        // Clean up CMS relay
        const relay = this.activeRelays.get(remoteCallsign);
        if (relay) {
            try {
                relay.dispose();
            } catch (ex) {
                // Ignore cleanup errors
            }
            this.activeRelays.delete(remoteCallsign);
        }
        
        // Clean up session state
        if (session.relayState) {
            session.relayState = null;
        }
        
        // Update server state
        this._publishState();
    }

    /**
     * Handle incoming data from radio - forward to CMS
     */
    onRadioData(session, data) {
        if (!session.relayState || !session.relayState.connected) {
            logger.log('[WinLink] Received data but relay not connected');
            return;
        }

        const relay = this.activeRelays.get(session.remoteCallsign);
        if (!relay || !relay.isConnected) {
            logger.log('[WinLink] No active relay for session');
            return;
        }

        // Track bytes sent
        if (session.relayState) {
            session.relayState.bytesSent += data.length;
        }

        // If in binary mode, forward raw bytes
        if (session.relayState.binaryMode) {
            logger.log(`[WinLink] Radio -> CMS: ${data.length} binary bytes`);
            relay.sendBinary(data);
            return;
        }

        // Text mode: parse lines and forward
        const text = data.toString('utf8');
        const lines = text.replace(/\r\n/g, '\r').replace(/\n/g, '\r').split('\r');
        
        for (const line of lines) {
            if (line.length === 0) continue;
            
            logger.log(`[WinLink] Radio -> CMS: ${line}`);
            
            const key = line.toUpperCase();
            
            // Detect FS response that accepts mail proposals - switch to binary
            if (key.startsWith('FS') && key.includes('Y')) {
                session.relayState.binaryMode = true;
                relay.binaryMode = true;
                logger.log(`[WinLink] Switching to binary mode (Radio accepted proposals)`);
            }
            
            // Detect FF - switch back from binary mode
            if (key.startsWith('FF')) {
                session.relayState.binaryMode = false;
                relay.binaryMode = false;
                logger.log(`[WinLink] Switching to text mode`);
            }
            
            // Detect FQ - session close
            if (key.startsWith('FQ')) {
                session.relayState.binaryMode = false;
                relay.binaryMode = false;
                logger.log(`[WinLink] Session close requested`);
            }
            
            relay.sendLine(line);
        }
    }

    /**
     * Send text to radio session and track bytes sent
     */
    sendTextToRadio(session, text) {
        if (!text) return;
        const buffer = Buffer.from(text, 'utf8');
        // Track bytes received from CMS (sent to radio client)
        if (session.relayState) {
            session.relayState.bytesReceived += buffer.length;
        }
        session.send(buffer, true);
    }

    /**
     * Process incoming AX25 packet
     */
    processPacket(packet, radio) {
        if (!packet || !packet.addresses || packet.addresses.length < 2) {
            logger.log('[WinLink] Invalid packet structure');
            return;
        }

        // Store radio reference
        if (radio) {
            this.radio = radio;
        }

        // Check if first address matches our station
        const firstAddr = packet.addresses[0];
        if (firstAddr.address === this.callsign && firstAddr.SSID == this.stationId) {
            // Check if this is a session-related packet
            if (packet.isSessionPacket()) {
                logger.log('[WinLink] Processing session packet');
                const session = this.getOrCreateSession(packet);
                if (session) {
                    session.receive(packet);
                } else {
                    logger.log('[WinLink] Failed to create/get session for packet');
                }
            } else {
                logger.log('[WinLink] Received non-session packet, ignoring');
            }
        }
    }
}

module.exports = WinLinkServer;
