/*
Copyright 2026 Ylian Saint-Hilaire

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

const net = require('net');
const tls = require('tls');
const EventEmitter = require('events');

// Get logger instance
const logger = global.logger ? global.logger.getLogger('WinlinkRelay') : console;

/**
 * Manages a TCP/TLS connection to the Winlink CMS gateway (server.winlink.org:8773)
 * for relaying Winlink protocol traffic between a BBS radio client and the internet gateway.
 * The relay logs in using the connecting station's callsign, obtains the ;PQ: challenge,
 * and then transparently relays all Winlink B2F protocol traffic.
 */
class WinlinkGatewayRelay extends EventEmitter {
    /**
     * Creates a new WinlinkGatewayRelay.
     * @param {number} deviceId - The BBS device ID (for logging).
     * @param {string} server - CMS server hostname.
     * @param {number} port - CMS server port.
     * @param {boolean} useTls - Whether to use TLS.
     */
    constructor(deviceId, server = 'server.winlink.org', port = 8773, useTls = true) {
        super();
        this.deviceId = deviceId;
        this.server = server;
        this.port = port;
        this.useTls = useTls;
        
        this.socket = null;
        this.tcpRunning = false;
        this.disposed = false;
        
        // The ;PQ: challenge string received from the CMS gateway during login.
        this.pqChallenge = null;
        
        // The [WL2K-...] banner string received from the CMS gateway.
        this.wl2kBanner = null;
        
        // When true, incoming data is forwarded as raw binary via 'binaryData' event.
        // When false, incoming data is parsed as lines and forwarded via 'line' event.
        this.binaryMode = false;
        
        // Buffer for accumulating line data
        this._lineBuffer = '';
    }
    
    /**
     * Whether the relay is currently connected to the CMS gateway.
     */
    get isConnected() {
        return this.socket !== null && !this.socket.destroyed && this.tcpRunning;
    }
    
    /**
     * Connects to the CMS gateway and performs the initial login handshake
     * using the specified station callsign. Returns true if the connection
     * and login succeed and a session prompt is received.
     * @param {string} stationCallsign - The callsign to log in with (the remote station's callsign).
     * @param {number} timeoutMs - Connection timeout in milliseconds.
     * @returns {Promise<boolean>} True if connected and handshake completed successfully.
     */
    async connectAsync(stationCallsign, timeoutMs = 15000) {
        try {
            logger.log(`[WinlinkRelay/${this.deviceId}] Connecting to CMS gateway ${this.server}:${this.port} for station ${stationCallsign}`);
            
            return new Promise((resolve) => {
                let resolved = false;
                let timeoutHandle = null;
                
                const cleanup = () => {
                    if (timeoutHandle) {
                        clearTimeout(timeoutHandle);
                        timeoutHandle = null;
                    }
                };
                
                const resolveOnce = (result) => {
                    if (!resolved) {
                        resolved = true;
                        cleanup();
                        resolve(result);
                    }
                };
                
                // Set connection timeout
                timeoutHandle = setTimeout(() => {
                    logger.error(`[WinlinkRelay/${this.deviceId}] Connection timed out`);
                    this._cleanupSocket();
                    resolveOnce(false);
                }, timeoutMs);
                
                // Create socket
                const connectOptions = {
                    host: this.server,
                    port: this.port,
                    rejectUnauthorized: true
                };
                
                if (this.useTls) {
                    this.socket = tls.connect(connectOptions, () => {
                        if (!this.socket.authorized) {
                            logger.error(`[WinlinkRelay/${this.deviceId}] TLS certificate verification failed`);
                            this._cleanupSocket();
                            resolveOnce(false);
                            return;
                        }
                        logger.log(`[WinlinkRelay/${this.deviceId}] TLS connection established`);
                        this.tcpRunning = true;
                        this._performHandshake(stationCallsign, timeoutMs - 5000)
                            .then(success => resolveOnce(success))
                            .catch(() => resolveOnce(false));
                    });
                } else {
                    this.socket = net.connect(connectOptions, () => {
                        logger.log(`[WinlinkRelay/${this.deviceId}] TCP connection established`);
                        this.tcpRunning = true;
                        this._performHandshake(stationCallsign, timeoutMs - 5000)
                            .then(success => resolveOnce(success))
                            .catch(() => resolveOnce(false));
                    });
                }
                
                this.socket.on('error', (err) => {
                    logger.error(`[WinlinkRelay/${this.deviceId}] Socket error: ${err.message}`);
                    this._cleanupSocket();
                    resolveOnce(false);
                });
                
                this.socket.on('close', () => {
                    logger.log(`[WinlinkRelay/${this.deviceId}] Socket closed`);
                    if (this.tcpRunning) {
                        this.tcpRunning = false;
                        this.emit('disconnected');
                    }
                    resolveOnce(false);
                });
            });
        } catch (ex) {
            logger.error(`[WinlinkRelay/${this.deviceId}] Connection failed: ${ex.message}`);
            this._cleanupSocket();
            return false;
        }
    }
    
