'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');
const os = require('os');

// Get logger instance
const logger = global.logger ? global.logger.getLogger('WebServer') : console;

class WebServer {
    constructor(config, radio, bbsServer, aprsHandler, winlinkServer) {
        this.config = config;
        this.radio = radio;
        this.bbsServer = bbsServer;
        this.aprsHandler = aprsHandler;
        this.winlinkServer = winlinkServer;
        
        this.httpServer = null;
        this.wsServer = null;
        this.clients = new Set();
        
        // Track system start time for uptime calculation
        this.startTime = new Date();
        
        // WebSocket event types
        this.EVENT_TYPES = {
            SYSTEM_STATUS: 'system_status',
            CURRENT_CONNECTION: 'current_connection',
            CONNECTION_UPDATE: 'connection_update',
            APRS_MESSAGE: 'aprs_message',
            BBS_CONNECTIONS: 'bbs_connections',
            APRS_MESSAGES: 'aprs_messages',
            SESSION_DATA: 'session_data',
            BULLETINS: 'bulletins',
            WINLINK_MAILS: 'winlink_mails'
        };
        
        // Setup event listeners for real-time updates
        this.setupEventListeners();
    }
    
    start(port) {
        return new Promise((resolve, reject) => {
            try {
                // Create HTTP server
                this.httpServer = http.createServer((req, res) => {
                    this.handleHttpRequest(req, res);
                });
                
                // Create WebSocket server
                this.wsServer = new WebSocket.Server({ server: this.httpServer });
                
                // Handle WebSocket server errors
                this.wsServer.on('error', (error) => {
                    //console.error('[WebServer] WebSocket server error:', error);
                    reject(error);
                });
                
                // Handle WebSocket connections
                this.wsServer.on('connection', (ws, req) => {
                    logger.log(`[WebServer] New WebSocket connection from ${req.socket.remoteAddress}`);
                    this.clients.add(ws);
                    
                    // Send initial data to new client
                    this.sendInitialData(ws);
                    
                    ws.on('close', () => {
                        logger.log('[WebServer] WebSocket connection closed');
                        this.clients.delete(ws);
                    });
                    
                    ws.on('error', (error) => {
                        logger.error('[WebServer] WebSocket error:', error);
                        this.clients.delete(ws);
                    });
                    
                    ws.on('message', (message) => {
                        try {
                            const data = JSON.parse(message);
                            this.handleWebSocketMessage(ws, data);
                        } catch (error) {
                            logger.error('[WebServer] Invalid WebSocket message:', error);
                        }
                    });
                });
                
                // Start the server
                this.httpServer.listen(port, () => {
                    logger.log(`[WebServer] HTTP server started on port ${port}`);
                    logger.log(`[WebServer] Dashboard available at http://localhost:${port}`);
                    resolve();
                });
                
                this.httpServer.on('error', (error) => {
                    //logger.error('[WebServer] HTTP server error:', error);
                    reject(error);
                });
                
            } catch (error) {
                logger.error('[WebServer] Failed to start web server:', error);
                reject(error);
            }
        });
    }
    
    stop() {
        if (this.wsServer) {
            this.wsServer.close();
        }
        if (this.httpServer) {
            this.httpServer.close();
        }
        logger.log('[WebServer] Web server stopped');
    }
    
    setupEventListeners() {
        // Monitor BBS sessions for connection updates
        if (this.bbsServer) {
            // Listen for session data events
            this.bbsServer.on('sessionDataReceived', (data) => {
                this.broadcastSessionData(data);
            });
            
            this.bbsServer.on('sessionDataSent', (data) => {
                this.broadcastSessionData(data);
            });
            
            // Check for session changes periodically
            setInterval(() => {
                this.broadcastCurrentConnections();
            }, 5000); // Check every 5 seconds
        }
        
        // Monitor for new APRS messages (we'll need to modify aprs.js to emit events)
        // For now, we'll poll for new messages
        setInterval(() => {
            this.broadcastSystemStatus();
        }, 10000); // Update system status every 10 seconds
    }
    
