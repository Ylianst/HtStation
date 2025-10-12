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

const { WinlinkSecurity, WinLinkChecksum } = require('./winlink-utils');
const { WinLinkMail, MailFlags } = require('./winlink-mail');
const AX25Session = require('./AX25Session');

/**
 * WinLink Server - Implements the B2F (Basic to Full-service) WinLink protocol
 * Handles mail exchange between WinLink clients and the station
 */
class WinLinkServer {
    constructor(config, storage, sessionRegistry) {
        this.config = config;
        this.storage = storage;
        this.sessionRegistry = sessionRegistry;
        this.callsign = config.callsign;
        this.stationId = config.winlinkStationId;
        this.password = config.winlinkPassword || '';
        this.version = config.version || '1.0';
        this.radio = null; // Will be set when processing packets
        
        // In-memory mail cache
        this.mails = [];
        
        // Active AX25 sessions
        this.activeSessions = new Map(); // Map of session keys to session objects
        
        // Load mails from storage
        this.loadMails();
        
        console.log(`[WinLink] Server initialized on ${this.callsign}-${this.stationId}`);
        if (this.password) {
            console.log('[WinLink] Password authentication enabled');
        }
    }

    /**
     * Get session key from addresses
     */
    getSessionKey(addresses) {
        if (!addresses || addresses.length < 2) return null;
        // Use remote station as key (addresses[1] is the source/remote station)
        return addresses[1].callSignWithId;
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
                console.log(`[WinLink] ${sessionKey} is busy with another server`);
                this.sendBusyResponse(packet);
                return null;
            }
            
