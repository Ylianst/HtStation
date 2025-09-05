/**
 * AprsPacket - Main APRS packet parser
 * Ported from C# aprsparser AprsPacket.cs
 */

const { PacketDataType, getDataType } = require('./PacketDataType');
const Position = require('./Position');
const { CoordinateSet, Coordinate } = require('./CoordinateSet');
const Callsign = require('./Callsign');
const { MessageData, MessageType } = require('./MessageData');
const AprsUtil = require('./AprsUtil');

class AprsPacket {
    constructor() {
        this.rawPacket = '';
        this.destCallsign = null;
        this.dataTypeCh = '\x00';
        this.dataType = PacketDataType.Unknown;
        this.informationField = '';
        this.comment = '';
        this.thirdPartyHeader = '';
        this.symbolTableIdentifier = '\x00';
        this.symbolCode = '\x00';
        this.fromD7 = false;
        this.fromD700 = false;
        this.authCode = '';
        this.position = new Position();
        this.timeStamp = null;
        this.messageData = new MessageData();
        this.parseErrors = [];
    }

    /**
     * Parse APRS packet from AX.25 payload data
     * @param {object} ax25Packet - AX.25 packet object with dataStr and addresses
     * @returns {AprsPacket|null} Parsed APRS packet or null if parsing failed
     */
    static parse(ax25Packet) {
        const packet = new AprsPacket();
        
        try {
            let dataStr = ax25Packet.dataStr;
            
            // Handle third party traffic
            if (dataStr[0] === '}') {
                const i = dataStr.indexOf('*:');
                if (i > 0) {
                    packet.thirdPartyHeader = dataStr.substring(1, i);
                    dataStr = dataStr.substring(i + 2);
                } else {
                    packet.raiseParseError(ax25Packet.dataStr, 'Invalid third party format');
                    return null;
                }
            }

            // Split packet into basic components
            packet.rawPacket = dataStr;
            packet.position.clear();
            
            // Parse destination callsign from first address
            if (ax25Packet.addresses && ax25Packet.addresses.length > 0) {
                packet.destCallsign = Callsign.parseCallsign(ax25Packet.addresses[0].callSignWithId || ax25Packet.addresses[0].toString());
            }

            // Get data type from first character
            packet.dataTypeCh = dataStr[0] || '\x00';
            packet.dataType = getDataType(packet.dataTypeCh);
            
            if (packet.dataType === PacketDataType.Unknown) {
                packet.dataTypeCh = '\x00';
                packet.informationField = dataStr;
            } else {
                packet.informationField = dataStr.substring(1);
            }

            // Parse auth code
            if (packet.informationField.length > 0) {
                const lastBrace = packet.informationField.lastIndexOf('}');
                if (lastBrace >= 0 && lastBrace === packet.informationField.length - 7) {
                    packet.authCode = packet.informationField.substring(lastBrace + 1, lastBrace + 7);
                    packet.informationField = packet.informationField.substring(0, lastBrace);
                } else if (lastBrace >= 0 && lastBrace < packet.informationField.length - 7 && 
                          packet.informationField[lastBrace + 7] === '{') {
                    packet.authCode = packet.informationField.substring(lastBrace + 1, lastBrace + 7);
                    packet.informationField = packet.informationField.substring(0, lastBrace) + 
                                            packet.informationField.substring(lastBrace + 7);
                }
            }

            // Parse information field based on data type
            if (packet.informationField.length > 0) {
                packet.parseInformationField();
            } else {
                packet.dataType = PacketDataType.Beacon;
            }

            // Compute grid square if position is valid
            packet.position.computeGridSquare();

            return packet;
        } catch (error) {
            packet.raiseParseError(ax25Packet.dataStr, error.message);
            return null;
        }
    }

