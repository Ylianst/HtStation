/*
Simple debug test to understand the SABM/UA issue
*/

'use strict';

const EventEmitter = require('events');
const AX25Session = require('./AX25Session.js');
const AX25Address = require('./AX25Address.js');
const AX25Packet = require('./AX25Packet.js');

class MockRadio extends EventEmitter {
    constructor(name) {
        super();
        this.name = name;
        this.partner = null;
    }

    setPartner(radio) {
        this.partner = radio;
        radio.partner = this;
    }

    sendTncFrame(frame) {
        if (!this.partner) return;
        console.log(`[${this.name}] Sending frame, data length: ${frame.data ? frame.data.length : 0}`);
        setTimeout(() => {
            this.partner.emit('tncFrame', frame);
        }, 10);
    }
}

class MockParent {
    constructor(callsign, stationId) {
        this.callsign = callsign;
        this.stationId = stationId;
        this.activeChannelIdLock = 1;
    }
}

// Create test setup
const radioA = new MockRadio('Radio-A');
const radioB = new MockRadio('Radio-B');
radioA.setPartner(radioB);

const parentA = new MockParent('TEST1', 1);
const parentB = new MockParent('TEST2', 2);

const sessionA = new AX25Session(parentA, radioA);
const sessionB = new AX25Session(parentB, radioB);

// Enable tracing to see what's happening
sessionA.tracing = true;
sessionB.tracing = true;

// Monitor traffic
radioA.on('tncFrame', (frame) => {
    const packet = AX25Packet.decodeAX25Packet(frame);
    if (packet) {
        console.log(`A --> B: ${getPacketTypeString(packet.type)} [${packet.addresses.map(a => a.toString()).join(' -> ')}]`);
        console.log(`  Command: ${packet.command}, P/F: ${packet.pollFinal}`);
        console.log(`  NR: ${packet.nr}, NS: ${packet.ns}`);
        
        // Let session B process it
        sessionB.receive(packet);
    }
});

radioB.on('tncFrame', (frame) => {
    const packet = AX25Packet.decodeAX25Packet(frame);
    if (packet) {
        console.log(`B --> A: ${getPacketTypeString(packet.type)} [${packet.addresses.map(a => a.toString()).join(' -> ')}]`);
        console.log(`  Command: ${packet.command}, P/F: ${packet.pollFinal}`);
        console.log(`  NR: ${packet.nr}, NS: ${packet.ns}`);
        
        // Let session A process it
        sessionA.receive(packet);
    }
});

function getPacketTypeString(type) {
    const types = {
        [AX25Packet.FrameType.I_FRAME]: 'I-FRAME',
        [AX25Packet.FrameType.S_FRAME_RR]: 'RR',
        [AX25Packet.FrameType.S_FRAME_RNR]: 'RNR',
        [AX25Packet.FrameType.S_FRAME_REJ]: 'REJ',
        [AX25Packet.FrameType.S_FRAME_SREJ]: 'SREJ',
        [AX25Packet.FrameType.U_FRAME_SABM]: 'SABM',
        [AX25Packet.FrameType.U_FRAME_SABME]: 'SABME',
        [AX25Packet.FrameType.U_FRAME_DISC]: 'DISC',
        [AX25Packet.FrameType.U_FRAME_DM]: 'DM',
        [AX25Packet.FrameType.U_FRAME_UA]: 'UA',
        [AX25Packet.FrameType.U_FRAME_UI]: 'UI',
        [AX25Packet.FrameType.U_FRAME_FRMR]: 'FRMR',
        [AX25Packet.FrameType.U_FRAME_XID]: 'XID',
        [AX25Packet.FrameType.U_FRAME_TEST]: 'TEST'
    };
    return types[type] || `UNKNOWN(${type})`;
}

// Set up event monitoring
sessionA.on('stateChanged', (state) => {
    console.log(`Session A state changed to: ${state}`);
});

sessionB.on('stateChanged', (state) => {
    console.log(`Session B state changed to: ${state}`);
});

// Test connection
console.log('Starting connection test...');
console.log('Session A callsign:', sessionA.sessionCallsign, 'stationId:', sessionA.sessionStationId);
console.log('Session B callsign:', sessionB.sessionCallsign, 'stationId:', sessionB.sessionStationId);

const addrA = AX25Address.getAddress('TEST1', 1);
const addrB = AX25Address.getAddress('TEST2', 2);
console.log('Address A:', addrA.toString());
console.log('Address B:', addrB.toString());

const addresses = [addrB, addrA]; // [destination, source]
console.log('Connection addresses:', addresses.map(a => a.toString()).join(' -> '));

sessionA.connect(addresses);

// Stop after 5 seconds
setTimeout(() => {
    console.log('Stopping test...');
    process.exit(0);
}, 5000);
