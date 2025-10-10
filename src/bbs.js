'use strict';

const EventEmitter = require('events');
const AX25Session = require('./AX25Session');
const AX25Packet = require('./AX25Packet');
const Storage = require('./storage');
const os = require('os');

// Game modules
const GuessTheNumberGame = require('./games-guess');
const BlackjackGame = require('./games-blackjack');
const JokeGame = require('./games-joke');
const YappTransfer = require('./yapp');

class BbsServer extends EventEmitter {
    constructor(config, radio) {
        super();
        this.config = config;
        this.radio = radio;
        this.RADIO_CALLSIGN = config.CALLSIGN;
        this.RADIO_STATIONID = config.STATIONID;
        
        // === AX25 Session Management for BBS Mode ===
        this.activeSessions = new Map(); // Map of session keys to session objects
        this.sessionStartTimes = new Map(); // Map of session keys to connection start times
        this.sessionMenuStates = new Map(); // Map of session keys to current menu state
        this.gameStates = new Map(); // Map of session keys to game state objects
        
        // === Games System ===
        this.games = new Map(); // Map of game names to game instances
        this.initializeGames();
        
        // === Connection Logging Storage ===
        try {
            this.storage = new Storage('./data/bbs-connections.db');
            console.log('[BBS Server] Connection logging initialized');
        } catch (error) {
            console.error('[BBS Server] Failed to initialize connection logging:', error);
            this.storage = null;
        }
        
        // === APRS Message Storage Access ===
        try {
            this.aprsMessageStorage = new Storage('./data/aprs-messages.db');
            console.log('[BBS Server] APRS message storage access initialized');
        } catch (error) {
            console.error('[BBS Server] Failed to initialize APRS message storage access:', error);
            this.aprsMessageStorage = null;
        }
        
        // === Bulletin Storage ===
        try {
            this.bulletinStorage = new Storage('./data/bbs-bulletins.db');
            console.log('[BBS Server] Bulletin storage initialized');
        } catch (error) {
            console.error('[BBS Server] Failed to initialize bulletin storage:', error);
            this.bulletinStorage = null;
        }
        
        // === File Transfer Management ===
        this.fileTransfers = new Map(); // Map of session keys to YAPP transfer instances
        this.pubFilesPath = './pubfiles';
        this.initializeFileSystem();
    }
    
    // Initialize available games
    initializeGames() {
        const guessGame = new GuessTheNumberGame();
        const blackjackGame = new BlackjackGame();
        const jokeGame = new JokeGame();
        
        // Register games by their command aliases
        for (const command of guessGame.gameCommands) {
            this.games.set(command, { instance: guessGame, menuState: 'guess_number' });
        }
        
        for (const command of blackjackGame.gameCommands) {
            this.games.set(command, { instance: blackjackGame, menuState: 'blackjack' });
        }
        
        for (const command of jokeGame.gameCommands) {
            this.games.set(command, { instance: jokeGame, menuState: 'joke' });
        }
        
        console.log(`[BBS Server] Initialized ${this.games.size} game commands`);
    }
    
    // Helper function to create session key from addresses
    getSessionKey(addresses) {
        if (!addresses || addresses.length < 2) return null;
        // Use remote station as key (addresses[1] is the source/remote station)
        return addresses[1].callSignWithId;
    }
    
    // Helper function to create or get session for BBS mode
    getOrCreateBbsSession(packet) {
        if (!packet.addresses || packet.addresses.length < 2) return null;
        
        const sessionKey = this.getSessionKey(packet.addresses);
        if (!sessionKey) return null;
        
        let session = this.activeSessions.get(sessionKey);
        if (!session) {
            console.log(`[BBS Session] Creating new session for ${sessionKey}`);
            session = new AX25Session({ 
                callsign: this.RADIO_CALLSIGN, 
                RADIO_CALLSIGN: this.RADIO_CALLSIGN,
                stationId: this.RADIO_STATIONID,
                RADIO_STATIONID: this.RADIO_STATIONID,
                activeChannelIdLock: packet.channel_id
            }, this.radio);
            
            // Set up session event handlers
            session.on('stateChanged', (state) => {
                console.log(`[BBS Session] ${sessionKey} state changed to ${state}`);
                if (state === AX25Session.ConnectionState.CONNECTED) {
                    // Record session start time and initialize menu state
                    this.sessionStartTimes.set(sessionKey, new Date());
                    this.sessionMenuStates.set(sessionKey, 'main'); // Start in main menu
                    
                    // Get last connection info before logging new connection
                    const lastConnectionInfo = this.getLastConnectionInfo(sessionKey);
                    
                    // Log the current connection
                    this.logConnection(sessionKey);
                    
                    // Send welcome message with last connection info when session is established
                    const welcomeMessage = this.generateWelcomeMessage(sessionKey, lastConnectionInfo);
                    console.log(`[BBS Session] Sending welcome message to ${sessionKey}`);
                    
                    // Emit welcome message event for web interface
                    this.emit('sessionDataSent', {
                        sessionKey: sessionKey,
                        data: welcomeMessage,
                        direction: 'sent',
                        timestamp: new Date().toISOString()
                    });
                    
                    session.send(Buffer.from(welcomeMessage), true); // Use immediate sending
                } else if (state === AX25Session.ConnectionState.DISCONNECTED) {
                    console.log(`[BBS Session] Removing disconnected session for ${sessionKey}`);
                    
                    // Get session statistics before removing session
                    const sessionStats = session.sessionStatistics;
                    
                    // Update the connection log with session statistics
                    this.updateConnectionLogWithStats(sessionKey, sessionStats);
                    
                    this.activeSessions.delete(sessionKey);
                    this.sessionStartTimes.delete(sessionKey);
                    this.sessionMenuStates.delete(sessionKey);
                    this.gameStates.delete(sessionKey);
                }
            });
            
            session.on('dataReceived', (data) => {
                console.log(`[BBS Session] ${sessionKey} received ${data.length} bytes: ${data.toString()}`);
                
                // Emit data event for web interface
                this.emit('sessionDataReceived', {
                    sessionKey: sessionKey,
                    data: data.toString(),
                    direction: 'received',
                    timestamp: new Date().toISOString()
                });
                
                // Check if YAPP file transfer is active for this session
                const activeTransfer = this.fileTransfers.get(sessionKey);
                if (activeTransfer && activeTransfer.state !== 'IDLE') {
                    console.log(`[BBS Session] YAPP transfer active for ${sessionKey}, skipping normal BBS command processing`);
                    // YAPP module will handle the data through its own handleIncomingData method
                    return;
                }
                
                // Process BBS commands only if no YAPP transfer is active
                if (session.currentState === AX25Session.ConnectionState.CONNECTED) {
                    const rawInput = data.toString().trim();
                    const currentMenu = this.sessionMenuStates.get(sessionKey) || 'main';
                    
                    // For bulletin creation, preserve original case
                    let command;
                    if (currentMenu === 'bulletin_create') {
                        command = rawInput; // Preserve original case for bulletin content
                    } else {
                        command = rawInput.toLowerCase(); // Convert to lowercase for commands
                    }
                    
                    let response = this.processCommand(sessionKey, command, currentMenu);
                    
                    if (response) {
                        console.log(`[BBS Session] Sending command response to ${sessionKey}`);
                        
                        // Emit data event for web interface
                        this.emit('sessionDataSent', {
                            sessionKey: sessionKey,
                            data: response,
                            direction: 'sent',
                            timestamp: new Date().toISOString()
                        });
                        
                        session.send(Buffer.from(response), true); // Use immediate sending for user responses
                    }
                }
            });
            
            session.on('uiDataReceived', (data) => {
                console.log(`[BBS Session] ${sessionKey} received UI data ${data.length} bytes: ${data.toString()}`);
                // For UI frames, we don't echo back as they're connectionless
            });
            
            session.on('error', (error) => {
                console.log(`[BBS Session] ${sessionKey} error: ${error}`);
            });
            
            this.activeSessions.set(sessionKey, session);
        }
        
        return session;
    }
    