            console.log(`[WinLink] Creating new session for ${sessionKey}`);
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
                console.log(`[WinLink] ${sessionKey} state changed to ${state}`);
                if (state === AX25Session.ConnectionState.CONNECTED) {
                    this.onConnect(session);
                } else if (state === AX25Session.ConnectionState.DISCONNECTED) {
                    console.log(`[WinLink] Removing disconnected session for ${sessionKey}`);
                    this.onDisconnect(session);
                    this.activeSessions.delete(sessionKey);
                }
            });
            
            session.on('dataReceived', (data) => {
                console.log(`[WinLink] ${sessionKey} received ${data.length} bytes`);
                this.onData(session, data);
            });
            
            session.on('error', (error) => {
                console.log(`[WinLink] ${sessionKey} error: ${error}`);
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
        if (serialized && this.radio && typeof this.radio.sendTncFrame === 'function') {
            this.radio.sendTncFrame({
                channel_id: packet.channel_id,
                data: serialized
            });
            console.log('[WinLink] Sent DM (busy) response');
        }
    }

    /**
     * Load mails from storage
     */
    loadMails() {
        try {
            const stored = this.storage.load('winlink-mails');
            if (stored && Array.isArray(stored)) {
                this.mails = stored.map(m => this.deserializeMail(m));
                console.log(`[WinLink] Loaded ${this.mails.length} mails from storage`);
            } else {
                this.mails = [];
            }
        } catch (error) {
            console.error('[WinLink] Error loading mails:', error);
            this.mails = [];
        }
    }

    /**
     * Save mails to storage
     */
    saveMails() {
        try {
            const serialized = this.mails.map(m => this.serializeMail(m));
            this.storage.save('winlink-mails', serialized);
        } catch (error) {
            console.error('[WinLink] Error saving mails:', error);
        }
    }

    /**
     * Serialize mail for storage (convert Date to ISO string)
     */
    serializeMail(mail) {
        const serialized = { ...mail };
        if (mail.dateTime instanceof Date) {
            serialized.dateTime = mail.dateTime.toISOString();
        }
        // Convert attachments buffers to base64 for storage
        if (mail.attachments && Array.isArray(mail.attachments)) {
            serialized.attachments = mail.attachments.map(att => ({
                name: att.name,
                data: att.data.toString('base64')
            }));
        }
        return serialized;
    }

    /**
     * Deserialize mail from storage (convert ISO string to Date)
     */
    deserializeMail(stored) {
        const mail = { ...stored };
        if (typeof stored.dateTime === 'string') {
            mail.dateTime = new Date(stored.dateTime);
        }
        // Convert attachments from base64 to Buffer
        if (stored.attachments && Array.isArray(stored.attachments)) {
            mail.attachments = stored.attachments.map(att => ({
                name: att.name,
                data: Buffer.from(att.data, 'base64')
            }));
        }
        return mail;
    }

    /**
     * Add a new mail to the collection
     */
    addMail(mail) {
        this.mails.push(mail);
        this.saveMails();
        console.log(`[WinLink] Added mail ${mail.mid} from ${mail.from} to ${mail.to}`);
    }

    /**
     * Check if we already have a mail with this MID
     */
    hasMail(mid) {
        return this.mails.some(m => m.mid === mid);
    }

    /**
     * Get outgoing mails for a specific callsign
     */
    getOutgoingMails(callsign) {
        return this.mails.filter(mail => {
            if (mail.mailbox !== 1) return false; // Only outbox
            if (!mail.mid || mail.mid.length !== 12) return false;
            
            const result = WinLinkMail.isMailForStation(callsign, mail.to, mail.cc);
            return result.forStation;
        });
    }

    /**
     * Mark mails as sent
     */
    markMailsAsSent(mids) {
        let changed = false;
        for (const mail of this.mails) {
            if (mids.includes(mail.mid) && mail.mailbox === 1) {
                mail.mailbox = 3; // Mark as sent
                changed = true;
            }
        }
        if (changed) {
            this.saveMails();
        }
    }

    /**
     * Handle new AX25 session connection
     */
    onConnect(session) {
        const remoteCallsign = session.remoteCallsign;
        
        console.log(`[WinLink] ${remoteCallsign} connected`);

        // Register this session
        this.sessionRegistry.registerSession(remoteCallsign, session, 'winlink');
        
        // Initialize session state
        session.winlinkState = {
            mode: 'connected',
            authenticated: !this.password, // Auto-auth if no password
            challenge: WinlinkSecurity.generateChallenge(),
            proposals: [],
            proposalChecksum: null,
            binaryBuffer: null,
            outgoingMails: [],
            outgoingBlocks: [],
            proposalResponses: null
        };

        // Send greeting
        const greeting = this.buildGreeting(session);
        this.sendText(session, greeting);
    }

    /**
     * Build greeting message
     */
    buildGreeting(session) {
        let greeting = `Handy-Talky Station WinLink Server\r`;
        greeting += `[HTCmd-${this.version}-B2FWIHJM$]\r`;
        
        // Add password challenge if configured
        if (this.password) {
            greeting += `;PQ: ${session.winlinkState.challenge}\r`;
        }
        
        greeting += `>\r`;
        return greeting;
    }

    /**
     * Handle session disconnect
     */
    onDisconnect(session) {
        const remoteCallsign = session.remoteCallsign;
        console.log(`[WinLink] ${remoteCallsign} disconnected`);
        
        // Unregister session
        this.sessionRegistry.unregisterSession(remoteCallsign);
        
        // Clean up session state
        if (session.winlinkState) {
            session.winlinkState = null;
        }
    }

    /**
     * Handle incoming data
     */
    onData(session, data) {
        if (!session.winlinkState) {
            console.error('[WinLink] Session state not initialized');
            return;
        }

        const state = session.winlinkState;

        // Check if we're in binary mode
        if (state.mode === 'receiving_mail' && state.binaryBuffer) {
            this.handleBinaryData(session, data);
            return;
        }

        // Parse text commands
        const text = data.toString('utf8');
        const lines = text.replace(/\r\n/g, '\r').replace(/\n/g, '\r').split('\r');
        
        for (const line of lines) {
            if (line.length === 0) continue;
            this.handleCommand(session, line.trim());
        }
    }

    /**
     * Handle a WinLink command
     */
    handleCommand(session, line) {
        const state = session.winlinkState;
        
        // Parse command and value
        let cmd = line.toUpperCase();
        let value = '';
        const spaceIdx = line.indexOf(' ');
        if (spaceIdx > 0) {
            cmd = line.substring(0, spaceIdx).toUpperCase();
            value = line.substring(spaceIdx + 1);
        }

        console.log(`[WinLink] ${session.remoteCallsign} > ${cmd}${value ? ' ' + value : ''}`);

        // Handle commands
        switch (cmd) {
            case ';PR:':
                this.handlePasswordResponse(session, value);
                break;
                
            case 'FC':
                this.handleProposal(session, value);
                break;
                
            case 'F>':
                this.handleProposalEnd(session, value);
                break;
                
            case 'FS':
                this.handleProposalResponses(session, value);
                break;
                
            case 'FF':
                this.handleRequestOutgoing(session);
                break;
                
            case 'FQ':
                this.handleQuit(session);
                break;
                
            default:
                console.log(`[WinLink] Unknown command: ${cmd}`);
                break;
        }
    }

    /**
     * Handle password authentication response
     */
    handlePasswordResponse(session, response) {
        const state = session.winlinkState;
        
        if (!this.password) {
            console.log('[WinLink] Password auth not required');
            return;
        }

        const expected = WinlinkSecurity.secureLoginResponse(state.challenge, this.password);
        
        if (response === expected) {
            state.authenticated = true;
            console.log(`[WinLink] ${session.remoteCallsign} authenticated successfully`);
        } else {
            console.log(`[WinLink] ${session.remoteCallsign} authentication failed`);
            session.disconnect();
        }
    }

    /**
     * Handle mail proposal (FC command)
     */
    handleProposal(session, value) {
        const state = session.winlinkState;
        
        // Collect proposals
        state.proposals.push(value);
        state.mode = 'receiving_proposals';
    }

    /**
     * Handle proposal end (F> command) with checksum
     */
    handleProposalEnd(session, checksumStr) {
        const state = session.winlinkState;
        
        if (state.proposals.length === 0) {
            console.log('[WinLink] No proposals to process');
            return;
        }

        // Calculate checksum of proposals
        let checksum = 0;
        for (const proposal of state.proposals) {
            const line = `FC ${proposal}\r`;
            const bytes = Buffer.from(line, 'ascii');
            for (let i = 0; i < bytes.length; i++) {
                checksum += bytes[i];
            }
        }
        checksum = (-checksum) & 0xFF;
        
        // Validate checksum
        const expectedChecksum = checksum.toString(16).toUpperCase().padStart(2, '0');
        if (checksumStr !== expectedChecksum) {
            console.log(`[WinLink] Checksum mismatch: expected ${expectedChecksum}, got ${checksumStr}`);
            session.disconnect();
            return;
        }

        // Process proposals and build response
        let response = 'FS ';
        const acceptedProposals = [];
        
        for (const proposal of state.proposals) {
            const parts = proposal.split(' ');
            
            // Expected format: EM <MID> <uncompressed> <compressed> <unknown>
            if (parts.length >= 5 && parts[0] === 'EM' && parts[1].length === 12) {
                const mid = parts[1];
                
                // Check if we already have this mail
                if (this.hasMail(mid)) {
                    response += 'N'; // No, already have it
                    console.log(`[WinLink] Rejecting duplicate mail ${mid}`);
                } else {
                    response += 'Y'; // Yes, accept it
                    acceptedProposals.push(proposal);
                    console.log(`[WinLink] Accepting mail ${mid}`);
                }
            } else {
                response += 'H'; // Hold/defer
                console.log(`[WinLink] Invalid proposal format: ${proposal}`);
            }
        }

        response += '\r';
        this.sendText(session, response);

        // If we accepted any proposals, prepare to receive binary data
        if (acceptedProposals.length > 0) {
            state.mode = 'receiving_mail';
            state.binaryBuffer = Buffer.alloc(0);
            state.acceptedProposals = acceptedProposals;
        } else {
            // No mails accepted, reset
            state.mode = 'connected';
            state.proposals = [];
        }
    }

    /**
     * Handle binary mail data
     */
    handleBinaryData(session, data) {
        const state = session.winlinkState;
        
        // Append to buffer
        state.binaryBuffer = Buffer.concat([state.binaryBuffer, data]);
        
        console.log(`[WinLink] Received binary data, buffer size: ${state.binaryBuffer.length}`);

        // Try to extract complete mails
        while (this.extractMail(session)) {
            // Keep extracting until no more complete mails
        }
    }

    /**
     * Extract a complete mail from binary buffer
     */
    extractMail(session) {
        const state = session.winlinkState;
        
        if (!state.acceptedProposals || state.acceptedProposals.length === 0) {
            // All mails received, clean up
            state.mode = 'connected';
            state.binaryBuffer = null;
            state.proposals = [];
            state.acceptedProposals = null;
            
            // Now send our outgoing proposals
            this.sendOutgoingProposals(session, false);
            return false;
        }

        // Try to decode a mail
        const result = WinLinkMail.decodeBlocksToEmail(state.binaryBuffer);
        
        if (result.fail) {
            console.error('[WinLink] Failed to decode mail');
            session.disconnect();
            return false;
        }

        if (!result.mail) {
            // Need more data
            return false;
        }

        // Successfully decoded a mail
        const mail = result.mail;
        console.log(`[WinLink] Decoded mail ${mail.mid} from ${mail.from}`);

        // Remove consumed data from buffer
        if (result.dataConsumed > 0) {
            if (result.dataConsumed >= state.binaryBuffer.length) {
                state.binaryBuffer = Buffer.alloc(0);
            } else {
                state.binaryBuffer = state.binaryBuffer.slice(result.dataConsumed);
            }
        }

        // Remove this proposal from the list
        state.acceptedProposals.shift();

        // Determine mailbox: check if mail is for us
        const forUs = WinLinkMail.isMailForStation(this.callsign, mail.to, mail.cc);
        mail.mailbox = forUs.forStation ? 0 : 1; // 0=inbox, 1=outbox (forward)
        mail.flags |= MailFlags.Unread;

        // Add mail to collection
        this.addMail(mail);

        return true;
    }

    /**
     * Handle request for outgoing mail (FF command)
     */
    handleRequestOutgoing(session) {
        this.sendOutgoingProposals(session, true);
    }

    /**
     * Send proposals for outgoing mail
     */
    sendOutgoingProposals(session, lastExchange) {
        const state = session.winlinkState;
        const remoteCallsign = session.remoteCallsign.split('-')[0]; // Remove SSID for matching
        
        // Get mails for this station
        const outgoingMails = this.getOutgoingMails(remoteCallsign);
        
        if (outgoingMails.length === 0) {
            // No mail to send
            console.log('[WinLink] No outgoing mail');
            if (lastExchange) {
                this.sendText(session, 'FQ');
            } else {
                this.sendText(session, 'FF');
            }
            return;
        }

        // Build proposals
        let proposalText = '';
        let checksum = 0;
        state.outgoingMails = [];
        state.outgoingBlocks = [];

        for (const mail of outgoingMails) {
            const encResult = WinLinkMail.encodeMailToBlocks(mail);
            if (!encResult) continue;

            const { blocks, uncompressedSize, compressedSize } = encResult;
            
            state.outgoingMails.push(mail);
            state.outgoingBlocks.push(blocks);

            const proposal = `FC EM ${mail.mid} ${uncompressedSize} ${compressedSize} 0\r`;
            proposalText += proposal;
            
            const bytes = Buffer.from(proposal, 'ascii');
            for (let i = 0; i < bytes.length; i++) {
                checksum += bytes[i];
            }
        }

        if (state.outgoingMails.length > 0) {
            checksum = (-checksum) & 0xFF;
            proposalText += `F> ${checksum.toString(16).toUpperCase().padStart(2, '0')}`;
            this.sendText(session, proposalText);
            state.mode = 'awaiting_responses';
            console.log(`[WinLink] Sent ${state.outgoingMails.length} mail proposals`);
        } else {
            if (lastExchange) {
                this.sendText(session, 'FQ');
            } else {
                this.sendText(session, 'FF');
            }
        }
    }

    /**
     * Handle proposal responses (FS command)
     */
    handleProposalResponses(session, responses) {
        const state = session.winlinkState;
        
        if (!state.outgoingMails || state.outgoingMails.length === 0) {
            console.log('[WinLink] Unexpected proposal responses');
            this.sendText(session, 'FQ');
            return;
        }

        // Parse responses
        const parsedResponses = this.parseProposalResponses(responses);
        
        if (parsedResponses.length !== state.outgoingMails.length) {
            console.log('[WinLink] Response count mismatch');
            this.sendText(session, 'FQ');
            return;
        }

        // Send mails that were accepted
        let totalBytes = 0;
        let sentCount = 0;
        const sentMids = [];

        for (let i = 0; i < parsedResponses.length; i++) {
            if (parsedResponses[i] === 'Y') {
                const blocks = state.outgoingBlocks[i];
                const mail = state.outgoingMails[i];
                
                for (const block of blocks) {
                    session.send(block);
                    totalBytes += block.length;
                }
                
                sentCount++;
                sentMids.push(mail.mid);
                console.log(`[WinLink] Sent mail ${mail.mid}, ${totalBytes} bytes`);
            }
        }

        // Mark sent mails
        if (sentMids.length > 0) {
            this.markMailsAsSent(sentMids);
        }

        // Clean up
        state.mode = 'connected';
        state.outgoingMails = [];
        state.outgoingBlocks = [];
        
        console.log(`[WinLink] Transfer complete, sent ${sentCount} mails, ${totalBytes} bytes`);
    }

    /**
     * Parse proposal response string
     */
    parseProposalResponses(value) {
        const normalized = value.toUpperCase()
            .replace(/\+/g, 'Y')
            .replace(/R/g, 'N')
            .replace(/-/g, 'N')
            .replace(/=/g, 'L')
            .replace(/H/g, 'L')
            .replace(/!/g, 'A');
        
        const responses = [];
        let current = '';
        
        for (let i = 0; i < normalized.length; i++) {
            const ch = normalized[i];
            
            if (ch >= '0' && ch <= '9') {
                if (current) {
                    current += ch;
                }
            } else {
                if (current) {
                    responses.push(current);
                    current = '';
                }
                current = ch;
            }
        }
        
        if (current) {
            responses.push(current);
        }
        
        return responses;
    }

    /**
     * Handle quit command (FQ)
     */
    handleQuit(session) {
        console.log(`[WinLink] ${session.remoteCallsign} requested disconnect`);
        session.disconnect();
    }

    /**
     * Send text to session
     */
    sendText(session, text) {
        if (!text) return;
        
        const lines = text.replace(/\r\n/g, '\r').replace(/\n/g, '\r').split('\r');
        for (const line of lines) {
            if (line.trim().length === 0) continue;
            console.log(`[WinLink] ${session.remoteCallsign} < ${line}`);
        }
        
        session.send(Buffer.from(text, 'utf8'));
    }

    /**
     * Process incoming AX25 packet
     * This is the main entry point called from htstation.js
     */
    processPacket(packet, radio) {
        if (!packet || !packet.addresses || packet.addresses.length < 2) {
            console.log('[WinLink] Invalid packet structure');
            return;
        }

        // Store radio reference BEFORE creating sessions
        if (radio) {
            this.radio = radio;
        }

        // Check if first address matches our station
        const firstAddr = packet.addresses[0];
        if (firstAddr.address === this.callsign && firstAddr.SSID == this.stationId) {
            // Check if this is a session-related packet
            if (packet.isSessionPacket()) {
                console.log('[WinLink] Processing session packet');
                const session = this.getOrCreateSession(packet);
                if (session) {
                    session.receive(packet);
                } else {
                    console.log('[WinLink] Failed to create/get session for packet');
                }
            } else {
                console.log('[WinLink] Received non-session packet, ignoring');
            }
        }
    }
}

module.exports = WinLinkServer;
