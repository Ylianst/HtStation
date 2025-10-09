'use strict';

const crypto = require('crypto');
const { AprsPacket } = require('../aprs/index.js');
const Storage = require('./storage');

class AprsHandler {
    constructor(config, radio, mqttReporter) {
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
            console.log('[APRS] APRS message storage initialized');
        } catch (error) {
            console.error('[APRS] Failed to initialize APRS message storage:', error);
            this.aprsMessageStorage = null;
        }
    }
    
    // Initialize station authentication table from config
    initializeAuthTable() {
        if (this.config.AUTH && Array.isArray(this.config.AUTH)) {
            console.log('[APRS] Loading station authentication entries...');
            
            for (const authEntry of this.config.AUTH) {
                // Parse AUTH entry format: "CALLSIGN-SSID,password"
                const commaIndex = authEntry.indexOf(',');
                if (commaIndex === -1) {
                    console.warn(`[APRS] Invalid AUTH entry format (missing comma): ${authEntry}`);
                    continue;
                }
                
                let stationCallsign = authEntry.substring(0, commaIndex).trim().toUpperCase();
                const stationPassword = authEntry.substring(commaIndex + 1);
                
                if (!stationCallsign || !stationPassword) {
                    console.warn(`[APRS] Invalid AUTH entry (empty callsign or password): ${authEntry}`);
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
                
                console.log(`[APRS] Added authentication entry for station: ${stationCallsign}`);
            }
            
            console.log(`[APRS] Station authentication table loaded with ${this.stationAuthTable.size} entries`);
        } else {
            console.log('[APRS] No AUTH entries found in configuration');
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
            
            // Extract information based on APRS data type
            switch (aprsPacket.dataType) {
                case 'Message':
                    if (aprsPacket.messageData) {
                        destinationCallsign = aprsPacket.messageData.addressee || '';
                        messageText = aprsPacket.messageData.msgText || '';
                    }
                    break;
                case 'Position':
                    destinationCallsign = 'APRS-POSITION';
                    if (aprsPacket.position) {
                        messageText = `Lat: ${aprsPacket.position.latitude}, Lon: ${aprsPacket.position.longitude}`;
                        if (aprsPacket.comment) {
                            messageText += ` - ${aprsPacket.comment}`;
                        }
                    }
                    break;
                case 'Weather':
                    destinationCallsign = 'APRS-WEATHER';
                    if (aprsPacket.weather) {
                        const weather = aprsPacket.weather;
                        messageText = `Temp: ${weather.temperature || 'N/A'}°F, Wind: ${weather.windSpeed || 'N/A'}mph @ ${weather.windDirection || 'N/A'}°`;
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
            
            const messageRecord = {
                source: sourceCallsign,
                destination: destinationCallsign,
                message: messageText,
                dataType: aprsPacket.dataType,
                timestamp: timestamp,
                localTime: localTime
            };
            
            // Use timestamp as key for natural sorting (newest first when sorted in reverse)
            const storageKey = `aprs-msg-${now.getTime()}`;
            
            if (this.aprsMessageStorage.save(storageKey, messageRecord)) {
                console.log(`[APRS Storage] Stored ${aprsPacket.dataType} from ${sourceCallsign} > ${destinationCallsign}: "${messageText}"`);
                
                // Maintain message limit
                this.cleanupOldAprsMessages();
                return true;
            } else {
                console.error(`[APRS Storage] Failed to store ${aprsPacket.dataType} from ${sourceCallsign}`);
                return false;
            }
        } catch (error) {
            console.error('[APRS Storage] Error storing APRS data:', error);
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
                console.log(`[APRS Storage] Stored message ${sourceCallsign} > ${destinationCallsign}: "${messageText}"`);
                
                // Maintain message limit
                this.cleanupOldAprsMessages();
                return true;
            } else {
                console.error(`[APRS Storage] Failed to store message from ${sourceCallsign}`);
                return false;
            }
        } catch (error) {
            console.error('[APRS Storage] Error storing message:', error);
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
                
                console.log(`[APRS Storage] Cleaned up ${keysToDelete.length} old APRS message records`);
            }
        } catch (error) {
            console.error('[APRS Storage] Error cleaning up old messages:', error);
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
        console.log(`[APRS Auth] Computing auth code for outgoing message to ${destinationCallsign}`);
        
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
            console.log(`[APRS Auth] No shared secret found for ${upperDestination} - cannot compute auth code`);
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
        
        console.log(`[APRS Auth] Hash message for outgoing: ${hashMessage}`);
        
        // Compute HMAC-SHA256
        const hmac = crypto.createHmac('sha256', secretKey);
        hmac.update(Buffer.from(hashMessage, 'utf8'));
        const computedToken = hmac.digest('base64').substring(0, 6);
        
        console.log(`[APRS Auth] Computed outgoing auth code: ${computedToken}`);
        
        return computedToken;
    }
    
    // Function to verify APRS message authentication
    verifyAprsAuthentication(authCode, senderCallsign, aprsMessage, msgId, addressee) {
        console.log(`[APRS Auth DEBUG] Starting authentication for ${senderCallsign}`);
        console.log(`[APRS Auth DEBUG] Auth code: ${authCode}`);
        console.log(`[APRS Auth DEBUG] Message: ${aprsMessage}`);
        console.log(`[APRS Auth DEBUG] Msg ID: ${msgId}`);
        console.log(`[APRS Auth DEBUG] Addressee: "${addressee}"`);
        
        // Normalize sender callsign
        let upperSender = senderCallsign.toUpperCase();
        if (!upperSender.includes('-')) {
            upperSender = `${upperSender}-0`;
        }
        console.log(`[APRS Auth DEBUG] Normalized sender: ${upperSender}`);
        
        // Check if we have authentication info for this station
        const authEntry = this.stationAuthTable.get(upperSender);
        if (!authEntry) {
            return false; // No authentication entry for this station
        }
        console.log(`[APRS Auth DEBUG] Found auth entry for ${upperSender}`);
        
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
        console.log(`[APRS Auth DEBUG] Found shared secret: ${sharedSecret}`);
        
        // Compute SHA256 hash of the shared secret (SecretKey)
        const secretKey = crypto.createHash('sha256').update(sharedSecret, 'utf8').digest();
        console.log(`[APRS Auth DEBUG] Secret key (hex): ${secretKey.toString('hex')}`);
        
        // Get current time in minutes since January 1, 1970 UTC
        const currentMinutes = Math.floor(Date.now() / (1000 * 60));
        console.log(`[APRS Auth DEBUG] Current minutes: ${currentMinutes}`);
        
        // Use the addressee from the APRS message and trim to match C# implementation
        const destinationStation = addressee.trim();
        console.log(`[APRS Auth DEBUG] Destination station (from addressee): "${destinationStation}"`);

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
            
            console.log(`[APRS Auth DEBUG] Hash message for minute ${minutesUtc}: ${hashMessage}`);
            
            const hmac = crypto.createHmac('sha256', secretKey);
            hmac.update(Buffer.from(hashMessage, 'utf8'));
            const computedToken = hmac.digest('base64').substring(0, 6);
            
            console.log(`[APRS Auth DEBUG] Computed token for minute ${minutesUtc}: ${computedToken}`);
            
            // Compare with provided auth code
            if (computedToken === authCode) {
                console.log(`[APRS Auth] Authentication successful for ${senderCallsign} using minute ${minutesUtc}`);
                return true;
            }
        }
        
        console.log(`[APRS Auth] Authentication failed for ${senderCallsign} - no matching token found`);
        return false;
    }
    
    // Generate a unique sequence ID for outgoing messages
    generateAprsSequenceId() {
        return Math.floor(Math.random() * 1000).toString().padStart(3, '0');
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
                console.log(`[APRS Send] Adding authentication to outgoing message: ${authCode}`);
            } else {
                console.error(`[APRS Send] Failed to compute authentication code for ${destinationCallsign}`);
                return false; // Cannot send authenticated message without auth code
            }
        }
        
        console.log(`[APRS Send] Sending message to ${destinationCallsign}: "${messageText}" (Seq: ${seqId}, Auth: ${requiresAuth})`);
        
        // Send the message immediately
        const success = this.sendAprsPacket(aprsMessage);
        if (!success) {
            console.error(`[APRS Send] Failed to send initial message to ${destinationCallsign}`);
            return false;
        }
        
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
        
        console.log(`[APRS Send] Message queued for ACK tracking: ${queueKey}`);
        return true;
    }
    
    // Retry sending an APRS message
    retryAprsMessage(queueKey) {
        const queueEntry = this.aprsOutgoingQueue.get(queueKey);
        if (!queueEntry) {
            console.log(`[APRS Send] Queue entry ${queueKey} not found for retry`);
            return;
        }
        
        if (queueEntry.attempts >= this.MAX_RETRIES) {
            console.log(`[APRS Send] Max retries (${this.MAX_RETRIES}) reached for message to ${queueEntry.destinationCallsign}, giving up`);
            this.aprsOutgoingQueue.delete(queueKey);
            return;
        }
        
        queueEntry.attempts++;
        queueEntry.sentTime = new Date();
        
        console.log(`[APRS Send] Retrying message to ${queueEntry.destinationCallsign} (attempt ${queueEntry.attempts}/${this.MAX_RETRIES})`);
        
        // Send the message again
        const success = this.sendAprsPacket(queueEntry.aprsMessage);
        if (!success) {
            console.error(`[APRS Send] Failed to send retry ${queueEntry.attempts} to ${queueEntry.destinationCallsign}`);
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
            console.log(`[APRS ACK] Received ACK from ${senderCallsign} for sequence ${ackSeqId}, but no pending message found`);
            return;
        }
        
        // Check authentication if original message required auth
        if (queueEntry.requiresAuth) {
            if (!authCode) {
                console.log(`[APRS ACK] ACK from ${senderCallsign} missing required authentication, ignoring`);
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
                console.log(`[APRS ACK] ACK from ${senderCallsign} has invalid authentication, ignoring`);
                return;
            }
            
            console.log(`[APRS ACK] Authenticated ACK received from ${senderCallsign} for sequence ${ackSeqId}`);
        } else {
            console.log(`[APRS ACK] ACK received from ${senderCallsign} for sequence ${ackSeqId}`);
        }
        
        // Clear retry timer and remove from queue
        if (queueEntry.timer) {
            clearTimeout(queueEntry.timer);
        }
        
        this.aprsOutgoingQueue.delete(queueKey);
        console.log(`[APRS ACK] Message to ${senderCallsign} successfully acknowledged, removed from queue`);
    }
    
    // Helper function to send APRS packet
    sendAprsPacket(aprsMessage) {
        // Find the APRS channel packet template from recent traffic
        // This is a simplified approach - in practice you'd want to store channel info
        console.log(`[APRS Send] Transmitting: "${aprsMessage}"`);
        
        // For now, we'll use a basic approach to send the packet
        // In a real implementation, you'd create proper AX.25 packet with addresses
        if (typeof this.radio.sendTncFrame !== 'function') {
            console.warn('[APRS Send] radio.sendTncFrame not implemented - cannot send message');
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
                console.error('[APRS Send] Packet serialization failed');
                return false;
            }
            
            this.radio.sendTncFrame({
                channel_id: packet.channel_id,
                data: serialized
            });
            
            return true;
        } catch (error) {
            console.error(`[APRS Send] Error sending packet: ${error.message}`);
            return false;
        }
    }
    
    // Main APRS packet processing function
    processAprsPacket(packet) {
        console.log('[APRS] APRS packet detected, attempting to decode...');
        
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
                        console.log(`[MQTT] Published to ${sensorType} sensor: "${formattedMessage}"`);
                        
                        // Store APRS messages that are NOT for our station (for BBS retrieval)
                        if (!isForUs) {
                            this.storeAprsMessage(senderCallsign, addressee, messageText);
                        }
                    } else if (isDuplicateMessage) {
                        console.log(`[APRS] Duplicate message detected from ${senderCallsign} with sequence ${messageSeqId} - skipping MQTT publish`);
                    } else if (isAckMessage) {
                        console.log(`[APRS] ACK message detected from ${senderCallsign} - skipping MQTT publish`);
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
                            console.log(`[APRS Auth] Authentication ${authenticationResult} for message from ${senderCallsign} with auth code ${aprsPacket.messageData.authCode}`);
                            
                            // If authentication failed, stop processing this message
                            if (authenticationResult === 'FAILED') {
                                console.log(`[APRS] Ignoring message from ${senderCallsign} due to authentication failure`);
                                return; // Stop processing this message
                            }
                        } else if (this.requiresAuthentication(senderCallsign)) {
                            authenticationResult = 'REQUIRED_BUT_MISSING';
                            console.log(`[APRS Auth] Authentication REQUIRED but MISSING for message from ${senderCallsign}`);
                        }
                        
                        if (isDuplicateMessage) {
                            console.log(`[APRS] Duplicate message from ${senderCallsign} sequence ${seqId} - sending ACK but not processing further`);
                        } else {
                            const authMsg = authenticationResult ? ` (Auth: ${authenticationResult})` : '';
                            console.log(`[APRS] Message addressed to our station! Sending ACK for sequence ${seqId}${authMsg}`);
                            
                            // Check if this is an ECHO message (only process for non-duplicates)
                            if (aprsPacket.messageData.msgText.startsWith('ECHO:')) {
                                const echoText = aprsPacket.messageData.msgText.substring(5); // Remove "ECHO:" prefix
                                console.log(`[APRS] ECHO request from ${senderCallsign}: "${echoText}"`);
                                
                                // Use sendMessage for ECHO reply with authentication based on original message
                                const requiresAuth = (authenticationResult === 'SUCCESS');
                                const success = this.sendMessage(senderCallsign, echoText, requiresAuth);
                                
                                if (success) {
                                    console.log(`[APRS] Sent ECHO reply to ${senderCallsign}: "${echoText}" (Auth: ${requiresAuth})`);
                                } else {
                                    console.error(`[APRS] Failed to send ECHO reply to ${senderCallsign}`);
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
                                console.log(`[APRS] Adding authentication to ACK: ${authCode}`);
                            }
                        }
                        
                        console.log(`[APRS] Sending ACK: "${ackMessage}"`);
                        
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
                                console.warn('[APRS] ACK packet serialization failed:', ackPacket);
                            } else if (typeof this.radio.sendTncFrame !== 'function') {
                                console.warn('[APRS] radio.sendTncFrame not implemented - cannot send ACK');
                            } else {
                                this.radio.sendTncFrame({
                                    channel_id: ackPacket.channel_id,
                                    data: serialized
                                });
                                console.log(`[APRS] Sent ACK for message sequence ${aprsPacket.messageData.seqId} to ${senderCallsign}`);
                            }
                        }
                    } else if (isForUs && aprsPacket.messageData.msgType === 'Ack') {
                        // This is an ACK message
                        const ackSeqId = aprsPacket.messageData.seqId;
                        const senderAddress = packet.addresses.length > 1 ? packet.addresses[1] : packet.addresses[0];
                        const senderCallsign = senderAddress.address + (senderAddress.SSID > 0 ? `-${senderAddress.SSID}` : '');
                        
                        console.log(`[APRS ACK] Received ACK from ${senderCallsign} for sequence ${ackSeqId}`);
                        
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
                            
                            console.log(`[APRS ACK] Received ACK from ${senderCallsign} for sequence ${ackSeqId} (fallback detection)`);
                            
                            // Handle the ACK (this will check authentication if required)
                            this.handleReceivedAck(senderCallsign, ackSeqId, aprsPacket.messageData.authCode, aprsPacket.messageData.msgText);
                        } else {
                            console.log('[APRS] Message addressed to our station (no sequence ID or not a regular message)');
                        }
                    } else if (isForUs) {
                        console.log('[APRS] Message addressed to our station (no sequence ID or not a regular message)');
                    }
                }
                
                // Log any parse errors if present
                if (aprsPacket.parseErrors && aprsPacket.parseErrors.length > 0) {
                    console.log('[APRS] Parse warnings:');
                    aprsPacket.parseErrors.forEach(err => {
                        console.log(`  ${err.error}`);
                    });
                }
            } else {
                console.log('[APRS] ERROR: Failed to parse APRS packet from channel APRS');
            }
        } catch (error) {
            console.log(`[APRS] ERROR: Exception while parsing APRS packet: ${error.message}`);
        }
    }
}

module.exports = AprsHandler;
