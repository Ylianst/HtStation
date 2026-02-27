/*
Copyright 2026 Ylian Saint-Hilaire
Licensed under the Apache License, Version 2.0 (the "License");
http://www.apache.org/licenses/LICENSE-2.0
*/

const fs = require('fs');
const path = require('path');
const DataBroker = require('./DataBroker');
const DataBrokerClient = require('./DataBrokerClient');

/**
 * A data handler that stores packets to a file and maintains a running list of the last 2000 packets in memory.
 * Listens for UniqueDataFrame events and saves them to "packets.ptcap".
 * Other modules can request the packet list via the Data Broker.
 */
class PacketStore {
    /**
     * Maximum number of packets to keep in memory.
     */
    static MAX_PACKETS_IN_MEMORY = 2000;

    /**
     * The filename for storing packets.
     */
    static PACKET_FILENAME = 'packets.ptcap';

    /**
     * How often to flush packets to disk (in milliseconds).
     * Writes are debounced to minimize file system writes.
     */
    static FLUSH_INTERVAL_MS = 60000; // 1 minute

    /**
     * Creates a new PacketStore that listens for UniqueDataFrame events and stores packets.
     * @param {string} dataPath - Path to the data directory for storing packets.
     */
    constructor(dataPath) {
        this._disposed = false;
        this._packets = [];
        this._dataPath = dataPath || path.join(__dirname, '../../data');
        this._packetFilePath = path.join(this._dataPath, PacketStore.PACKET_FILENAME);
        this._fileStream = null;
        this._broker = new DataBrokerClient();
        this._pendingWrites = []; // Buffer for packets waiting to be written
        this._flushTimer = null;  // Timer for debounced flush

        // Ensure the data directory exists
        if (!fs.existsSync(this._dataPath)) {
            fs.mkdirSync(this._dataPath, { recursive: true });
        }

        // Load existing packets from file
        this._loadPackets();

        // Open the file for appending new packets
        this._openPacketFile();

        // Subscribe to DataFrame events on all devices (both inbound and outbound)
        this._broker.subscribe(DataBroker.AllDevices, 'DataFrame', this._onDataFrame.bind(this));

        // Subscribe to requests for the packet list
        this._broker.subscribe(1, 'RequestPacketList', this._onRequestPacketList.bind(this));

        // Notify subscribers that PacketStore is ready and packets are loaded (stored so late subscribers can check)
        this._broker.dispatch(1, 'PacketStoreReady', true, true);

        // Handle process exit to flush pending writes
        this._exitHandler = () => this._flushPendingWrites();
        process.on('beforeExit', this._exitHandler);
        process.on('SIGINT', this._exitHandler);
        process.on('SIGTERM', this._exitHandler);
    }

    /**
     * Whether the handler has been disposed.
     */
    get isDisposed() { return this._disposed; }

    /**
     * Number of packets currently stored in memory.
     */
    get packetCount() { return this._packets.length; }

    /**
     * Gets a copy of the current packet list.
     * @returns {Array} A copy of the packets array.
     */
    getPackets() {
        return [...this._packets];
    }

    /**
     * Opens the packet file for appending.
     */
    _openPacketFile() {
        try {
            this._fileStream = fs.createWriteStream(this._packetFilePath, { flags: 'a' });
        } catch (err) {
            this._fileStream = null;
        }
    }

    /**
     * Loads the last MAX_PACKETS_IN_MEMORY packets from the file.
     */
    _loadPackets() {
        let lines = null;

        try {
            if (fs.existsSync(this._packetFilePath)) {
                const content = fs.readFileSync(this._packetFilePath, 'utf8');
                lines = content.split('\n').filter(line => line.trim().length > 0);
            }
        } catch (err) {
            return;
        }

        if (!lines || lines.length === 0) return;

        // If the packet file is big, load only the last MAX_PACKETS_IN_MEMORY packets
        let startIndex = 0;
        if (lines.length > PacketStore.MAX_PACKETS_IN_MEMORY) {
            startIndex = lines.length - PacketStore.MAX_PACKETS_IN_MEMORY;
        }

        for (let i = startIndex; i < lines.length; i++) {
            try {
                const fragment = PacketStore.parsePacketLine(lines[i]);
                if (fragment) {
                    this._packets.push(fragment);
                }
            } catch (err) {
                // Skip malformed lines
            }
        }
    }

