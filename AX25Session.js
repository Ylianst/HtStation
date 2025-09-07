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

const EventEmitter = require('events');
const AX25Packet = require('./AX25Packet.js');
const AX25Address = require('./AX25Address.js');

class AX25Session extends EventEmitter {
    constructor(parent, radio) {
        super();
        
        this.radio = radio;
        this.parent = parent;
        this.sessionState = new Map();
        
        // Override callsign and station ID if needed
        this.callSignOverride = null;
        this.stationIdOverride = -1; // -1 means use the default station ID
        
        // Configuration parameters
        this.maxFrames = 4;
        this.packetLength = 256;
        this.retries = 3;
        this.hBaud = 1200;
        this.modulo128 = false;
        this.tracing = true;
        
        // Connection state
        this._state = {
            connection: AX25Session.ConnectionState.DISCONNECTED,
            receiveSequence: 0,
            sendSequence: 0,
            remoteReceiveSequence: 0,
            remoteBusy: false,
            sentREJ: false,
            sentSREJ: false,
            gotREJSequenceNum: -1,
            gotSREJSequenceNum: -1,
            sendBuffer: [],
            receiveBuffer: new Map() // Buffer for out-of-order packets
        };
        
        // Timers
        this._timers = {
            connect: null,
            disconnect: null,
            t1: null,
            t2: null,
            t3: null,
            connectAttempts: 0,
            disconnectAttempts: 0,
            t1Attempts: 0,
            t3Attempts: 0
        };
        
        this.addresses = null;
    }
    
    // Getters for session properties
    get sessionCallsign() {
        if (this.callSignOverride !== null) {
            return this.callSignOverride;
        }
        return this.parent.callsign || this.parent.RADIO_CALLSIGN;
    }
    
    get sessionStationId() {
        if (this.stationIdOverride >= 0) {
            return this.stationIdOverride;
        }
        return this.parent.stationId || this.parent.RADIO_STATIONID;
    }
    
    get currentState() {
        return this._state.connection;
    }
    
    get sendBufferLength() {
        return this._state.sendBuffer.length;
    }
    
    // Event emission helpers
    _onErrorEvent(error) {
        this._trace(`ERROR: ${error}`);
        this.emit('error', error);
    }
    
    _onStateChangedEvent(state) {
        this.emit('stateChanged', state);
    }
    
    _onUiDataReceivedEvent(data) {
        this.emit('uiDataReceived', data);
    }
    
    _onDataReceivedEvent(data) {
        this.emit('dataReceived', data);
    }
    
    // Utility methods
    _trace(msg) {
        if (this.tracing) {
            console.log(`[AX25Session] ${msg}`);
        }
    }
    
    _setConnectionState(state) {
        if (state !== this._state.connection) {
            this._state.connection = state;
            this._onStateChangedEvent(state);
            if (state === AX25Session.ConnectionState.DISCONNECTED) {
                this._state.sendBuffer = [];
                this._clearReceiveBuffer();
                this.addresses = null;
                this.sessionState.clear();
                // Clear session channel ID when disconnecting
                this.sessionChannelId = undefined;
            }
        }
    }
    
    _emitPacket(packet) {
        this._trace('EmitPacket');
        
        // Use session channel ID if available, otherwise fall back to parent's activeChannelIdLock
        const channelId = this.sessionChannelId || this.parent.activeChannelIdLock;
        
        if (!channelId || channelId < 0) return;
        
        if (typeof this.radio.sendTncFrame === 'function') {
            const serialized = packet.toByteArray();
            if (serialized) {
                this._trace(`Sending TNC frame on channel ${channelId}, data length: ${serialized.length}`);
                
                // Debug: Log packet details for UA frames
                if (packet.type === AX25Packet.FrameType.U_FRAME_UA) {
                    this._trace(`UA packet details:`);
                    this._trace(`  Type: ${packet.type} (UA)`);
                    this._trace(`  Command: ${packet.command}`);
                    this._trace(`  Poll/Final: ${packet.pollFinal}`);
                    this._trace(`  Modulo128: ${packet.modulo128}`);
                    this._trace(`  Addresses: ${packet.addresses.map(a => a.toString()).join(' -> ')}`);
                    this._trace(`  Serialized bytes: ${Array.from(serialized).map(b => '0x' + b.toString(16).padStart(2, '0')).join(' ')}`);
                }
                
                this.radio.sendTncFrame({
                    channel_id: channelId,
                    data: serialized
                });
            } else {
                this._trace('Packet serialization failed - cannot send');
            }
        } else {
            this._trace('Radio sendTncFrame not available');
        }
    }
    
