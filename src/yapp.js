'use strict';

const EventEmitter = require('events');
const fs = require('fs');
const path = require('path');
const AX25Packet = require('./AX25Packet');

/**
 * YAPP (Yet Another Protocol for Packet) Implementation
 * 
 * This module implements the YAPP protocol for binary file transfer over packet radio.
 * Based on YAPP protocol specification v1.1 by Jeff Jacobsen (WA7MBL) and extensions
 * for YappC (YAPP with checksums) and resume functionality.
 */

class YappTransfer extends EventEmitter {
    constructor(session, config = {}) {
        super();
        
        this.session = session;
        this.config = {
            maxRetries: config.maxRetries || 3,
            timeout: config.timeout || 60000, // 60 seconds
            blockSize: config.blockSize || 128,
            useChecksum: config.useChecksum !== false, // Default to true for YappC
            enableResume: config.enableResume !== false, // Default to true
            ...config
        };
        
        // YAPP Control Characters (from specification)
        this.CONTROL = {
            // ACK variants
            ACK: 0x06,
            
            // ENQ variants  
            ENQ: 0x05,
            
            // Frame delimiters
            SOH: 0x01,    // Start of Header
            STX: 0x02,    // Start of Text (Data)
            ETX: 0x03,    // End of Text (EOF)
            EOT: 0x04,    // End of Transmission
            NAK: 0x15,    // Negative Acknowledge
            CAN: 0x18,    // Cancel
            DLE: 0x10     // Data Link Escape (for server text)
        };
        
        // YAPP Packet Types
        this.PACKET_TYPES = {
            // Acknowledgments
            RR: { type: this.CONTROL.ACK, subtype: 0x01 },    // Receive Ready
            RF: { type: this.CONTROL.ACK, subtype: 0x02 },    // Receive File
            AF: { type: this.CONTROL.ACK, subtype: 0x03 },    // Ack EOF
            AT: { type: this.CONTROL.ACK, subtype: 0x04 },    // Ack EOT
            CA: { type: this.CONTROL.ACK, subtype: 0x05 },    // Cancel Ack
            RT: { type: this.CONTROL.ACK, subtype: this.CONTROL.ACK }, // Receive TPK (YappC)
            
            // Requests
            SI: { type: this.CONTROL.ENQ, subtype: 0x01 },    // Send Init
            RI: { type: this.CONTROL.ENQ, subtype: 0x02 },    // Receive Init (server mode)
            
            // Data packets
            HD: { type: this.CONTROL.SOH },                   // Header
            DT: { type: this.CONTROL.STX },                   // Data
            EF: { type: this.CONTROL.ETX, subtype: 0x01 },    // End of File
            ET: { type: this.CONTROL.EOT, subtype: 0x01 },    // End of Transmission
            
            // Error/Control packets
            NR: { type: this.CONTROL.NAK },                   // Not Ready
            RE: { type: this.CONTROL.NAK },                   // Resume
            CN: { type: this.CONTROL.CAN },                   // Cancel
            TX: { type: this.CONTROL.DLE }                    // Text (server mode)
        };
        
        // Transfer state
        this.state = 'IDLE';
        this.mode = null; // 'SEND' or 'RECEIVE'
        this.retryCount = 0;
        this.timeout = null;
        this.currentFile = null;
        this.fileHandle = null;
        this.transferStats = {
            filename: null,
            fileSize: 0,
            bytesTransferred: 0,
            startTime: null,
            useChecksum: false,
            resumeOffset: 0
        };
        
        // Send-specific state
        this.sendBuffer = null;
        this.sendOffset = 0;
        this.currentSequence = 0;
        
        // Receive-specific state
        this.receiveBuffer = [];
        this.expectedLength = 0;
        this.receivePath = null;
        
        // Setup session event handlers
        this.setupSessionHandlers();
    }
    
    setupSessionHandlers() {
        // We'll handle YAPP packets through the existing session data events
        this.session.on('dataReceived', (data) => {
            this.handleIncomingData(data);
        });
        
        this.session.on('disconnected', () => {
            this.handleDisconnection();
        });
    }
    
