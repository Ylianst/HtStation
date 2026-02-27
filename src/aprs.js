'use strict';

// Get logger instance
const logger = global.logger ? global.logger.getLogger('APRS') : console;

const crypto = require('crypto');
const EventEmitter = require('events');
const { AprsPacket } = require('./aprs/index.js');
const Storage = require('./storage');
const AX25Packet = require('./AX25Packet');
const DataBroker = require('./utils/DataBroker');
const DataBrokerClient = require('./utils/DataBrokerClient');

class AprsHandler extends EventEmitter {
    constructor(config, radio, mqttReporter) {
        super(); // Initialize EventEmitter
        this.config = config;
        this.radio = radio;
        this.mqttReporter = mqttReporter;
        
        // APRS Message Duplicate Detection
        // In-memory table to track received APRS messages and prevent duplicate processing
        // Key format: "SENDER-SSID:SEQID", Value: { timestamp, messageText }
        this.aprsMessageCache = new Map();
        this.MAX_APRS_CACHE_SIZE = 100;
        
        // APRS Message Sending Queue
        // Queue to track outgoing APRS messages awaiting ACK
        // Key format: "DESTINATION-SSID:SEQID", Value: { message, attempts, timer, requiresAuth, sentTime }
        this.aprsOutgoingQueue = new Map();
        this.MAX_RETRIES = 3;
        this.RETRY_INTERVAL_MS = 20000; // 20 seconds
        
        // Station Authentication Table
        this.stationAuthTable = new Map();
        this.initializeAuthTable();
        
        // APRS Message Storage for BBS access
        // Store messages that are not for our station for BBS retrieval
        try {
            this.aprsMessageStorage = new Storage('./data/aprs-messages.db');
            this.MAX_STORED_APRS_MESSAGES = 1000;
            logger.log('[APRS] APRS message storage initialized');
        } catch (error) {
            logger.error('[APRS] Failed to initialize APRS message storage:', error);
            this.aprsMessageStorage = null;
        }
        
        // Write throttling for Raspberry Pi/MicroSD protection
        // Limit file writes to at most once per minute
        this.WRITE_THROTTLE_MS = 60000; // 60 seconds
        this._pendingWrites = []; // Queue of pending write operations
        this._lastWriteTime = 0;
        this._writeTimer = null;
        
        // In-memory APRS frame history (matches C# implementation)
        this._aprsFrames = [];
        this.MAX_FRAME_HISTORY = 1000;
        this._storeReady = false;

        // Data Broker client for receiving UniqueDataFrame events
        this._broker = new DataBrokerClient();
        this._broker.subscribe(DataBroker.AllDevices, 'UniqueDataFrame', this._onUniqueDataFrame.bind(this));
        
        // Subscribe to PacketStoreReady to know when we can request historical packets
        this._broker.subscribe(1, 'PacketStoreReady', this._onPacketStoreReady.bind(this));
        
        // Subscribe to PacketList to receive the list of historical packets
        this._broker.subscribe(1, 'PacketList', this._onPacketList.bind(this));
        
        // Subscribe to SendAprsMessage events from the UI
        this._broker.subscribe(1, 'SendAprsMessage', this._onSendAprsMessage.bind(this));
        
        // Subscribe to RequestAprsPackets to provide current packet list on-demand
        this._broker.subscribe(1, 'RequestAprsPackets', this._onRequestAprsPackets.bind(this));
        
        // Load the next APRS message ID from the Data Broker (persisted across restarts)
        this._nextAprsMessageId = this._broker.getValue(0, 'NextAprsMessageId', 1);
        if (this._nextAprsMessageId < 1 || this._nextAprsMessageId > 999) {
            this._nextAprsMessageId = 1;
        }
        
        // Check if PacketStore is already ready (in case we're created after PacketStore)
        if (this._broker.hasValue(1, 'PacketStoreReady')) {
            // Request the packet list immediately
            this._broker.dispatch(1, 'RequestPacketList', null, false);
        } else {
            // If no PacketStore or not ready after 2 seconds, mark as ready anyway
            // This allows the web UI to get an empty list rather than waiting forever
            setTimeout(() => {
                if (!this._storeReady) {
                    logger.log('[APRS] No PacketStore response, marking store as ready with empty history');
                    this._storeReady = true;
                    this._broker.dispatch(1, 'AprsStoreReady', true, false);
                }
            }, 2000);
        }
    }
    
    /**
     * Gets the next APRS message ID, cycling from 1 to 999.
     * Persists the value to the Data Broker for recovery across restarts.
     * @returns {number} The next message ID.
     */
    _getNextAprsMessageId() {
        const msgId = this._nextAprsMessageId++;
        if (this._nextAprsMessageId > 999) {
            this._nextAprsMessageId = 1;
        }
        this._broker.dispatch(0, 'NextAprsMessageId', this._nextAprsMessageId, true);
        return msgId;
    }
    
    /**
     * Handle PacketStoreReady event by requesting the packet list.
     */
    _onPacketStoreReady(deviceId, name, data) {
        if (this._storeReady) return; // Already processed
        
        // Request the packet list from PacketStore
        this._broker.dispatch(1, 'RequestPacketList', null, false);
    }
    
    /**
     * Handle PacketList event by parsing all historical APRS packets.
     */
    _onPacketList(deviceId, name, packets) {
        if (this._storeReady) return; // Already processed
        if (!Array.isArray(packets)) return;
        
        logger.log(`[APRS] Loading ${packets.length} historical packets from PacketStore`);
        
        // Parse all historical packets from the APRS channel
        for (const frame of packets) {
            // Only process frames from the APRS channel
            if (frame.channel_name !== 'APRS') continue;
            
            // Decode the frame as AX.25
            const ax25Packet = AX25Packet.decodeAX25Packet(frame);
            if (!ax25Packet) continue;
            
            // Only process UI frames (used by APRS)
            if (ax25Packet.type !== 3) continue; // 3 = UI frame
            
            // Parse the APRS packet
            const aprsInput = {
                dataStr: ax25Packet.dataStr,
                addresses: ax25Packet.addresses
            };
            const aprsPacket = AprsPacket.parse(aprsInput);
            if (!aprsPacket) continue;
            
            // Add to in-memory history
            this._aprsFrames.push({
                aprsPacket,
                ax25Packet,
                frame,
                timestamp: frame.time || Date.now()
            });
        }
        
        // Trim to max size
        while (this._aprsFrames.length > this.MAX_FRAME_HISTORY) {
            this._aprsFrames.shift();
        }
        
        // Mark as ready
        this._storeReady = true;
        
        logger.log(`[APRS] Loaded ${this._aprsFrames.length} APRS packets from history`);
        
        // Notify subscribers that AprsHandler is ready with historical data
        this._broker.dispatch(1, 'AprsStoreReady', true, false);
    }
    
