/**
 * APRS Packet Decoder for NodeJS
 * 
 * This module decodes APRS packets from AX.25 payloads.
 * It does not handle AX.25 frame decoding - only the APRS information field.
 * 
 * Usage:
 *   const { AprsPacket } = require('./aprs');
 *   const packet = AprsPacket.parse(ax25PayloadString);
 */

const AprsPacket = require('./AprsPacket');
const PacketDataType = require('./PacketDataType');
const Position = require('./Position');
const CoordinateSet = require('./CoordinateSet');
const Callsign = require('./Callsign');
const MessageData = require('./MessageData');
const AprsUtil = require('./AprsUtil');

module.exports = {
    AprsPacket,
    PacketDataType,
    Position,
    CoordinateSet,
    Callsign,
    MessageData,
    AprsUtil
};
