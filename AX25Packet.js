// AX25Packet.js - NodeJS port of AX25Packet from C#
// Copyright 2025 Ylian Saint-Hilaire
// Licensed under the Apache License, Version 2.0

const AX25Address = require('./AX25Address');

class AX25Packet {
    constructor(addresses, nr, ns, pollFinal, command, type, data = null) {
        this.addresses = addresses;
        this.nr = nr;
        this.ns = ns;
        this.pollFinal = pollFinal;
        this.command = command;
        this.type = type;
        this.time = new Date();
        this.data = data;
        this.pid = 240;
        this.dataStr = null;
        this.channel_id = null;
        this.channel_name = null;
        this.incoming = false;
        this.frame_size = null;
    }

    static get FrameType() {
        return {
            I_FRAME: 0,
            I_FRAME_MASK: 1,
            S_FRAME: 1,
            S_FRAME_RR: 1,
            S_FRAME_RNR: 1 | (1 << 2),
            S_FRAME_REJ: 1 | (1 << 3),
            S_FRAME_SREJ: 1 | (1 << 2) | (1 << 3),
            S_FRAME_MASK: 1 | (1 << 2) | (1 << 3),
            U_FRAME: 3,
            U_FRAME_SABM: 3 | (1 << 2) | (1 << 3) | (1 << 5),
            U_FRAME_SABME: 3 | (1 << 3) | (1 << 5) | (1 << 6),
            U_FRAME_DISC: 3 | (1 << 6),
            U_FRAME_DM: 3 | (1 << 2) | (1 << 3),
            U_FRAME_UA: 3 | (1 << 5) | (1 << 6),
            U_FRAME_FRMR: 3 | (1 << 2) | (1 << 7),
            U_FRAME_UI: 3,
            U_FRAME_XID: 3 | (1 << 2) | (1 << 3) | (1 << 5) | (1 << 7),
            U_FRAME_TEST: 3 | (1 << 5) | (1 << 6) | (1 << 7),
            U_FRAME_MASK: 3 | (1 << 2) | (1 << 3) | (1 << 5) | (1 << 6) | (1 << 7),
            A_CRH: 0x80
        };
    }

    static get Defs() {
        return {
            PF: (1 << 4),
            NS: (1 << 1) | (1 << 2) | (1 << 3),
            NR: (1 << 5) | (1 << 6) | (1 << 7),
            PF_MODULO128: (1 << 8),
            NS_MODULO128: (127 << 1),
            NR_MODULO128: (127 << 9),
            PID_NONE: (1 << 4) | (1 << 5) | (1 << 6) | (1 << 7)
        };
    }