    // Last Connection Info Methods
    getLastConnectionInfo(sessionKey) {
        if (!this.storage) {
            return null;
        }
        
        try {
            // Get all connection keys and sort them (newest first)
            const connectionKeys = this.storage.list('connection-%');
            connectionKeys.sort().reverse();
            
            // Find the most recent connection for this callsign
            for (const key of connectionKeys) {
                const record = this.storage.load(key);
                if (record && record.callsign === sessionKey) {
                    return {
                        timestamp: new Date(record.timestamp),
                        localTime: record.localTime
                    };
                }
            }
            
            return null; // No previous connection found
        } catch (error) {
            console.error('[BBS Server] Error retrieving last connection info:', error);
            return null;
        }
    }
    
    generateWelcomeMessage(sessionKey, lastConnectionInfo) {
        let welcomeMessage = `Welcome to ${this.RADIO_CALLSIGN} BBS`;
        
        if (lastConnectionInfo) {
            const timeSinceStr = this.formatTimeSince(lastConnectionInfo.timestamp);
            welcomeMessage += `\r\nLast connected: ${lastConnectionInfo.localTime} (${timeSinceStr} ago)`;
        } else {
            welcomeMessage += `\r\nFirst time connecting - welcome!`;
        }
        
        welcomeMessage += `\r\nType 'M' or 'MENU' for main menu.\r\n`;
        return welcomeMessage;
    }
    
    formatTimeSince(lastConnectionTime) {
        const now = new Date();
        const diffMs = now.getTime() - lastConnectionTime.getTime();
        
        // Convert to minutes, hours, days
        const diffMinutes = Math.floor(diffMs / (1000 * 60));
        const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
        const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
        
        if (diffDays > 0) {
            const remainingHours = diffHours % 24;
            const remainingMinutes = diffMinutes % 60;
            
            let timeStr = `${diffDays} day${diffDays !== 1 ? 's' : ''}`;
            if (remainingHours > 0) {
                timeStr += `, ${remainingHours} hour${remainingHours !== 1 ? 's' : ''}`;
            }
            if (remainingMinutes > 0 && diffDays < 7) { // Only show minutes if less than a week
                timeStr += `, ${remainingMinutes} minute${remainingMinutes !== 1 ? 's' : ''}`;
            }
            return timeStr;
        } else if (diffHours > 0) {
            const remainingMinutes = diffMinutes % 60;
            let timeStr = `${diffHours} hour${diffHours !== 1 ? 's' : ''}`;
            if (remainingMinutes > 0) {
                timeStr += `, ${remainingMinutes} minute${remainingMinutes !== 1 ? 's' : ''}`;
            }
            return timeStr;
        } else if (diffMinutes > 0) {
            return `${diffMinutes} minute${diffMinutes !== 1 ? 's' : ''}`;
        } else {
            return `less than a minute`;
        }
    }
    
    // Connection Logging Methods
    logConnection(sessionKey) {
        if (!this.storage) {
            console.log('[BBS Server] Storage not available, skipping connection log');
            return;
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
            
            const connectionRecord = {
                callsign: sessionKey,
                timestamp: timestamp,
                localTime: localTime,
                sessionKey: sessionKey
            };
            
            // Use timestamp as key for natural sorting
            const storageKey = `connection-${now.getTime()}`;
            
            if (this.storage.save(storageKey, connectionRecord)) {
                console.log(`[BBS Server] Logged connection from ${sessionKey} at ${localTime}`);
                
                // Maintain only the last 100 connections for performance
                this.cleanupOldConnections();
            } else {
                console.error(`[BBS Server] Failed to log connection from ${sessionKey}`);
            }
        } catch (error) {
            console.error('[BBS Server] Error logging connection:', error);
        }
    }
    
    updateConnectionLogWithStats(sessionKey, sessionStats) {
        if (!this.storage || !sessionStats) {
            console.log('[BBS Server] Storage not available or no stats, skipping connection log update');
            return;
        }
        
        try {
            // Find the most recent connection record for this session
            const connectionKeys = this.storage.list('connection-%');
            connectionKeys.sort().reverse(); // Newest first
            
            for (const key of connectionKeys) {
                const record = this.storage.load(key);
                if (record && record.callsign === sessionKey) {
                    // Update the record with session statistics
                    record.packetsSent = sessionStats.packetsSent;
                    record.packetsReceived = sessionStats.packetsReceived;
                    record.bytesSent = sessionStats.bytesSent;
                    record.bytesReceived = sessionStats.bytesReceived;
                    record.connectionDuration = sessionStats.connectionDuration;
                    
                    if (this.storage.save(key, record)) {
                        console.log(`[BBS Server] Updated connection log for ${sessionKey} with session stats: ${sessionStats.packetsSent}/${sessionStats.packetsReceived} packets, ${sessionStats.bytesSent}/${sessionStats.bytesReceived} bytes, ${sessionStats.connectionDuration}s duration`);
                    } else {
                        console.error(`[BBS Server] Failed to update connection log for ${sessionKey} with session stats`);
                    }
                    break; // Only update the most recent connection
                }
            }
        } catch (error) {
            console.error('[BBS Server] Error updating connection log with stats:', error);
        }
    }
    