    handleHttpRequest(req, res) {
        const url = req.url === '/' ? '/index.html' : req.url;
        const filePath = path.join(__dirname, './web', url);
        
        // Security check - prevent directory traversal
        const webDir = path.join(__dirname, './web');
        const resolvedPath = path.resolve(filePath);
        if (!resolvedPath.startsWith(webDir)) {
            res.writeHead(403);
            res.end('Forbidden');
            return;
        }
        
        // Serve static files
        fs.readFile(filePath, (err, data) => {
            if (err) {
                if (err.code === 'ENOENT') {
                    res.writeHead(404);
                    res.end('Not Found');
                } else {
                    res.writeHead(500);
                    res.end('Internal Server Error');
                }
                return;
            }
            
            // Set content type based on file extension
            const ext = path.extname(filePath).toLowerCase();
            const contentTypes = {
                '.html': 'text/html',
                '.css': 'text/css',
                '.js': 'application/javascript',
                '.json': 'application/json',
                '.png': 'image/png',
                '.jpg': 'image/jpeg',
                '.gif': 'image/gif',
                '.ico': 'image/x-icon'
            };
            
            const contentType = contentTypes[ext] || 'text/plain';
            res.writeHead(200, { 'Content-Type': contentType });
            res.end(data);
        });
    }
    
    handleWebSocketMessage(ws, data) {
        switch (data.type) {
            case 'get_initial_data':
                this.sendInitialData(ws);
                break;
            case 'refresh_data':
                this.sendAllData(ws);
                break;
            case 'delete_bulletin':
                this.handleBulletinDeletion(ws, data);
                break;
            case 'create_bulletin':
                this.handleBulletinCreation(ws, data);
                break;
            case 'delete_mail':
                this.handleMailDeletion(ws, data);
                break;
            case 'compose_mail':
                this.handleMailComposition(ws, data);
                break;
            default:
                logger.log('[WebServer] Unknown WebSocket message type:', data.type);
        }
    }
    
    sendInitialData(ws) {
        // Send all current data to a new client
        this.sendSystemStatus(ws);
        this.sendCurrentConnections(ws);
        this.sendBbsConnections(ws);
        this.sendAprsMessages(ws);
        this.sendBulletins(ws);
        this.sendWinlinkMails(ws);
    }
    
    sendAllData(ws) {
        // Refresh all data for a client
        this.sendInitialData(ws);
    }
    
    sendSystemStatus(ws = null) {
        const now = new Date();
        const uptimeMs = now.getTime() - this.startTime.getTime();
        const systemUptimeSeconds = os.uptime();
        
        // Get last BBS activity timestamp
        let lastBbsActivity = null;
        if (this.bbsServer && this.bbsServer.storage) {
            try {
                const connectionKeys = this.bbsServer.storage.list('connection-%');
                if (connectionKeys.length > 0) {
                    connectionKeys.sort().reverse();
                    const lastConnection = this.bbsServer.storage.load(connectionKeys[0]);
                    if (lastConnection && lastConnection.timestamp) {
                        lastBbsActivity = lastConnection.timestamp;
                    }
                }
            } catch (error) {
                logger.error('[WebServer] Error getting last BBS activity:', error);
            }
        }
        
        // Get last APRS message timestamp and counts
        let lastAprsMessage = null;
        let aprsMessageCount = 0;
        let aprsStationsCount = 0;
        if (this.bbsServer && this.bbsServer.aprsMessageStorage) {
            try {
                const messageKeys = this.bbsServer.aprsMessageStorage.list('aprs-msg-%');
                aprsMessageCount = messageKeys.length;
                
                if (messageKeys.length > 0) {
                    messageKeys.sort().reverse();
                    const lastMessage = this.bbsServer.aprsMessageStorage.load(messageKeys[0]);
                    if (lastMessage && lastMessage.timestamp) {
                        lastAprsMessage = lastMessage.timestamp;
                    }
                    
                    // Count unique stations
                    const uniqueStations = new Set();
                    for (const key of messageKeys) {
                        const msg = this.bbsServer.aprsMessageStorage.load(key);
                        if (msg && msg.source) {
                            uniqueStations.add(msg.source);
                        }
                    }
                    aprsStationsCount = uniqueStations.size;
                }
            } catch (error) {
                logger.error('[WebServer] Error getting APRS data:', error);
            }
        }
        
        // Get bulletin count
        let bulletinCount = 0;
        if (this.bbsServer && this.bbsServer.bulletinStorage) {
            try {
                const bulletins = this.bbsServer.getAllActiveBulletins();
                bulletinCount = bulletins.length;
            } catch (error) {
                logger.error('[WebServer] Error getting bulletin count:', error);
            }
        }
        
        // Get BBS total connections count
        let bbsTotalConnections = 0;
        if (this.bbsServer && this.bbsServer.storage) {
            try {
                const connectionKeys = this.bbsServer.storage.list('connection-%');
                bbsTotalConnections = connectionKeys.length;
            } catch (error) {
                logger.error('[WebServer] Error getting BBS connection count:', error);
            }
        }
        
        const data = {
            type: this.EVENT_TYPES.SYSTEM_STATUS,
            timestamp: now.toISOString(),
            callsign: this.config.CALLSIGN,
            stationId: this.config.STATIONID,
            bbsStationId: this.config.BBS_STATION_ID,
            winlinkStationId: this.config.WINLINK_STATION_ID,
            radioConnected: this.radio ? (this.radio.state === 3) : false, // RadioState.CONNECTED = 3
            appUptime: this.formatUptime(uptimeMs / 1000),
            systemUptime: this.formatUptime(systemUptimeSeconds),
            activeConnections: this.bbsServer ? this.bbsServer.activeSessions.size : 0,
            lastBbsActivity: lastBbsActivity,
            lastAprsMessage: lastAprsMessage,
            aprsMessageCount: aprsMessageCount,
            aprsStationsCount: aprsStationsCount,
            bulletinCount: bulletinCount,
            bbsTotalConnections: bbsTotalConnections
        };
        
        this.sendToClients(data, ws);
    }
    
