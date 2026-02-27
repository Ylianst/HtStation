// BSSPacket.js - NodeJS port of BSSPacket from C#
// Copyright 2026 Ylian Saint-Hilaire
// Licensed under the Apache License, Version 2.0

/**
 * Represents a BSS (Binary Short Serialization) packet used for compact data encoding.
 * The packet format is: 0x01 [length][type][value...] [length][type][value...] ...
 * Where length includes the type byte (length = 1 + value.Length).
 */
class BSSPacket {
    /**
     * BSS packet type identifiers.
     */
    static get FieldType() {
        return {
            Callsign: 0x20,
            Destination: 0x21,
            Message: 0x24,
            Location: 0x25,
            LocationRequest: 0x27, // Contains a string like "N0CALL" or "NOCALL-0"
            CallRequest: 0x28      // Contains a string like "N0CALL" or "NOCALL-0"
        };
    }

    /**
     * Creates an empty BSS packet.
     */
    constructor(callsign = null, destination = null, message = null) {
        this.callsign = callsign;
        this.destination = destination;
        this.message = message;
        this.location = null;
        this.locationRequest = null;
        this.callRequest = null;
        this.messageID = 0;
        this.rawFields = new Map();
    }

    /**
     * Decodes a BSS packet from raw byte data.
     * @param {Buffer|Uint8Array} data - The raw byte data starting with 0x01.
     * @returns {BSSPacket|null} A BSSPacket instance, or null if the data is invalid.
     */
    static decode(data) {
        if (!data || data.length < 2) return null;

        // BSS packets must start with 0x01
        if (data[0] !== 0x01) return null;

        const packet = new BSSPacket();
        let index = 1; // Skip the leading 0x01

        while (index < data.length) {
            // Need at least length + type bytes
            if (index + 1 >= data.length) break;

            const length = data[index];

            // Special case: 0x85 indicates MessageID (next 2 bytes, MSB first)
            if (length === 0x85) {
                if (index + 3 > data.length) break;
                packet.messageID = (data[index + 1] << 8) | data[index + 2];
                index += 3;
                continue;
            }

            const fieldType = data[index + 1];

            // Length must allow type (1) + value (0+)
            if (length < 1) break;

            const valueLen = length - 1;

            // Check if we have enough bytes for the value
            if (index + 2 + valueLen > data.length) break;

            const value = Buffer.alloc(valueLen);
            if (valueLen > 0) {
                if (Buffer.isBuffer(data)) {
                    data.copy(value, 0, index + 2, index + 2 + valueLen);
                } else {
                    for (let i = 0; i < valueLen; i++) {
                        value[i] = data[index + 2 + i];
                    }
                }
            }

            // Store the raw field
            packet.rawFields.set(fieldType, value);

            // Parse known field types
            const FieldType = BSSPacket.FieldType;
            switch (fieldType) {
                case FieldType.Callsign:
                    packet.callsign = value.toString('utf8');
                    break;
                case FieldType.Destination:
                    packet.destination = value.toString('utf8');
                    break;
                case FieldType.Message:
                    packet.message = value.toString('utf8');
                    break;
                case FieldType.Location:
                    packet.location = BSSPacket.decodeGpsBytes(value);
                    break;
                case FieldType.LocationRequest:
                    packet.locationRequest = value.toString('utf8');
                    break;
                case FieldType.CallRequest:
                    packet.callRequest = value.toString('utf8');
                    break;
            }

            // Move to the next field
            index += 2 + valueLen;
        }

        return packet;
    }

    /**
     * Encodes this BSS packet to a byte array.
     * @returns {Buffer} The encoded byte array starting with 0x01.
     */
    encode() {
        const result = [0x01]; // BSS packet identifier
        const FieldType = BSSPacket.FieldType;

        // Encode callsign if present
        if (this.callsign) {
            const callsignBytes = Buffer.from(this.callsign, 'utf8');
            result.push(callsignBytes.length + 1); // length = value length + 1 for type
            result.push(FieldType.Callsign);
            for (const byte of callsignBytes) result.push(byte);
        }

        // Encode MessageID if non-zero (after callsign)
        if (this.messageID !== 0) {
            result.push(0x85);
            result.push((this.messageID >> 8) & 0xFF);   // MSB first
            result.push(this.messageID & 0xFF);          // LSB
        }

        // Encode destination if present
        if (this.destination) {
            const destinationBytes = Buffer.from(this.destination, 'utf8');
            result.push(destinationBytes.length + 1); // length = value length + 1 for type
            result.push(FieldType.Destination);
            for (const byte of destinationBytes) result.push(byte);
        }

        // Encode message if present
        if (this.message) {
            const messageBytes = Buffer.from(this.message, 'utf8');
            result.push(messageBytes.length + 1); // length = value length + 1 for type
            result.push(FieldType.Message);
            for (const byte of messageBytes) result.push(byte);
        }

        // Encode location if present
        if (this.location) {
            const locationBytes = BSSPacket.encodeGpsBytes(this.location);
            result.push(locationBytes.length + 1); // length = value length + 1 for type
            result.push(FieldType.Location);
            for (const byte of locationBytes) result.push(byte);
        }

        // Encode location request if present
        if (this.locationRequest) {
            const locationRequestBytes = Buffer.from(this.locationRequest, 'utf8');
            result.push(locationRequestBytes.length + 1); // length = value length + 1 for type
            result.push(FieldType.LocationRequest);
            for (const byte of locationRequestBytes) result.push(byte);
        }

        // Encode call request if present
        if (this.callRequest) {
            const callRequestBytes = Buffer.from(this.callRequest, 'utf8');
            result.push(callRequestBytes.length + 1); // length = value length + 1 for type
            result.push(FieldType.CallRequest);
            for (const byte of callRequestBytes) result.push(byte);
        }

        // Encode any additional raw fields that weren't already encoded
        for (const [fieldKey, fieldValue] of this.rawFields) {
            // Skip fields we've already encoded
            if (fieldKey === FieldType.Callsign && this.callsign) continue;
            if (fieldKey === FieldType.Destination && this.destination) continue;
            if (fieldKey === FieldType.Message && this.message) continue;
            if (fieldKey === FieldType.Location && this.location) continue;
            if (fieldKey === FieldType.LocationRequest && this.locationRequest) continue;
            if (fieldKey === FieldType.CallRequest && this.callRequest) continue;

            result.push(fieldValue.length + 1); // length = value length + 1 for type
            result.push(fieldKey);
            for (const byte of fieldValue) result.push(byte);
        }

        return Buffer.from(result);
    }

