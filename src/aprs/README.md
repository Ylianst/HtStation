# APRS Decoder for NodeJS

A NodeJS module for decoding APRS (Automatic Packet Reporting System) packets from AX.25 payloads. This module handles the APRS information field decoding and does not process AX.25 frame headers.

## Features

- Decodes APRS position reports (compressed and uncompressed)
- Handles position reports with and without timestamps
- Parses APRS messages, acknowledgments, and rejections
- Supports status reports and various APRS packet types
- Includes utility functions for coordinate conversion and grid square calculation
- Ported from a proven C# APRS parser library

## Installation

The `aprs` module is included in the `src/aprs/` folder. Require it from your code:

```javascript
const { AprsPacket } = require('./aprs/index.js');
```

## Usage

### Basic Packet Decoding

```javascript
const { AprsPacket } = require('./aprs/index.js');

// Example AX.25 packet object (you provide this from your AX.25 decoder)
const ax25Packet = {
    dataStr: '!4903.50N/07201.75W-Test comment',
    addresses: [{ callSignWithId: 'APRS' }]
};

const aprsPacket = AprsPacket.parse(ax25Packet);

if (aprsPacket) {
    console.log('Packet Type:', aprsPacket.dataType);
    console.log('Information:', aprsPacket.informationField);
    
    if (aprsPacket.position.isValid()) {
        console.log('Latitude:', aprsPacket.position.coordinateSet.latitude.value);
        console.log('Longitude:', aprsPacket.position.coordinateSet.longitude.value);
        console.log('Grid Square:', aprsPacket.position.gridsquare);
    }
    
    if (aprsPacket.comment) {
        console.log('Comment:', aprsPacket.comment);
    }
}
```

### Position Reports

```javascript
// Position without timestamp
const positionPacket = {
    dataStr: '!4903.50N/07201.75W-Mobile station',
    addresses: [{ callSignWithId: 'APRS' }]
};

// Position with timestamp and altitude
const timedPositionPacket = {
    dataStr: '@092345z4903.50N/07201.75W>088/036/A=001234Comment',
    addresses: [{ callSignWithId: 'APRS' }]
};
```

### Messages

```javascript
// APRS message
const messagePacket = {
    dataStr: ':N0CALL   :Hello World{123',
    addresses: [{ callSignWithId: 'SENDER' }]
};

const parsed = AprsPacket.parse(messagePacket);
if (parsed && parsed.messageData) {
    console.log('To:', parsed.messageData.addressee);
    console.log('Message:', parsed.messageData.msgText);
    console.log('Sequence:', parsed.messageData.seqId);
}
```

### Utility Functions

```javascript
const { AprsUtil } = require('./aprs/index.js');

// Convert coordinates to grid square
const gridSquare = AprsUtil.latLonToGridSquare(42.3601, -71.0589);
console.log('Grid Square:', gridSquare); // FN42ij

// Generate APRS validation code for server login
const validationCode = AprsUtil.aprsValidationCode('N0CALL');
console.log('Validation Code:', validationCode);

// Convert NMEA to decimal degrees
const latitude = AprsUtil.convertNmeaToFloat('4903.50N');
const longitude = AprsUtil.convertNmeaToFloat('07201.75W');
console.log('Coordinates:', latitude, longitude);
```

## Supported Packet Types

- **Position Reports**: `!` (no timestamp), `/` (with timestamp)
- **Position with Messaging**: `=` (no timestamp), `@` (with timestamp)
- **Messages**: `:` (including ACK/REJ)
- **Status Reports**: `>`
- **Objects**: `;`
- **Items**: `)`
- **Telemetry**: `T`
- **Weather Reports**: `_`
- **Mic-E**: `` ` `` (basic support)
- **Third Party**: `}`

## API Reference

### AprsPacket Class

#### Static Methods

- `AprsPacket.parse(ax25Packet)` - Parse an AX.25 packet object

#### Properties

- `dataType` - Packet type (from PacketDataType enum)
- `informationField` - APRS information field
- `position` - Position object with coordinates, course, speed, altitude
- `messageData` - Message data for message packets
- `comment` - Comment field
- `symbolTableIdentifier` - APRS symbol table
- `symbolCode` - APRS symbol code
- `timeStamp` - Timestamp for timed packets

### Position Class

- `coordinateSet` - Latitude/longitude coordinates
- `course` - Course in degrees
- `speed` - Speed in knots
- `altitude` - Altitude in feet
- `gridsquare` - Maidenhead grid square

### AprsUtil Functions

- `latLonToGridSquare(lat, lon)` - Convert coordinates to grid square
- `gridSquareToLatLon(locator)` - Convert grid square to coordinates
- `aprsValidationCode(callsign)` - Generate APRS server validation code
- `convertNmeaToFloat(nmea)` - Convert NMEA coordinate to decimal
- `convertLatToNmea(lat)` - Convert latitude to NMEA format
- `convertLonToNmea(lon)` - Convert longitude to NMEA format

## Testing

Run the included test file:

```bash
cd aprs
node test.js
```

## Limitations

- Mic-E decoding is not fully implemented
- Some advanced APRS features are not supported
- Weather data parsing is minimal
- Object and item parsing is basic