    sendCurrentConnections(ws = null) {
        const activeConnections = [];
        
        if (this.bbsServer && this.bbsServer.activeSessions) {
            for (const [sessionKey, session] of this.bbsServer.activeSessions) {
                const startTime = this.bbsServer.sessionStartTimes.get(sessionKey);
                const menuState = this.bbsServer.sessionMenuStates.get(sessionKey);
                
                activeConnections.push({
                    callsign: sessionKey,
                    state: session.currentState,
                    connectedAt: startTime ? startTime.toISOString() : null,
                    duration: startTime ? this.formatUptime((new Date().getTime() - startTime.getTime()) / 1000) : null,
                    menuState: menuState || 'unknown'
                });
            }
        }
        
        const data = {
            type: this.EVENT_TYPES.CURRENT_CONNECTION,
            timestamp: new Date().toISOString(),
            connections: activeConnections
        };
        
        this.sendToClients(data, ws);
    }
    
    sendBbsConnections(ws = null) {
        const connections = this.getBbsConnectionHistory();
        
        const data = {
            type: this.EVENT_TYPES.BBS_CONNECTIONS,
            timestamp: new Date().toISOString(),
            connections: connections
        };
        
        this.sendToClients(data, ws);
    }
    
    sendAprsMessages(ws = null) {
        const messages = this.getAprsMessageHistory();
        
        const data = {
            type: this.EVENT_TYPES.APRS_MESSAGES,
            timestamp: new Date().toISOString(),
            messages: messages
        };
        
        this.sendToClients(data, ws);
    }
    
    sendBulletins(ws = null) {
        const bulletins = this.getBulletinHistory();
        
        const data = {
            type: this.EVENT_TYPES.BULLETINS,
            timestamp: new Date().toISOString(),
            bulletins: bulletins
        };
        
        this.sendToClients(data, ws);
    }
    
    sendWinlinkMails(ws = null) {
        const mails = this.getWinlinkMails();
        
        const data = {
            type: this.EVENT_TYPES.WINLINK_MAILS,
            timestamp: new Date().toISOString(),
            mails: mails
        };
        
        this.sendToClients(data, ws);
    }
    