    // Timing calculations
    _getMaxPacketTime() {
        return Math.floor((600 + (this.packetLength * 8)) / this.hBaud * 1000);
    }
    
    _getTimeout() {
        let multiplier = 0;
        for (const packet of this._state.sendBuffer) {
            if (packet.sent) {
                multiplier++;
            }
        }
        const addressCount = this.addresses ? this.addresses.length : 2;
        return (this._getMaxPacketTime() * Math.max(1, addressCount - 2) * 4) + 
               (this._getMaxPacketTime() * Math.max(1, multiplier));
    }
    
    _getTimerTimeout(timerName) {
        switch (timerName) {
            case 'connect':
            case 'disconnect':
            case 't1':
                return this._getTimeout();
            case 't2':
                return this._getMaxPacketTime() * 2;
            case 't3':
                return this._getTimeout() * 7;
            default:
                return 0;
        }
    }
    
    // Timer management
    _setTimer(timerName) {
        this._clearTimer(timerName);
        if (!this.addresses) return;
        
        const timeout = this._getTimerTimeout(timerName);
        this._trace(`SetTimer ${timerName} to ${timeout}ms`);
        
        this._timers[timerName] = setTimeout(() => {
            this._onTimerExpired(timerName);
        }, timeout);
    }
    
    _clearTimer(timerName) {
        this._trace(`ClearTimer ${timerName}`);
        if (this._timers[timerName]) {
            clearTimeout(this._timers[timerName]);
            this._timers[timerName] = null;
        }
        
        switch (timerName) {
            case 'connect':
                this._timers.connectAttempts = 0;
                break;
            case 'disconnect':
                this._timers.disconnectAttempts = 0;
                break;
            case 't1':
                this._timers.t1Attempts = 0;
                break;
            case 't3':
                this._timers.t3Attempts = 0;
                break;
        }
    }
    
    _onTimerExpired(timerName) {
        switch (timerName) {
            case 'connect':
                this._onConnectTimerExpired();
                break;
            case 'disconnect':
                this._onDisconnectTimerExpired();
                break;
            case 't1':
                this._onT1TimerExpired();
                break;
            case 't2':
                this._onT2TimerExpired();
                break;
            case 't3':
                this._onT3TimerExpired();
                break;
        }
    }
    
    _onConnectTimerExpired() {
        this._trace('Timer - Connect');
        if (this._timers.connectAttempts >= (this.retries - 1)) {
            this._clearTimer('connect');
            this._setConnectionState(AX25Session.ConnectionState.DISCONNECTED);
            return;
        }
        this._connectEx();
    }
    
    _onDisconnectTimerExpired() {
        this._trace('Timer - Disconnect');
        if (this._timers.disconnectAttempts >= (this.retries - 1)) {
            this._clearTimer('disconnect');
            this._emitPacket(
                new AX25Packet(
                    this.addresses,
                    this._state.receiveSequence,
                    this._state.sendSequence,
                    false,
                    false,
                    AX25Packet.FrameType.U_FRAME_DM
                )
            );
            this._setConnectionState(AX25Session.ConnectionState.DISCONNECTED);
            return;
        }
        this.disconnect();
    }
    
    _onT1TimerExpired() {
        this._trace('** Timer - T1 expired');
        if (this._timers.t1Attempts >= this.retries) {
            this._clearTimer('t1');
            this.disconnect();
            return;
        }
        this._timers.t1Attempts++;
        this._sendRR(true);
    }
    
    _onT2TimerExpired() {
        this._trace('** Timer - T2 expired');
        this._clearTimer('t2');
        this._drain(true);
    }
    
    _onT3TimerExpired() {
        this._trace('** Timer - T3 expired');
        if (this._timers.t1) return; // Don't interfere if T1 is active
        if (this._timers.t3Attempts >= this.retries) {
            this._clearTimer('t3');
            this.disconnect();
            return;
        }
        this._timers.t3Attempts++;
    }
    