    // === Public API Methods ===
    
    /**
     * Start sending a file to the remote station
     * @param {string} filePath - Path to the file to send
     * @param {string} filename - Name to send (optional, defaults to basename)
     */
    async startSend(filePath, filename = null) {
        if (this.state !== 'IDLE') {
            throw new Error('Transfer already in progress');
        }
        
        if (!fs.existsSync(filePath)) {
            throw new Error(`File not found: ${filePath}`);
        }
        
        const stats = fs.statSync(filePath);
        if (!stats.isFile()) {
            throw new Error(`Not a file: ${filePath}`);
        }
        
        this.currentFile = filePath;
        this.transferStats = {
            filename: filename || path.basename(filePath),
            fileSize: stats.size,
            bytesTransferred: 0,
            startTime: new Date(),
            useChecksum: this.config.useChecksum,
            resumeOffset: 0
        };
        
        this.mode = 'SEND';
        this.state = 'S'; // Send state
        this.retryCount = 0;
        
        // Load file into buffer
        this.sendBuffer = fs.readFileSync(filePath);
        this.sendOffset = 0;
        
        console.log(`[YAPP] Starting send of ${this.transferStats.filename} (${this.transferStats.fileSize} bytes)`);
        
        // Send SI (Send Init) packet
        this.sendSI();
        this.startTimeout();
        
        this.emit('transferStarted', {
            mode: 'SEND',
            filename: this.transferStats.filename,
            fileSize: this.transferStats.fileSize
        });
    }
    
    /**
     * Start receiving a file from the remote station
     * @param {string} receivePath - Directory path where to save the file
     */
    startReceive(receivePath = './') {
        if (this.state !== 'IDLE') {
            throw new Error('Transfer already in progress');
        }
        
        this.receivePath = receivePath;
        this.mode = 'RECEIVE';
        this.state = 'R'; // Receive state
        this.retryCount = 0;
        
        console.log(`[YAPP] Ready to receive file to ${receivePath}`);
        
        this.emit('transferStarted', {
            mode: 'RECEIVE',
            receivePath: receivePath
        });
    }
    
    /**
     * Cancel the current transfer
     */
    cancel(reason = 'Transfer cancelled by user') {
        console.log(`[YAPP] Cancelling transfer: ${reason}`);
        
        this.sendCN(reason);
        this.setState('CW'); // Cancel Wait state
        
        this.emit('transferCancelled', { reason });
    }
    
    /**
     * Get current transfer progress
     */
    getProgress() {
        if (this.state === 'IDLE') {
            return null;
        }
        
        const progress = {
            filename: this.transferStats.filename,
            fileSize: this.transferStats.fileSize,
            bytesTransferred: this.transferStats.bytesTransferred,
            percentage: this.transferStats.fileSize > 0 ? 
                Math.round((this.transferStats.bytesTransferred / this.transferStats.fileSize) * 100) : 0,
            state: this.state,
            mode: this.mode
        };
        
        if (this.transferStats.startTime) {
            const elapsed = (new Date() - this.transferStats.startTime) / 1000;
            progress.elapsedSeconds = elapsed;
            if (this.transferStats.bytesTransferred > 0) {
                progress.bytesPerSecond = Math.round(this.transferStats.bytesTransferred / elapsed);
                if (progress.bytesPerSecond > 0) {
                    const remainingBytes = this.transferStats.fileSize - this.transferStats.bytesTransferred;
                    progress.estimatedSecondsRemaining = Math.round(remainingBytes / progress.bytesPerSecond);
                }
            }
        }
        
        return progress;
    }
    
    // === Packet Creation Methods ===
    
