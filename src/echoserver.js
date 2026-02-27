'use strict';

// Get logger instance
const logger = global.logger ? global.logger.getLogger('Echo') : console;

const AX25Session = require('./AX25Session');
const AX25Packet = require('./AX25Packet');
const BSSPacket = require('./BSSPacket');
const DataBroker = require('./utils/DataBroker');
const DataBrokerClient = require('./utils/DataBrokerClient');

class EchoServer {
    constructor(config, radio, sessionRegistry) {
        this.config = config;
        this.radio = radio;
        this.RADIO_CALLSIGN = config.CALLSIGN;
        this.RADIO_STATIONID = config.STATIONID;
        this.sessionRegistry = sessionRegistry; // Global session registry for coordination
        
        // === AX25 Session Management for Echo Mode ===
        this.activeSessions = new Map(); // Map of session keys to session objects

        // Data Broker client for receiving UniqueDataFrame events
        this._broker = new DataBrokerClient();
        this._broker.subscribe(DataBroker.AllDevices, 'UniqueDataFrame', this._onUniqueDataFrame.bind(this));
    }

    /**
     * Handle UniqueDataFrame events from the Data Broker.
     * This replaces the direct call from htstation.js
     */
    _onUniqueDataFrame(deviceId, name, frame) {
        if (!frame || !frame.data) return;

        // Check if this is a BSS packet (starts with 0x01)
        if (BSSPacket.isBSSPacket(frame.data)) {
            this.processBSSPacket(frame);
            return;
        }

        // Attempt to decode AX.25 packet
        const packet = AX25Packet.decodeAX25Packet(frame);
        if (!packet) return;

        // Skip APRS channel packets - those are handled by AprsHandler
        if (packet.channel_name === 'APRS') return;

        // Check if first address matches our station (Echo server)
        if (packet.addresses && packet.addresses.length >= 1) {
            const firstAddr = packet.addresses[0];
            if (firstAddr.address === this.RADIO_CALLSIGN && firstAddr.SSID == this.RADIO_STATIONID) {
                logger.log(`[Echo Server] Routing packet to Echo Server (${this.RADIO_CALLSIGN}-${this.RADIO_STATIONID})`);
                this.processPacket(packet);
            }
        }
    }

    /**
     * Process a BSS packet.
     * If the destination matches our station and there's a message, echo it back.
     */
    processBSSPacket(frame) {
        const bssPacket = BSSPacket.decode(frame.data);
        if (!bssPacket) {
            logger.log('[Echo Server] Failed to decode BSS packet');
            return;
        }

        logger.log(`[Echo Server] Received BSS packet: ${bssPacket.toString()}`);

        // Build our station identifier for comparison
        const ourStation = this.RADIO_STATIONID > 0 
            ? `${this.RADIO_CALLSIGN}-${this.RADIO_STATIONID}` 
            : this.RADIO_CALLSIGN;

        // Check if destination matches our station
        const destination = bssPacket.destination || '';
        if (destination.toUpperCase() !== ourStation.toUpperCase()) {
            logger.log(`[Echo Server] BSS packet not for us (dest: ${destination}, our: ${ourStation})`);
            return;
        }

        // Check if there's a message to echo
        if (!bssPacket.message || bssPacket.message.length === 0) {
            logger.log('[Echo Server] BSS packet has no message to echo');
            return;
        }

        // Create reply packet: swap source and destination
        const replyPacket = new BSSPacket(
            ourStation,           // Our station as source (callsign field)
            bssPacket.callsign,   // Original sender as destination
            bssPacket.message     // Echo the same message
        );

        // Encode and send the reply
        const replyData = replyPacket.encode();
        
        if (typeof this.radio.sendTncFrame !== 'function') {
            logger.warn('[Echo Server] radio.sendTncFrame not implemented.');
            return;
        }

        this.radio.sendTncFrame({
            channel_id: frame.channel_id,
            data: replyData
        });
        
        logger.log(`[Echo Server] Echoed BSS message back to ${bssPacket.callsign}: ${bssPacket.message}`);
    }

    /**
     * Dispose the handler, cleaning up broker subscriptions.
     */
    dispose() {
        if (this._broker) {
            this._broker.dispose();
            this._broker = null;
        }
    }
    
    // Helper function to create session key from addresses
    getSessionKey(addresses) {
        if (!addresses || addresses.length < 2) return null;
        // Use remote station as key (addresses[1] is the source/remote station)
        return addresses[1].callSignWithId;
    }
    
    // Send DM (Disconnect Mode) response to indicate server is busy
    sendBusyResponse(packet) {
        if (!packet.addresses || packet.addresses.length < 2) return;
        
        // Create DM packet with swapped addresses
        const replyAddresses = [packet.addresses[1], packet.addresses[0]];
        const dmPacket = new AX25Packet(
            replyAddresses,
            0,
            0,
            true,  // poll/final bit set
            false, // response frame
            AX25Packet.FrameType.U_FRAME_DM
        );
        
        dmPacket.channel_id = packet.channel_id;
        dmPacket.channel_name = packet.channel_name;
        
        const serialized = dmPacket.toByteArray ? dmPacket.toByteArray() : (dmPacket.ToByteArray ? dmPacket.ToByteArray() : null);
        if (serialized && typeof this.radio.sendTncFrame === 'function') {
            this.radio.sendTncFrame({
                channel_id: packet.channel_id,
                data: serialized
            });
            logger.log('[Echo Server] Sent DM (busy) response');
        }
    }
    