    // Utility methods
    _distanceBetween(leader, follower, modulus) {
        return (leader < follower) ? (leader + (modulus - follower)) : (leader - follower);
    }
    
    _receiveAcknowledgement(packet) {
        this._trace('ReceiveAcknowledgement');
        for (let p = 0; p < this._state.sendBuffer.length; p++) {
            if (this._state.sendBuffer[p].sent &&
                (this._state.sendBuffer[p].ns !== packet.nr) &&
                (this._distanceBetween(packet.nr, this._state.sendBuffer[p].ns, 
                    this.modulo128 ? 128 : 8) <= this.maxFrames)) {
                this._state.sendBuffer.splice(p, 1);
                p--;
            }
        }
        this._state.remoteReceiveSequence = packet.nr;
    }
    
    _sendRR(pollFinal) {
        this._trace('SendRR');
        const packet = new AX25Packet(
            this.addresses,
            this._state.receiveSequence,
            this._state.sendSequence,
            pollFinal,
            true,
            AX25Packet.FrameType.S_FRAME_RR
        );
        packet.modulo128 = this.modulo128;
        this._emitPacket(packet);
    }
    
    _drain(resent = true) {
        this._trace(`Drain, Packets in Queue: ${this._state.sendBuffer.length}, Resend: ${resent}`);
        if (this._state.remoteBusy) {
            this._clearTimer('t1');
            return;
        }
        
        let sequenceNum = this._state.sendSequence;
        if (this._state.gotREJSequenceNum > 0) {
            sequenceNum = this._state.gotREJSequenceNum;
        }
        
        let startTimer = false;
        for (let packetIndex = 0; packetIndex < this._state.sendBuffer.length; packetIndex++) {
            const dst = this._distanceBetween(sequenceNum, this._state.remoteReceiveSequence, 
                this.modulo128 ? 128 : 8);
            if (this._state.sendBuffer[packetIndex].sent || (dst < this.maxFrames)) {
                this._state.sendBuffer[packetIndex].nr = this._state.receiveSequence;
                if (!this._state.sendBuffer[packetIndex].sent) {
                    this._state.sendBuffer[packetIndex].ns = this._state.sendSequence;
                    this._state.sendBuffer[packetIndex].sent = true;
                    this._state.sendSequence = (this._state.sendSequence + 1) % (this.modulo128 ? 128 : 8);
                    sequenceNum = (sequenceNum + 1) % (this.modulo128 ? 128 : 8);
                } else if (!resent) {
                    continue;
                }
                startTimer = true;
                this._emitPacket(this._state.sendBuffer[packetIndex]);
            }
        }
        
        if ((this._state.gotREJSequenceNum < 0) && !startTimer) {
            this._sendRR(false);
        }
        
        this._state.gotREJSequenceNum = -1;
        if (startTimer) {
            this._setTimer('t1');
        } else {
            this._clearTimer('t1');
        }
    }
    
    _renumber() {
        this._trace('Renumber');
        for (let p = 0; p < this._state.sendBuffer.length; p++) {
            this._state.sendBuffer[p].ns = p % (this.modulo128 ? 128 : 8);
            this._state.sendBuffer[p].nr = 0;
            this._state.sendBuffer[p].sent = false;
        }
    }
    
    // Out-of-order packet management
    _storeOutOfOrderPacket(packet) {
        const sequenceNumber = packet.ns;
        this._trace(`Storing out-of-order packet with sequence ${sequenceNumber}`);
        this._state.receiveBuffer.set(sequenceNumber, {
            packet: packet,
            timestamp: Date.now()
        });
        
        // Clean up old packets (older than 30 seconds) to prevent memory leaks
        const now = Date.now();
        const timeout = 30000; // 30 seconds
        for (const [seq, entry] of this._state.receiveBuffer.entries()) {
            if (now - entry.timestamp > timeout) {
                this._trace(`Removing expired out-of-order packet with sequence ${seq}`);
                this._state.receiveBuffer.delete(seq);
            }
        }
    }
    