    /**
     * Handle RequestAprsPackets events to provide the current packet list on-demand.
     */
    _onRequestAprsPackets(deviceId, name, data) {
        // Always respond with the current packet list (may be empty if not ready)
        logger.log(`[APRS] RequestAprsPackets received, returning ${this._aprsFrames.length} packets`);
        this._broker.dispatch(1, 'AprsPacketList', [...this._aprsFrames], false);
    }
    
    /**
     * Handle SendAprsMessage events from the UI to transmit APRS messages.
     */
    _onSendAprsMessage(deviceId, name, messageData) {
        if (!messageData || !messageData.destination || !messageData.message) {
            logger.error('[APRS] Invalid SendAprsMessage data');
            return;
        }
        
        const destination = messageData.destination;
        const message = messageData.message;
        const route = messageData.route || null;
        
        // Use the sendMessage method which handles authentication and retry logic
        const requiresAuth = this.requiresAuthentication(destination);
        this.sendMessage(destination, message, requiresAuth);
    }

    /**
     * Handle UniqueDataFrame events from the Data Broker.
     * This replaces the direct call from htstation.js
     */
    _onUniqueDataFrame(deviceId, name, frame) {
        if (!frame || !frame.data) return;

        // Attempt to decode AX.25 packet
        const packet = AX25Packet.decodeAX25Packet(frame);
        if (!packet) return;

        // Check if this packet is from the APRS channel
        if (packet.channel_name === 'APRS') {
            this.processAprsPacket(packet);
        }
    }

    /**
     * Dispose the handler, cleaning up broker subscriptions.
     */
    dispose() {
        // Clear write timer
        if (this._writeTimer) {
            clearTimeout(this._writeTimer);
            this._writeTimer = null;
        }
        
        // Flush any pending writes before disposing
        this._flushPendingWrites();
        
        if (this._broker) {
            this._broker.dispose();
            this._broker = null;
        }
        
        // Clear outgoing message timers
        for (const [key, entry] of this.aprsOutgoingQueue) {
            if (entry.timer) {
                clearTimeout(entry.timer);
            }
        }
        this.aprsOutgoingQueue.clear();
    }
    
    /**
     * Queue a write operation for throttled execution.
     * Writes are batched and executed at most once per minute to protect MicroSD cards.
     * @param {string} storageKey - The storage key
     * @param {object} record - The record to save
     */
    _queueThrottledWrite(storageKey, record) {
        // Add to pending writes queue
        this._pendingWrites.push({ key: storageKey, record });
        
        const now = Date.now();
        const timeSinceLastWrite = now - this._lastWriteTime;
        
        // If enough time has passed since last write, flush immediately
        if (timeSinceLastWrite >= this.WRITE_THROTTLE_MS) {
            this._flushPendingWrites();
        } else if (!this._writeTimer) {
            // Schedule a flush for when the throttle period ends
            const timeUntilNextWrite = this.WRITE_THROTTLE_MS - timeSinceLastWrite;
            this._writeTimer = setTimeout(() => {
                this._writeTimer = null;
                this._flushPendingWrites();
            }, timeUntilNextWrite);
        }
    }
    
    /**
     * Flush all pending writes to storage.
     */
    _flushPendingWrites() {
        if (!this.aprsMessageStorage || this._pendingWrites.length === 0) {
            return;
        }
        
        const writesToFlush = this._pendingWrites;
        this._pendingWrites = [];
        this._lastWriteTime = Date.now();
        
        logger.log(`[APRS Storage] Flushing ${writesToFlush.length} pending writes to disk`);
        
        // Batch write all pending records
        for (const write of writesToFlush) {
            try {
                this.aprsMessageStorage.save(write.key, write.record);
            } catch (error) {
                logger.error(`[APRS Storage] Failed to write ${write.key}:`, error);
            }
        }
        
        // Cleanup old messages after batch write
        this.cleanupOldAprsMessages();
    }
    
    /**
     * Add an APRS frame to in-memory history and dispatch via DataBroker.
     * @param {object} aprsPacket - Parsed APRS packet
     * @param {object} ax25Packet - Underlying AX.25 packet
     * @param {object} frame - Original TNC data fragment (can be null for sent packets)
     */
    _addToFrameHistory(aprsPacket, ax25Packet, frame) {
        const frameEntry = {
            aprsPacket,
            ax25Packet,
            frame,
            timestamp: Date.now()
        };
        
        // Add to in-memory history
        this._aprsFrames.push(frameEntry);
        
        // Trim to max size
        while (this._aprsFrames.length > this.MAX_FRAME_HISTORY) {
            this._aprsFrames.shift();
        }
        
        // Dispatch AprsFrame event via DataBroker (for UI updates)
        this._broker.dispatch(1, 'AprsFrame', frameEntry, false);
    }
    
    // Initialize station authentication table from config
    initializeAuthTable() {
        if (this.config.AUTH && Array.isArray(this.config.AUTH)) {
            logger.log('[APRS] Loading station authentication entries...');
            
            for (const authEntry of this.config.AUTH) {
                // Parse AUTH entry format: "CALLSIGN-SSID,password"
                const commaIndex = authEntry.indexOf(',');
                if (commaIndex === -1) {
                    logger.warn(`[APRS] Invalid AUTH entry format (missing comma): ${authEntry}`);
                    continue;
                }
                
                let stationCallsign = authEntry.substring(0, commaIndex).trim().toUpperCase();
                const stationPassword = authEntry.substring(commaIndex + 1);
                
                if (!stationCallsign || !stationPassword) {
                    logger.warn(`[APRS] Invalid AUTH entry (empty callsign or password): ${authEntry}`);
                    continue;
                }
                
                // If no SSID is specified, assume SSID 0
                if (!stationCallsign.includes('-')) {
                    stationCallsign = `${stationCallsign}-0`;
                }
                
                // Create SHA256 hash of the password
                const passwordHash = crypto.createHash('sha256').update(stationPassword).digest('hex');
                
                // Store in authentication table
                this.stationAuthTable.set(stationCallsign, {
                    callsign: stationCallsign,
                    passwordHash: passwordHash
                });
                
                logger.log(`[APRS] Added authentication entry for station: ${stationCallsign}`);
            }
            
            logger.log(`[APRS] Station authentication table loaded with ${this.stationAuthTable.size} entries`);
        } else {
            logger.log('[APRS] No AUTH entries found in configuration');
        }
    }
    
