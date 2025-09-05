/**
 * Callsign class - represents and parses APRS callsigns
 * Ported from C# aprsparser Callsign.cs
 */

class Callsign {
    constructor() {
        this.baseCallsign = '';
        this.ssid = 0;
        this.fullCallsign = '';
    }

    /**
     * Parse a callsign string into its components
     * @param {string} callsignStr - Callsign string (e.g., "N0CALL-5")
     * @returns {Callsign} Parsed callsign object
     */
    static parseCallsign(callsignStr) {
        const callsign = new Callsign();
        
        if (!callsignStr || typeof callsignStr !== 'string') {
            return callsign;
        }

        callsign.fullCallsign = callsignStr.trim().toUpperCase();
        
        const parts = callsign.fullCallsign.split('-');
        callsign.baseCallsign = parts[0];
        
        if (parts.length > 1) {
            const ssidStr = parts[1];
            const ssidNum = parseInt(ssidStr, 10);
            if (!isNaN(ssidNum) && ssidNum >= 0 && ssidNum <= 15) {
                callsign.ssid = ssidNum;
            }
        }

        return callsign;
    }

    /**
     * Get the callsign with SSID if present
     * @returns {string} Full callsign string
     */
    toString() {
        if (this.ssid > 0) {
            return `${this.baseCallsign}-${this.ssid}`;
        }
        return this.baseCallsign;
    }
}

module.exports = Callsign;