    _processBufferedPackets() {
        let packetsProcessed = 0;
        let expectedSeq = this._state.receiveSequence;
        const modulus = this.modulo128 ? 128 : 8;
        
        // Keep processing buffered packets in order until we hit a gap
        while (this._state.receiveBuffer.has(expectedSeq)) {
            const entry = this._state.receiveBuffer.get(expectedSeq);
            const packet = entry.packet;
            
            this._trace(`Processing buffered packet with sequence ${expectedSeq}`);
            
            // Deliver the packet data
            if (packet.data && packet.data.length > 0) {
                this._onDataReceivedEvent(packet.data);
            }
            
            // Remove from buffer and advance sequence
            this._state.receiveBuffer.delete(expectedSeq);
            this._state.receiveSequence = (this._state.receiveSequence + 1) % modulus;
            expectedSeq = (expectedSeq + 1) % modulus;
            packetsProcessed++;
        }
        
        if (packetsProcessed > 0) {
            this._trace(`Processed ${packetsProcessed} buffered packets, new receive sequence: ${this._state.receiveSequence}`);
        }
        
        return packetsProcessed;
    }
    
    _clearReceiveBuffer() {
        this._trace('Clearing receive buffer');
        this._state.receiveBuffer.clear();
    }
    
    // Public methods
    connect(addresses) {
        this._trace('Connect');
        if (this.currentState !== AX25Session.ConnectionState.DISCONNECTED) return false;
        if (!addresses || addresses.length < 2) return false;
        
        this.addresses = addresses;
        this._state.sendBuffer = [];
        this._clearTimer('connect');
        this._clearTimer('t1');
        this._clearTimer('t2');
        this._clearTimer('t3');
        return this._connectEx();
    }
    
    _connectEx() {
        this._trace('ConnectEx');
        this._setConnectionState(AX25Session.ConnectionState.CONNECTING);
        this._state.receiveSequence = 0;
        this._state.sendSequence = 0;
        this._state.remoteReceiveSequence = 0;
        this._state.remoteBusy = false;
        this._state.gotREJSequenceNum = -1;
        
        this._clearTimer('disconnect');
        this._clearTimer('t3');
        
        const connectPacket = new AX25Packet(
            this.addresses,
            this._state.receiveSequence,
            this._state.sendSequence,
            true,
            true,
            this.modulo128 ? AX25Packet.FrameType.U_FRAME_SABME : AX25Packet.FrameType.U_FRAME_SABM
        );
        connectPacket.modulo128 = this.modulo128;
        this._emitPacket(connectPacket);
        
        this._renumber();
        this._timers.connectAttempts++;
        if (this._timers.connectAttempts >= this.retries) {
            this._clearTimer('connect');
            this._setConnectionState(AX25Session.ConnectionState.DISCONNECTED);
            return true;
        }
        
        if (!this._timers.connect) {
            this._setTimer('connect');
        }
        return true;
    }
    
    disconnect() {
        if (this._state.connection === AX25Session.ConnectionState.DISCONNECTED) return;
        
        this._trace('Disconnect');
        this._clearTimer('connect');
        this._clearTimer('t1');
        this._clearTimer('t2');
        this._clearTimer('t3');
        
        if (this._state.connection !== AX25Session.ConnectionState.CONNECTED) {
            this._onErrorEvent('ax25.Session.disconnect: Not connected.');
            this._setConnectionState(AX25Session.ConnectionState.DISCONNECTED);
            this._clearTimer('disconnect');
            return;
        }
        
        if (this._timers.disconnectAttempts >= this.retries) {
            this._clearTimer('disconnect');
            this._emitPacket(
                new AX25Packet(
                    this.addresses,
                    this._state.receiveSequence,
                    this._state.sendSequence,
                    false,
                    false,
                    AX25Packet.FrameType.U_FRAME_DM
                )
            );
            this._setConnectionState(AX25Session.ConnectionState.DISCONNECTED);
            return;
        }
        
        this._timers.disconnectAttempts++;
        this._setConnectionState(AX25Session.ConnectionState.DISCONNECTING);
        const discPacket = new AX25Packet(
            this.addresses,
            this._state.receiveSequence,
            this._state.sendSequence,
            true,
            true,
            AX25Packet.FrameType.U_FRAME_DISC
        );
        discPacket.modulo128 = this.modulo128;
        this._emitPacket(discPacket);
        
        if (!this._timers.disconnect) {
            this._setTimer('disconnect');
        }
    }
    