    /**
     * Reads lines from the CMS gateway during the initial login, handling the
     * "Callsign :", "Password :", [WL2K-...] banner, ;PQ: challenge, and > prompt.
     * @private
     */
    async _performHandshake(stationCallsign, timeoutMs) {
        return new Promise((resolve) => {
            const deadline = Date.now() + timeoutMs;
            let lineBuffer = '';
            let gotPrompt = false;
            let resolved = false;
            
            const resolveOnce = (result) => {
                if (!resolved) {
                    resolved = true;
                    this.socket.removeListener('data', onData);
                    
                    if (result) {
                        // Set up the receive loop after successful handshake
                        this._setupReceiveLoop();
                    }
                    
                    resolve(result);
                }
            };
            
            const onData = (data) => {
                if (Date.now() > deadline) {
                    logger.error(`[WinlinkRelay/${this.deviceId}] Handshake timeout`);
                    resolveOnce(false);
                    return;
                }
                
                lineBuffer += data.toString('utf8');
                
                // Process complete lines
                while (true) {
                    const crIdx = lineBuffer.indexOf('\r');
                    const nlIdx = lineBuffer.indexOf('\n');
                    
                    let lineEnd = -1;
                    let skipLen = 0;
                    
                    if (crIdx >= 0 && nlIdx >= 0) {
                        if (crIdx < nlIdx) {
                            lineEnd = crIdx;
                            skipLen = (nlIdx === crIdx + 1) ? 2 : 1;
                        } else {
                            lineEnd = nlIdx;
                            skipLen = 1;
                        }
                    } else if (crIdx >= 0) {
                        lineEnd = crIdx;
                        skipLen = 1;
                    } else if (nlIdx >= 0) {
                        lineEnd = nlIdx;
                        skipLen = 1;
                    } else {
                        break;
                    }
                    
                    const line = lineBuffer.substring(0, lineEnd);
                    lineBuffer = lineBuffer.substring(lineEnd + skipLen);
                    
                    logger.log(`[WinlinkRelay/${this.deviceId}] CMS << ${line}`);
                    
                    // Handle prompts
                    const trimmedLine = line.trim();
                    
                    if (trimmedLine.toLowerCase() === 'callsign :') {
                        logger.log(`[WinlinkRelay/${this.deviceId}] Sending callsign: ${stationCallsign}`);
                        this._sendRaw(stationCallsign + '\r');
                        continue;
                    }
                    
                    if (trimmedLine.toLowerCase() === 'password :') {
                        logger.log(`[WinlinkRelay/${this.deviceId}] Sending password`);
                        this._sendRaw('CMSTelnet\r');
                        continue;
                    }
                    
                    // Capture [WL2K-...] banner
                    if (trimmedLine.startsWith('[WL2K-') && trimmedLine.endsWith('$]')) {
                        this.wl2kBanner = trimmedLine;
                        logger.log(`[WinlinkRelay/${this.deviceId}] Got WL2K banner: ${this.wl2kBanner}`);
                        continue;
                    }
                    
                    // Capture ;PQ: challenge
                    if (trimmedLine.startsWith(';PQ:')) {
                        this.pqChallenge = trimmedLine.substring(4).trim();
                        logger.log(`[WinlinkRelay/${this.deviceId}] Got PQ challenge: ${this.pqChallenge}`);
                        continue;
                    }
                    
                    // Check for session prompt (ends with >)
                    if (trimmedLine.endsWith('>')) {
                        gotPrompt = true;
                        break;
                    }
                }
                
                if (gotPrompt) {
                    logger.log(`[WinlinkRelay/${this.deviceId}] Connected and handshake complete. PQ=${this.pqChallenge || '(none)'}`);
                    resolveOnce(true);
                }
            };
            
            this.socket.on('data', onData);
        });
    }
    
