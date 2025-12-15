#!/usr/bin/env node
/**
 * Test APRS position parsing
 * This script tests the parsing of APRS position messages
 */

const { AprsPacket } = require('./src/aprs/index.js');

// Test data - simulate the message you received
const testMessage = '=4523.42NY12245.66Wz354/000/A=000068Test';

// Create a mock AX.25 packet structure
const mockPacket = {
    dataStr: testMessage,
    addresses: [
        { address: 'APRS', SSID: 0, callSignWithId: 'APRS', toString: () => 'APRS' },
        { address: 'KK7VZT', SSID: 6, callSignWithId: 'KK7VZT-6', toString: () => 'KK7VZT-6' }
    ]
};

console.log('='.repeat(70));
console.log('APRS Position Parsing Test');
console.log('='.repeat(70));
console.log('\nTest Message:', testMessage);
console.log('Expected: Position message with coordinates');
console.log('  Latitude: 4523.42N should parse to ~45.390333°N');
console.log('  Longitude: 12245.66W should parse to ~-122.761°W');
console.log('\n' + '-'.repeat(70));

try {
    // Parse the APRS packet
    const aprsPacket = AprsPacket.parse(mockPacket);
    
    if (!aprsPacket) {
        console.error('ERROR: AprsPacket.parse() returned null');
        process.exit(1);
    }
    
    console.log('\n✓ Packet parsed successfully\n');
    
    // Display basic packet info
    console.log('Data Type:', aprsPacket.dataType);
    console.log('Data Type Character:', aprsPacket.dataTypeCh);
    console.log('Information Field:', aprsPacket.informationField);
    console.log('Comment:', aprsPacket.comment || '(none)');
    
    // Check position data
    console.log('\n' + '-'.repeat(70));
    console.log('POSITION DATA:');
    console.log('-'.repeat(70));
    
    if (aprsPacket.position) {
        console.log('Position object exists:', true);
        console.log('Position.isValid():', aprsPacket.position.isValid());
        
        if (aprsPacket.position.coordinateSet) {
            console.log('\nCoordinate Set:');
            console.log('  Latitude object:', aprsPacket.position.coordinateSet.latitude);
            console.log('  Latitude value:', aprsPacket.position.coordinateSet.latitude.value);
            console.log('  Latitude NMEA:', aprsPacket.position.coordinateSet.latitude.nmea);
            console.log('  Longitude object:', aprsPacket.position.coordinateSet.longitude);
            console.log('  Longitude value:', aprsPacket.position.coordinateSet.longitude.value);
            console.log('  Longitude NMEA:', aprsPacket.position.coordinateSet.longitude.nmea);
        } else {
            console.log('  ERROR: coordinateSet is missing!');
        }
        
        console.log('\nOther Position Data:');
        console.log('  Course:', aprsPacket.position.course);
        console.log('  Speed:', aprsPacket.position.speed);
        console.log('  Altitude:', aprsPacket.position.altitude);
        console.log('  Grid Square:', aprsPacket.position.gridsquare || '(not computed)');
    } else {
        console.log('ERROR: position object is null or undefined!');
    }
    
    // Check symbol data
    console.log('\n' + '-'.repeat(70));
    console.log('SYMBOL DATA:');
    console.log('-'.repeat(70));
    console.log('Symbol Table:', aprsPacket.symbolTableIdentifier || '(none)');
    console.log('Symbol Code:', aprsPacket.symbolCode || '(none)');
    
    // Display any parse errors
    if (aprsPacket.parseErrors && aprsPacket.parseErrors.length > 0) {
        console.log('\n' + '-'.repeat(70));
        console.log('PARSE ERRORS:');
        console.log('-'.repeat(70));
        aprsPacket.parseErrors.forEach((err, i) => {
            console.log(`${i + 1}. ${err.error}`);
        });
    }
    
    // Summary
    console.log('\n' + '='.repeat(70));
    console.log('TEST SUMMARY:');
    console.log('='.repeat(70));
    
    const hasValidPosition = aprsPacket.position && 
                            aprsPacket.position.isValid() && 
                            aprsPacket.position.coordinateSet &&
                            aprsPacket.position.coordinateSet.latitude.value !== 0 &&
                            aprsPacket.position.coordinateSet.longitude.value !== 0;
    
    if (hasValidPosition) {
        console.log('✓ SUCCESS: Position parsed correctly!');
        console.log(`  Location: ${aprsPacket.position.coordinateSet.latitude.value.toFixed(6)}°, ${aprsPacket.position.coordinateSet.longitude.value.toFixed(6)}°`);
        process.exit(0);
    } else {
        console.log('✗ FAILURE: Position not parsed correctly');
        process.exit(1);
    }
    
} catch (error) {
    console.error('\n' + '='.repeat(70));
    console.error('EXCEPTION OCCURRED:');
    console.error('='.repeat(70));
    console.error(error.message);
    console.error('\nStack trace:');
    console.error(error.stack);
    process.exit(1);
}