    /**
     * Parse the information field based on data type
     */
    parseInformationField() {
        switch (this.dataType) {
            case PacketDataType.Unknown:
                this.raiseParseError(this.rawPacket, 'Unknown packet type');
                break;
            case PacketDataType.Position:       // '!' Position without timestamp
            case PacketDataType.PositionMsg:    // '=' Position without timestamp (with messaging)
                this.parsePosition();
                break;
            case PacketDataType.PositionTime:   // '/' Position with timestamp
            case PacketDataType.PositionTimeMsg: // '@' Position with timestamp (with messaging)
                this.parsePositionTime();
                break;
            case PacketDataType.Message:        // ':' Message
                this.parseMessage(this.informationField);
                break;
            case PacketDataType.MicECurrent:    // 0x1C Current Mic-E Data
            case PacketDataType.MicEOld:        // 0x1D Old Mic-E Data
            case PacketDataType.TMD700:         // '\'' Old Mic-E Data (TM-D700)
            case PacketDataType.MicE:           // '`' Current Mic-E data
                this.parseMicE();
                break;
            case PacketDataType.Beacon:
            case PacketDataType.Status:
            case PacketDataType.PeetBrosUII1:
            case PacketDataType.PeetBrosUII2:
            case PacketDataType.WeatherReport:
            case PacketDataType.Object:
            case PacketDataType.Item:
            case PacketDataType.StationCapabilities:
            case PacketDataType.Query:
            case PacketDataType.UserDefined:
            case PacketDataType.Telemetry:
            case PacketDataType.InvalidOrTestData:
            case PacketDataType.MaidenheadGridLoc:
            case PacketDataType.RawGPSorU2K:
            case PacketDataType.ThirdParty:
            case PacketDataType.MicroFinder:
            case PacketDataType.MapFeature:
            case PacketDataType.ShelterData:
            case PacketDataType.SpaceWeather:
                // Not implemented - do nothing
                break;
            default:
                this.raiseParseError(this.rawPacket, 'Unexpected packet data type in information field');
                break;
        }
    }

    /**
     * Parse position without timestamp
     */
    parsePosition() {
        this.comment = this.parsePositionAndSymbol(this.informationField);
    }

    /**
     * Parse position with timestamp
     */
    parsePositionTime() {
        if (this.informationField.length < 7) {
            this.raiseParseError(this.rawPacket, 'Position with timestamp too short');
            return;
        }
        
        this.parseDateTime(this.informationField.substring(0, 7));
        const psr = this.informationField.substring(7);
        this.comment = this.parsePositionAndSymbol(psr);
    }

    /**
     * Parse position and symbol data from position string
     * @param {string} ps - Position string
     * @returns {string} Remaining comment text
     */
    parsePositionAndSymbol(ps) {
        try {
            if (!ps || ps.length === 0) {
                this.position.clear();
                return '';
            }

            // Compressed format if first character is not a digit
            if (!this.isDigit(ps[0])) {
                return this.parseCompressedPosition(ps);
            } else {
                return this.parseUncompressedPosition(ps);
            }
        } catch (error) {
            this.raiseParseError(this.rawPacket, `Position parsing error: ${error.message}`);
            return this.informationField;
        }
    }

    /**
     * Parse compressed position format
     * @param {string} ps - Position string
     * @returns {string} Remaining comment text
     */
    parseCompressedPosition(ps) {
        if (ps.length < 13) {
            this.position.clear();
            return '';
        }

        const pd = ps.substring(0, 13);
        
        this.symbolTableIdentifier = pd[0];
        // Convert letter overlays (a..j) to digits (0..9)
        if ('abcdefghij'.includes(this.symbolTableIdentifier)) {
            this.symbolTableIdentifier = String.fromCharCode(
                this.symbolTableIdentifier.charCodeAt(0) - 'a'.charCodeAt(0) + '0'.charCodeAt(0)
            );
        }
        this.symbolCode = pd[9];

        const sqr91 = 91 * 91;
        const cube91 = 91 * 91 * 91;

        // Parse latitude
        const sLat = pd.substring(1, 5);
        const dLat = 90 - (
            (sLat.charCodeAt(0) - 33) * cube91 +
            (sLat.charCodeAt(1) - 33) * sqr91 +
            (sLat.charCodeAt(2) - 33) * 91 +
            (sLat.charCodeAt(3) - 33)
        ) / 380926.0;
        this.position.coordinateSet.latitude = new Coordinate(dLat, true);

        // Parse longitude
        const sLon = pd.substring(5, 9);
        const dLon = -180 + (
            (sLon.charCodeAt(0) - 33) * cube91 +
            (sLon.charCodeAt(1) - 33) * sqr91 +
            (sLon.charCodeAt(2) - 33) * 91 +
            (sLon.charCodeAt(3) - 33)
        ) / 190463.0;
        this.position.coordinateSet.longitude = new Coordinate(dLon, false);

        // Parse course/speed or altitude from compressed data
        const csBytes = pd.substring(10, 13);
        // Additional compressed data parsing would go here
        // For now, just strip off the position data and return the rest
        
        return ps.substring(13);
    }

