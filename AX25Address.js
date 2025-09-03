// AX25Address.js - NodeJS port of AX25Address from C#
// Copyright 2025 Ylian Saint-Hilaire
// Licensed under the Apache License, Version 2.0

class AX25Address {
    constructor(address, SSID) {
        if (!address || address.length > 6) throw new Error('Invalid address');
        if (SSID > 15 || SSID < 0) throw new Error('Invalid SSID');
        this.address = address;
        this.SSID = SSID;
        this.CRBit1 = false;
        this.CRBit2 = false;
        this.CRBit3 = true;
    }

    get callSignWithId() {
        return `${this.address}-${this.SSID}`;
    }

    isSame(a) {
        return this.address === a.address && this.SSID === a.SSID;
    }

    static getAddress(address, SSID = 0) {
        if (!address || address.length > 6) return null;
        if (SSID > 15 || SSID < 0) return null;
        return new AX25Address(address, SSID);
    }

    static getAddressFromString(address) {
        if (!address || address.length > 9) return null;
        const s = address.indexOf('-');
        let ssid = 0;
        if (s === -1) {
            if (!address || address.length > 6) return null;
        } else {
            if (s < 1) return null;
            const ssidstr = address.substring(s + 1);
            ssid = parseInt(ssidstr, 10);
            if (isNaN(ssid) || ssid > 15 || ssid < 0) return null;
            address = address.substring(0, s);
        }
        if (address.length === 0) return null;
        return AX25Address.getAddress(address, ssid);
    }

    static decodeAX25Address(data, index) {
        if (index + 7 > data.length) return null;
        let address = '';
        for (let i = 0; i < 6; i++) {
            const c = String.fromCharCode(data[index + i] >> 1);
            if (c < ' ' || (data[index + i] & 0x01) !== 0) return null;
            if (c !== ' ') address += c;
        }
        const SSID = (data[index + 6] >> 1) & 0x0F;
        const last = (data[index + 6] & 0x01) !== 0;
        const addr = AX25Address.getAddress(address, SSID);
        addr.CRBit1 = (data[index + 6] & 0x80) !== 0;
        addr.CRBit2 = (data[index + 6] & 0x40) !== 0;
        addr.CRBit3 = (data[index + 6] & 0x20) !== 0;
        return { addr, last };
    }

    toByteArray(last) {
        if (!this.address || this.address.length > 6) return null;
        if (this.SSID > 15 || this.SSID < 0) return null;
        const rdata = new Uint8Array(7);
        let addressPadded = this.address;
        while (addressPadded.length < 6) addressPadded += String.fromCharCode(0x20);
        for (let i = 0; i < 6; i++) rdata[i] = addressPadded.charCodeAt(i) << 1;
        rdata[6] = this.SSID << 1;
        if (this.CRBit1) rdata[6] |= 0x80;
        if (this.CRBit2) rdata[6] |= 0x40;
        if (this.CRBit3) rdata[6] |= 0x20;
        if (last) rdata[6] |= 0x01;
        return rdata;
    }

    toString() {
        return this.SSID === 0 ? this.address : `${this.address}-${this.SSID}`;
    }
}

module.exports = AX25Address;
