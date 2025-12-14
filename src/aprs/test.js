/**
 * Test/Example file for the APRS decoder
 */

const { AprsPacket } = require('./index');

// Example AX.25 packet data (just the payload/information field)
const testPackets = [
    {
        name: 'Position without timestamp',
        dataStr: '!4903.50N/07201.75W-Test comment',
        addresses: [{ callSignWithId: 'APRS' }]
    },
    {
        name: 'Position with timestamp', 
        dataStr: '@092345z4903.50N/07201.75W>Test /A=001234',
        addresses: [{ callSignWithId: 'APRS' }]
    },
    {
        name: 'Message',
        dataStr: ':N0CALL   :Hello World{123',
        addresses: [{ callSignWithId: 'APRS' }]
    },
    {
        name: 'Status',
        dataStr: '>Status: Testing APRS decoder',
        addresses: [{ callSignWithId: 'APRS' }]
    },
    {
        name: 'Compressed position',
        dataStr: '!/5L!!<*e7>7P[',
        addresses: [{ callSignWithId: 'APRS' }]
    }
];

console.log('APRS Packet Decoder Test\n');
console.log('='.repeat(50));

testPackets.forEach((test, index) => {
    console.log(`\nTest ${index + 1}: ${test.name}`);
    console.log('-'.repeat(30));
    console.log(`Raw data: ${test.dataStr}`);
    
    const packet = AprsPacket.parse(test);
    
    if (packet) {
        console.log('Parsed successfully:');
        console.log(packet.toString());
        
        if (packet.parseErrors.length > 0) {
            console.log('\nParse errors:');
            packet.parseErrors.forEach(err => {
                console.log(`  ${err.error}`);
            });
        }
    } else {
        console.log('Failed to parse packet');
    }
    
    console.log('\n' + '='.repeat(50));
});

// Test utility functions
console.log('\nUtility Functions Test:');
console.log('-'.repeat(30));

const { AprsUtil } = require('./index');

// Test grid square conversion
const lat = 42.3601;
const lon = -71.0589;
const grid = AprsUtil.latLonToGridSquare(lat, lon);
console.log(`Lat/Lon: ${lat}, ${lon} -> Grid: ${grid}`);

// Test APRS validation code
const callsign = 'N0CALL';
const validationCode = AprsUtil.aprsValidationCode(callsign);
console.log(`Callsign: ${callsign} -> Validation Code: ${validationCode}`);

// Test coordinate conversion
const nmeaLat = '4903.50N';
const nmeaLon = '07201.75W';
const decLat = AprsUtil.convertNmeaToFloat(nmeaLat);
const decLon = AprsUtil.convertNmeaToFloat(nmeaLon);
console.log(`NMEA: ${nmeaLat}, ${nmeaLon} -> Decimal: ${decLat.toFixed(6)}, ${decLon.toFixed(6)}`);

module.exports = { testPackets };
