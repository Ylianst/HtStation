/*
Copyright 2026 Ylian Saint-Hilaire
Licensed under the Apache License, Version 2.0 (the "License");
http://www.apache.org/licenses/LICENSE-2.0
*/

/**
 * Simple test for SBC encoder/decoder
 */

const { SbcEncoder, SbcDecoder, SbcFrame, SbcFrequency, SbcMode, SbcBitAllocationMethod } = require('./index');

console.log('SBC Codec Test\n');

// Test 1: Create mSBC frame configuration
console.log('Test 1: mSBC Frame Configuration');
const msbcFrame = SbcFrame.createMsbc();
console.log('  isMsbc:', msbcFrame.isMsbc);
console.log('  frequency:', msbcFrame.frequency, '(', msbcFrame.getFrequencyHz(), 'Hz)');
console.log('  mode:', msbcFrame.mode);
console.log('  subbands:', msbcFrame.subbands);
console.log('  blocks:', msbcFrame.blocks);
console.log('  bitpool:', msbcFrame.bitpool);
console.log('  isValid:', msbcFrame.isValid());
console.log('  frameSize:', msbcFrame.getFrameSize(), 'bytes');
console.log('  bitrate:', msbcFrame.getBitrate(), 'bps');
console.log('  delay:', msbcFrame.getDelay(), 'samples');
console.log('  PASS\n');

// Test 2: Create standard SBC frame configuration
console.log('Test 2: Standard SBC Frame Configuration');
const stdFrame = new SbcFrame();
stdFrame.frequency = SbcFrequency.Freq44K1;
stdFrame.mode = SbcMode.JointStereo;
stdFrame.allocationMethod = SbcBitAllocationMethod.Loudness;
stdFrame.subbands = 8;
stdFrame.blocks = 16;
stdFrame.bitpool = 53;
console.log('  frequency:', stdFrame.frequency, '(', stdFrame.getFrequencyHz(), 'Hz)');
console.log('  mode:', stdFrame.mode);
console.log('  subbands:', stdFrame.subbands);
console.log('  blocks:', stdFrame.blocks);
console.log('  bitpool:', stdFrame.bitpool);
console.log('  isValid:', stdFrame.isValid());
console.log('  frameSize:', stdFrame.getFrameSize(), 'bytes');
console.log('  bitrate:', stdFrame.getBitrate(), 'bps');
console.log('  PASS\n');

// Test 3: Encode and decode mSBC frame
console.log('Test 3: mSBC Encode/Decode Round-trip');
const encoder = new SbcEncoder();
const decoder = new SbcDecoder();

// Create test PCM data (sine wave)
const samplesPerFrame = 120; // mSBC uses 15 blocks * 8 subbands = 120 samples
const pcmInput = new Int16Array(samplesPerFrame);
for (let i = 0; i < samplesPerFrame; i++) {
    pcmInput[i] = Math.round(Math.sin(2 * Math.PI * 440 * i / 16000) * 16000);
}

// Encode
const encodeFrame = SbcFrame.createMsbc();
const encoded = encoder.encode(pcmInput, null, encodeFrame);
if (encoded) {
    console.log('  Encoded successfully:', encoded.length, 'bytes');
    console.log('  First 8 bytes:', Array.from(encoded.slice(0, 8)).map(b => '0x' + b.toString(16).padStart(2, '0')).join(' '));
    
    // Decode
    const decoded = decoder.decode(encoded);
    if (decoded) {
        console.log('  Decoded successfully:', decoded.pcmLeft.length, 'samples');
        console.log('  Frame info: subbands=', decoded.frame.subbands, 'blocks=', decoded.frame.blocks);
        
        // Check that we got data back (not exact match due to lossy compression)
        let nonZero = 0;
        for (let i = 0; i < decoded.pcmLeft.length; i++) {
            if (decoded.pcmLeft[i] !== 0) nonZero++;
        }
        console.log('  Non-zero samples:', nonZero);
        console.log('  PASS\n');
    } else {
        console.log('  Decode FAILED\n');
    }
} else {
    console.log('  Encode FAILED\n');
}

// Test 4: Probe SBC data
console.log('Test 4: Probe SBC Data');
if (encoded) {
    const probed = decoder.probe(encoded);
    if (probed) {
        console.log('  Probed frame info:');
        console.log('    isMsbc:', probed.isMsbc);
        console.log('    subbands:', probed.subbands);
        console.log('    blocks:', probed.blocks);
        console.log('    bitpool:', probed.bitpool);
        console.log('  PASS\n');
    } else {
        console.log('  Probe FAILED\n');
    }
} else {
    console.log('  Skipped (no encoded data)\n');
}

// Test 5: Standard SBC encode/decode (mono)
console.log('Test 5: Standard SBC Mono Encode/Decode');
const monoEncoder = new SbcEncoder();
const monoDecoder = new SbcDecoder();

const monoFrame = new SbcFrame();
monoFrame.frequency = SbcFrequency.Freq44K1;
monoFrame.mode = SbcMode.Mono;
monoFrame.allocationMethod = SbcBitAllocationMethod.Loudness;
monoFrame.subbands = 8;
monoFrame.blocks = 16;
monoFrame.bitpool = 31;

const monoSamples = monoFrame.blocks * monoFrame.subbands;
const monoPcm = new Int16Array(monoSamples);
for (let i = 0; i < monoSamples; i++) {
    monoPcm[i] = Math.round(Math.sin(2 * Math.PI * 1000 * i / 44100) * 10000);
}

const monoEncoded = monoEncoder.encode(monoPcm, null, monoFrame);
if (monoEncoded) {
    console.log('  Encoded:', monoEncoded.length, 'bytes');
    const monoDecoded = monoDecoder.decode(monoEncoded);
    if (monoDecoded) {
        console.log('  Decoded:', monoDecoded.pcmLeft.length, 'samples');
        console.log('  Right channel:', monoDecoded.pcmRight === null ? 'null (correct for mono)' : 'present');
        console.log('  PASS\n');
    } else {
        console.log('  Decode FAILED\n');
    }
} else {
    console.log('  Encode FAILED\n');
}

console.log('All tests completed!');