    getWinlinkMails() {
        logger.log('[WebServer] getWinlinkMails called');
        
        if (!this.winlinkServer) {
            logger.log('[WebServer] No WinLink server available');
            return { 
                inbox: [], outbox: [], draft: [], sent: [], archive: [], trash: [],
                inboxSize: 0, outboxSize: 0, draftSize: 0, sentSize: 0, archiveSize: 0, trashSize: 0
            };
        }
        
        try {
            logger.log('[WebServer] Retrieving WinLink mails');
            const allMails = this.winlinkServer.mails || [];
            
            // Organize by mailbox
            const inbox = [];
            const outbox = [];
            const draft = [];
            const sent = [];
            const archive = [];
            const trash = [];
            
            // Track sizes
            let inboxSize = 0;
            let outboxSize = 0;
            let draftSize = 0;
            let sentSize = 0;
            let archiveSize = 0;
            let trashSize = 0;
            
            for (const mail of allMails) {
                // Calculate mail size (approximate)
                const mailSize = (mail.from || '').length + 
                               (mail.to || '').length + 
                               (mail.cc || '').length + 
                               (mail.subject || '').length + 
                               (mail.body || '').length;
                
                const mailData = {
                    mid: mail.mid,
                    from: mail.from,
                    to: mail.to,
                    cc: mail.cc || '',
                    subject: mail.subject || '(no subject)',
                    body: mail.body || '',
                    dateTime: mail.dateTime,
                    flags: mail.flags || 0,
                    isUnread: (mail.flags & 1) !== 0,
                    isPrivate: (mail.flags & 2) !== 0,
                    attachmentCount: mail.attachments ? mail.attachments.length : 0
                };
                
                // Mailbox values: 0=inbox, 1=outbox, 2=draft, 3=sent, 4=archive, 5=trash
                if (mail.mailbox === 0) {
                    inbox.push(mailData);
                    inboxSize += mailSize;
                } else if (mail.mailbox === 1) {
                    outbox.push(mailData);
                    outboxSize += mailSize;
                } else if (mail.mailbox === 2) {
                    draft.push(mailData);
                    draftSize += mailSize;
                } else if (mail.mailbox === 3) {
                    sent.push(mailData);
                    sentSize += mailSize;
                } else if (mail.mailbox === 4) {
                    archive.push(mailData);
                    archiveSize += mailSize;
                } else if (mail.mailbox === 5) {
                    trash.push(mailData);
                    trashSize += mailSize;
                }
            }
            
            // Sort by date (newest first)
            const sortByDate = (a, b) => new Date(b.dateTime) - new Date(a.dateTime);
            inbox.sort(sortByDate);
            outbox.sort(sortByDate);
            draft.sort(sortByDate);
            sent.sort(sortByDate);
            archive.sort(sortByDate);
            trash.sort(sortByDate);
            
            logger.log(`[WebServer] Retrieved ${inbox.length} inbox (${inboxSize} bytes), ${outbox.length} outbox (${outboxSize} bytes), ${draft.length} draft (${draftSize} bytes), ${sent.length} sent (${sentSize} bytes), ${archive.length} archive (${archiveSize} bytes), ${trash.length} trash (${trashSize} bytes) mails`);
            
            return { 
                inbox, outbox, draft, sent, archive, trash,
                inboxSize, outboxSize, draftSize, sentSize, archiveSize, trashSize
            };
        } catch (error) {
            logger.error('[WebServer] Error retrieving WinLink mails:', error);
            return { 
                inbox: [], outbox: [], draft: [], sent: [], archive: [], trash: [],
                inboxSize: 0, outboxSize: 0, draftSize: 0, sentSize: 0, archiveSize: 0, trashSize: 0
            };
        }
    }
    
    getBulletinHistory() {
        logger.log('[WebServer] getBulletinHistory called');
        
        if (!this.bbsServer) {
            logger.log('[WebServer] No BBS server available');
            return [];
        }
        
        if (!this.bbsServer.bulletinStorage) {
            logger.log('[WebServer] No bulletin storage available');
            return [];
        }
        
        try {
            logger.log('[WebServer] Attempting to get all active bulletins');
            const bulletins = this.bbsServer.getAllActiveBulletins();
            logger.log(`[WebServer] Retrieved ${bulletins.length} active bulletins`);
            
            return bulletins.map(bulletin => ({
                id: bulletin.id,
                callsign: bulletin.callsign,
                message: bulletin.message,
                postedTime: bulletin.postedTime,
                expireTime: bulletin.expireTime,
                postedTimeLocal: bulletin.postedTimeLocal,
                expireTimeLocal: bulletin.expireTimeLocal,
                expireDays: bulletin.expireDays
            }));
        } catch (error) {
            logger.error('[WebServer] Error retrieving bulletins:', error);
            return [];
        }
    }
    