    createYappPacket(packetType, data = null, length = null) {
        let packet = [];
        
        if (packetType.subtype !== undefined) {
            packet.push(packetType.type);
            packet.push(packetType.subtype);
        } else {
            packet.push(packetType.type);
            if (length !== null) {
                packet.push(length);
            }
        }
        
        if (data) {
            if (typeof data === 'string') {
                packet = packet.concat(Array.from(Buffer.from(data, 'utf8')));
            } else if (Buffer.isBuffer(data)) {
                packet = packet.concat(Array.from(data));
            } else if (Array.isArray(data)) {
                packet = packet.concat(data);
            }
        }
        
        return Buffer.from(packet);
    }
    
    // === Sender State Machine ===
    
    sendSI() {
        console.log('[YAPP] Sending SI (Send Init)');
        const packet = this.createYappPacket(this.PACKET_TYPES.SI);
        this.sendPacket(packet);
    }
    
    sendHD() {
        console.log('[YAPP] Sending HD (Header)');
        
        // Create header data: filename NUL filesize NUL [date time NUL]
        let headerData = [];
        
        // Filename
        headerData = headerData.concat(Array.from(Buffer.from(this.transferStats.filename, 'utf8')));
        headerData.push(0x00); // NUL
        
        // File size in ASCII
        headerData = headerData.concat(Array.from(Buffer.from(this.transferStats.fileSize.toString(), 'ascii')));
        headerData.push(0x00); // NUL
        
        // Optional: Add file date/time (YAPP extension)
        if (this.config.sendDateTime) {
            const stats = fs.statSync(this.currentFile);
            const mtime = stats.mtime;
            
            // DOS date/time format in hex ASCII (YAPP extension)
            const dosDate = this.toDosDate(mtime);
            const dosTime = this.toDosTime(mtime);
            
            headerData = headerData.concat(Array.from(Buffer.from(dosDate.toString(16).padStart(4, '0'), 'ascii')));
            headerData = headerData.concat(Array.from(Buffer.from(dosTime.toString(16).padStart(4, '0'), 'ascii')));
            headerData.push(0x00); // NUL
        }
        
        const packet = this.createYappPacket(this.PACKET_TYPES.HD, headerData, headerData.length);
        this.sendPacket(packet);
    }
    
    sendDT() {
        if (this.sendOffset >= this.sendBuffer.length) {
            console.log('[YAPP] No more data to send, moving to EOF');
            this.setState('SE');
            this.sendEF();
            return;
        }
        
        const blockSize = Math.min(this.config.blockSize, this.sendBuffer.length - this.sendOffset);
        const dataBlock = this.sendBuffer.slice(this.sendOffset, this.sendOffset + blockSize);
        
        let packet = [];
        packet.push(this.CONTROL.STX);
        
        // Length byte (0 = 256 bytes)
        const lengthByte = blockSize === 256 ? 0 : blockSize;
        packet.push(lengthByte);
        
        // Data
        packet = packet.concat(Array.from(dataBlock));
        
        // Add checksum if using YappC
        if (this.transferStats.useChecksum) {
            let checksum = 0;
            for (const byte of dataBlock) {
                checksum = (checksum + byte) & 0xFF;
            }
            packet.push(checksum);
        }
        
        console.log(`[YAPP] Sending DT block ${Math.floor(this.sendOffset / this.config.blockSize) + 1}, ${blockSize} bytes`);
        this.sendPacket(Buffer.from(packet));
        
        this.sendOffset += blockSize;
        this.transferStats.bytesTransferred += blockSize;
        
        this.emit('transferProgress', this.getProgress());
    }
    
    sendEF() {
        console.log('[YAPP] Sending EF (End of File)');
        const packet = this.createYappPacket(this.PACKET_TYPES.EF);
        this.sendPacket(packet);
    }
    
    sendET() {
        console.log('[YAPP] Sending ET (End of Transmission)');
        const packet = this.createYappPacket(this.PACKET_TYPES.ET);
        this.sendPacket(packet);
    }
    
    // === Receiver State Machine ===
    
    sendRR() {
        console.log('[YAPP] Sending RR (Receive Ready)');
        const packet = this.createYappPacket(this.PACKET_TYPES.RR);
        this.sendPacket(packet);
    }
    