    /**
     * Parse uncompressed position format
     * @param {string} ps - Position string
     * @returns {string} Remaining comment text
     */
    parseUncompressedPosition(ps) {
        if (ps.length < 19) {
            this.position.clear();
            return '';
        }

        const pd = ps.substring(0, 19); // position data
        const sLat = pd.substring(0, 8); // latitude
        this.symbolTableIdentifier = pd[8];
        const sLon = pd.substring(9, 18); // longitude
        this.symbolCode = pd[18];

        this.position.coordinateSet.latitude = new Coordinate(0, true, sLat);
        this.position.coordinateSet.longitude = new Coordinate(0, false, sLon);

        // Validate lat/lon values
        if (this.position.coordinateSet.latitude.value < -90 || 
            this.position.coordinateSet.latitude.value > 90 ||
            this.position.coordinateSet.longitude.value < -180 || 
            this.position.coordinateSet.longitude.value > 180) {
            this.position.clear();
        }

        // Strip off position report
        let remaining = ps.substring(19);

        // Look for course and speed (format: 000/000)
        if (remaining.length >= 7 && remaining[3] === '/' &&
            this.isDigit(remaining[0]) && this.isDigit(remaining[1]) && this.isDigit(remaining[2]) &&
            this.isDigit(remaining[4]) && this.isDigit(remaining[5]) && this.isDigit(remaining[6])) {
            this.position.course = parseInt(remaining.substring(0, 3), 10);
            this.position.speed = parseInt(remaining.substring(4, 7), 10);
            remaining = remaining.substring(7);
        }

        // Look for altitude (format: /A=123456)
        if (remaining.length >= 9 && remaining.substring(0, 3) === '/A=' &&
            this.isDigit(remaining[3]) && this.isDigit(remaining[4]) && this.isDigit(remaining[5]) &&
            this.isDigit(remaining[6]) && this.isDigit(remaining[7]) && this.isDigit(remaining[8])) {
            this.position.altitude = parseInt(remaining.substring(3, 9), 10);
            remaining = remaining.substring(9);
        }

        return remaining;
    }

    /**
     * Parse APRS message
     * @param {string} infoField - Information field
     */
    parseMessage(infoField) {
        const s = infoField;

        // Addressee field must be 9 characters long
        if (s.length < 9) {
            this.dataType = PacketDataType.InvalidOrTestData;
            return;
        }

        // Get addressee
        this.messageData.addressee = s.substring(0, 9).toUpperCase().trim();

        if (s.length < 10) return; // no message

        let msgContent = s.substring(10);

        // Look for ack and reject messages
        if (msgContent.length > 3) {
            if (msgContent.toUpperCase().startsWith('ACK')) {
                const lastBrace = msgContent.lastIndexOf('}');
                if (lastBrace >= 0) {
                    this.authCode = msgContent.substring(lastBrace + 1);
                    msgContent = msgContent.substring(0, lastBrace - 1);
                }
                this.messageData.msgType = MessageType.Ack;
                this.messageData.seqId = msgContent.substring(3).trim();
                this.messageData.msgText = '';
                return;
            }
            if (msgContent.toUpperCase().startsWith('REJ')) {
                const lastBrace = msgContent.lastIndexOf('}');
                if (lastBrace >= 0) {
                    this.authCode = msgContent.substring(lastBrace + 1);
                    msgContent = msgContent.substring(0, lastBrace - 1);
                }
                this.messageData.msgType = MessageType.Reject;
                this.messageData.seqId = msgContent.substring(3).trim();
                this.messageData.msgText = '';
                return;
            }
        }

        // Regular message - look for sequence ID
        const lastBrace = msgContent.lastIndexOf('{');
        if (lastBrace >= 0) {
            this.messageData.seqId = msgContent.substring(lastBrace + 1);
            this.messageData.msgText = msgContent.substring(0, lastBrace);
        } else {
            this.messageData.msgText = msgContent;
        }
        this.messageData.msgType = MessageType.Message;
    }