    cleanupOldConnections() {
        try {
            // Get all connection keys
            const connectionKeys = this.storage.list('connection-%');
            
            // If we have more than 100 connections, remove the oldest ones
            if (connectionKeys.length > 100) {
                // Sort keys to get oldest first (they're timestamp-based)
                connectionKeys.sort();
                
                // Remove the oldest connections beyond 100
                const keysToDelete = connectionKeys.slice(0, connectionKeys.length - 100);
                for (const key of keysToDelete) {
                    this.storage.delete(key);
                }
                
                console.log(`[BBS Server] Cleaned up ${keysToDelete.length} old connection records`);
            }
        } catch (error) {
            console.error('[BBS Server] Error cleaning up old connections:', error);
        }
    }
    
    getLastConnections() {
        if (!this.storage) {
            return `Connection logging not available.\r\n`;
        }
        
        try {
            // Get all connection keys and sort them (newest first)
            const connectionKeys = this.storage.list('connection-%');
            connectionKeys.sort().reverse();
            
            // Get the last 20 connections
            const recentKeys = connectionKeys.slice(0, 20);
            
            if (recentKeys.length === 0) {
                return `No connections recorded yet.\r\n`;
            }
            
            // Load the connection records
            const connections = [];
            for (const key of recentKeys) {
                const record = this.storage.load(key);
                if (record) {
                    connections.push(record);
                }
            }
            
            // Format the output
            let output = `${this.RADIO_CALLSIGN} BBS - Last Connections\r\n`;
            output += `========================================\r\n`;
            output += `Callsign          Date/Time\r\n`;
            output += `----------------------------------------\r\n`;
            
            for (const conn of connections) {
                const callsign = conn.callsign.padEnd(16);
                output += `${callsign}  ${conn.localTime}\r\n`;
            }
            
            output += `\r\nTotal: ${connections.length} connection${connections.length !== 1 ? 's' : ''}\r\n`;
            
            return output;
        } catch (error) {
            console.error('[BBS Server] Error retrieving last connections:', error);
            return `Error retrieving connection history.\r\n`;
        }
    }
    
    getLastAprsMessages() {
        if (!this.aprsMessageStorage) {
            return `APRS message storage not available.\r\n\r\n`;
        }
        
        try {
            // Get all APRS message keys and sort them (newest first)
            const messageKeys = this.aprsMessageStorage.list('aprs-msg-%');
            messageKeys.sort().reverse();
            
            // Get the last 20 messages
            const recentKeys = messageKeys.slice(0, 20);
            
            if (recentKeys.length === 0) {
                return `No APRS messages recorded yet.\r\n`;
            }
            
            // Load the message records
            const messages = [];
            for (const key of recentKeys) {
                const record = this.aprsMessageStorage.load(key);
                if (record) {
                    messages.push(record);
                }
            }
            
            // Format the output
            let output = `${this.RADIO_CALLSIGN} BBS - Last received APRS messages\r\n`;
            output += `==========================================\r\n`;
            output += `Source     Dest       Message\r\n`;
            output += `------------------------------------------\r\n`;
            
            for (const msg of messages) {
                const source = msg.source.padEnd(10);
                const dest = msg.destination.padEnd(10);
                const message = msg.message.length > 45 ? msg.message.substring(0, 42) + '...' : msg.message;
                output += `${source} ${dest} ${message}\r\n`;
            }
            
            output += `\r\nTotal: ${messages.length} message${messages.length !== 1 ? 's' : ''}\r\n\r\n`;
            
            return output;
        } catch (error) {
            console.error('[BBS Server] Error retrieving APRS messages:', error);
            return `Error retrieving APRS message history.\r\n\r\n`;
        }
    }
    
    // Bulletin Management Methods
    createBulletin(callsign, message, expireDays = 7) {
        if (!this.bulletinStorage) {
            return { success: false, error: 'Bulletin storage not available' };
        }
        
        // Validate message length
        if (message.length > 300) {
            return { success: false, error: 'Bulletin message exceeds 300 character limit' };
        }
        
        if (message.trim().length === 0) {
            return { success: false, error: 'Bulletin message cannot be empty' };
        }
        
        try {
            // Clean up expired bulletins first
            this.cleanupExpiredBulletins();
            
            // Check how many bulletins this callsign already has
            const existingBulletins = this.getBulletinsByCallsign(callsign);
            if (existingBulletins.length >= 3) {
                return { success: false, error: 'You already have 3 bulletins. Delete or wait for expiration before posting new ones.' };
            }
            
            const now = new Date();
            const expireDate = new Date(now.getTime() + (expireDays * 24 * 60 * 60 * 1000));
            
            const bulletin = {
                id: now.getTime(), // Use timestamp as unique ID
                callsign: callsign.toUpperCase(),
                message: message.trim(),
                postedTime: now.toISOString(),
                expireTime: expireDate.toISOString(),
                postedTimeLocal: now.toLocaleString('en-US', {
                    year: 'numeric',
                    month: '2-digit',
                    day: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                    hour12: false
                }),
                expireTimeLocal: expireDate.toLocaleString('en-US', {
                    year: 'numeric',
                    month: '2-digit',
                    day: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                    hour12: false
                }),
                expireDays: expireDays
            };
            
            const storageKey = `bulletin-${bulletin.id}`;
            
            if (this.bulletinStorage.save(storageKey, bulletin)) {
                console.log(`[BBS Bulletin] Created bulletin ${bulletin.id} by ${callsign}: "${message}"`);
                return { success: true, bulletin: bulletin };
            } else {
                return { success: false, error: 'Failed to save bulletin' };
            }
        } catch (error) {
            console.error('[BBS Bulletin] Error creating bulletin:', error);
            return { success: false, error: 'Internal error creating bulletin' };
        }
    }
    