    getBbsConnectionHistory() {
        logger.log('[WebServer] getBbsConnectionHistory called');
        
        if (!this.bbsServer) {
            logger.log('[WebServer] No BBS server available');
            return [];
        }
        
        if (!this.bbsServer.storage) {
            logger.log('[WebServer] No BBS storage available');
            return [];
        }
        
        try {
            logger.log('[WebServer] Attempting to list connection keys');
            const connectionKeys = this.bbsServer.storage.list('connection-%');
            logger.log(`[WebServer] Found ${connectionKeys.length} connection keys`);
            
            connectionKeys.sort().reverse();
            const recentKeys = connectionKeys.slice(0, 20);
            
            const connections = [];
            for (const key of recentKeys) {
                const record = this.bbsServer.storage.load(key);
                if (record) {
                    connections.push({
                        callsign: record.callsign,
                        timestamp: record.timestamp,
                        localTime: record.localTime,
                        packetsSent: record.packetsSent || 0,
                        packetsReceived: record.packetsReceived || 0,
                        bytesSent: record.bytesSent || 0,
                        bytesReceived: record.bytesReceived || 0,
                        connectionDuration: record.connectionDuration || 0
                    });
                }
            }
            
            logger.log(`[WebServer] Retrieved ${connections.length} BBS connections`);
            return connections;
        } catch (error) {
            logger.error('[WebServer] Error retrieving BBS connections:', error);
            return [];
        }
    }
    
    getAprsMessageHistory() {
        logger.log('[WebServer] getAprsMessageHistory called');
        
        if (!this.bbsServer) {
            logger.log('[WebServer] No BBS server available');
            return [];
        }
        
        if (!this.bbsServer.aprsMessageStorage) {
            logger.log('[WebServer] No APRS message storage available');
            return [];
        }
        
        try {
            logger.log('[WebServer] Attempting to list APRS message keys');
            const messageKeys = this.bbsServer.aprsMessageStorage.list('aprs-msg-%');
            logger.log(`[WebServer] Found ${messageKeys.length} APRS message keys`);
            
            messageKeys.sort().reverse();
            const recentKeys = messageKeys.slice(0, 100); // Increased from 20 to 100 for better map display
            
            const messages = [];
            for (const key of recentKeys) {
                const record = this.bbsServer.aprsMessageStorage.load(key);
                if (record) {
                    messages.push({
                        source: record.source,
                        destination: record.destination,
                        message: record.message,
                        dataType: record.dataType || 'Message',
                        direction: record.direction || 'received',
                        timestamp: record.timestamp,
                        localTime: record.localTime,
                        position: record.position || null,
                        weather: record.weather || null
                    });
                }
            }
            
            logger.log(`[WebServer] Retrieved ${messages.length} APRS messages`);
            return messages;
        } catch (error) {
            logger.error('[WebServer] Error retrieving APRS messages:', error);
            return [];
        }
    }
    
    broadcastSystemStatus() {
        this.sendSystemStatus();
    }
    
    broadcastCurrentConnections() {
        this.sendCurrentConnections();
    }
    
    broadcastConnectionUpdate(sessionKey, action) {
        const data = {
            type: this.EVENT_TYPES.CONNECTION_UPDATE,
            timestamp: new Date().toISOString(),
            sessionKey: sessionKey,
            action: action // 'connected' or 'disconnected'
        };
        
        this.sendToClients(data);
        
        // Also update the full connection list
        this.sendCurrentConnections();
        this.sendBbsConnections();
    }
    
    broadcastSessionData(sessionData) {
        const data = {
            type: this.EVENT_TYPES.SESSION_DATA,
            timestamp: new Date().toISOString(),
            sessionKey: sessionData.sessionKey,
            direction: sessionData.direction,
            data: sessionData.data,
            originalTimestamp: sessionData.timestamp
        };
        
        this.sendToClients(data);
    }
    
    broadcastAprsMessage(sourceCallsign, destinationCallsign, messageText) {
        const data = {
            type: this.EVENT_TYPES.APRS_MESSAGE,
            timestamp: new Date().toISOString(),
            source: sourceCallsign,
            destination: destinationCallsign,
            message: messageText
        };
        
        this.sendToClients(data);
        
        // Also update the full message list
        this.sendAprsMessages();
    }
    