    /**
     * Checks if the given data appears to be a BSS packet.
     * @param {Buffer|Uint8Array} data - The data to check.
     * @returns {boolean} True if the data starts with 0x01 and has enough length to be a valid BSS packet.
     */
    static isBSSPacket(data) {
        return data != null && data.length >= 2 && data[0] === 0x01;
    }

    /**
     * Gets a raw field value by type.
     * @param {number} fieldType - The field type byte.
     * @returns {Buffer|null} The raw byte array value, or null if not present.
     */
    getRawField(fieldType) {
        return this.rawFields.get(fieldType) || null;
    }

    /**
     * Sets a raw field value by type.
     * @param {number} fieldType - The field type byte.
     * @param {Buffer} value - The raw byte array value.
     */
    setRawField(fieldType, value) {
        this.rawFields.set(fieldType, value || Buffer.alloc(0));
    }

    /**
     * Decodes GPS bytes to a location object.
     * @param {Buffer} bytes - The GPS bytes to decode.
     * @returns {Object|null} A location object with latitude, longitude, and optionally altitude.
     */
    static decodeGpsBytes(bytes) {
        if (!bytes || bytes.length < 8) return null;

        // Read latitude (4 bytes, signed 32-bit integer, little-endian)
        // Latitude is stored as microdegrees (degrees * 1,000,000)
        const latMicro = bytes.readInt32LE(0);
        const latitude = latMicro / 1000000.0;

        // Read longitude (4 bytes, signed 32-bit integer, little-endian)
        // Longitude is stored as microdegrees (degrees * 1,000,000)
        const lonMicro = bytes.readInt32LE(4);
        const longitude = lonMicro / 1000000.0;

        const location = { latitude, longitude };

        // Optional altitude (2 bytes, signed 16-bit integer, little-endian)
        if (bytes.length >= 10) {
            location.altitude = bytes.readInt16LE(8);
        }

        return location;
    }

    /**
     * Encodes a location object to GPS bytes.
     * @param {Object} location - The location object with latitude, longitude, and optionally altitude.
     * @returns {Buffer} The encoded GPS bytes.
     */
    static encodeGpsBytes(location) {
        if (!location) return Buffer.alloc(0);

        const hasAltitude = location.altitude !== undefined && location.altitude !== null;
        const buffer = Buffer.alloc(hasAltitude ? 10 : 8);

        // Write latitude as microdegrees
        buffer.writeInt32LE(Math.round(location.latitude * 1000000), 0);

        // Write longitude as microdegrees
        buffer.writeInt32LE(Math.round(location.longitude * 1000000), 4);

        // Write altitude if present
        if (hasAltitude) {
            buffer.writeInt16LE(Math.round(location.altitude), 8);
        }

        return buffer;
    }

    /**
     * Converts bytes to a hex string.
     * @param {Buffer} bytes - The bytes to convert.
     * @returns {string} The hex string representation.
     */
    static bytesToHex(bytes) {
        if (!bytes) return '';
        return Buffer.from(bytes).toString('hex').toUpperCase();
    }

    /**
     * Returns a string representation of the BSS packet.
     * @returns {string} A human-readable string describing the packet contents.
     */
    toString() {
        const parts = [];
        const FieldType = BSSPacket.FieldType;

        if (this.callsign) {
            parts.push('Callsign: ' + this.callsign);
        }

        if (this.destination) {
            parts.push('Dest: ' + this.destination);
        }

        if (this.message) {
            parts.push('Msg: ' + this.message);
        }

        if (this.location) {
            const locStr = `${this.location.latitude.toFixed(6)}, ${this.location.longitude.toFixed(6)}` +
                (this.location.altitude !== undefined ? `, ${this.location.altitude}m` : '');
            parts.push('Loc: ' + locStr);
        }

        if (this.locationRequest) {
            parts.push('LocReq: ' + this.locationRequest);
        }

        if (this.callRequest) {
            parts.push('CallReq: ' + this.callRequest);
        }

        if (this.messageID !== 0) {
            parts.push('MsgID: ' + this.messageID);
        }

        // Include any unknown raw fields
        for (const [fieldKey, fieldValue] of this.rawFields) {
            if (fieldKey === FieldType.Callsign || 
                fieldKey === FieldType.Destination || 
                fieldKey === FieldType.Message || 
                fieldKey === FieldType.Location ||
                fieldKey === FieldType.LocationRequest ||
                fieldKey === FieldType.CallRequest) {
                continue;
            }
            parts.push(`0x${fieldKey.toString(16).toUpperCase()}: ${BSSPacket.bytesToHex(fieldValue)}`);
        }

        return parts.join(', ');
    }
}

module.exports = BSSPacket;