    send(info) {
        if (typeof info === 'string') {
            info = Buffer.from(info, 'utf8');
        }
        
        this._trace('Send');
        if (!info || info.length === 0) return;
        
        const packetLength = this.packetLength;
        for (let i = 0; i < info.length; i += packetLength) {
            const length = Math.min(packetLength, info.length - i);
            const packetInfo = info.slice(i, i + length);
            
            const dataPacket = new AX25Packet(
                this.addresses,
                0,
                0,
                false,
                true,
                AX25Packet.FrameType.I_FRAME,
                packetInfo
            );
            dataPacket.modulo128 = this.modulo128;
            this._state.sendBuffer.push(dataPacket);
        }
        
        if (!this._timers.t2) {
            this._drain(false);
        }
    }
    
    receive(packet) {
        if (!packet || !packet.addresses || packet.addresses.length < 2) return false;
        
        this._trace(`Receive ${packet.type}`);
        
        // Debug: Log incoming SABM packet details
        if (packet.type === AX25Packet.FrameType.U_FRAME_SABM || packet.type === AX25Packet.FrameType.U_FRAME_SABME) {
            this._trace(`Incoming SABM packet details:`);
            this._trace(`  Type: ${packet.type} (${packet.type === AX25Packet.FrameType.U_FRAME_SABM ? 'SABM' : 'SABME'})`);
            this._trace(`  Command: ${packet.command}`);
            this._trace(`  Poll/Final: ${packet.pollFinal}`);
            this._trace(`  Addresses: ${packet.addresses.map(a => a.toString()).join(' -> ')}`);
            this._trace(`  Address[0] (dest): ${packet.addresses[0].toString()} (callsign: ${packet.addresses[0].callSignWithId})`);
            this._trace(`  Address[1] (src): ${packet.addresses[1].toString()} (callsign: ${packet.addresses[1].callSignWithId})`);
        }
        
        let response = new AX25Packet(
            this.addresses,
            this._state.receiveSequence,
            this._state.sendSequence,
            false,
            !packet.command,
            0
        );
        response.modulo128 = this.modulo128;
        
        let newState = this.currentState;
        
        // Check if this is for the right station for this session
        if (this.addresses && 
            (packet.addresses[1].callSignWithId !== this.addresses[0].callSignWithId)) {
            this._trace(`Got packet from wrong station: ${packet.addresses[1].callSignWithId}`);
            
            const fromAddr = AX25Address.getAddressFromString(packet.addresses[1].toString());
            const toAddr = AX25Address.getAddress(this.sessionCallsign, this.sessionStationId);
            
            if (!fromAddr || !toAddr) {
                this._trace(`Failed to create response addresses for wrong station packet`);
                return false;
            }
            
            response.addresses = [fromAddr, toAddr];
            response.type = AX25Packet.FrameType.U_FRAME_DISC;
            response.command = false;
            response.pollFinal = true;
            this._emitPacket(response);
            return false;
        }
        
        // If we are not connected and this is not a connection request, respond with a disconnect
        if (!this.addresses && 
            (packet.type !== AX25Packet.FrameType.U_FRAME_SABM) && 
            (packet.type !== AX25Packet.FrameType.U_FRAME_SABME)) {
            
            const fromAddr = AX25Address.getAddressFromString(packet.addresses[1].toString());
            const toAddr = AX25Address.getAddress(this.sessionCallsign, this.sessionStationId);
            
            if (!fromAddr || !toAddr) {
                this._trace(`Failed to create response addresses for non-connection packet`);
                return false;
            }
            
            response.addresses = [fromAddr, toAddr];
            response.command = false;
            response.pollFinal = true;
            
            if (packet.type === AX25Packet.FrameType.U_FRAME_DISC) {
                response.type = AX25Packet.FrameType.U_FRAME_UA;
            } else {
                response.type = AX25Packet.FrameType.U_FRAME_DISC;
            }
            this._emitPacket(response);
            return false;
        }
        
        // Process different packet types
        switch (packet.type) {
            case AX25Packet.FrameType.U_FRAME_SABM:
            case AX25Packet.FrameType.U_FRAME_SABME:
                this._trace(`Processing SABM/SABME, current state: ${this.currentState}`);
                
                if (this.currentState !== AX25Session.ConnectionState.DISCONNECTED) {
                    this._trace(`Ignoring SABM - not in DISCONNECTED state (current: ${this.currentState})`);
                    return false;
                }
                
                const fromAddr = AX25Address.getAddressFromString(packet.addresses[1].toString());
                const toAddr = AX25Address.getAddress(this.sessionCallsign, this.sessionStationId);
                
                if (!fromAddr || !toAddr) {
                    this._trace(`Failed to create session addresses for connection request`);
                    return false;
                }
                
                this._trace(`Creating session addresses: [${fromAddr.toString()}] <-> [${toAddr.toString()}]`);
                this._trace(`Incoming SABM command bit: ${packet.command}, poll/final: ${packet.pollFinal}`);
                
                // Store the channel ID from the incoming packet for responses
                if (packet.channel_id !== undefined) {
                    this.sessionChannelId = packet.channel_id;
                    this._trace(`Storing session channel ID: ${packet.channel_id} for responses`);
                } else {
                    this._trace(`Warning: No channel_id in incoming SABM packet`);
                }
                
                // For session addresses, store as [remote, local] for consistency
                this.addresses = [fromAddr, toAddr];
                
                // For the UA response, we need to swap the addresses from the incoming packet
                // The incoming SABM has [destination=us, source=remote]
                // Our UA response should have [destination=remote, source=us]
                response.addresses = [fromAddr, toAddr];
                response.command = false; // UA is always a response frame
                response.pollFinal = packet.pollFinal; // Echo the poll/final bit from SABM
                
                this._trace(`UA response addresses: dest=[${response.addresses[0].toString()}] src=[${response.addresses[1].toString()}]`);
                this._trace(`UA response command bit: ${response.command}, poll/final: ${response.pollFinal}`);
                
                this._state.receiveSequence = 0;
                this._state.sendSequence = 0;
                this._state.remoteReceiveSequence = 0;
                this._state.gotREJSequenceNum = -1;
                this._state.remoteBusy = false;
                this._state.sendBuffer = [];
                this._clearReceiveBuffer();
                
                this._clearTimer('connect');
                this._clearTimer('disconnect');
                this._clearTimer('t1');
                this._clearTimer('t2');
                this._clearTimer('t3');
                
                this.modulo128 = (packet.type === AX25Packet.FrameType.U_FRAME_SABME);
                response.modulo128 = this.modulo128; // Update response modulo128 after setting session modulo128
                this._renumber();
                response.type = AX25Packet.FrameType.U_FRAME_UA;
                newState = AX25Session.ConnectionState.CONNECTED;
                break;
                
            case AX25Packet.FrameType.U_FRAME_DISC:
                if (this._state.connection === AX25Session.ConnectionState.CONNECTED) {
                    this._state.receiveSequence = 0;
                    this._state.sendSequence = 0;
                    this._state.remoteReceiveSequence = 0;
                    this._state.gotREJSequenceNum = -1;
                    this._state.remoteBusy = false;
                    
                    this._clearTimer('connect');
                    this._clearTimer('disconnect');
                    this._clearTimer('t1');
                    this._clearTimer('t2');
                    this._clearTimer('t3');
                    
                    response.type = AX25Packet.FrameType.U_FRAME_UA;
                    response.pollFinal = true;
                    this._emitPacket(response);
                    this._setConnectionState(AX25Session.ConnectionState.DISCONNECTED);
                } else {
                    response.type = AX25Packet.FrameType.U_FRAME_DM;
                    response.pollFinal = true;
                    this._emitPacket(response);
                }
                return true;
                
            case AX25Packet.FrameType.U_FRAME_UA:
                if (this._state.connection === AX25Session.ConnectionState.CONNECTING) {
                    this._clearTimer('connect');
                    this._clearTimer('t2');
                    this._setTimer('t3');
                    response = null;
                    newState = AX25Session.ConnectionState.CONNECTED;
                } else if (this._state.connection === AX25Session.ConnectionState.DISCONNECTING) {
                    this._clearTimer('disconnect');
                    this._clearTimer('t2');
                    this._clearTimer('t3');
                    response = null;
                    newState = AX25Session.ConnectionState.DISCONNECTED;
                } else if (this._state.connection === AX25Session.ConnectionState.CONNECTED) {
                    response = null;
                } else {
                    response.type = AX25Packet.FrameType.U_FRAME_DM;
                    response.pollFinal = false;
                }
                break;
                
            case AX25Packet.FrameType.U_FRAME_DM:
                if (this._state.connection === AX25Session.ConnectionState.CONNECTED) {
                    this._connectEx();
                    response = null;
                } else if (this._state.connection === AX25Session.ConnectionState.CONNECTING || 
                          this._state.connection === AX25Session.ConnectionState.DISCONNECTING) {
                    this._state.receiveSequence = 0;
                    this._state.sendSequence = 0;
                    this._state.remoteReceiveSequence = 0;
                    this._state.gotREJSequenceNum = -1;
                    this._state.remoteBusy = false;
                    this._state.sendBuffer = [];
                    
                    this._clearTimer('connect');
                    this._clearTimer('disconnect');
                    this._clearTimer('t1');
                    this._clearTimer('t2');
                    this._clearTimer('t3');
                    
                    response = null;
                    if (this._state.connection === AX25Session.ConnectionState.CONNECTING) {
                        this.modulo128 = false;
                        this._connectEx();
                    } else {
                        newState = AX25Session.ConnectionState.DISCONNECTED;
                    }
                } else {
                    response.type = AX25Packet.FrameType.U_FRAME_DM;
                    response.pollFinal = true;
                }
                break;
                
            case AX25Packet.FrameType.U_FRAME_UI:
                if (packet.data && packet.data.length > 0) {
                    this._onUiDataReceivedEvent(packet.data);
                }
                if (packet.pollFinal) {
                    response.pollFinal = false;
                    response.type = (this._state.connection === AX25Session.ConnectionState.CONNECTED) ? 
                        AX25Packet.FrameType.S_FRAME_RR : AX25Packet.FrameType.U_FRAME_DM;
                } else {
                    response = null;
                }
                break;
                
            case AX25Packet.FrameType.U_FRAME_XID:
                response.type = AX25Packet.FrameType.U_FRAME_DM;
                break;
                
            case AX25Packet.FrameType.U_FRAME_TEST:
                response.type = AX25Packet.FrameType.U_FRAME_TEST;
                if (packet.data && packet.data.length > 0) {
                    response.data = packet.data;
                }
                break;
                
            case AX25Packet.FrameType.U_FRAME_FRMR:
                if (this._state.connection === AX25Session.ConnectionState.CONNECTING && this.modulo128) {
                    this.modulo128 = false;
                    this._connectEx();
                    response = null;
                } else if (this._state.connection === AX25Session.ConnectionState.CONNECTED) {
                    this._connectEx();
                    response = null;
                } else {
                    response.type = AX25Packet.FrameType.U_FRAME_DM;
                    response.pollFinal = true;
                }
                break;
                
            case AX25Packet.FrameType.S_FRAME_RR:
                if (this._state.connection === AX25Session.ConnectionState.CONNECTED) {
                    this._state.remoteBusy = false;
                    if (packet.command && packet.pollFinal) {
                        response.type = AX25Packet.FrameType.S_FRAME_RR;
                        response.pollFinal = true;
                    } else {
                        response = null;
                    }
                    this._receiveAcknowledgement(packet);
                    this._setTimer('t2');
                } else if (packet.command) {
                    response.type = AX25Packet.FrameType.U_FRAME_DM;
                    response.pollFinal = true;
                }
                break;
                
            case AX25Packet.FrameType.S_FRAME_RNR:
                if (this._state.connection === AX25Session.ConnectionState.CONNECTED) {
                    this._state.remoteBusy = true;
                    this._receiveAcknowledgement(packet);
                    if (packet.command && packet.pollFinal) {
                        response.type = AX25Packet.FrameType.S_FRAME_RR;
                        response.pollFinal = true;
                    } else {
                        response = null;
                    }
                    this._clearTimer('t2');
                    this._setTimer('t1');
                } else if (packet.command) {
                    response.type = AX25Packet.FrameType.U_FRAME_DM;
                    response.pollFinal = true;
                }
                break;
                
            case AX25Packet.FrameType.S_FRAME_REJ:
                if (this._state.connection === AX25Session.ConnectionState.CONNECTED) {
                    this._state.remoteBusy = false;
                    if (packet.command && packet.pollFinal) {
                        response.type = AX25Packet.FrameType.S_FRAME_RR;
                        response.pollFinal = true;
                    } else {
                        response = null;
                    }
                    this._receiveAcknowledgement(packet);
                    this._state.gotREJSequenceNum = packet.nr;
                    this._setTimer('t2');
                } else {
                    response.type = AX25Packet.FrameType.U_FRAME_DM;
                    response.pollFinal = true;
                }
                break;
                
            case AX25Packet.FrameType.I_FRAME:
                if (this._state.connection === AX25Session.ConnectionState.CONNECTED) {
                    this._trace(`Received I-frame with sequence ${packet.ns}, expecting ${this._state.receiveSequence}`);
                    
                    if (packet.pollFinal) {
                        response.pollFinal = true;
                    }
                    
                    if (packet.ns === this._state.receiveSequence) {
                        // Expected packet - process it and any buffered packets
                        this._state.sentREJ = false;
                        this._state.receiveSequence = (this._state.receiveSequence + 1) % (this.modulo128 ? 128 : 8);
                        
                        if (packet.data && packet.data.length > 0) {
                            this._onDataReceivedEvent(packet.data);
                        }
                        
                        // Process any buffered packets that are now in order
                        const bufferedProcessed = this._processBufferedPackets();
                        if (bufferedProcessed > 0) {
                            this._trace(`After processing expected packet, delivered ${bufferedProcessed} additional buffered packets`);
                        }
                        
                        response = null;
                    } else {
                        // Out-of-order packet
                        const modulus = this.modulo128 ? 128 : 8;
                        const distance = this._distanceBetween(packet.ns, this._state.receiveSequence, modulus);
                        
                        if (distance <= this.maxFrames && distance > 0) {
                            // Packet is ahead but within window - buffer it
                            this._trace(`Buffering out-of-order packet sequence ${packet.ns} (ahead by ${distance})`);
                            this._storeOutOfOrderPacket(packet);
                            
                            // Don't send REJ if we're buffering packets
                            response = null;
                        } else if (this._state.sentREJ) {
                            // REJ already sent for this gap
                            response = null;
                        } else {
                            // Gap is too large or packet is behind - send REJ
                            this._trace(`Sending REJ for sequence ${this._state.receiveSequence} (received ${packet.ns})`);
                            response.type = AX25Packet.FrameType.S_FRAME_REJ;
                            this._state.sentREJ = true;
                        }
                    }
                    
                    this._receiveAcknowledgement(packet);
                    
                    if (!response || !response.pollFinal) {
                        response = null;
                        this._setTimer('t2');
                    }
                } else if (packet.command) {
                    response.type = AX25Packet.FrameType.U_FRAME_DM;
                    response.pollFinal = true;
                }
                break;
                
            default:
                response = null;
                break;
        }
        
        if (response) {
            if (!response.addresses) {
                const fromAddr = AX25Address.getAddressFromString(packet.addresses[1].toString());
                const toAddr = AX25Address.getAddress(this.sessionCallsign, this.sessionStationId);
                
                if (!fromAddr || !toAddr) {
                    this._trace(`Failed to create response addresses`);
                    return false;
                }
                
                response.addresses = [fromAddr, toAddr];
            }
            this._emitPacket(response);
        }
        
        if (newState !== this.currentState) {
            if ((this.currentState === AX25Session.ConnectionState.DISCONNECTING) && 
                (newState === AX25Session.ConnectionState.CONNECTED)) {
                return true;
            }
            this._setConnectionState(newState);
        }
        
        return true;
    }
}

// Static constants
AX25Session.ConnectionState = {
    DISCONNECTED: 1,
    CONNECTED: 2,
    CONNECTING: 3,
    DISCONNECTING: 4
};

module.exports = AX25Session;