    deleteBulletin(callsign, bulletinId) {
        if (!this.bulletinStorage) {
            return { success: false, error: 'Bulletin storage not available' };
        }
        
        try {
            const storageKey = `bulletin-${bulletinId}`;
            const bulletin = this.bulletinStorage.load(storageKey);
            
            if (!bulletin) {
                return { success: false, error: 'Bulletin not found' };
            }
            
            // Only allow deletion by the original poster
            if (bulletin.callsign.toUpperCase() !== callsign.toUpperCase()) {
                return { success: false, error: 'You can only delete your own bulletins' };
            }
            
            if (this.bulletinStorage.delete(storageKey)) {
                console.log(`[BBS Bulletin] Deleted bulletin ${bulletinId} by ${callsign}`);
                return { success: true };
            } else {
                return { success: false, error: 'Failed to delete bulletin' };
            }
        } catch (error) {
            console.error('[BBS Bulletin] Error deleting bulletin:', error);
            return { success: false, error: 'Internal error deleting bulletin' };
        }
    }
    
    getBulletinsByCallsign(callsign) {
        if (!this.bulletinStorage) {
            return [];
        }
        
        try {
            // Clean up expired bulletins first
            this.cleanupExpiredBulletins();
            
            const bulletinKeys = this.bulletinStorage.list('bulletin-%');
            const bulletins = [];
            
            for (const key of bulletinKeys) {
                const bulletin = this.bulletinStorage.load(key);
                if (bulletin && bulletin.callsign.toUpperCase() === callsign.toUpperCase()) {
                    bulletins.push(bulletin);
                }
            }
            
            // Sort by posted time (newest first)
            bulletins.sort((a, b) => new Date(b.postedTime) - new Date(a.postedTime));
            
            return bulletins;
        } catch (error) {
            console.error('[BBS Bulletin] Error retrieving bulletins by callsign:', error);
            return [];
        }
    }
    
    getAllActiveBulletins() {
        if (!this.bulletinStorage) {
            return [];
        }
        
        try {
            // Clean up expired bulletins first
            this.cleanupExpiredBulletins();
            
            const bulletinKeys = this.bulletinStorage.list('bulletin-%');
            const bulletins = [];
            
            for (const key of bulletinKeys) {
                const bulletin = this.bulletinStorage.load(key);
                if (bulletin) {
                    bulletins.push(bulletin);
                }
            }
            
            // Sort by posted time (newest first)
            bulletins.sort((a, b) => new Date(b.postedTime) - new Date(a.postedTime));
            
            return bulletins;
        } catch (error) {
            console.error('[BBS Bulletin] Error retrieving all bulletins:', error);
            return [];
        }
    }
    
    cleanupExpiredBulletins() {
        if (!this.bulletinStorage) {
            return;
        }
        
        try {
            const now = new Date();
            const bulletinKeys = this.bulletinStorage.list('bulletin-%');
            let deletedCount = 0;
            
            for (const key of bulletinKeys) {
                const bulletin = this.bulletinStorage.load(key);
                if (bulletin && new Date(bulletin.expireTime) <= now) {
                    this.bulletinStorage.delete(key);
                    deletedCount++;
                    console.log(`[BBS Bulletin] Expired bulletin ${bulletin.id} by ${bulletin.callsign}`);
                }
            }
            
            if (deletedCount > 0) {
                console.log(`[BBS Bulletin] Cleaned up ${deletedCount} expired bulletin${deletedCount !== 1 ? 's' : ''}`);
            }
        } catch (error) {
            console.error('[BBS Bulletin] Error cleaning up expired bulletins:', error);
        }
    }
    
    getBulletinsDisplay() {
        const bulletins = this.getAllActiveBulletins();
        
        if (bulletins.length === 0) {
            return `${this.RADIO_CALLSIGN} BBS - Active Bulletins\r\n` +
                   `=============================\r\n` +
                   `No active bulletins.\r\n\r\n`;
        }
        
        let output = `${this.RADIO_CALLSIGN} BBS - Active Bulletins\r\n`;
        output += `=============================\r\n`;
        
        bulletins.forEach((bulletin, index) => {
            const expireDate = new Date(bulletin.expireTime);
            const now = new Date();
            const daysLeft = Math.ceil((expireDate - now) / (1000 * 60 * 60 * 24));
            
            output += `[${index + 1}] From: ${bulletin.callsign}\r\n`;
            output += `    Posted: ${bulletin.postedTimeLocal}\r\n`;
            output += `    Expires: ${daysLeft} day${daysLeft !== 1 ? 's' : ''}\r\n`;
            output += `    Message: ${bulletin.message}\r\n`;
            if (index < bulletins.length - 1) {
                output += `\r\n`;
            }
        });
        
        output += `\r\nTotal: ${bulletins.length} bulletin${bulletins.length !== 1 ? 's' : ''}\r\n`;
        
        return output;
    }
    
    getBulletinCreatePrompt(sessionKey) {
        const callsign = sessionKey.split('-')[0]; // Extract callsign without SSID
        const existingBulletins = this.getBulletinsByCallsign(callsign);
        
        let prompt = `${this.RADIO_CALLSIGN} BBS - Post New Bulletin\r\n`;
        prompt += `================================\r\n`;
        prompt += `You currently have ${existingBulletins.length}/3 bulletins.\r\n\r\n`;
        
        if (existingBulletins.length >= 3) {
            prompt += `You have reached the maximum of 3 bulletins.\r\n`;
            prompt += `Delete an existing bulletin before posting a new one.\r\n\r\n`;
            prompt += `Type 'MAIN' to return to main menu.\r\n`;
        } else {
            prompt += `Enter your bulletin message (300 char max):\r\n`;
            prompt += `Or type 'MAIN' to return to main menu.\r\n`;
        }
        
        return prompt;
    }
    
    getBulletinDeletePrompt(sessionKey) {
        const callsign = sessionKey.split('-')[0]; // Extract callsign without SSID
        const userBulletins = this.getBulletinsByCallsign(callsign);
        
        let prompt = `${this.RADIO_CALLSIGN} BBS - Delete Your Bulletins\r\n`;
        prompt += `====================================\r\n`;
        
        if (userBulletins.length === 0) {
            prompt += `You have no bulletins to delete.\r\n\r\n`;
            prompt += `Type 'MAIN' to return to main menu.\r\n`;
        } else {
            prompt += `Your bulletins:\r\n\r\n`;
            
            userBulletins.forEach((bulletin, index) => {
                const expireDate = new Date(bulletin.expireTime);
                const now = new Date();
                const daysLeft = Math.ceil((expireDate - now) / (1000 * 60 * 60 * 24));
                
                prompt += `[${index + 1}] ID: ${bulletin.id}\r\n`;
                prompt += `    Posted: ${bulletin.postedTimeLocal}\r\n`;
                prompt += `    Expires: ${daysLeft} day${daysLeft !== 1 ? 's' : ''}\r\n`;
                prompt += `    Message: ${bulletin.message}\r\n\r\n`;
            });
            
            prompt += `Enter bulletin number (1-${userBulletins.length}) to delete,\r\n`;
            prompt += `or type 'MAIN' to return to main menu.\r\n`;
        }
        
        return prompt;
    }
    