    sendRF() {
        console.log('[YAPP] Sending RF (Receive File)');
        const packet = this.createYappPacket(this.PACKET_TYPES.RF);
        this.sendPacket(packet);
    }
    
    sendRT() {
        console.log('[YAPP] Sending RT (Receive TPK - YappC mode)');
        const packet = this.createYappPacket(this.PACKET_TYPES.RT);
        this.sendPacket(packet);
    }
    
    sendAF() {
        console.log('[YAPP] Sending AF (Ack EOF)');
        const packet = this.createYappPacket(this.PACKET_TYPES.AF);
        this.sendPacket(packet);
    }
    
    sendAT() {
        console.log('[YAPP] Sending AT (Ack EOT)');
        const packet = this.createYappPacket(this.PACKET_TYPES.AT);
        this.sendPacket(packet);
    }
    
    // === Error and Control Packets ===
    
    sendNR(reason = 'Not ready') {
        console.log(`[YAPP] Sending NR (Not Ready): ${reason}`);
        const reasonBytes = Array.from(Buffer.from(reason, 'utf8'));
        const packet = this.createYappPacket(this.PACKET_TYPES.NR, reasonBytes, reasonBytes.length);
        this.sendPacket(packet);
    }
    
    sendCN(reason = 'Transfer cancelled') {
        console.log(`[YAPP] Sending CN (Cancel): ${reason}`);
        const reasonBytes = Array.from(Buffer.from(reason, 'utf8'));
        const packet = this.createYappPacket(this.PACKET_TYPES.CN, reasonBytes, reasonBytes.length);
        this.sendPacket(packet);
    }
    
    sendCA() {
        console.log('[YAPP] Sending CA (Cancel Ack)');
        const packet = this.createYappPacket(this.PACKET_TYPES.CA);
        this.sendPacket(packet);
    }
    
    sendRE(receivedLength, useYappC = false) {
        console.log(`[YAPP] Sending RE (Resume) at ${receivedLength} bytes`);
        
        let data = [];
        data.push(0x52); // 'R'
        data.push(0x00); // NUL
        
        // Received length in ASCII
        const lengthStr = receivedLength.toString();
        data = data.concat(Array.from(Buffer.from(lengthStr, 'ascii')));
        data.push(0x00); // NUL
        
        // Add 'C' flag for YappC if requested
        if (useYappC) {
            data.push(0x43); // 'C'
            data.push(0x00); // NUL
        }
        
        const packet = this.createYappPacket(this.PACKET_TYPES.RE, data, data.length);
        this.sendPacket(packet);
    }
    
    // === Packet Processing ===
    
    handleIncomingData(data) {
        if (this.state === 'IDLE') {
            // Check if this is an incoming YAPP request
            this.handleIncomingRequest(data);
            return;
        }
        
        // Process YAPP protocol data
        this.processYappPacket(data);
    }
    
    handleIncomingRequest(data) {
        if (data.length < 2) return;
        
        const type = data[0];
        const subtype = data[1];
        
        // Check for SI (Send Init) - incoming file transfer request
        if (type === this.CONTROL.ENQ && subtype === 0x01) {
            console.log('[YAPP] Received SI (Send Init) - remote wants to send file');
            this.mode = 'RECEIVE';
            this.state = 'R';
            
            // Send RR (Receive Ready) to accept the transfer
            this.sendRR();
            this.startTimeout();
            
            this.emit('transferStarted', {
                mode: 'RECEIVE',
                receivePath: this.receivePath || './'
            });
        }
    }
    
    processYappPacket(data) {
        if (data.length < 1) return;
        
        const type = data[0];
        
        try {
            switch (this.mode) {
                case 'SEND':
                    this.processSendModePacket(data, type);
                    break;
                case 'RECEIVE':
                    this.processReceiveModePacket(data, type);
                    break;
            }
        } catch (error) {
            console.error(`[YAPP] Error processing packet: ${error.message}`);
            this.cancel(`Protocol error: ${error.message}`);
        }
    }
    