    // Helper function to create or get session for echo mode
    getOrCreateEchoSession(packet) {
        if (!packet.addresses || packet.addresses.length < 2) return null;
        
        const sessionKey = this.getSessionKey(packet.addresses);
        if (!sessionKey) return null;
        
        let session = this.activeSessions.get(sessionKey);
        if (!session) {
            // Check if this station is busy with another server
            if (this.sessionRegistry && !this.sessionRegistry.canCreateSession(sessionKey, 'echo')) {
                logger.log(`[Echo Session] ${sessionKey} is busy with another server, sending DM`);
                this.sendBusyResponse(packet);
                return null;
            }
            
            logger.log(`[Echo Session] Creating new session for ${sessionKey}`);
            session = new AX25Session({
                callsign: this.RADIO_CALLSIGN, 
                RADIO_CALLSIGN: this.RADIO_CALLSIGN,
                stationId: this.RADIO_STATIONID,
                RADIO_STATIONID: this.RADIO_STATIONID,
                activeChannelIdLock: packet.channel_id
            }, this.radio);
            
            // Set up session event handlers
            session.on('stateChanged', (state) => {
                logger.log(`[Echo Session] ${sessionKey} state changed to ${state}`);
                if (state === AX25Session.ConnectionState.CONNECTED) {
                    // Register session in global registry
                    if (this.sessionRegistry) {
                        this.sessionRegistry.registerSession(sessionKey, 'echo');
                    }
                } else if (state === AX25Session.ConnectionState.DISCONNECTED) {
                    logger.log(`[Echo Session] Removing disconnected session for ${sessionKey}`);
                    
                    // Unregister session from global registry
                    if (this.sessionRegistry) {
                        this.sessionRegistry.unregisterSession(sessionKey);
                    }
                    
                    this.activeSessions.delete(sessionKey);
                }
            });
            
            session.on('dataReceived', (data) => {
                logger.log(`[Echo Session] ${sessionKey} received ${data.length} bytes: ${data.toString()}`);
                // Echo the data back to the sender
                if (session.currentState === AX25Session.ConnectionState.CONNECTED) {
                    logger.log(`[Echo Session] Echoing ${data.length} bytes back to ${sessionKey}`);
                    session.send(data);
                }
            });
            
            session.on('uiDataReceived', (data) => {
                logger.log(`[Echo Session] ${sessionKey} received UI data ${data.length} bytes: ${data.toString()}`);
                // For UI frames, we don't echo back as they're connectionless
            });
            
            session.on('error', (error) => {
                logger.log(`[Echo Session] ${sessionKey} error: ${error}`);
            });
            
            this.activeSessions.set(sessionKey, session);
        }
        
        return session;
    }
    
    // Main method to process packets in echo mode
    processPacket(packet) {
        // Check if first address matches our station
        const firstAddr = packet.addresses[0];
        if (firstAddr.address === this.RADIO_CALLSIGN && firstAddr.SSID == this.RADIO_STATIONID) {
            // For echo mode, handle session management and U-frame echoing
            
            // Check if this is a session-related packet (SABM, SABME, I-frame, etc.)
            if (packet.isSessionPacket()) {
                // Handle session management
                logger.log('[Echo Session] Processing session packet');
                const session = this.getOrCreateEchoSession(packet);
                if (session) {
                    session.receive(packet);
                } else {
                    logger.log('[Echo Session] Failed to create/get session for packet');
                }
            } else {
                // Handle U-frame echoing for non-session packets
                const isUFrame = packet.type === 3;
                const hasPayload = packet.data && packet.data.length >= 1;
                
                if (isUFrame && hasPayload) {
                    // Prepare reply: flip first and second address
                    if (packet.addresses.length > 1) {
                        const replyAddresses = [...packet.addresses];
                        [replyAddresses[0], replyAddresses[1]] = [replyAddresses[1], replyAddresses[0]];
                        // Create reply packet
                        const replyPacket = new AX25Packet(replyAddresses, packet.nr, packet.ns, packet.pollFinal, packet.command, packet.type, packet.data);
                        replyPacket.pid = packet.pid;
                        replyPacket.channel_id = packet.channel_id;
                        replyPacket.channel_name = packet.channel_name;
                        // Serialize replyPacket with header and addresses
                        const serialized = replyPacket.ToByteArray ? replyPacket.ToByteArray() : (replyPacket.toByteArray ? replyPacket.toByteArray() : null);
                        if (!serialized) {
                            logger.warn('[Echo Server] AX.25 packet serialization failed:', replyPacket);
                        } else if (typeof this.radio.sendTncFrame !== 'function') {
                            logger.warn('[Echo Server] radio.sendTncFrame not implemented.');
                        } else {
                            this.radio.sendTncFrame({
                                channel_id: replyPacket.channel_id,
                                data: serialized
                            });
                            logger.log('[Echo Server] Echoed AX.25 U-frame packet back to sender.');
                        }
                    }
                } else {
                    if (!isUFrame) {
                        logger.log('[Echo Server] AX.25 packet addressed to our station - not echoing (not a U-frame)');
                    } else {
                        logger.log('[Echo Server] AX.25 packet addressed to our station - not echoing (no payload data)');
                    }
                }
            }
        }
    }
}

module.exports = EchoServer;