    static decodeAX25Packet(frame) {
        const data = frame.data;
        if (!data || data.length < 6) return null;
        // Odd packet, not AX.25
        if (data[0] === 1) {
            const callsignLen = data[1];
            if (data.length < 3 + callsignLen) return null;
            const controlLen = data[2 + callsignLen];
            if (data.length < 4 + callsignLen + controlLen) return null;
            const messageLen = data[3 + callsignLen + controlLen];
            const xaddresses = [AX25Address.getAddress(Buffer.from(data).toString('utf8', 3, 3 + callsignLen - 1), 0)];
            const xxdata = Buffer.from(data).toString('utf8', 5 + callsignLen + controlLen, 5 + callsignLen + controlLen + messageLen - 1);
            const xxdata2 = Buffer.from(data).slice(5 + callsignLen + controlLen, 5 + callsignLen + controlLen + messageLen - 1);
            const xpacket = new AX25Packet(xaddresses, null, null, null, null, null, xxdata2);
            xpacket.dataStr = xxdata;
            xpacket.channel_id = frame.channel_id;
            xpacket.channel_name = frame.channel_name;
            xpacket.incoming = frame.incoming;
            xpacket.frame_size = data.length;
            return xpacket;
        }
        // Decode headers
        let i = 0;
        let done = false;
        const addresses = [];
        do {
            const { addr, last } = AX25Address.decodeAX25Address(data, i);
            if (!addr) return null;
            addresses.push(addr);
            done = last;
            i += 7;
        } while (!done);
        if (addresses.length < 1) return null;
        const command = addresses[0].CRBit1;
        const modulo128 = !addresses[0].CRBit2;
        // Decode control and pid
        let control = data[i++];
        let pollFinal = false;
        let type;
        let pid = 0;
        let nr = 0;
        let ns = 0;
        const FrameType = AX25Packet.FrameType;
        const Defs = AX25Packet.Defs;
        if ((control & FrameType.U_FRAME) === FrameType.U_FRAME) {
            pollFinal = ((control & Defs.PF) >> 4) !== 0;
            type = control & FrameType.U_FRAME_MASK;
            if (type === FrameType.U_FRAME_UI) pid = data[i++];
        } else if ((control & FrameType.U_FRAME) === FrameType.S_FRAME) {
            type = control & FrameType.S_FRAME_MASK;
            if (modulo128) {
                control |= data[i++] << 8;
                nr = (control & Defs.NR_MODULO128) >> 8;
                pollFinal = ((control & Defs.PF) >> 7) !== 0;
            } else {
                nr = (control & Defs.NR) >> 5;
                pollFinal = ((control & Defs.PF) >> 4) !== 0;
            }
        } else if ((control & 1) === FrameType.I_FRAME) {
            type = FrameType.I_FRAME;
            if (modulo128) {
                control |= data[i++] << 8;
                nr = (control & Defs.NR_MODULO128) >> 8;
                ns = (control & Defs.NS_MODULO128) >> 1;
                pollFinal = ((control & Defs.PF) >> 7) !== 0;
            } else {
                nr = (control & Defs.NR) >> 5;
                ns = (control & Defs.NS) >> 1;
                pollFinal = ((control & Defs.PF) >> 4) !== 0;
            }
            pid = data[i++];
        } else {
            return null;
        }
        let xdataStr = null;
        let xdata = null;
        if (data.length > i) {
            xdataStr = Buffer.from(data).toString('utf8', i);
            xdata = data.slice(i);
        }
        const packet = new AX25Packet(addresses, nr, ns, pollFinal, command, type, xdata);
        packet.dataStr = xdataStr;
        packet.pid = pid;
        packet.channel_id = frame.channel_id;
        packet.channel_name = frame.channel_name;
        packet.incoming = frame.incoming;
        packet.frame_size = data.length;
        return packet;
    }

    toString() {
        return this.addresses.map(a => `[${a.toString()}]`).join('') + ': ' + this.data;
    }

    /**
     * Format an AX.25 packet into APRS-style string representation
     * @returns {string} Formatted packet string (e.g., "SQ7PFS-10>APRS,TCPIP*,qAC,T2SYDNEY:payload")
     */
    formatAX25PacketString() {
        if (!this.addresses || this.addresses.length < 2) {
            return 'Invalid packet';
        }

        // Helper function to format a single address with SSID
        const formatAddress = (addr) => {
            if (!addr || !addr.address) return '';
            if (addr.SSID && addr.SSID > 0) {
                return `${addr.address}-${addr.SSID}`;
            }
            return addr.address;
        };

        // Source is addresses[1] (sender)
        const source = formatAddress(this.addresses[1]);
        
        // Destination is addresses[0] 
        const destination = formatAddress(this.addresses[0]);
        
        // Build the path string: source>destination[,repeaters...]
        let pathString = `${source}>${destination}`;
        
        // Add any additional addresses (repeaters/digipeaters) starting from index 2
        if (this.addresses.length > 2) {
            const repeaters = this.addresses.slice(2).map(formatAddress).filter(addr => addr.length > 0);
            if (repeaters.length > 0) {
                pathString += ',' + repeaters.join(',');
            }
        }
        
        // Add the payload (dataStr or data)
        const payload = this.dataStr || (this.data ? this.data.toString() : '');
        
        return `${pathString}:${payload}`;
    }