    // Function to add a message to the cache and maintain size limit
    addToAprsCache(senderCallsign, seqId, messageText) {
        const key = `${senderCallsign}:${seqId}`;
        
        // If cache is at limit, remove oldest entry
        if (this.aprsMessageCache.size >= this.MAX_APRS_CACHE_SIZE) {
            const firstKey = this.aprsMessageCache.keys().next().value;
            this.aprsMessageCache.delete(firstKey);
        }
        
        this.aprsMessageCache.set(key, {
            timestamp: new Date().toISOString(),
            messageText: messageText
        });
    }
    
    // Function to check if a message is a duplicate
    isAprsMessageDuplicate(senderCallsign, seqId) {
        const key = `${senderCallsign}:${seqId}`;
        return this.aprsMessageCache.has(key);
    }
    
    // Check if an identical message was received in the last 10 minutes
    isDuplicateInDatabase(sourceCallsign, destinationCallsign, messageText, dataType) {
        if (!this.aprsMessageStorage) {
            return false; // Cannot check without storage
        }
        
        try {
            // Get current time and 10 minutes ago
            const now = Date.now();
            const tenMinutesAgo = now - (10 * 60 * 1000);
            
            // Get all APRS message keys
            const messageKeys = this.aprsMessageStorage.list('aprs-msg-%');
            
            // Check each message within the time window
            for (const key of messageKeys) {
                // Extract timestamp from key (format: aprs-msg-{timestamp})
                const timestampMatch = key.match(/aprs-msg-(\d+)/);
                if (!timestampMatch) continue;
                
                const messageTimestamp = parseInt(timestampMatch[1]);
                
                // Skip messages older than 10 minutes
                if (messageTimestamp < tenMinutesAgo) continue;
                
                // Load the message record
                const record = this.aprsMessageStorage.load(key);
                if (!record) continue;
                
                // Check if it's an exact match
                if (record.source === sourceCallsign &&
                    record.destination === destinationCallsign &&
                    record.message === messageText &&
                    record.dataType === dataType &&
                    record.direction === 'received') {
                    logger.log(`[APRS] Duplicate detected in database: ${sourceCallsign} > ${destinationCallsign} from ${new Date(messageTimestamp).toISOString()}`);
                    return true;
                }
            }
            
            return false; // No duplicate found
        } catch (error) {
            logger.error('[APRS] Error checking for duplicates in database:', error);
            return false; // On error, allow the message through
        }
    }
    
    // Store ALL APRS data for BBS retrieval (all packet types)
    storeAllAprsData(aprsPacket, packet) {
        if (!this.aprsMessageStorage) {
            return false; // Storage not available
        }
        
        try {
            const now = new Date();
            const timestamp = now.toISOString();
            const localTime = now.toLocaleString('en-US', {
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
                hour12: false
            });
            
            // Get source callsign from packet addresses
            const senderAddress = packet.addresses.length > 1 ? packet.addresses[1] : packet.addresses[0];
            const sourceCallsign = senderAddress.address + (senderAddress.SSID > 0 ? `-${senderAddress.SSID}` : '');
            
            let destinationCallsign = '';
            let messageText = '';
            let positionData = null;
            let weatherData = null;
            
            // Extract information based on APRS data type
            switch (aprsPacket.dataType) {
                case 'Message':
                    if (aprsPacket.messageData) {
                        destinationCallsign = aprsPacket.messageData.addressee || '';
                        messageText = aprsPacket.messageData.msgText || '';
                    }
                    break;
                case 'Position':
                case 'PositionMsg':
                case 'PositionTime':
                case 'PositionTimeMsg':
                    destinationCallsign = 'APRS-POSITION';
                    if (aprsPacket.position && aprsPacket.position.isValid()) {
                        positionData = {
                            latitude: aprsPacket.position.coordinateSet.latitude.value,
                            longitude: aprsPacket.position.coordinateSet.longitude.value,
                            altitude: aprsPacket.position.altitude,
                            comment: aprsPacket.comment || ''
                        };
                        messageText = `Lat: ${aprsPacket.position.coordinateSet.latitude.value.toFixed(6)}, Lon: ${aprsPacket.position.coordinateSet.longitude.value.toFixed(6)}`;
                        if (aprsPacket.comment) {
                            messageText += ` - ${aprsPacket.comment}`;
                        }
                    }
                    break;
                case 'Weather':
                    destinationCallsign = 'APRS-WEATHER';
                    if (aprsPacket.weather) {
                        weatherData = aprsPacket.weather;
                        messageText = `Temp: ${weatherData.temperature || 'N/A'}°F, Wind: ${weatherData.windSpeed || 'N/A'}mph @ ${weatherData.windDirection || 'N/A'}°`;
                    }
                    break;
                case 'Status':
                    destinationCallsign = 'APRS-STATUS';
                    messageText = aprsPacket.status || packet.dataStr || '';
                    break;
                case 'Telemetry':
                    destinationCallsign = 'APRS-TELEMETRY';
                    messageText = packet.dataStr || 'Telemetry data';
                    break;
                case 'Object':
                    destinationCallsign = 'APRS-OBJECT';
                    messageText = aprsPacket.objectName || packet.dataStr || 'Object data';
                    break;
                case 'Item':
                    destinationCallsign = 'APRS-ITEM';
                    messageText = aprsPacket.itemName || packet.dataStr || 'Item data';
                    break;
                default:
                    destinationCallsign = `APRS-${aprsPacket.dataType.toUpperCase()}`;
                    messageText = packet.dataStr || 'Unknown APRS data';
                    break;
            }
            
            // Don't store messages addressed to our station
            const ourCallsign = this.config.CALLSIGN.toUpperCase();
            const isForUs = (aprsPacket.dataType === 'Message' && aprsPacket.messageData) ? 
                (aprsPacket.messageData.addressee.trim().toUpperCase() === ourCallsign || 
                 aprsPacket.messageData.addressee.trim().toUpperCase() === `${ourCallsign}-${this.config.STATIONID}`) : 
                false;
            
            if (isForUs) {
                return false; // Don't store messages for our station
            }
            
            // Check for duplicate in database (last 10 minutes)
            if (this.isDuplicateInDatabase(sourceCallsign, destinationCallsign, messageText, aprsPacket.dataType)) {
                logger.log(`[APRS Storage] Skipping duplicate message from ${sourceCallsign} > ${destinationCallsign} received within last 10 minutes`);
                return false; // Don't store duplicate
            }
            
            const messageRecord = {
                source: sourceCallsign,
                destination: destinationCallsign,
                message: messageText,
                dataType: aprsPacket.dataType,
                direction: 'received', // Add direction tracking
                timestamp: timestamp,
                localTime: localTime,
                position: positionData,
                weather: weatherData
            };
            
            // Use timestamp as key for natural sorting (newest first when sorted in reverse)
            const storageKey = `aprs-msg-${now.getTime()}`;
            
            // Queue for throttled write (at most once per minute for Raspberry Pi/MicroSD protection)
            this._queueThrottledWrite(storageKey, messageRecord);
            
            logger.log(`[APRS Storage] Queued ${aprsPacket.dataType} from ${sourceCallsign} > ${destinationCallsign}: "${messageText}"`);
            
            // Emit event for real-time WebSocket broadcast
            this.emit('aprsMessageReceived', {
                source: sourceCallsign,
                destination: destinationCallsign,
                message: messageText,
                dataType: aprsPacket.dataType,
                direction: 'received',
                timestamp: timestamp,
                localTime: localTime,
                position: positionData,
                weather: weatherData
            });
            
            return true;
        } catch (error) {
            logger.error('[APRS Storage] Error storing APRS data:', error);
            return false;
        }
    }
    