    /**
     * Parses a packet line from the file into a packet object.
     * @param {string} line - The line to parse.
     * @returns {object|null} A packet object, or null if the line is invalid.
     */
    static parsePacketLine(line) {
        const parts = line.split(',');
        if (parts.length < 3) return null;

        const timestamp = parseInt(parts[0], 10);
        const incoming = parts[1] === '1';
        const fragmentType = parts[2];

        // Check for supported fragment types
        if (!['TncFrag', 'TncFrag2', 'TncFrag3', 'TncFrag4'].includes(fragmentType)) return null;

        const channelId = parseInt(parts[3], 10);
        let radioId = -1;
        let channelName = channelId.toString();
        let data = null;
        let encoding = 0;  // Unknown
        let frameType = 0; // Unknown
        let corrections = -1;
        let radioMac = null;

        if (fragmentType === 'TncFrag') {
            if (parts.length < 5) return null;
            data = PacketStore._hexToBuffer(parts[4]);
        } else if (fragmentType === 'TncFrag2') {
            if (parts.length < 7) return null;
            radioId = parseInt(parts[4], 10) || 0;
            channelName = parts[5];
            data = PacketStore._hexToBuffer(parts[6]);
        } else if (fragmentType === 'TncFrag3') {
            if (parts.length < 10) return null;
            radioId = parseInt(parts[4], 10) || 0;
            channelName = parts[5];
            data = PacketStore._hexToBuffer(parts[6]);
            encoding = parseInt(parts[7], 10);
            frameType = parseInt(parts[8], 10);
            corrections = parseInt(parts[9], 10);
        } else if (fragmentType === 'TncFrag4') {
            if (parts.length < 10) return null;
            radioId = parseInt(parts[4], 10) || 0;
            channelName = parts[5];
            data = PacketStore._hexToBuffer(parts[6]);
            encoding = parseInt(parts[7], 10);
            frameType = parseInt(parts[8], 10);
            corrections = parseInt(parts[9], 10);
            if (parts.length > 10 && parts[10]) {
                radioMac = parts[10];
            }
        }

        return {
            time: new Date(timestamp),
            incoming,
            fragmentType,
            channelId,
            radioId,
            channelName,
            data,
            encoding,
            frameType,
            corrections,
            radioMac
        };
    }

    /**
     * Converts a hex string to a Buffer.
     * @param {string} hex - Hex string.
     * @returns {Buffer} Buffer.
     */
    static _hexToBuffer(hex) {
        if (!hex) return Buffer.alloc(0);
        return Buffer.from(hex, 'hex');
    }

    /**
     * Converts a Buffer to a hex string.
     * @param {Buffer|Uint8Array|Array} buffer - Buffer to convert.
     * @returns {string} Hex string.
     */
    static _bufferToHex(buffer) {
        if (!buffer) return '';
        if (Buffer.isBuffer(buffer)) return buffer.toString('hex');
        if (buffer instanceof Uint8Array || Array.isArray(buffer)) return Buffer.from(buffer).toString('hex');
        return '';
    }