    /**
     * Check if this packet is a session-related packet (SABM, SABME, I-frame, etc.)
     * @returns {boolean} True if this is a session packet, false otherwise
     */
    isSessionPacket() {
        return (
            this.type === AX25Packet.FrameType.U_FRAME_SABM ||
            this.type === AX25Packet.FrameType.U_FRAME_SABME ||
            this.type === AX25Packet.FrameType.U_FRAME_DISC ||
            this.type === AX25Packet.FrameType.U_FRAME_UA ||
            this.type === AX25Packet.FrameType.U_FRAME_DM ||
            this.type === AX25Packet.FrameType.I_FRAME ||
            this.type === AX25Packet.FrameType.S_FRAME_RR ||
            this.type === AX25Packet.FrameType.S_FRAME_RNR ||
            this.type === AX25Packet.FrameType.S_FRAME_REJ
        );
    }

    toByteArray() {
        if (!this.addresses || this.addresses.length < 1) return null;
        let dataBytes = null;
        let dataBytesLen = 0;
        if (this.data) {
            dataBytes = Buffer.isBuffer(this.data) ? this.data : Buffer.from(this.data);
            dataBytesLen = dataBytes.length;
        } else if (this.dataStr && this.dataStr.length > 0) {
            dataBytes = Buffer.from(this.dataStr, 'utf8');
            dataBytesLen = dataBytes.length;
        }

        // Compute the packet size & control bits
        let modulo128 = !!this.modulo128;
        let type = this.type;
        let pid = this.pid !== undefined ? this.pid : 240;
        let packetSize = (7 * this.addresses.length) + (modulo128 ? 2 : 1) + dataBytesLen;
        if (type === AX25Packet.FrameType.I_FRAME || type === AX25Packet.FrameType.U_FRAME_UI) {
            packetSize++;
        }
        let rdata = Buffer.alloc(packetSize);
        let control = this._getControl();

        // Put the addresses
        let i = 0;
        for (let j = 0; j < this.addresses.length; j++) {
            let a = this.addresses[j];
            if (!a) {
                console.error(`[AX25Packet] Address at index ${j} is null`);
                return null;
            }
            a.CRBit1 = false;
            a.CRBit2 = a.CRBit3 = true;
            if (j === 0) { a.CRBit1 = !!this.command; }
            if (j === 1) { a.CRBit1 = !this.command; a.CRBit2 = modulo128 ? false : true; }
            let ab = a.toByteArray(j === (this.addresses.length - 1));
            if (!ab) {
                console.error(`[AX25Packet] Failed to serialize address at index ${j}: ${a.toString()}`);
                return null;
            }
            // ab is Uint8Array, convert to Buffer for copy
            Buffer.from(ab).copy(rdata, i, 0, 7);
            i += 7;
        }

        // Put the control
        rdata[i++] = control & 0xFF;
        if (modulo128) { rdata[i++] = (control >> 8) & 0xFF; }

        // Put the pid if needed
        if (type === AX25Packet.FrameType.I_FRAME || type === AX25Packet.FrameType.U_FRAME_UI) {
            rdata[i++] = pid;
        }

        // Put the data
        if (dataBytesLen > 0) {
            dataBytes.copy(rdata, i, 0, dataBytesLen);
        }

        return rdata;
    }

    _getControl() {
        let type = this.type;
        let nr = this.nr || 0;
        let ns = this.ns || 0;
        let modulo128 = !!this.modulo128;
        let pollFinal = !!this.pollFinal;
        let control = type;
        if (type === AX25Packet.FrameType.I_FRAME || ((type & AX25Packet.FrameType.U_FRAME) === AX25Packet.FrameType.S_FRAME)) {
            control |= (nr << (modulo128 ? 9 : 5));
        }
        if (type === AX25Packet.FrameType.I_FRAME) {
            control |= (ns << 1);
        }
        if (pollFinal) {
            control |= (1 << (modulo128 ? 8 : 4));
        }
        return control;
    }
}

module.exports = AX25Packet;