    processBulletinCreate(sessionKey, input) {
        const callsign = sessionKey.split('-')[0]; // Extract callsign without SSID
        
        if (input.trim().toLowerCase() === 'main') {
            this.sessionMenuStates.set(sessionKey, 'main');
            return this.getMainMenu();
        }
        
        // Validate input
        if (input.trim().length === 0) {
            return `Bulletin message cannot be empty.\r\nPlease enter your message or 'MAIN' to return:\r\n`;
        }
        
        if (input.length > 300) {
            return `Message too long (${input.length}/300 characters).\r\nPlease shorten your message:\r\n`;
        }
        
        // Create the bulletin
        const result = this.createBulletin(callsign, input);
        
        if (result.success) {
            this.sessionMenuStates.set(sessionKey, 'main');
            return `Bulletin posted successfully!\r\n` +
                   `Bulletin ID: ${result.bulletin.id}\r\n` +
                   `Expires: ${result.bulletin.expireTimeLocal}\r\n` +
                   this.getMainMenu();
        } else {
            this.sessionMenuStates.set(sessionKey, 'main');
            return `Error posting bulletin: ${result.error}\r\n` + this.getMainMenu();
        }
    }
    
    processBulletinDelete(sessionKey, input) {
        const callsign = sessionKey.split('-')[0]; // Extract callsign without SSID
        
        if (input.toLowerCase() === 'main') {
            this.sessionMenuStates.set(sessionKey, 'main');
            return this.getMainMenu();
        }
        
        const userBulletins = this.getBulletinsByCallsign(callsign);
        
        if (userBulletins.length === 0) {
            this.sessionMenuStates.set(sessionKey, 'main');
            return `You have no bulletins to delete.\r\n` + this.getMainMenu();
        }
        
        const bulletinNumber = parseInt(input.trim());
        
        if (isNaN(bulletinNumber) || bulletinNumber < 1 || bulletinNumber > userBulletins.length) {
            return `Invalid bulletin number. Please enter 1-${userBulletins.length} or 'MAIN':\r\n`;
        }
        
        const bulletinToDelete = userBulletins[bulletinNumber - 1];
        const result = this.deleteBulletin(callsign, bulletinToDelete.id);
        
        if (result.success) {
            this.sessionMenuStates.set(sessionKey, 'main');
            return `Bulletin deleted successfully!\r\n` + this.getMainMenu();
        } else {
            this.sessionMenuStates.set(sessionKey, 'main');
            return `Error deleting bulletin: ${result.error}\r\n` + this.getMainMenu();
        }
    }
    
    // Command Processing with Menu System
    processCommand(sessionKey, command, currentMenu) {
        let response = '';
        
        // Handle disconnect command - works from any menu
        if (command === 'bye') {
            response = this.getDisconnectMessage(sessionKey);
            // Send disconnect message first, then disconnect the session
            const session = this.activeSessions.get(sessionKey);
            if (session) {
                session.send(Buffer.from(response), true);
                // Disconnect after a short delay to ensure message is sent
                setTimeout(() => {
                    console.log(`[BBS Session] User ${sessionKey} requested disconnect`);
                    session.disconnect();
                }, 100);
            }
            return null; // Don't send response again
        }
        
        // Handle menu-specific commands
        switch (currentMenu) {
            case 'main':
                response = this.processMainMenuCommand(sessionKey, command);
                break;
            case 'games':
                response = this.processGamesMenuCommand(sessionKey, command);
                break;
            case 'bulletin_create':
                response = this.processBulletinCreate(sessionKey, command);
                break;
            case 'bulletin_delete':
                response = this.processBulletinDelete(sessionKey, command);
                break;
            case 'files':
                response = this.processFilesCommand(sessionKey, command);
                break;
            case 'guess_number':
            case 'blackjack':
            case 'joke':
                // Use modular game system
                response = this.processGameCommand(sessionKey, command, currentMenu);
                break;
            default:
                // Unknown menu state, reset to main
                this.sessionMenuStates.set(sessionKey, 'main');
                response = this.getMainMenu();
                break;
        }
        
        return response;
    }
    
    // Process game commands using modular game system
    processGameCommand(sessionKey, command, menuState) {
        // Find the game instance for this menu state
        for (const [cmd, gameInfo] of this.games) {
            if (gameInfo.menuState === menuState) {
                return gameInfo.instance.processGameCommand(
                    sessionKey, 
                    command, 
                    this.gameStates, 
                    () => this.getGamesMenu(),
                    () => this.sessionMenuStates.set(sessionKey, 'games') // Add callback to reset menu state
                );
            }
        }
        
        // Fallback if no game found
        this.sessionMenuStates.set(sessionKey, 'games');
        return `Game not found! Returning to games menu.\r\n` + this.getGamesMenu();
    }
    
    processMainMenuCommand(sessionKey, command) {
        switch (command) {
            case 'm':
            case 'menu':
                return this.getMainMenu();
            case 't':
            case 'time':
                return this.getCurrentTime();
            case 'uptime':
                return this.getSystemUptime();
            case 'lc':
            case 'lastconnections':
                return this.getLastConnections();
            case 'aprsmsgs':
                return this.getLastAprsMessages();
            case 'b':
            case 'bull':
                return this.getBulletinsDisplay();
            case 'newb':
                // Switch to bulletin creation mode
                this.sessionMenuStates.set(sessionKey, 'bulletin_create');
                return this.getBulletinCreatePrompt(sessionKey);
            case 'delb':
                // Switch to bulletin deletion mode
                this.sessionMenuStates.set(sessionKey, 'bulletin_delete');
                return this.getBulletinDeletePrompt(sessionKey);
            case 'f':
            case 'files':
                // Show files list without switching menu state
                return this.getFilesDisplay();
            case 'g':
            case 'games':
                // Switch to games menu
                this.sessionMenuStates.set(sessionKey, 'games');
                return this.getGamesMenu();
            default:
                // Check if it's a download command
                if (command.startsWith('download ')) {
                    const filename = command.substring(9).trim(); // Remove "download " prefix
                    if (filename.length === 0) {
                        return `Please specify a filename. Usage: DOWNLOAD <filename>\r\n`;
                    }
                    return this.startFileDownloadByName(sessionKey, filename);
                }
                return `Unknown command: ${command}\r\nType 'M' or 'MENU' for help.\r\n`;
        }
    }
    