    /**
     * Handles incoming DataFrame events and stores the packet.
     * @param {number} deviceId
     * @param {string} name
     * @param {object} frame - The data frame/fragment.
     */
    _onDataFrame(deviceId, name, frame) {
        if (this._disposed) return;
        if (!frame) return;

        // Create a packet object from the frame
        const packet = {
            time: frame.time || new Date(),
            incoming: frame.incoming !== false,
            fragmentType: 'TncFrag4',
            channelId: frame.channelId || frame.channel_id || 0,
            radioId: frame.radioId || frame.radio_id || deviceId || 0,
            channelName: frame.channelName || frame.channel_name || '0',
            data: frame.data,
            encoding: frame.encoding || 0,
            frameType: frame.frameType || frame.frame_type || 0,
            corrections: frame.corrections !== undefined ? frame.corrections : -1,
            radioMac: frame.radioMac || frame.RadioMac || null
        };

        // Write to file
        this._writePacketToFile(packet);

        // Add to memory list
        this._packets.push(packet);

        // Trim to MAX_PACKETS_IN_MEMORY
        while (this._packets.length > PacketStore.MAX_PACKETS_IN_MEMORY) {
            this._packets.shift();
        }

        // Dispatch an event to notify that a new packet was stored
        this._broker.dispatch(1, 'PacketStored', packet, false);
    }

    /**
     * Handles requests for the packet list.
     * @param {number} deviceId
     * @param {string} name
     * @param {object} data
     */
    _onRequestPacketList(deviceId, name, data) {
        if (this._disposed) return;

        // Dispatch the current packet list
        const packets = this.getPackets();
        this._broker.dispatch(1, 'PacketList', packets, false);
    }

    /**
     * Queues a packet for writing to the file.
     * Writes are debounced to minimize file system writes (once per minute max).
     * @param {object} packet - The packet to write.
     */
    _writePacketToFile(packet) {
        if (this._disposed) return;

        // Add to pending writes buffer
        this._pendingWrites.push(packet);

        // Schedule a flush if not already scheduled
        this._scheduleFlush();
    }

    /**
     * Schedules a debounced flush of pending writes to disk.
     */
    _scheduleFlush() {
        if (this._flushTimer) return; // Already scheduled
        if (this._disposed) return;

        this._flushTimer = setTimeout(() => {
            this._flushTimer = null;
            this._flushPendingWrites();
        }, PacketStore.FLUSH_INTERVAL_MS);
    }

    /**
     * Flushes all pending writes to the file.
     */
    _flushPendingWrites() {
        if (this._pendingWrites.length === 0) return;
        if (!this._fileStream) return;

        try {
            const lines = this._pendingWrites.map(packet => {
                const timestamp = packet.time instanceof Date ? packet.time.getTime() : packet.time;
                const incoming = packet.incoming ? '1' : '0';
                const dataHex = PacketStore._bufferToHex(packet.data);
                
                // Format: timestamp,incoming,TncFrag4,channelId,radioId,channelName,dataHex,encoding,frameType,corrections,radioMac
                return [
                    timestamp,
                    incoming,
                    packet.fragmentType,
                    packet.channelId,
                    packet.radioId,
                    packet.channelName,
                    dataHex,
                    packet.encoding,
                    packet.frameType,
                    packet.corrections,
                    packet.radioMac || ''
                ].join(',');
            });

            // Write all lines at once
            this._fileStream.write(lines.join('\n') + '\n');
            this._pendingWrites = [];
        } catch (err) {
            // Ignore write errors
        }
    }

    /**
     * Clears all packets from memory. Does not affect the file.
     */
    clearMemory() {
        this._packets.length = 0;
    }

    /**
     * Disposes the handler, unsubscribing from the broker and closing the file.
     */
    dispose() {
        if (this._disposed) return;
        this._disposed = true;

        // Remove process exit handlers
        if (this._exitHandler) {
            process.off('beforeExit', this._exitHandler);
            process.off('SIGINT', this._exitHandler);
            process.off('SIGTERM', this._exitHandler);
        }

        // Clear flush timer
        if (this._flushTimer) {
            clearTimeout(this._flushTimer);
            this._flushTimer = null;
        }

        // Flush any pending writes before closing
        this._flushPendingWrites();

        // Dispose the broker client (unsubscribes)
        if (this._broker) {
            this._broker.dispose();
        }

        // Close the packet file
        if (this._fileStream) {
            try {
                this._fileStream.end();
            } catch (err) { /* ignore */ }
            this._fileStream = null;
        }

        // Clear the memory
        this._packets.length = 0;
        this._pendingWrites = [];
    }
}

module.exports = PacketStore;