    processSendModePacket(data, type) {
        const subtype = data.length > 1 ? data[1] : null;
        
        switch (this.state) {
            case 'S': // Send Init state
                if (type === this.CONTROL.ACK && subtype === 0x01) { // RR
                    console.log('[YAPP] Received RR, sending header');
                    this.setState('SH');
                    this.sendHD();
                } else if (type === this.CONTROL.ACK && subtype === 0x02) { // RF
                    console.log('[YAPP] Received RF, skipping header and starting data');
                    this.setState('SD');
                    this.sendDT();
                } else if (type === this.CONTROL.NAK) { // NR
                    this.handleNotReady(data);
                } else if (type === this.CONTROL.CAN) { // CN
                    this.handleCancel(data);
                }
                break;
                
            case 'SH': // Send Header state
                if (type === this.CONTROL.ACK && subtype === 0x02) { // RF
                    console.log('[YAPP] Received RF, starting data transfer');
                    this.setState('SD');
                    this.transferStats.useChecksum = false; // Standard YAPP
                    this.sendDT();
                } else if (type === this.CONTROL.ACK && subtype === this.CONTROL.ACK) { // RT (YappC)
                    console.log('[YAPP] Received RT, starting YappC data transfer');
                    this.setState('SD');
                    this.transferStats.useChecksum = true; // YappC mode
                    this.sendDT();
                } else if (type === this.CONTROL.NAK && this.isResumePacket(data)) { // RE
                    this.handleResume(data);
                } else if (type === this.CONTROL.NAK) { // NR
                    this.handleNotReady(data);
                } else if (type === this.CONTROL.CAN) { // CN
                    this.handleCancel(data);
                }
                break;
                
            case 'SD': // Send Data state
                // In data state, just continue sending next block
                this.sendDT();
                break;
                
            case 'SE': // Send EOF state
                if (type === this.CONTROL.ACK && subtype === 0x03) { // AF
                    console.log('[YAPP] Received AF, sending EOT');
                    this.setState('ST');
                    this.sendET();
                } else if (type === this.CONTROL.CAN) { // CN
                    this.handleCancel(data);
                }
                break;
                
            case 'ST': // Send EOT state
                if (type === this.CONTROL.ACK && subtype === 0x04) { // AT
                    console.log('[YAPP] Received AT, transfer complete');
                    this.completeTransfer();
                }
                break;
        }
    }
    
    processReceiveModePacket(data, type) {
        const subtype = data.length > 1 ? data[1] : null;
        
        switch (this.state) {
            case 'R': // Receive Init state
                if (type === this.CONTROL.ENQ && subtype === 0x01) { // SI
                    // Sender is initiating - respond with RR
                    console.log('[YAPP] Received SI in receive mode, sending RR');
                    this.sendRR();
                } else if (type === this.CONTROL.SOH) { // HD
                    this.handleHeader(data);
                } else if (type === this.CONTROL.EOT) { // ET
                    console.log('[YAPP] Received EOT in receive init, sending AT');
                    this.sendAT();
                    this.completeTransfer();
                }
                break;
                
            case 'RH': // Receive Header state
                if (type === this.CONTROL.SOH) { // HD
                    this.handleHeader(data);
                } else if (type === this.CONTROL.EOT) { // ET
                    this.sendAT();
                    this.completeTransfer();
                }
                break;
                
            case 'RD': // Receive Data state
                if (type === this.CONTROL.STX) { // DT
                    this.handleDataPacket(data);
                    // Send empty ACK to request more data
                    this.sendPacket(Buffer.from([this.CONTROL.ACK]));
                } else if (type === this.CONTROL.ETX) { // EF
                    this.handleEndOfFile();
                } else if (type === this.CONTROL.CAN) { // CN
                    this.handleCancel(data);
                }
                break;
        }
    }
    
    // === Data Handling Methods ===
    
