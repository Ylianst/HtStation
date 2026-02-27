/*
Copyright 2026 Ylian Saint-Hilaire
Licensed under the Apache License, Version 2.0 (the "License");
http://www.apache.org/licenses/LICENSE-2.0
*/

const { SbcFrequency, SbcMode, SbcBitAllocationMethod } = require('./SbcEnums');

/**
 * SBC frame configuration and parameters
 */
class SbcFrame {
    /** Maximum number of subbands */
    static MAX_SUBBANDS = 8;

    /** Maximum number of blocks */
    static MAX_BLOCKS = 16;

    /** Maximum samples per frame */
    static MAX_SAMPLES = SbcFrame.MAX_BLOCKS * SbcFrame.MAX_SUBBANDS;

    /** SBC frame header size in bytes */
    static HEADER_SIZE = 4;

    /** mSBC samples per frame (fixed at 120) */
    static MSBC_SAMPLES = 120;

    /** mSBC frame size in bytes (fixed at 57) */
    static MSBC_SIZE = 57;

    constructor() {
        /** Whether this is an mSBC (Bluetooth HFP) frame */
        this.isMsbc = false;

        /** Sampling frequency */
        this.frequency = SbcFrequency.Freq16K;

        /** Channel mode */
        this.mode = SbcMode.Mono;

        /** Bit allocation method */
        this.allocationMethod = SbcBitAllocationMethod.Loudness;

        /** Number of blocks (4, 8, 12, or 16) */
        this.blocks = 4;

        /** Number of subbands (4 or 8) */
        this.subbands = 4;

        /** Bitpool value (controls quality/bitrate) */
        this.bitpool = 0;
    }

    /**
     * Get the sampling frequency in Hz
     * @returns {number}
     */
    getFrequencyHz() {
        switch (this.frequency) {
            case SbcFrequency.Freq16K:
                return 16000;
            case SbcFrequency.Freq32K:
                return 32000;
            case SbcFrequency.Freq44K1:
                return 44100;
            case SbcFrequency.Freq48K:
                return 48000;
            default:
                return 0;
        }
    }

    /**
     * Get the algorithmic codec delay in samples (encoding + decoding)
     * @returns {number}
     */
    getDelay() {
        return 10 * this.subbands;
    }

    /**
     * Check if the frame configuration is valid
     * @returns {boolean}
     */
    isValid() {
        // Check number of blocks
        if (this.blocks < 4 || this.blocks > 16 || (!this.isMsbc && this.blocks % 4 !== 0)) {
            return false;
        }

        // Check number of subbands
        if (this.subbands !== 4 && this.subbands !== 8) {
            return false;
        }

        // Validate bitpool value
        const twoChannels = this.mode !== SbcMode.Mono;
        const dualMode = this.mode === SbcMode.DualChannel;
        const jointMode = this.mode === SbcMode.JointStereo;
        const stereoMode = jointMode || this.mode === SbcMode.Stereo;

        const maxBits = ((16 * this.subbands * this.blocks) << (twoChannels ? 1 : 0)) -
            (SbcFrame.HEADER_SIZE * 8) -
            ((4 * this.subbands) << (twoChannels ? 1 : 0)) -
            (jointMode ? this.subbands : 0);

        const maxBitpool = Math.min(
            Math.floor(maxBits / (this.blocks << (dualMode ? 1 : 0))),
            (16 << (stereoMode ? 1 : 0)) * this.subbands
        );

        return this.bitpool <= maxBitpool;
    }

    /**
     * Get the frame size in bytes
     * @returns {number}
     */
    getFrameSize() {
        if (!this.isValid()) {
            return 0;
        }

        const twoChannels = this.mode !== SbcMode.Mono;
        const dualMode = this.mode === SbcMode.DualChannel;
        const jointMode = this.mode === SbcMode.JointStereo;

        const nbits = ((4 * this.subbands) << (twoChannels ? 1 : 0)) +
            ((this.blocks * this.bitpool) << (dualMode ? 1 : 0)) +
            (jointMode ? this.subbands : 0);

        return SbcFrame.HEADER_SIZE + ((nbits + 7) >> 3);
    }

    /**
     * Get the bitrate in bits per second
     * @returns {number}
     */
    getBitrate() {
        if (!this.isValid()) {
            return 0;
        }

        const nsamples = this.blocks * this.subbands;
        const nbits = 8 * this.getFrameSize();

        return Math.floor((nbits * this.getFrequencyHz()) / nsamples);
    }

    /**
     * Create a standard mSBC frame configuration
     * @returns {SbcFrame}
     */
    static createMsbc() {
        const frame = new SbcFrame();
        frame.isMsbc = true;
        frame.mode = SbcMode.Mono;
        frame.frequency = SbcFrequency.Freq16K;
        frame.allocationMethod = SbcBitAllocationMethod.Loudness;
        frame.subbands = 8;
        frame.blocks = 15;
        frame.bitpool = 26;
        return frame;
    }
}

module.exports = SbcFrame;