    // Store APRS message for BBS retrieval (messages not for our station)
    storeAprsMessage(sourceCallsign, destinationCallsign, messageText) {
        if (!this.aprsMessageStorage) {
            return false; // Storage not available
        }
        
        try {
            const now = new Date();
            const timestamp = now.toISOString();
            const localTime = now.toLocaleString('en-US', {
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
                hour12: false
            });
            
            const messageRecord = {
                source: sourceCallsign,
                destination: destinationCallsign,
                message: messageText,
                timestamp: timestamp,
                localTime: localTime
            };
            
            // Use timestamp as key for natural sorting (newest first when sorted in reverse)
            const storageKey = `aprs-msg-${now.getTime()}`;
            
            if (this.aprsMessageStorage.save(storageKey, messageRecord)) {
                logger.log(`[APRS Storage] Stored message ${sourceCallsign} > ${destinationCallsign}: "${messageText}"`);
                
                // Maintain message limit
                this.cleanupOldAprsMessages();
                return true;
            } else {
                logger.error(`[APRS Storage] Failed to store message from ${sourceCallsign}`);
                return false;
            }
        } catch (error) {
            logger.error('[APRS Storage] Error storing message:', error);
            return false;
        }
    }
    
    // Cleanup old APRS messages to maintain the 1000 message limit
    cleanupOldAprsMessages() {
        if (!this.aprsMessageStorage) {
            return;
        }
        
        try {
            // Get all APRS message keys
            const messageKeys = this.aprsMessageStorage.list('aprs-msg-%');
            
            // If we have more than the limit, remove the oldest ones
            if (messageKeys.length > this.MAX_STORED_APRS_MESSAGES) {
                // Sort keys to get oldest first (they're timestamp-based)
                messageKeys.sort();
                
                // Remove the oldest messages beyond the limit
                const keysToDelete = messageKeys.slice(0, messageKeys.length - this.MAX_STORED_APRS_MESSAGES);
                for (const key of keysToDelete) {
                    this.aprsMessageStorage.delete(key);
                }
                
                logger.log(`[APRS Storage] Cleaned up ${keysToDelete.length} old APRS message records`);
            }
        } catch (error) {
            logger.error('[APRS Storage] Error cleaning up old messages:', error);
        }
    }
    
    // Function to check if station requires authentication
    requiresAuthentication(stationCallsign) {
        let upperCallsign = stationCallsign.toUpperCase();
        
        // If no SSID is specified, assume SSID 0
        if (!upperCallsign.includes('-')) {
            upperCallsign = `${upperCallsign}-0`;
        }
        
        return this.stationAuthTable.has(upperCallsign);
    }
    
    // Function to compute APRS authentication code for outgoing messages
    computeAprsAuthenticationCode(destinationCallsign, aprsMessage, msgId) {
        logger.log(`[APRS Auth] Computing auth code for outgoing message to ${destinationCallsign}`);
        
        // Normalize destination callsign
        let upperDestination = destinationCallsign.toUpperCase();
        if (!upperDestination.includes('-')) {
            upperDestination = `${upperDestination}-0`;
        }
        
        // Get the shared secret (password) from config for the destination station
        let sharedSecret = null;
        if (this.config.AUTH && Array.isArray(this.config.AUTH)) {
            for (const authEntryConfig of this.config.AUTH) {
                const commaIndex = authEntryConfig.indexOf(',');
                if (commaIndex === -1) continue;
                
                let configCallsign = authEntryConfig.substring(0, commaIndex).trim().toUpperCase();
                if (!configCallsign.includes('-')) {
                    configCallsign = `${configCallsign}-0`;
                }
                
                if (configCallsign === upperDestination) {
                    sharedSecret = authEntryConfig.substring(commaIndex + 1);
                    break;
                }
            }
        }
        
        if (!sharedSecret) {
            logger.log(`[APRS Auth] No shared secret found for ${upperDestination} - cannot compute auth code`);
            return null; // No shared secret for this destination
        }
        
        // Compute SHA256 hash of the shared secret (SecretKey)
        const secretKey = crypto.createHash('sha256').update(sharedSecret, 'utf8').digest();
        
        // Get current time in minutes since January 1, 1970 UTC
        const currentMinutes = Math.floor(Date.now() / (1000 * 60));
        
        // Our station callsign with SSID as source
        const sourceStation = `${this.config.CALLSIGN}-${this.config.STATIONID}`;
        
        // Build hash message according to spec
        let hashMessage;
        if (msgId) {
            // For messages with message ID (like ACK messages)
            hashMessage = `${currentMinutes}:${sourceStation}:${upperDestination}:${aprsMessage}{${msgId}`;
        } else {
            // For messages without message ID
            hashMessage = `${currentMinutes}:${sourceStation}:${upperDestination}:${aprsMessage}`;
        }
        
        logger.log(`[APRS Auth] Hash message for outgoing: ${hashMessage}`);
        
        // Compute HMAC-SHA256
        const hmac = crypto.createHmac('sha256', secretKey);
        hmac.update(Buffer.from(hashMessage, 'utf8'));
        const computedToken = hmac.digest('base64').substring(0, 6);
        
        logger.log(`[APRS Auth] Computed outgoing auth code: ${computedToken}`);
        
        return computedToken;
    }
    