    handleHeader(data) {
        if (data.length < 3) {
            throw new Error('Invalid header packet');
        }
        
        const length = data[1];
        const headerData = data.slice(2, 2 + length);
        
        // Parse header: filename NUL filesize NUL [date time NUL]
        const parts = [];
        let current = [];
        
        for (const byte of headerData) {
            if (byte === 0x00) {
                if (current.length > 0) {
                    parts.push(Buffer.from(current).toString('utf8'));
                    current = [];
                }
            } else {
                current.push(byte);
            }
        }
        
        if (current.length > 0) {
            parts.push(Buffer.from(current).toString('utf8'));
        }
        
        if (parts.length < 2) {
            throw new Error('Invalid header format');
        }
        
        const filename = parts[0];
        const fileSize = parseInt(parts[1], 10);
        
        if (isNaN(fileSize)) {
            throw new Error('Invalid file size in header');
        }
        
        this.transferStats.filename = filename;
        this.transferStats.fileSize = fileSize;
        
        console.log(`[YAPP] Received header: ${filename}, ${fileSize} bytes`);
        
        // Check if we should resume an existing file
        const filePath = path.join(this.receivePath, filename);
        let resumeOffset = 0;
        
        if (this.config.enableResume && fs.existsSync(filePath)) {
            const existingStats = fs.statSync(filePath);
            resumeOffset = existingStats.size;
            
            if (resumeOffset > 0 && resumeOffset < fileSize) {
                console.log(`[YAPP] Resuming transfer at ${resumeOffset} bytes`);
                this.transferStats.resumeOffset = resumeOffset;
                this.transferStats.bytesTransferred = resumeOffset;
                
                // Send resume request
                this.sendRE(resumeOffset, this.config.useChecksum);
                this.setState('RD');
                
                // Open file for appending
                this.fileHandle = fs.openSync(filePath, 'a');
                this.emit('transferProgress', this.getProgress());
                return;
            } else if (resumeOffset >= fileSize) {
                console.log('[YAPP] File already complete');
                this.sendNR('File already exists and is complete');
                return;
            }
        }
        
        // Create new file
        try {
            this.fileHandle = fs.openSync(filePath, 'w');
            console.log(`[YAPP] Created file: ${filePath}`);
        } catch (error) {
            this.sendNR(`Cannot create file: ${error.message}`);
            return;
        }
        
        this.setState('RD');
        
        // Send appropriate response based on checksum support
        if (this.config.useChecksum) {
            this.sendRT(); // Request YappC mode
            this.transferStats.useChecksum = true;
        } else {
            this.sendRF(); // Standard YAPP mode
            this.transferStats.useChecksum = false;
        }
        
        this.emit('transferProgress', this.getProgress());
    }
    
    handleDataPacket(data) {
        if (data.length < 2) {
            throw new Error('Invalid data packet');
        }
        
        const lengthByte = data[1];
        const dataLength = lengthByte === 0 ? 256 : lengthByte;
        
        let packetData;
        let checksum = null;
        
        if (this.transferStats.useChecksum) {
            // YappC mode - last byte is checksum
            if (data.length < dataLength + 3) {
                throw new Error('Invalid YappC data packet length');
            }
            packetData = data.slice(2, 2 + dataLength);
            checksum = data[2 + dataLength];
            
            // Verify checksum
            let calculatedChecksum = 0;
            for (const byte of packetData) {
                calculatedChecksum = (calculatedChecksum + byte) & 0xFF;
            }
            
            if (calculatedChecksum !== checksum) {
                console.error(`[YAPP] Checksum mismatch: expected ${checksum}, got ${calculatedChecksum}`);
                this.cancel('Checksum error - data corruption detected');
                return;
            }
        } else {
            // Standard YAPP mode
            if (data.length < dataLength + 2) {
                throw new Error('Invalid YAPP data packet length');
            }
            packetData = data.slice(2, 2 + dataLength);
        }
        
        // Write data to file
        try {
            fs.writeSync(this.fileHandle, packetData);
            this.transferStats.bytesTransferred += packetData.length;
            
            console.log(`[YAPP] Received data block: ${packetData.length} bytes (${this.transferStats.bytesTransferred}/${this.transferStats.fileSize})`);
            
            this.emit('transferProgress', this.getProgress());
        } catch (error) {
            this.cancel(`File write error: ${error.message}`);
            return;
        }
    }
    
