/*
Copyright 2026 Ylian Saint-Hilaire
Licensed under the Apache License, Version 2.0 (the "License");
http://www.apache.org/licenses/LICENSE-2.0
*/

/**
 * SBC sampling frequencies
 * @enum {number}
 */
const SbcFrequency = {
    /** 16 kHz */
    Freq16K: 0,
    /** 32 kHz */
    Freq32K: 1,
    /** 44.1 kHz */
    Freq44K1: 2,
    /** 48 kHz */
    Freq48K: 3
};

/**
 * SBC channel modes
 * @enum {number}
 */
const SbcMode = {
    /** Mono (1 channel) */
    Mono: 0,
    /** Dual channel (2 independent channels) */
    DualChannel: 1,
    /** Stereo (2 channels) */
    Stereo: 2,
    /** Joint stereo (2 channels with joint encoding) */
    JointStereo: 3
};

/**
 * SBC bit allocation method
 * @enum {number}
 */
const SbcBitAllocationMethod = {
    /** Loudness allocation */
    Loudness: 0,
    /** SNR allocation */
    SNR: 1
};

module.exports = {
    SbcFrequency,
    SbcMode,
    SbcBitAllocationMethod
};