    // Function to verify APRS message authentication
    verifyAprsAuthentication(authCode, senderCallsign, aprsMessage, msgId, addressee) {
        logger.log(`[APRS Auth DEBUG] Starting authentication for ${senderCallsign}`);
        logger.log(`[APRS Auth DEBUG] Auth code: ${authCode}`);
        logger.log(`[APRS Auth DEBUG] Message: ${aprsMessage}`);
        logger.log(`[APRS Auth DEBUG] Msg ID: ${msgId}`);
        logger.log(`[APRS Auth DEBUG] Addressee: "${addressee}"`);
        
        // Normalize sender callsign
        let upperSender = senderCallsign.toUpperCase();
        if (!upperSender.includes('-')) {
            upperSender = `${upperSender}-0`;
        }
        logger.log(`[APRS Auth DEBUG] Normalized sender: ${upperSender}`);
        
        // Check if we have authentication info for this station
        const authEntry = this.stationAuthTable.get(upperSender);
        if (!authEntry) {
            return false; // No authentication entry for this station
        }
        logger.log(`[APRS Auth DEBUG] Found auth entry for ${upperSender}`);
        
        // Get the shared secret (password) from config
        // We need to find the original password, not the hash
        let sharedSecret = null;
        if (this.config.AUTH && Array.isArray(this.config.AUTH)) {
            for (const authEntryConfig of this.config.AUTH) {
                const commaIndex = authEntryConfig.indexOf(',');
                if (commaIndex === -1) continue;
                
                let configCallsign = authEntryConfig.substring(0, commaIndex).trim().toUpperCase();
                if (!configCallsign.includes('-')) {
                    configCallsign = `${configCallsign}-0`;
                }
                
                if (configCallsign === upperSender) {
                    sharedSecret = authEntryConfig.substring(commaIndex + 1);
                    break;
                }
            }
        }
        
        if (!sharedSecret) {
            return false; // Could not find shared secret
        }
        logger.log(`[APRS Auth DEBUG] Found shared secret: ${sharedSecret}`);
        
        // Compute SHA256 hash of the shared secret (SecretKey)
        const secretKey = crypto.createHash('sha256').update(sharedSecret, 'utf8').digest();
        logger.log(`[APRS Auth DEBUG] Secret key (hex): ${secretKey.toString('hex')}`);
        
        // Get current time in minutes since January 1, 1970 UTC
        const currentMinutes = Math.floor(Date.now() / (1000 * 60));
        logger.log(`[APRS Auth DEBUG] Current minutes: ${currentMinutes}`);
        
        // Use the addressee from the APRS message and trim to match C# implementation
        const destinationStation = addressee.trim();
        logger.log(`[APRS Auth DEBUG] Destination station (from addressee): "${destinationStation}"`);

        // Try authentication with 4 minute window (current, 3 previous, 1 future)
        const minutesToTry = [
            currentMinutes,     // current minute
            currentMinutes - 1, // 1 minute ago
            currentMinutes - 2, // 2 minutes ago
            currentMinutes - 3, // 3 minutes ago
            currentMinutes + 1  // 1 minute future
        ];
        
        for (const minutesUtc of minutesToTry) {
            // Build hash message according to spec
            let hashMessage;
            if (msgId) {
                // For messages with message ID
                hashMessage = `${minutesUtc}:${upperSender}:${destinationStation}:${aprsMessage}{${msgId}`;
            } else {
                // For messages without message ID (including ACK messages)
                hashMessage = `${minutesUtc}:${upperSender}:${destinationStation}:${aprsMessage}`;
            }
            
            logger.log(`[APRS Auth DEBUG] Hash message for minute ${minutesUtc}: ${hashMessage}`);
            
            const hmac = crypto.createHmac('sha256', secretKey);
            hmac.update(Buffer.from(hashMessage, 'utf8'));
            const computedToken = hmac.digest('base64').substring(0, 6);
            
            logger.log(`[APRS Auth DEBUG] Computed token for minute ${minutesUtc}: ${computedToken}`);
            
            // Compare with provided auth code
            if (computedToken === authCode) {
                logger.log(`[APRS Auth] Authentication successful for ${senderCallsign} using minute ${minutesUtc}`);
                return true;
            }
        }
        
        logger.log(`[APRS Auth] Authentication failed for ${senderCallsign} - no matching token found`);
        return false;
    }
    
    // Generate a unique sequence ID for outgoing messages
    generateAprsSequenceId() {
        return Math.floor(Math.random() * 1000).toString().padStart(3, '0');
    }
    
    // Store sent APRS message with direction tracking
    storeSentAprsMessage(destinationCallsign, messageText) {
        if (!this.aprsMessageStorage) {
            return false;
        }
        
        try {
            const now = new Date();
            const timestamp = now.toISOString();
            const localTime = now.toLocaleString('en-US', {
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
                hour12: false
            });
            
            const sourceCallsign = `${this.config.CALLSIGN}-${this.config.STATIONID}`;
            
            const messageRecord = {
                source: sourceCallsign,
                destination: destinationCallsign,
                message: messageText,
                dataType: 'Message',
                direction: 'sent', // Mark as sent message
                timestamp: timestamp,
                localTime: localTime,
                position: null,
                weather: null
            };
            
            const storageKey = `aprs-msg-${now.getTime()}`;
            
            // Queue for throttled write (at most once per minute for Raspberry Pi/MicroSD protection)
            this._queueThrottledWrite(storageKey, messageRecord);
            
            logger.log(`[APRS Storage] Queued sent message to ${destinationCallsign}: "${messageText}"`);
            
            // Emit event for real-time WebSocket broadcast
            this.emit('aprsMessageReceived', {
                source: sourceCallsign,
                destination: destinationCallsign,
                message: messageText,
                dataType: 'Message',
                direction: 'sent',
                timestamp: timestamp,
                localTime: localTime,
                position: null,
                weather: null
            });
            
            return true;
        } catch (error) {
            logger.error('[APRS Storage] Error storing sent message:', error);
            return false;
        }
    }
    