    handleEndOfFile() {
        console.log('[YAPP] Received EF (End of File)');
        
        if (this.fileHandle) {
            fs.closeSync(this.fileHandle);
            this.fileHandle = null;
        }
        
        this.sendAF();
        this.setState('RH'); // Back to receive header for potential next file
        
        this.emit('fileCompleted', {
            filename: this.transferStats.filename,
            fileSize: this.transferStats.fileSize,
            bytesTransferred: this.transferStats.bytesTransferred
        });
    }
    
    // === Helper Methods ===
    
    handleNotReady(data) {
        let reason = 'Not ready';
        if (data.length > 2) {
            const length = data[1];
            if (length > 0 && data.length >= 2 + length) {
                reason = Buffer.from(data.slice(2, 2 + length)).toString('utf8');
            }
        }
        
        console.log(`[YAPP] Received NR: ${reason}`);
        this.cancel(`Remote not ready: ${reason}`);
    }
    
    handleCancel(data) {
        let reason = 'Transfer cancelled';
        if (data.length > 2) {
            const length = data[1];
            if (length > 0 && data.length >= 2 + length) {
                reason = Buffer.from(data.slice(2, 2 + length)).toString('utf8');
            }
        }
        
        console.log(`[YAPP] Received CN: ${reason}`);
        this.sendCA();
        this.setState('CW');
        
        this.emit('transferCancelled', { reason });
    }
    
    handleResume(data) {
        // Parse resume packet: NAK len 'R' NUL receivedLength NUL ['C' NUL]
        if (data.length < 4) {
            throw new Error('Invalid resume packet');
        }
        
        const length = data[1];
        const resumeData = data.slice(2, 2 + length);
        
        // Find 'R' marker
        if (resumeData[0] !== 0x52) { // 'R'
            throw new Error('Invalid resume packet format');
        }
        
        // Parse received length
        let resumeOffset = 0;
        let useYappC = false;
        let pos = 2; // Skip 'R' and NUL
        
        // Find received length
        let lengthStr = '';
        while (pos < resumeData.length && resumeData[pos] !== 0x00) {
            lengthStr += String.fromCharCode(resumeData[pos]);
            pos++;
        }
        
        resumeOffset = parseInt(lengthStr, 10);
        if (isNaN(resumeOffset)) {
            throw new Error('Invalid resume offset');
        }
        
        pos++; // Skip NUL
        
        // Check for YappC flag
        if (pos < resumeData.length && resumeData[pos] === 0x43) { // 'C'
            useYappC = true;
        }
        
        console.log(`[YAPP] Resuming transfer at offset ${resumeOffset}, YappC: ${useYappC}`);
        
        // Adjust send position
        this.sendOffset = resumeOffset;
        this.transferStats.bytesTransferred = resumeOffset;
        this.transferStats.resumeOffset = resumeOffset;
        this.transferStats.useChecksum = useYappC;
        
        this.setState('SD');
        this.sendDT();
        
        this.emit('transferResumed', {
            resumeOffset: resumeOffset,
            useChecksum: useYappC
        });
    }
    
    isResumePacket(data) {
        return data.length >= 4 && data[0] === this.CONTROL.NAK && 
               data.length > 2 && data[2] === 0x52; // 'R'
    }
    
    handleDisconnection() {
        console.log('[YAPP] Session disconnected during transfer');
        this.cleanupTransfer();
        this.emit('transferAborted', { reason: 'Session disconnected' });
    }
    
