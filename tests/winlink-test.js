#!/usr/bin/env node
'use strict';

const { WinlinkSecurity, WinlinkCompression, WinLinkChecksum, WinlinkCrc16 } = require('../src/winlink-utils');
const { WinLinkMail, WinLinkMailAttachment, MailFlags } = require('../src/winlink-mail');

console.log('Testing Winlink modules...\n');

// Test WinlinkSecurity
console.log('1. Testing WinlinkSecurity...');
const securityTest = WinlinkSecurity.test();
console.log(`   WinlinkSecurity test: ${securityTest ? 'PASSED' : 'FAILED'}`);

// Test challenge generation
const challenge = WinlinkSecurity.generateChallenge();
console.log(`   Generated challenge: ${challenge} (length: ${challenge.length})`);

// Test WinlinkCompression
console.log('\n2. Testing WinlinkCompression...');
const compressionTest = WinlinkCompression.test();
console.log(`   WinlinkCompression test: ${compressionTest ? 'PASSED' : 'FAILED'}`);

// Test WinLinkChecksum
console.log('\n3. Testing WinLinkChecksum...');
const checksumTest = WinLinkChecksum.test();
console.log(`   WinLinkChecksum test: ${checksumTest ? 'PASSED' : 'FAILED'}`);

// Test WinlinkCrc16
console.log('\n4. Testing WinlinkCrc16...');
const crc16Test = WinlinkCrc16.test();
console.log(`   WinlinkCrc16 test: ${crc16Test ? 'PASSED' : 'FAILED'}`);

// Test WinLinkMail
console.log('\n5. Testing WinLinkMail...');

// Create a test mail
const testMail = new WinLinkMail();
testMail.mid = WinLinkMail.generateMID();
testMail.dateTime = new Date();
testMail.from = 'KK7VZT';
testMail.to = 'test@winlink.org';
testMail.subject = 'Test Message';
testMail.mbo = 'KK7VZT';
testMail.body = 'This is a test message.\nWith multiple lines.';
testMail.flags = MailFlags.Private;
testMail.location = '45.395833N, 122.791667W';

console.log(`   Created mail with MID: ${testMail.mid}`);

// Serialize the mail
const serialized = WinLinkMail.serializeMail(testMail);
console.log(`   Serialized mail size: ${serialized.length} bytes`);

// Deserialize the mail
const deserialized = WinLinkMail.deserializeMail(serialized);
console.log(`   Deserialized MID: ${deserialized.mid}`);
console.log(`   Subject matches: ${deserialized.subject === testMail.subject}`);
console.log(`   Body matches: ${deserialized.body === testMail.body}`);

// Test mail encoding to blocks
const encodeResult = WinLinkMail.encodeMailToBlocks(testMail);
if (encodeResult) {
    console.log(`   Encoded to ${encodeResult.blocks.length} blocks`);
    console.log(`   Uncompressed size: ${encodeResult.uncompressedSize} bytes`);
    console.log(`   Compressed size: ${encodeResult.compressedSize} bytes`);
    console.log(`   Compression ratio: ${(100 * (1 - encodeResult.compressedSize / encodeResult.uncompressedSize)).toFixed(1)}%`);

    // Test decoding
    const combinedBlocks = Buffer.concat(encodeResult.blocks);
    const decodeResult = WinLinkMail.decodeBlocksToEmail(combinedBlocks);
    
    if (decodeResult.mail && !decodeResult.fail) {
        console.log(`   Decoded mail MID: ${decodeResult.mail.mid}`);
        console.log(`   Decoded subject matches: ${decodeResult.mail.subject === testMail.subject}`);
        console.log(`   Decoded body matches: ${decodeResult.mail.body === testMail.body}`);
        console.log(`   Mail encoding/decoding: PASSED`);
    } else {
        console.log(`   Mail encoding/decoding: FAILED`);
    }
} else {
    console.log(`   Mail encoding: FAILED`);
}

// Test isMailForStation
console.log('\n6. Testing isMailForStation...');
const result1 = WinLinkMail.isMailForStation('KK7VZT', 'kk7vzt@winlink.org', null);
console.log(`   Mail for KK7VZT: ${result1.forStation} (expected: true)`);

const result2 = WinLinkMail.isMailForStation('KK7VZT', 'other@winlink.org', null);
console.log(`   Mail for other: ${result2.forStation} (expected: false)`);

const result3 = WinLinkMail.isMailForStation('KK7VZT', 'kk7vzt-1@winlink.org', null);
console.log(`   Mail for KK7VZT-1: ${result3.forStation} (expected: true)`);

console.log('\n✓ All tests completed!');