    processGamesMenuCommand(sessionKey, command) {
        switch (command) {
            case 'm':
            case 'menu':
                return this.getGamesMenu();
            case 'main':
                // Return to main menu
                this.sessionMenuStates.set(sessionKey, 'main');
                return this.getMainMenu();
            default:
                // Check if command matches any game
                const gameInfo = this.games.get(command);
                if (gameInfo) {
                    // Start the game
                    this.sessionMenuStates.set(sessionKey, gameInfo.menuState);
                    return gameInfo.instance.startGame(
                        sessionKey, 
                        this.gameStates, 
                        () => this.getGamesMenu(),
                        () => this.sessionMenuStates.set(sessionKey, 'games')
                    );
                }
                return `Unknown command: ${command}\r\nType 'M' or 'MENU' for games menu, or 'MAIN' to return to main menu.\r\n`;
        }
    }
    
    // BBS Menu Methods
    getMainMenu() {
        return `${this.RADIO_CALLSIGN} BBS - Main Menu\r\n` +
               `========================\r\n` +
               `[M]ENU    - Display this menu\r\n` +
               `[T]IME    - Display current time\r\n` +
               `UPTIME    - Display system uptime\r\n` +
               `LC        - Last connections to BBS\r\n` +
               `APRSMSGS  - Last received APRS messages\r\n` +
               `[B]ULL    - View active bulletins\r\n` +
               `NEWB      - Post new bulletin\r\n` +
               `DELB      - Delete your bulletin\r\n` +
               `[F]ILES   - Browse and download files\r\n` +
               `[G]AMES   - Games submenu\r\n` +
               `BYE       - Disconnect from BBS\r\n`;
    }
    
    getGamesMenu() {
        return `${this.RADIO_CALLSIGN} BBS - Games Menu\r\n` +
               `=========================\r\n` +
               `[M]ENU    - Display this menu\r\n` +
               `[G]UESS   - Guess the Number game\r\n` +
               `[B]LKJK   - Blackjack game\r\n` +
               `[J]OKE    - Joke of the Day\r\n` +
               `MAIN      - Return to main menu\r\n` +
               `BYE       - Disconnect from BBS\r\n`;
    }
    
    getDisconnectMessage(sessionKey) {
        let message = `\r\nThank you for using ${this.RADIO_CALLSIGN} BBS!`;
        
        // Add session duration if we have the start time
        if (sessionKey && this.sessionStartTimes.has(sessionKey)) {
            const sessionStart = this.sessionStartTimes.get(sessionKey);
            const sessionDuration = this.formatTimeSince(sessionStart);
            message += `\r\nSession duration: ${sessionDuration}`;
        }
        
        message += `\r\n73 and hope to see you again soon.\r\n` +
                   `Disconnecting...\r\n`;
        
        return message;
    }
    
    getCurrentTime() {
        const now = new Date();
        const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
        const localTime = now.toLocaleString('en-US', {
            timeZone: timeZone,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false
        });
        const utcTime = now.toISOString().replace('T', ' ').substring(0, 19);
        
        return `Current Time:\r\n` +
               `Local: ${localTime} (${timeZone})\r\n` +
               `UTC:   ${utcTime}\r\n`;
    }
    
    getSystemUptime() {
        const uptimeSeconds = os.uptime();
        const loadAvg = os.loadavg();
        
        // Convert uptime to human readable format
        const days = Math.floor(uptimeSeconds / 86400);
        const hours = Math.floor((uptimeSeconds % 86400) / 3600);
        const minutes = Math.floor((uptimeSeconds % 3600) / 60);
        const seconds = Math.floor(uptimeSeconds % 60);
        
        let uptimeStr = '';
        if (days > 0) uptimeStr += `${days} day${days !== 1 ? 's' : ''}, `;
        if (hours > 0) uptimeStr += `${hours} hour${hours !== 1 ? 's' : ''}, `;
        if (minutes > 0) uptimeStr += `${minutes} minute${minutes !== 1 ? 's' : ''}, `;
        uptimeStr += `${seconds} second${seconds !== 1 ? 's' : ''}`;
        
        return `System Uptime:\r\n` +
               `${uptimeStr}\r\n` +
               `Load Average: ${loadAvg[0].toFixed(2)}, ${loadAvg[1].toFixed(2)}, ${loadAvg[2].toFixed(2)}\r\n`;
    }
    
    // === File Transfer and Management Methods ===
    
    initializeFileSystem() {
        const fs = require('fs');
        const path = require('path');
        
        try {
            // Ensure pubfiles directory exists
            if (!fs.existsSync(this.pubFilesPath)) {
                fs.mkdirSync(this.pubFilesPath, { recursive: true });
                console.log(`[BBS Files] Created pubfiles directory: ${this.pubFilesPath}`);
            }
            
            console.log(`[BBS Files] File system initialized - pubfiles path: ${this.pubFilesPath}`);
        } catch (error) {
            console.error('[BBS Files] Error initializing file system:', error);
        }
    }
    
    getAvailableFiles() {
        const fs = require('fs');
        const path = require('path');
        
        try {
            const files = [];
            
            // Recursively scan the pubfiles directory
            const scanDirectory = (dir, relativePath = '') => {
                const items = fs.readdirSync(dir);
                
                for (const item of items) {
                    const fullPath = path.join(dir, item);
                    const stats = fs.statSync(fullPath);
                    
                    if (stats.isFile()) {
                        const relativeFilePath = path.join(relativePath, item);
                        files.push({
                            name: item,
                            path: fullPath,
                            relativePath: relativeFilePath,
                            size: stats.size,
                            modified: stats.mtime,
                            category: relativePath || 'root'
                        });
                    } else if (stats.isDirectory() && item !== '.' && item !== '..') {
                        scanDirectory(fullPath, path.join(relativePath, item));
                    }
                }
            };
            
            scanDirectory(this.pubFilesPath);
            
            // Sort files by category then by name
            files.sort((a, b) => {
                if (a.category !== b.category) {
                    return a.category.localeCompare(b.category);
                }
                return a.name.localeCompare(b.name);
            });
            
            return files;
        } catch (error) {
            console.error('[BBS Files] Error scanning files:', error);
            return [];
        }
    }
    