    /**
     * Parse Mic-E format (placeholder - not fully implemented)
     */
    parseMicE() {
        // Mic-E parsing is complex and not implemented in this basic port
        this.raiseParseError(this.rawPacket, 'Mic-E parsing not implemented');
    }

    /**
     * Parse date/time string
     * @param {string} str - Date/time string
     */
    parseDateTime(str) {
        try {
            if (!str || str.length === 0) return;

            // Assume current date/time
            this.timeStamp = new Date();

            const l = str.length;
            if (str[l - 1] === 'z') {
                // DDHHMM format (UTC)
                try {
                    const day = parseInt(str.substring(0, 2), 10);
                    const hour = parseInt(str.substring(2, 4), 10);
                    const minute = parseInt(str.substring(4, 6), 10);
                    this.timeStamp = new Date(
                        this.timeStamp.getFullYear(),
                        this.timeStamp.getMonth(),
                        day, hour, minute, 0
                    );
                } catch (error) {
                    this.timeStamp = new Date();
                }
            }
            // Additional date/time formats could be implemented here
        } catch (error) {
            this.raiseParseError(this.rawPacket, `Date/time parsing error: ${error.message}`);
        }
    }

    /**
     * Check if character is a digit
     * @param {string} ch - Character to check
     * @returns {boolean} True if digit
     */
    isDigit(ch) {
        return ch >= '0' && ch <= '9';
    }

    /**
     * Add parse error to error list
     * @param {string} packet - Raw packet data
     * @param {string} error - Error message
     */
    raiseParseError(packet, error) {
        this.parseErrors.push({ packet, error, timestamp: new Date() });
    }

    /**
     * Get string representation of the packet
     * @returns {string} String representation
     */
    toString() {
        const lines = [];
        lines.push(`DataTypeCh           : ${this.dataTypeCh}`);
        lines.push(`DataType             : ${this.dataType}`);
        lines.push(`InformationField     : ${this.informationField}`);
        
        if (this.comment && this.comment.length > 0) {
            lines.push(`Comment              : ${this.comment}`);
        }
        if (this.symbolTableIdentifier !== '\x00') {
            lines.push(`SymbolTableIdentifier: ${this.symbolTableIdentifier}`);
        }
        if (this.symbolCode !== '\x00') {
            lines.push(`SymbolCode           : ${this.symbolCode}`);
        }
        if (this.fromD7) {
            lines.push(`FromD7               : ${this.fromD7}`);
        }
        if (this.fromD700) {
            lines.push(`FromD700             : ${this.fromD700}`);
        }
        if (this.position && this.position.isValid()) {
            lines.push('Position:');
            lines.push(`  Latitude           : ${this.position.coordinateSet.latitude.value.toFixed(6)}`);
            lines.push(`  Longitude          : ${this.position.coordinateSet.longitude.value.toFixed(6)}`);
            if (this.position.course > 0) {
                lines.push(`  Course             : ${this.position.course}`);
            }
            if (this.position.speed > 0) {
                lines.push(`  Speed              : ${this.position.speed}`);
            }
            if (this.position.altitude > 0) {
                lines.push(`  Altitude           : ${this.position.altitude}`);
            }
            if (this.position.gridsquare) {
                lines.push(`  Grid Square        : ${this.position.gridsquare}`);
            }
        }
        if (this.messageData && this.messageData.msgType !== MessageType.Unknown) {
            lines.push('Message:');
            lines.push(`  Type               : ${this.messageData.msgType}`);
            lines.push(`  Addressee          : ${this.messageData.addressee}`);
            if (this.messageData.msgText) {
                lines.push(`  Text               : ${this.messageData.msgText}`);
            }
            if (this.messageData.seqId) {
                lines.push(`  Sequence ID        : ${this.messageData.seqId}`);
            }
        }
        
        return lines.join('\n');
    }
}

module.exports = AprsPacket;