    // Generic method to send APRS messages with retry logic
    sendMessage(destinationCallsign, messageText, requiresAuth = null) {
        // Auto-detect authentication requirement if not specified
        if (requiresAuth === null) {
            requiresAuth = this.requiresAuthentication(destinationCallsign);
        }
        
        const seqId = this.generateAprsSequenceId();
        const paddedDestination = destinationCallsign.padEnd(9, ' '); // APRS addressee field must be 9 chars
        
        // Create base APRS message format: :DEST     :messageText{SEQID}
        let aprsMessage = `:${paddedDestination}:${messageText}{${seqId}`;
        
        // Add authentication if required
        if (requiresAuth) {
            const authCode = this.computeAprsAuthenticationCode(destinationCallsign, messageText, seqId);
            if (authCode) {
                aprsMessage = `:${paddedDestination}:${messageText}}${authCode}{${seqId}`;
                logger.log(`[APRS Send] Adding authentication to outgoing message: ${authCode}`);
            } else {
                logger.error(`[APRS Send] Failed to compute authentication code for ${destinationCallsign}`);
                return false; // Cannot send authenticated message without auth code
            }
        }
        
        logger.log(`[APRS Send] Sending message to ${destinationCallsign}: "${messageText}" (Seq: ${seqId}, Auth: ${requiresAuth})`);
        
        // Send the message immediately
        const success = this.sendAprsPacket(aprsMessage);
        if (!success) {
            logger.error(`[APRS Send] Failed to send initial message to ${destinationCallsign}`);
            return false;
        }
        
        // Store sent message in database
        this.storeSentAprsMessage(destinationCallsign, messageText);
        
        // Add to outgoing queue for ACK tracking
        const queueKey = `${destinationCallsign.toUpperCase()}:${seqId}`;
        const queueEntry = {
            destinationCallsign: destinationCallsign,
            messageText: messageText,
            seqId: seqId,
            aprsMessage: aprsMessage,
            requiresAuth: requiresAuth,
            attempts: 1,
            sentTime: new Date(),
            timer: null
        };
        
        this.aprsOutgoingQueue.set(queueKey, queueEntry);
        
        // Set up retry timer
        queueEntry.timer = setTimeout(() => {
            this.retryAprsMessage(queueKey);
        }, this.RETRY_INTERVAL_MS);
        
        logger.log(`[APRS Send] Message queued for ACK tracking: ${queueKey}`);
        return true;
    }
    
    // Retry sending an APRS message
    retryAprsMessage(queueKey) {
        const queueEntry = this.aprsOutgoingQueue.get(queueKey);
        if (!queueEntry) {
            logger.log(`[APRS Send] Queue entry ${queueKey} not found for retry`);
            return;
        }
        
        if (queueEntry.attempts >= this.MAX_RETRIES) {
            logger.log(`[APRS Send] Max retries (${this.MAX_RETRIES}) reached for message to ${queueEntry.destinationCallsign}, giving up`);
            this.aprsOutgoingQueue.delete(queueKey);
            return;
        }
        
        queueEntry.attempts++;
        queueEntry.sentTime = new Date();
        
        logger.log(`[APRS Send] Retrying message to ${queueEntry.destinationCallsign} (attempt ${queueEntry.attempts}/${this.MAX_RETRIES})`);
        
        // Send the message again
        const success = this.sendAprsPacket(queueEntry.aprsMessage);
        if (!success) {
            logger.error(`[APRS Send] Failed to send retry ${queueEntry.attempts} to ${queueEntry.destinationCallsign}`);
        }
        
        // Set up next retry timer if not at max attempts
        if (queueEntry.attempts < this.MAX_RETRIES) {
            queueEntry.timer = setTimeout(() => {
                this.retryAprsMessage(queueKey);
            }, this.RETRY_INTERVAL_MS);
        } else {
            // This was the last attempt, queue entry will be cleaned up above
            queueEntry.timer = null;
        }
    }
    
    // Handle received ACK messages
    handleReceivedAck(senderCallsign, ackSeqId, authCode, msgText) {
        const queueKey = `${senderCallsign.toUpperCase()}:${ackSeqId}`;
        const queueEntry = this.aprsOutgoingQueue.get(queueKey);
        
        if (!queueEntry) {
            logger.log(`[APRS ACK] Received ACK from ${senderCallsign} for sequence ${ackSeqId}, but no pending message found`);
            return;
        }
        
        // Check authentication if original message required auth
        if (queueEntry.requiresAuth) {
            if (!authCode) {
                logger.log(`[APRS ACK] ACK from ${senderCallsign} missing required authentication, ignoring`);
                return;
            }
            
            // Verify ACK authentication using the actual received message text
            const isValidAuth = this.verifyAprsAuthentication(
                authCode,
                senderCallsign,
                msgText, // Use actual message text from parsed packet
                null, // ACK messages don't have message ID
                `${this.config.CALLSIGN}-${this.config.STATIONID}` // ACK is addressed to us
            );
            
            if (!isValidAuth) {
                logger.log(`[APRS ACK] ACK from ${senderCallsign} has invalid authentication, ignoring`);
                return;
            }
            
            logger.log(`[APRS ACK] Authenticated ACK received from ${senderCallsign} for sequence ${ackSeqId}`);
        } else {
            logger.log(`[APRS ACK] ACK received from ${senderCallsign} for sequence ${ackSeqId}`);
        }
        
        // Clear retry timer and remove from queue
        if (queueEntry.timer) {
            clearTimeout(queueEntry.timer);
        }
        
        this.aprsOutgoingQueue.delete(queueKey);
        logger.log(`[APRS ACK] Message to ${senderCallsign} successfully acknowledged, removed from queue`);
    }
    
    // Helper function to send APRS packet
    sendAprsPacket(aprsMessage) {
        // Find the APRS channel packet template from recent traffic
        // This is a simplified approach - in practice you'd want to store channel info
        logger.log(`[APRS Send] Transmitting: "${aprsMessage}"`);
        
        // For now, we'll use a basic approach to send the packet
        // In a real implementation, you'd create proper AX.25 packet with addresses
        if (typeof this.radio.sendTncFrame !== 'function') {
            logger.warn('[APRS Send] radio.sendTncFrame not implemented - cannot send message');
            return false;
        }
        
        try {
            // Create a basic AX.25 packet for APRS transmission
            // This assumes we have an APRS channel configured (channel_id would need to be determined)
            const AX25PacketClass = require('./AX25Packet');
            const AX25Address = require('./AX25Address');
            
            // Create addresses array: [destination, source]
            // For APRS, destination is typically "APRS" or similar
            const addresses = [
                new AX25Address('APRS', 0),
                new AX25Address(this.config.CALLSIGN, this.config.STATIONID)
            ];
            
            const packet = new AX25PacketClass(
                addresses,
                0, // nr
                0, // ns
                false, // pollFinal
                true, // command
                3, // UI frame type
                Buffer.from(aprsMessage, 'utf8')
            );
            
            packet.pid = 0xF0; // APRS protocol ID
            packet.channel_id = 1; // Assume APRS is on channel 1 - this should be configurable
            packet.channel_name = 'APRS';
            
            const serialized = packet.toByteArray();
            if (!serialized) {
                logger.error('[APRS Send] Packet serialization failed');
                return false;
            }
            
            this.radio.sendTncFrame({
                channel_id: packet.channel_id,
                data: serialized
            });
            
            return true;
        } catch (error) {
            logger.error(`[APRS Send] Error sending packet: ${error.message}`);
            return false;
        }
    }
    