    getFilesDisplay() {
        const files = this.getAvailableFiles();
        
        if (files.length === 0) {
            return `${this.RADIO_CALLSIGN} BBS - Available Files\r\n` +
                   `=============================\r\n` +
                   `No files available for download.\r\n` +
                   `Use: DOWNLOAD <filename> to download a file\r\n\r\n`;
        }
        
        let output = `${this.RADIO_CALLSIGN} BBS - Available Files\r\n`;
        output += `=============================\r\n`;
        output += `Name                    Size     Category\r\n`;
        output += `----                    ----     --------\r\n`;
        
        files.forEach((file) => {
            const name = file.name.length > 20 ? file.name.substring(0, 17) + '...' : file.name.padEnd(20);
            const size = this.formatFileSize(file.size).padEnd(8);
            const category = file.category === 'root' ? 'main' : file.category;
            
            output += `${name}  ${size}  ${category}\r\n`;
        });
        
        output += `\r\nTotal: ${files.length} file${files.length !== 1 ? 's' : ''}\r\n`;
        output += `Use: DOWNLOAD <filename> to download a file\r\n\r\n`;
        
        return output;
    }
    
    formatFileSize(bytes) {
        if (bytes < 1024) {
            return `${bytes} B`;
        } else if (bytes < 1024 * 1024) {
            return `${Math.round(bytes / 1024)} KB`;
        } else {
            return `${Math.round(bytes / (1024 * 1024))} MB`;
        }
    }
    
    startFileDownload(sessionKey, fileNumber) {
        const files = this.getAvailableFiles();
        
        if (fileNumber < 1 || fileNumber > files.length) {
            return `Invalid file number. Please enter 1-${files.length} or 'MAIN':\r\n`;
        }
        
        const selectedFile = files[fileNumber - 1];
        const session = this.activeSessions.get(sessionKey);
        
        if (!session) {
            return `Session not found. Please try again.\r\n`;
        }
        
        // Check if there's already a transfer in progress for this session
        if (this.fileTransfers.has(sessionKey)) {
            const existingTransfer = this.fileTransfers.get(sessionKey);
            if (existingTransfer.state !== 'IDLE') {
                return `File transfer already in progress. Please wait for it to complete.\r\n`;
            }
        }
        
        try {
            // Create YAPP transfer instance
            const yappTransfer = new YappTransfer(session, {
                maxRetries: 3,
                timeout: 30000,
                blockSize: 128,
                useChecksum: true,
                enableResume: true
            });
            
            // Set up transfer event handlers
            yappTransfer.on('transferStarted', (info) => {
                console.log(`[BBS YAPP] Transfer started for ${sessionKey}: ${info.filename}`);
            });
            
            yappTransfer.on('transferProgress', (progress) => {
                console.log(`[BBS YAPP] Transfer progress for ${sessionKey}: ${progress.percentage}% (${progress.bytesTransferred}/${progress.fileSize} bytes)`);
            });
            
            yappTransfer.on('transferCompleted', (stats) => {
                console.log(`[BBS YAPP] Transfer completed for ${sessionKey}: ${stats.filename} (${stats.bytesTransferred} bytes in ${stats.elapsedTime}s)`);
                this.fileTransfers.delete(sessionKey);
                
                // Send completion message
                const completionMsg = `\r\nFile transfer completed successfully!\r\n` +
                                    `File: ${stats.filename}\r\n` +
                                    `Size: ${this.formatFileSize(stats.bytesTransferred)}\r\n` +
                                    `Time: ${Math.round(stats.elapsedTime)}s\r\n` +
                                    this.getMainMenu();
                
                session.send(Buffer.from(completionMsg), true);
                this.sessionMenuStates.set(sessionKey, 'main');
            });
            
            yappTransfer.on('transferCancelled', (info) => {
                console.log(`[BBS YAPP] Transfer cancelled for ${sessionKey}: ${info.reason}`);
                this.fileTransfers.delete(sessionKey);
                
                const cancelMsg = `\r\nFile transfer cancelled: ${info.reason}\r\n` + this.getMainMenu();
                session.send(Buffer.from(cancelMsg), true);
                this.sessionMenuStates.set(sessionKey, 'main');
            });
            
            yappTransfer.on('transferAborted', (info) => {
                console.log(`[BBS YAPP] Transfer aborted for ${sessionKey}: ${info.reason}`);
                this.fileTransfers.delete(sessionKey);
                
                const abortMsg = `\r\nFile transfer aborted: ${info.reason}\r\n` + this.getMainMenu();
                session.send(Buffer.from(abortMsg), true);
                this.sessionMenuStates.set(sessionKey, 'main');
            });
            
            // Store the transfer instance
            this.fileTransfers.set(sessionKey, yappTransfer);
            
            // Start the transfer
            yappTransfer.startSend(selectedFile.path, selectedFile.name);
            
            return ''; // Just start the transfer, no user messages since this could interfere with the protocol.

            /*
            return `Starting YAPP download of: ${selectedFile.name}\r\n` +
                   `Size: ${this.formatFileSize(selectedFile.size)}\r\n` +
                   `Please ensure your terminal supports YAPP protocol.\r\n` +
                   `Transfer will begin shortly...\r\n`;
            */
            
        } catch (error) {
            console.error(`[BBS YAPP] Error starting file transfer for ${sessionKey}:`, error);
            return `Error starting file transfer: ${error.message}\r\n` + this.getMainMenu();
        }
    }
    
