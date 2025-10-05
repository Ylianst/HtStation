'use strict';

const AX25Session = require('./AX25Session');
const AX25Packet = require('./AX25Packet');
const Storage = require('./storage');
const os = require('os');

// Game modules
const GuessTheNumberGame = require('./games-guess');
const BlackjackGame = require('./games-blackjack');
const JokeGame = require('./games-joke');

class BbsServer {
    constructor(config, radio) {
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
                    session.send(Buffer.from(welcomeMessage), true); // Use immediate sending
                } else if (state === AX25Session.ConnectionState.DISCONNECTED) {
                    console.log(`[BBS Session] Removing disconnected session for ${sessionKey}`);
                    this.activeSessions.delete(sessionKey);
                    this.sessionStartTimes.delete(sessionKey);
                    this.sessionMenuStates.delete(sessionKey);
                    this.gameStates.delete(sessionKey);
                }
            });
            
            session.on('dataReceived', (data) => {
                console.log(`[BBS Session] ${sessionKey} received ${data.length} bytes: ${data.toString()}`);
                // Process BBS commands
                if (session.currentState === AX25Session.ConnectionState.CONNECTED) {
                    const command = data.toString().trim().toLowerCase();
                    const currentMenu = this.sessionMenuStates.get(sessionKey) || 'main';
                    let response = this.processCommand(sessionKey, command, currentMenu);
                    
                    if (response) {
                        console.log(`[BBS Session] Sending command response to ${sessionKey}`);
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
            return `Connection logging not available.\r\n\r\n`;
        }
        
        try {
            // Get all connection keys and sort them (newest first)
            const connectionKeys = this.storage.list('connection-%');
            connectionKeys.sort().reverse();
            
            // Get the last 20 connections
            const recentKeys = connectionKeys.slice(0, 20);
            
            if (recentKeys.length === 0) {
                return `No connections recorded yet.\r\n\r\n`;
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
            
            output += `\r\nTotal: ${connections.length} connection${connections.length !== 1 ? 's' : ''}\r\n\r\n`;
            
            return output;
        } catch (error) {
            console.error('[BBS Server] Error retrieving last connections:', error);
            return `Error retrieving connection history.\r\n\r\n`;
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
            case 'g':
            case 'games':
                // Switch to games menu
                this.sessionMenuStates.set(sessionKey, 'games');
                return this.getGamesMenu();
            default:
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
               `M or MENU - Display this menu\r\n` +
               `T or TIME - Display current time\r\n` +
               `UPTIME    - Display system uptime\r\n` +
               `LC        - Last connections to BBS\r\n` +
               `G or GAMES- Games submenu\r\n` +
               `BYE       - Disconnect from BBS\r\n` +
               `\r\n` +
               `Enter command: `;
    }
    
    getGamesMenu() {
        return `${this.RADIO_CALLSIGN} BBS - Games Menu\r\n` +
               `=========================\r\n` +
               `M or MENU - Display this menu\r\n` +
               `G or GUESS- Guess the Number game\r\n` +
               `B or BLKJK- Blackjack game\r\n` +
               `J or JOKE - Joke of the Day\r\n` +
               `MAIN      - Return to main menu\r\n` +
               `BYE       - Disconnect from BBS\r\n` +
               `\r\n` +
               `Enter command: `;
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
               `UTC:   ${utcTime}\r\n` +
               `\r\n`;
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
               `Load Average: ${loadAvg[0].toFixed(2)}, ${loadAvg[1].toFixed(2)}, ${loadAvg[2].toFixed(2)}\r\n` +
               `\r\n`;
    }
    
    // Cleanup method for proper shutdown
    close() {
        try {
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