    handleBulletinCreation(ws, data) {
        logger.log('[WebServer] Handling bulletin creation request:', data);
        
        if (!this.bbsServer || !this.bbsServer.bulletinStorage) {
            this.sendResponse(ws, {
                type: 'bulletin_create_result',
                success: false,
                error: 'Bulletin storage not available'
            });
            return;
        }
        
        const { message } = data;
        
        if (!message || typeof message !== 'string') {
            this.sendResponse(ws, {
                type: 'bulletin_create_result',
                success: false,
                error: 'Bulletin message is required'
            });
            return;
        }
        
        // Use station callsign for web-created bulletins
        const stationCallsign = this.config.CALLSIGN;
        
        try {
            // Create bulletin using BBS server's createBulletin method
            const result = this.bbsServer.createBulletin(stationCallsign, message);
            
            if (result.success) {
                logger.log(`[WebServer] Web created bulletin ${result.bulletin.id} by ${stationCallsign}`);
                
                this.sendResponse(ws, {
                    type: 'bulletin_create_result',
                    success: true,
                    bulletin: result.bulletin
                });
                
                // Broadcast updated bulletin list to all clients
                this.sendBulletins();
            } else {
                this.sendResponse(ws, {
                    type: 'bulletin_create_result',
                    success: false,
                    error: result.error
                });
            }
        } catch (error) {
            logger.error('[WebServer] Error creating bulletin:', error);
            this.sendResponse(ws, {
                type: 'bulletin_create_result',
                success: false,
                error: 'Internal error creating bulletin'
            });
        }
    }
    
    handleMailDeletion(ws, data) {
        logger.log('[WebServer] Handling mail deletion request:', data);
        
        if (!this.winlinkServer) {
            this.sendResponse(ws, {
                type: 'mail_delete_result',
                success: false,
                error: 'WinLink server not available',
                mid: data.mid,
                permanent: data.permanent
            });
            return;
        }
        
        const { mid, permanent } = data;
        
        if (!mid) {
            this.sendResponse(ws, {
                type: 'mail_delete_result',
                success: false,
                error: 'Mail ID is required',
                mid: mid,
                permanent: permanent
            });
            return;
        }
        
        try {
            // Find the mail in the WinLink server's mail array
            const mailIndex = this.winlinkServer.mails.findIndex(m => m.mid === mid);
            
            if (mailIndex === -1) {
                this.sendResponse(ws, {
                    type: 'mail_delete_result',
                    success: false,
                    error: 'Mail not found',
                    mid: mid,
                    permanent: permanent
                });
                return;
            }
            
            const mail = this.winlinkServer.mails[mailIndex];
            
            if (permanent) {
                // Permanently delete the mail
                this.winlinkServer.mails.splice(mailIndex, 1);
                logger.log(`[WebServer] Permanently deleted mail ${mid}`);
                
                // Save to storage if available
                if (this.winlinkServer.storage) {
                    this.winlinkServer.storage.save('winlink-mails', this.winlinkServer.mails);
                }
                
                this.sendResponse(ws, {
                    type: 'mail_delete_result',
                    success: true,
                    mid: mid,
                    permanent: true
                });
            } else {
                // Move to trash (mailbox 5)
                mail.mailbox = 5;
                logger.log(`[WebServer] Moved mail ${mid} to trash`);
                
                // Save to storage if available
                if (this.winlinkServer.storage) {
                    this.winlinkServer.storage.save('winlink-mails', this.winlinkServer.mails);
                }
                
                this.sendResponse(ws, {
                    type: 'mail_delete_result',
                    success: true,
                    mid: mid,
                    permanent: false
                });
            }
            
            // Broadcast updated mail list to all clients
            this.sendWinlinkMails();
            
        } catch (error) {
            logger.error('[WebServer] Error deleting mail:', error);
            this.sendResponse(ws, {
                type: 'mail_delete_result',
                success: false,
                error: 'Internal error deleting mail',
                mid: mid,
                permanent: permanent
            });
        }
    }
    