    startFileDownloadByName(sessionKey, filename) {
        const files = this.getAvailableFiles();
        
        // Find file by exact name match (case insensitive)
        const selectedFile = files.find(file => 
            file.name.toLowerCase() === filename.toLowerCase()
        );
        
        if (!selectedFile) {
            return `File '${filename}' not found. Use FILES command to see available files.\r\n`;
        }
        
        const session = this.activeSessions.get(sessionKey);
        
        if (!session) {
            return `Session not found. Please try again.\r\n`;
        }
        
        // Check if there's already a transfer in progress for this session
        if (this.fileTransfers.has(sessionKey)) {
            const existingTransfer = this.fileTransfers.get(sessionKey);
            if (existingTransfer.state !== 'IDLE') {
                return `File transfer already in progress. Please wait for it to complete.\r\n`;
            }
        }
        
        try {
            // Create YAPP transfer instance
            const yappTransfer = new YappTransfer(session, {
                maxRetries: 3,
                timeout: 30000,
                blockSize: 128,
                useChecksum: true,
                enableResume: true
            });
            
            // Set up transfer event handlers
            yappTransfer.on('transferStarted', (info) => {
                console.log(`[BBS YAPP] Transfer started for ${sessionKey}: ${info.filename}`);
            });
            
            yappTransfer.on('transferProgress', (progress) => {
                console.log(`[BBS YAPP] Transfer progress for ${sessionKey}: ${progress.percentage}% (${progress.bytesTransferred}/${progress.fileSize} bytes)`);
            });
            
            yappTransfer.on('transferCompleted', (stats) => {
                console.log(`[BBS YAPP] Transfer completed for ${sessionKey}: ${stats.filename} (${stats.bytesTransferred} bytes in ${stats.elapsedTime}s)`);
                this.fileTransfers.delete(sessionKey);
                
                // Send completion message
                const completionMsg = `\r\nFile transfer completed successfully!\r\n` +
                                    `File: ${stats.filename}\r\n` +
                                    `Size: ${this.formatFileSize(stats.bytesTransferred)}\r\n` +
                                    `Time: ${Math.round(stats.elapsedTime)}s\r\n` +
                                    this.getMainMenu();
                
                session.send(Buffer.from(completionMsg), true);
                this.sessionMenuStates.set(sessionKey, 'main');
            });
            
            yappTransfer.on('transferCancelled', (info) => {
                console.log(`[BBS YAPP] Transfer cancelled for ${sessionKey}: ${info.reason}`);
                this.fileTransfers.delete(sessionKey);
                
                const cancelMsg = `\r\nFile transfer cancelled: ${info.reason}\r\n` + this.getMainMenu();
                session.send(Buffer.from(cancelMsg), true);
                this.sessionMenuStates.set(sessionKey, 'main');
            });
            
            yappTransfer.on('transferAborted', (info) => {
                console.log(`[BBS YAPP] Transfer aborted for ${sessionKey}: ${info.reason}`);
                this.fileTransfers.delete(sessionKey);
                
                const abortMsg = `\r\nFile transfer aborted: ${info.reason}\r\n` + this.getMainMenu();
                session.send(Buffer.from(abortMsg), true);
                this.sessionMenuStates.set(sessionKey, 'main');
            });
            
            // Store the transfer instance
            this.fileTransfers.set(sessionKey, yappTransfer);
            
            // Start the transfer
            yappTransfer.startSend(selectedFile.path, selectedFile.name);
            
            return ''; // Just start the transfer, no user messages since this could interfere with the protocol.

            /*
            return `Starting YAPP download of: ${selectedFile.name}\r\n` +
                   `Size: ${this.formatFileSize(selectedFile.size)}\r\n` +
                   `Category: ${selectedFile.category === 'root' ? 'main' : selectedFile.category}\r\n` +
                   `Please ensure your terminal supports YAPP protocol.\r\n` +
                   `Transfer will begin shortly...\r\n`;
            */
        } catch (error) {
            console.error(`[BBS YAPP] Error starting file transfer for ${sessionKey}:`, error);
            return `Error starting file transfer: ${error.message}\r\n` + this.getMainMenu();
        }
    }
    
    processFilesCommand(sessionKey, command) {
        if (command.toLowerCase() === 'main') {
            this.sessionMenuStates.set(sessionKey, 'main');
            return this.getMainMenu();
        }
        
        // Check if it's a file number
        const fileNumber = parseInt(command.trim());
        if (!isNaN(fileNumber)) {
            return this.startFileDownload(sessionKey, fileNumber);
        }
        
        return `Invalid input. Please enter a file number or 'MAIN':\r\n`;
    }
    
    // Cleanup method for proper shutdown
    close() {
        try {
            // Cancel any active file transfers
            for (const [sessionKey, transfer] of this.fileTransfers) {
                console.log(`[BBS Server] Cancelling file transfer for ${sessionKey}`);
                transfer.cancel('BBS shutting down');
            }
            this.fileTransfers.clear();
            
            // Close all active sessions
            for (const [sessionKey, session] of this.activeSessions) {
                console.log(`[BBS Server] Closing session for ${sessionKey}`);
                session.disconnect();
            }
            this.activeSessions.clear();
            
            // Close storage
            if (this.storage) {
                this.storage.close();
                console.log('[BBS Server] Storage connection closed');
            }
        } catch (error) {
            console.error('[BBS Server] Error during cleanup:', error);
        }
    }
    
    // Main method to process packets in BBS mode
    processPacket(packet) {
        // Check if first address matches our station
        const firstAddr = packet.addresses[0];
        if (firstAddr.address === this.RADIO_CALLSIGN && firstAddr.SSID == this.RADIO_STATIONID) {
            // For BBS mode, handle session management and U-frame echoing
            
            // Check if this is a session-related packet (SABM, SABME, I-frame, etc.)
            if (packet.isSessionPacket()) {
                // Handle session management
                console.log('[BBS Session] Processing session packet');
                const session = this.getOrCreateBbsSession(packet);
                if (session) {
                    session.receive(packet);
                } else {
                    console.log('[BBS Session] Failed to create/get session for packet');
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
                            console.warn('[BBS Server] AX.25 packet serialization failed:', replyPacket);
                        } else if (typeof this.radio.sendTncFrame !== 'function') {
                            console.warn('[BBS Server] radio.sendTncFrame not implemented.');
                        } else {
                            this.radio.sendTncFrame({
                                channel_id: replyPacket.channel_id,
                                data: serialized
                            });
                            console.log('[BBS Server] Echoed AX.25 U-frame packet back to sender.');
                        }
                    }
                } else {
                    if (!isUFrame) {
                        console.log('[BBS Server] AX.25 packet addressed to our station - not echoing (not a U-frame)');
                    } else {
                        console.log('[BBS Server] AX.25 packet addressed to our station - not echoing (no payload data)');
                    }
                }
            }
        }
    }
}

module.exports = BbsServer;