    // Main APRS packet processing function
    processAprsPacket(packet) {
        logger.log('[APRS] APRS packet detected, attempting to decode...');
        
        try {
            // Create APRS input object from AX.25 packet
            const aprsInput = {
                dataStr: packet.dataStr,
                addresses: packet.addresses
            };
            
            const aprsPacket = AprsPacket.parse(aprsInput);
            
            if (aprsPacket) {
                // Perform duplicate detection once for all APRS message processing
                let isDuplicateMessage = false;
                let senderCallsign = '';
                let messageSeqId = null;
                
                if (aprsPacket.dataType === 'Message' && aprsPacket.messageData) {
                    const senderAddress = packet.addresses.length > 1 ? packet.addresses[1] : packet.addresses[0];
                    senderCallsign = senderAddress.address + (senderAddress.SSID > 0 ? `-${senderAddress.SSID}` : '');
                    messageSeqId = aprsPacket.messageData.seqId;
                    
                    // Check for duplicate message
                    isDuplicateMessage = messageSeqId && this.isAprsMessageDuplicate(senderCallsign, messageSeqId);
                    
                    if (!isDuplicateMessage && messageSeqId) {
                        // Add to cache if we have a sequence ID and it's not a duplicate
                        this.addToAprsCache(senderCallsign, messageSeqId, aprsPacket.messageData.msgText || '');
                    }
                }

                // Add to in-memory frame history and dispatch AprsFrame event via DataBroker
                this._addToFrameHistory(aprsPacket, packet, null);
                
                // Store ALL APRS messages for BBS retrieval (regardless of type)
                this.storeAllAprsData(aprsPacket, packet);
                
                // Publish APRS messages to Home Assistant sensor (exclude ACK messages)
                if (aprsPacket.dataType === 'Message' && aprsPacket.messageData && this.mqttReporter && this.config.MQTT_TOPIC) {
                    const messageText = aprsPacket.messageData.msgText || '';
                    
                    // Filter out ACK messages from being published to Home Assistant sensors
                    const isAckMessage = aprsPacket.messageData.msgType === 'Ack' || 
                                       (aprsPacket.messageData.msgType === 'Message' && messageText.match(/^ack\d+$/));
                    
                    if (!isDuplicateMessage && !isAckMessage) {
                        // Check if message is addressed to our station
                        const addressee = aprsPacket.messageData.addressee.trim().toUpperCase();
                        const ourCallsign = this.config.CALLSIGN.toUpperCase();
                        const isForUs = addressee === ourCallsign || 
                                       addressee === `${ourCallsign}-${this.config.STATIONID}`;
                        
                        // Format message based on whether it's for us or not
                        let formattedMessage;
                        if (isForUs) {
                            // For messages to our station: "SENDER > message"
                            formattedMessage = `${senderCallsign} > ${messageText}`;
                        } else {
                            // For messages to other stations: "SOURCE > DESTINATION : message"
                            formattedMessage = `${senderCallsign} > ${addressee} : ${messageText}`;
                        }
                        
                        // Check authentication for MQTT publishing if authCode is present
                        let authStatus = 'NONE';
                        if (aprsPacket.messageData.authCode) {
                            const isAuthenticated = this.verifyAprsAuthentication(
                                aprsPacket.messageData.authCode,
                                senderCallsign,
                                aprsPacket.messageData.msgText,
                                messageSeqId,
                                aprsPacket.messageData.addressee
                            );
                            authStatus = isAuthenticated ? 'SUCCESS' : 'FAILED';
                        } else if (this.requiresAuthentication(senderCallsign)) {
                            authStatus = 'REQUIRED_BUT_MISSING';
                        }

                        // Choose the appropriate topic based on whether message is for us and authentication status
                        let aprsMessageTopic;
                        let sensorType;
                        
                        if (isForUs) {
                            // Message is for our station - check if it's authenticated
                            if (authStatus === 'SUCCESS') {
                                // Successfully authenticated message for our station -> Trusted sensor
                                aprsMessageTopic = `${this.config.MQTT_TOPIC}/aprs_message_trusted`;
                                sensorType = "My Trusted APRS Message";
                            } else {
                                // Non-authenticated or failed authentication for our station -> Regular sensor
                                aprsMessageTopic = `${this.config.MQTT_TOPIC}/aprs_message`;
                                sensorType = "My APRS Message";
                            }
                        } else {
                            // Message for other stations -> Other sensor
                            aprsMessageTopic = `${this.config.MQTT_TOPIC}/aprs_message_other`;
                            sensorType = "APRS Message";
                        }

                        const messageData = {
                            message: formattedMessage,
                            sender: senderCallsign,
                            addressee: addressee,
                            text: messageText,
                            authStatus: authStatus,
                            timestamp: new Date().toISOString()
                        };
                        
                        this.mqttReporter.publishStatus(aprsMessageTopic, messageData);
                        logger.log(`[MQTT] Published to ${sensorType} sensor: "${formattedMessage}"`);
                        
                        // Note: All APRS messages are already stored by storeAllAprsData() above
                        // No need to store again here to avoid duplicates
                    } else if (isDuplicateMessage) {
                        logger.log(`[APRS] Duplicate message detected from ${senderCallsign} with sequence ${messageSeqId} - skipping MQTT publish`);
                    } else if (isAckMessage) {
                        logger.log(`[APRS] ACK message detected from ${senderCallsign} - skipping MQTT publish`);
                    }
                }
                
                // Check if this is a message intended for our station
                if (aprsPacket.dataType === 'Message' && aprsPacket.messageData) {
                    const addressee = aprsPacket.messageData.addressee.trim().toUpperCase();
                    const ourCallsign = this.config.CALLSIGN.toUpperCase();
                    
                    // Check if message is addressed to us (with or without SSID)
                    const isForUs = addressee === ourCallsign || 
                                   addressee === `${ourCallsign}-${this.config.STATIONID}`;
                    
                    if (isForUs && aprsPacket.messageData.msgType === 'Message' && aprsPacket.messageData.seqId) {
                        const seqId = aprsPacket.messageData.seqId;
                        
                        // Check authentication if authCode is present
                        let authenticationResult = null;
                        if (aprsPacket.messageData.authCode) {
                            const isAuthenticated = this.verifyAprsAuthentication(
                                aprsPacket.messageData.authCode,
                                senderCallsign,
                                aprsPacket.messageData.msgText,
                                seqId,
                                aprsPacket.messageData.addressee
                            );
                            authenticationResult = isAuthenticated ? 'SUCCESS' : 'FAILED';
                            logger.log(`[APRS Auth] Authentication ${authenticationResult} for message from ${senderCallsign} with auth code ${aprsPacket.messageData.authCode}`);
                            
                            // If authentication failed, stop processing this message
                            if (authenticationResult === 'FAILED') {
                                logger.log(`[APRS] Ignoring message from ${senderCallsign} due to authentication failure`);
                                return; // Stop processing this message
                            }
                        } else if (this.requiresAuthentication(senderCallsign)) {
                            authenticationResult = 'REQUIRED_BUT_MISSING';
                            logger.log(`[APRS Auth] Authentication REQUIRED but MISSING for message from ${senderCallsign}`);
                        }
                        
                        if (isDuplicateMessage) {
                            logger.log(`[APRS] Duplicate message from ${senderCallsign} sequence ${seqId} - sending ACK but not processing further`);
                        } else {
                            const authMsg = authenticationResult ? ` (Auth: ${authenticationResult})` : '';
                            logger.log(`[APRS] Message addressed to our station! Sending ACK for sequence ${seqId}${authMsg}`);
                            
                            // Check if this is an ECHO message (only process for non-duplicates)
                            if (aprsPacket.messageData.msgText.startsWith('ECHO:')) {
                                const echoText = aprsPacket.messageData.msgText.substring(5); // Remove "ECHO:" prefix
                                logger.log(`[APRS] ECHO request from ${senderCallsign}: "${echoText}"`);
                                
                                // Use sendMessage for ECHO reply with authentication based on original message
                                const requiresAuth = (authenticationResult === 'SUCCESS');
                                const success = this.sendMessage(senderCallsign, echoText, requiresAuth);
                                
                                if (success) {
                                    logger.log(`[APRS] Sent ECHO reply to ${senderCallsign}: "${echoText}" (Auth: ${requiresAuth})`);
                                } else {
                                    logger.error(`[APRS] Failed to send ECHO reply to ${senderCallsign}`);
                                }
                            }
                        }
                        
                        // Always send ACK, even for duplicates (in case original ACK was lost)
                        // Create APRS ACK message format: :SENDER   :ack{SEQID}
                        const paddedSender = senderCallsign.padEnd(9, ' '); // APRS addressee field must be 9 chars
                        let ackMessage = `:${paddedSender}:ack${seqId}`;
                        
                        // Add authentication to ACK if original message was authenticated successfully
                        if (authenticationResult === 'SUCCESS') {
                            const authCode = this.computeAprsAuthenticationCode(senderCallsign, `ack${seqId}`, null);
                            if (authCode) {
                                ackMessage = `:${paddedSender}:ack${seqId}}${authCode}`;
                                logger.log(`[APRS] Adding authentication to ACK: ${authCode}`);
                            }
                        }
                        
                        logger.log(`[APRS] Sending ACK: "${ackMessage}"`);
                        
                        // Create reply packet with same addresses but set our callsign in position 1
                        if (packet.addresses.length > 1) {
                            const replyAddresses = [...packet.addresses];
                            // Set our callsign and station ID in the second address position
                            replyAddresses[1].address = this.config.CALLSIGN;
                            replyAddresses[1].SSID = this.config.STATIONID;
                            
                            // Create reply packet with APRS ACK payload
                            const AX25PacketClass = require('./AX25Packet');
                            const ackPacket = new AX25PacketClass(
                                replyAddresses, 
                                packet.nr, 
                                packet.ns, 
                                packet.pollFinal, 
                                packet.command, 
                                packet.type, 
                                Buffer.from(ackMessage, 'utf8')
                            );
                            ackPacket.pid = packet.pid;
                            ackPacket.channel_id = packet.channel_id;
                            ackPacket.channel_name = packet.channel_name;
                            
                            // Serialize and send the ACK packet
                            const serialized = ackPacket.ToByteArray ? ackPacket.ToByteArray() : (ackPacket.toByteArray ? ackPacket.toByteArray() : null);
                            if (!serialized) {
                                logger.warn('[APRS] ACK packet serialization failed:', ackPacket);
                            } else if (typeof this.radio.sendTncFrame !== 'function') {
                                logger.warn('[APRS] radio.sendTncFrame not implemented - cannot send ACK');
                            } else {
                                this.radio.sendTncFrame({
                                    channel_id: ackPacket.channel_id,
                                    data: serialized
                                });
                                logger.log(`[APRS] Sent ACK for message sequence ${aprsPacket.messageData.seqId} to ${senderCallsign}`);
                            }
                        }
                    } else if (isForUs && aprsPacket.messageData.msgType === 'Ack') {
                        // This is an ACK message
                        const ackSeqId = aprsPacket.messageData.seqId;
                        const senderAddress = packet.addresses.length > 1 ? packet.addresses[1] : packet.addresses[0];
                        const senderCallsign = senderAddress.address + (senderAddress.SSID > 0 ? `-${senderAddress.SSID}` : '');
                        
                        logger.log(`[APRS ACK] Received ACK from ${senderCallsign} for sequence ${ackSeqId}`);
                        
                        // Handle the ACK (this will check authentication if required)
                        this.handleReceivedAck(senderCallsign, ackSeqId, aprsPacket.messageData.authCode, aprsPacket.messageData.msgText);
                    } else if (isForUs && aprsPacket.messageData.msgType === 'Message') {
                        // Check if this is an ACK message (fallback for incorrectly parsed ACKs)
                        const messageText = aprsPacket.messageData.msgText || '';
                        const ackMatch = messageText.match(/^ack(\d+)$/);
                        
                        if (ackMatch) {
                            const ackSeqId = ackMatch[1];
                            const senderAddress = packet.addresses.length > 1 ? packet.addresses[1] : packet.addresses[0];
                            const senderCallsign = senderAddress.address + (senderAddress.SSID > 0 ? `-${senderAddress.SSID}` : '');
                            
                            logger.log(`[APRS ACK] Received ACK from ${senderCallsign} for sequence ${ackSeqId} (fallback detection)`);
                            
                            // Handle the ACK (this will check authentication if required)
                            this.handleReceivedAck(senderCallsign, ackSeqId, aprsPacket.messageData.authCode, aprsPacket.messageData.msgText);
                        } else {
                            logger.log('[APRS] Message addressed to our station (no sequence ID or not a regular message)');
                        }
                    } else if (isForUs) {
                        logger.log('[APRS] Message addressed to our station (no sequence ID or not a regular message)');
                    }
                }
                
                // Log any parse errors if present
                if (aprsPacket.parseErrors && aprsPacket.parseErrors.length > 0) {
                    logger.log('[APRS] Parse warnings:');
                    aprsPacket.parseErrors.forEach(err => {
                        logger.log(`  ${err.error}`);
                    });
                }
            } else {
                logger.log('[APRS] ERROR: Failed to parse APRS packet from channel APRS');
            }
        } catch (error) {
            logger.log(`[APRS] ERROR: Exception while parsing APRS packet: ${error.message}`);
        }
    }
}

module.exports = AprsHandler;
