/*
Copyright 2026 Ylian Saint-Hilaire
Licensed under the Apache License, Version 2.0 (the "License");
http://www.apache.org/licenses/LICENSE-2.0
*/

/**
 * SBC (Sub-Band Coding) Audio Codec for Node.js
 * 
 * This module provides SBC encoding and decoding capabilities,
 * commonly used in Bluetooth audio applications (A2DP, HFP).
 * 
 * Features:
 * - Standard SBC encoding/decoding (A2DP)
 * - mSBC encoding/decoding (HFP wideband speech)
 * - Support for mono, dual channel, stereo, and joint stereo modes
 * - 4 or 8 subbands
 * - 4, 8, 12, or 16 blocks
 * - 16kHz, 32kHz, 44.1kHz, or 48kHz sampling rates
 * 
 * @example
 * const { SbcEncoder, SbcDecoder, SbcFrame, SbcFrequency, SbcMode } = require('./sbc');
 * 
 * // Create mSBC encoder for Bluetooth HFP
 * const encoder = new SbcEncoder();
 * const frame = SbcFrame.createMsbc();
 * const pcmData = new Int16Array(120); // 120 samples for mSBC
 * const sbcData = encoder.encode(pcmData, null, frame);
 * 
 * // Decode SBC data
 * const decoder = new SbcDecoder();
 * const result = decoder.decode(sbcData);
 * if (result) {
 *     console.log('Decoded', result.pcmLeft.length, 'samples');
 * }
 */

const { SbcFrequency, SbcMode, SbcBitAllocationMethod } = require('./SbcEnums');
const SbcFrame = require('./SbcFrame');
const SbcBitStream = require('./SbcBitStream');
const SbcTables = require('./SbcTables');
const SbcDecoderTables = require('./SbcDecoderTables');
const SbcEncoderTables = require('./SbcEncoderTables');
const SbcDecoder = require('./SbcDecoder');
const SbcEncoder = require('./SbcEncoder');

module.exports = {
    // Enums
    SbcFrequency,
    SbcMode,
    SbcBitAllocationMethod,
    
    // Classes
    SbcFrame,
    SbcBitStream,
    SbcDecoder,
    SbcEncoder,
    
    // Tables (for advanced usage)
    SbcTables,
    SbcDecoderTables,
    SbcEncoderTables
};