    setState(newState) {
        if (this.state !== newState) {
            console.log(`[YAPP] State change: ${this.state} -> ${newState}`);
            this.state = newState;
            this.clearTimeout();
            
            if (newState !== 'IDLE' && newState !== 'CW') {
                this.startTimeout();
            }
        }
    }
    
    startTimeout() {
        this.clearTimeout();
        this.timeout = setTimeout(() => {
            this.handleTimeout();
        }, this.config.timeout);
    }
    
    clearTimeout() {
        if (this.timeout) {
            clearTimeout(this.timeout);
            this.timeout = null;
        }
    }
    
    handleTimeout() {
        console.log(`[YAPP] Timeout in state ${this.state}`);
        
        if (this.retryCount < this.config.maxRetries) {
            this.retryCount++;
            console.log(`[YAPP] Retry ${this.retryCount}/${this.config.maxRetries}`);
            
            // Resend last packet based on current state
            this.retryCurrentState();
        } else {
            console.log('[YAPP] Max retries exceeded');
            this.cancel('Timeout - max retries exceeded');
        }
    }
    
    retryCurrentState() {
        // Check if session is still connected before retrying
        if (!this.session || this.session.currentState !== this.session.constructor.ConnectionState.CONNECTED) {
            console.log('[YAPP] Session not connected during retry, cancelling transfer');
            this.cancel('Session disconnected during retry');
            return;
        }
        
        // Retry logic based on current state
        switch (this.state) {
            case 'S':
                if (!this.sendSI()) return;
                break;
            case 'SH':
                if (!this.sendHD()) return;
                break;
            case 'SD':
                // Don't resend data automatically - let higher level protocol handle it
                this.cancel('Data transmission timeout');
                return;
            case 'SE':
                if (!this.sendEF()) return;
                break;
            case 'ST':
                if (!this.sendET()) return;
                break;
            default:
                this.cancel('Timeout in unknown state');
                return;
        }
        
        this.startTimeout();
    }
    
    sendPacket(data) {
        if (this.session && this.session.currentState === this.session.constructor.ConnectionState.CONNECTED) {
            this.session.send(data, true); // Send immediately
        } else {
            console.log('[YAPP] Cannot send packet - session not connected, cancelling transfer');
            this.cancel('Session disconnected');
            return false;
        }
        return true;
    }
    
    completeTransfer() {
        console.log('[YAPP] Transfer completed successfully');
        
        const stats = {
            filename: this.transferStats.filename,
            fileSize: this.transferStats.fileSize,
            bytesTransferred: this.transferStats.bytesTransferred,
            elapsedTime: this.transferStats.startTime ? 
                (new Date() - this.transferStats.startTime) / 1000 : 0,
            useChecksum: this.transferStats.useChecksum,
            resumeOffset: this.transferStats.resumeOffset
        };
        
        this.cleanupTransfer();
        this.emit('transferCompleted', stats);
    }
    
    cleanupTransfer() {
        this.clearTimeout();
        
        if (this.fileHandle) {
            try {
                fs.closeSync(this.fileHandle);
            } catch (error) {
                console.error(`[YAPP] Error closing file: ${error.message}`);
            }
            this.fileHandle = null;
        }
        
        this.state = 'IDLE';
        this.mode = null;
        this.retryCount = 0;
        this.currentFile = null;
        this.sendBuffer = null;
        this.sendOffset = 0;
        this.receiveBuffer = [];
        this.transferStats = {
            filename: null,
            fileSize: 0,
            bytesTransferred: 0,
            startTime: null,
            useChecksum: false,
            resumeOffset: 0
        };
    }
    
    // === Utility Methods ===
    
    toDosDate(date) {
        const year = date.getFullYear();
        const month = date.getMonth() + 1;
        const day = date.getDate();
        
        return ((year - 1980) << 9) | (month << 5) | day;
    }
    
    toDosTime(date) {
        const hours = date.getHours();
        const minutes = date.getMinutes();
        const seconds = Math.floor(date.getSeconds() / 2);
        
        return (hours << 11) | (minutes << 5) | seconds;
    }
}

module.exports = YappTransfer;