    /**
     * Sets up the receive loop for ongoing relay after successful handshake.
     * @private
     */
    _setupReceiveLoop() {
        this.socket.on('data', (data) => {
            if (!this.tcpRunning) return;
            
            try {
                if (this.binaryMode) {
                    this.emit('binaryData', data);
                } else {
                    // Parse into lines and forward
                    const chunk = data.toString('utf8');
                    this._lineBuffer += chunk;
                    
                    // Split on \r\n or \r or \n
                    const normalized = this._lineBuffer.replace(/\r\n/g, '\r').replace(/\n/g, '\r');
                    const parts = normalized.split('\r');
                    
                    // Process all complete lines (all but the last part)
                    for (let i = 0; i < parts.length - 1; i++) {
                        const line = parts[i];
                        if (line.length > 0) {
                            logger.log(`[WinlinkRelay/${this.deviceId}] CMS << ${line}`);
                            this.emit('line', line);
                        }
                    }
                    
                    // Keep the incomplete last part in the buffer
                    this._lineBuffer = parts[parts.length - 1];
                }
            } catch (ex) {
                if (this.tcpRunning) {
                    logger.error(`[WinlinkRelay/${this.deviceId}] Receive error: ${ex.message}`);
                }
            }
        });
    }
    
    /**
     * Sends a string to the CMS gateway with \r appended.
     * @param {string} line - The line to send.
     */
    sendLine(line) {
        if (!this.isConnected) return;
        logger.log(`[WinlinkRelay/${this.deviceId}] CMS >> ${line}`);
        this._sendRaw(line + '\r');
    }
    
    /**
     * Sends raw string data to the CMS gateway (no \r appended).
     * @param {string} data - The raw string data to send.
     * @private
     */
    _sendRaw(data) {
        if (!this.isConnected) return;
        try {
            this.socket.write(data, 'utf8');
        } catch (ex) {
            logger.error(`[WinlinkRelay/${this.deviceId}] Send error: ${ex.message}`);
            this.disconnect();
        }
    }
    
    /**
     * Sends raw binary data to the CMS gateway.
     * @param {Buffer} data - The binary data to send.
     */
    sendBinary(data) {
        if (!this.isConnected) return;
        try {
            this.socket.write(data);
        } catch (ex) {
            logger.error(`[WinlinkRelay/${this.deviceId}] Binary send error: ${ex.message}`);
            this.disconnect();
        }
    }
    
    /**
     * Disconnects from the CMS gateway.
     */
    disconnect() {
        if (!this.tcpRunning && this.socket === null) return;
        logger.log(`[WinlinkRelay/${this.deviceId}] Disconnecting from CMS gateway`);
        this.tcpRunning = false;
        this._cleanupSocket();
        this.emit('disconnected');
    }
    
    /**
     * Cleans up the socket connection.
     * @private
     */
    _cleanupSocket() {
        if (this.socket) {
            try {
                this.socket.destroy();
            } catch (ex) {
                // Ignore cleanup errors
            }
            this.socket = null;
        }
    }
    
    /**
     * Disposes of the relay, cleaning up all resources.
     */
    dispose() {
        if (this.disposed) return;
        this.disposed = true;
        this.tcpRunning = false;
        this._cleanupSocket();
        this.removeAllListeners();
    }
}

module.exports = WinlinkGatewayRelay;