    handleMailComposition(ws, data) {
        logger.log('[WebServer] Handling mail composition request:', data);
        
        if (!this.winlinkServer) {
            this.sendResponse(ws, {
                type: 'mail_compose_result',
                success: false,
                error: 'WinLink server not available',
                isDraft: data.isDraft
            });
            return;
        }
        
        const { to, subject, body, isDraft } = data;
        
        // Validation
        if (!to || !subject || !body) {
            this.sendResponse(ws, {
                type: 'mail_compose_result',
                success: false,
                error: 'To, subject, and body are required',
                isDraft: isDraft
            });
            return;
        }
        
        try {
            // Generate unique MID (Message ID)
            const crypto = require('crypto');
            const mid = crypto.randomBytes(6).toString('hex').toUpperCase();
            
            // Get station callsign as sender
            const from = this.config.CALLSIGN;
            
            // Create new mail object
            const newMail = {
                mid: mid,
                from: from,
                to: to.toUpperCase(),
                cc: '',
                subject: subject,
                body: body,
                dateTime: new Date().toISOString(),
                flags: 0, // Not unread, not private
                mailbox: isDraft ? 2 : 1, // 2=draft, 1=outbox
                attachments: []
            };
            
            // Add to WinLink server's mail array
            this.winlinkServer.mails.push(newMail);
            
            logger.log(`[WebServer] Created ${isDraft ? 'draft' : 'outbox'} mail ${mid} from ${from} to ${to}`);
            
            // Save to storage if available
            if (this.winlinkServer.storage) {
                this.winlinkServer.storage.save('winlink-mails', this.winlinkServer.mails);
            }
            
            this.sendResponse(ws, {
                type: 'mail_compose_result',
                success: true,
                mid: mid,
                isDraft: isDraft
            });
            
            // Broadcast updated mail list to all clients
            this.sendWinlinkMails();
            
        } catch (error) {
            logger.error('[WebServer] Error composing mail:', error);
            this.sendResponse(ws, {
                type: 'mail_compose_result',
                success: false,
                error: 'Internal error composing mail',
                isDraft: isDraft
            });
        }
    }
    
    handleBulletinDeletion(ws, data) {
        logger.log('[WebServer] Handling bulletin deletion request:', data);
        
        if (!this.bbsServer || !this.bbsServer.bulletinStorage) {
            this.sendResponse(ws, {
                type: 'bulletin_delete_result',
                success: false,
                error: 'Bulletin storage not available'
            });
            return;
        }
        
        const { bulletinId } = data;
        
        if (!bulletinId) {
            this.sendResponse(ws, {
                type: 'bulletin_delete_result',
                success: false,
                error: 'Bulletin ID is required'
            });
            return;
        }
        
        try {
            // For web admin deletion, we'll delete as admin (bypass callsign check)
            // First check if bulletin exists
            const storageKey = `bulletin-${bulletinId}`;
            const bulletin = this.bbsServer.bulletinStorage.load(storageKey);
            
            if (!bulletin) {
                this.sendResponse(ws, {
                    type: 'bulletin_delete_result',
                    success: false,
                    error: 'Bulletin not found'
                });
                return;
            }
            
            // Admin can delete any bulletin from web interface
            if (this.bbsServer.bulletinStorage.delete(storageKey)) {
                logger.log(`[WebServer] Admin deleted bulletin ${bulletinId} by ${bulletin.callsign}`);
                
                this.sendResponse(ws, {
                    type: 'bulletin_delete_result',
                    success: true,
                    bulletinId: bulletinId
                });
                
                // Broadcast updated bulletin list to all clients
                this.sendBulletins();
            } else {
                this.sendResponse(ws, {
                    type: 'bulletin_delete_result',
                    success: false,
                    error: 'Failed to delete bulletin'
                });
            }
        } catch (error) {
            logger.error('[WebServer] Error deleting bulletin:', error);
            this.sendResponse(ws, {
                type: 'bulletin_delete_result',
                success: false,
                error: 'Internal error deleting bulletin'
            });
        }
    }
    
    sendResponse(ws, data) {
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(data));
        }
    }
    
    sendToClients(data, specificClient = null) {
        const message = JSON.stringify(data);
        
        if (specificClient) {
            // Send to specific client
            if (specificClient.readyState === WebSocket.OPEN) {
                specificClient.send(message);
            }
        } else {
            // Broadcast to all connected clients
            for (const client of this.clients) {
                if (client.readyState === WebSocket.OPEN) {
                    client.send(message);
                } else {
                    // Remove dead connections
                    this.clients.delete(client);
                }
            }
        }
    }
    
    formatUptime(seconds) {
        const days = Math.floor(seconds / 86400);
        const hours = Math.floor((seconds % 86400) / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const secs = Math.floor(seconds % 60);
        
        let result = '';
        if (days > 0) result += `${days}d `;
        if (hours > 0) result += `${hours}h `;
        if (minutes > 0) result += `${minutes}m `;
        result += `${secs}s`;
        
        return result.trim();
    }
}

module.exports = WebServer;
