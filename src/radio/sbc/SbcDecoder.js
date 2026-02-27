/*
Copyright 2026 Ylian Saint-Hilaire
Licensed under the Apache License, Version 2.0 (the "License");
http://www.apache.org/licenses/LICENSE-2.0
*/

const { SbcFrequency, SbcMode, SbcBitAllocationMethod } = require('./SbcEnums');
const SbcFrame = require('./SbcFrame');
const SbcBitStream = require('./SbcBitStream');
const SbcTables = require('./SbcTables');
const SbcDecoderTables = require('./SbcDecoderTables');

/**
 * Decoder state for a single channel
 */
class DecoderState {
    constructor() {
        this.index = 0;
        // V[2][MaxSubbands][10]
        this.v = [[], []];
        for (let odd = 0; odd < 2; odd++) {
            for (let i = 0; i < SbcFrame.MAX_SUBBANDS; i++) {
                this.v[odd][i] = new Int16Array(10);
            }
        }
    }

    reset() {
        this.index = 0;
        for (let odd = 0; odd < 2; odd++) {
            for (let sb = 0; sb < SbcFrame.MAX_SUBBANDS; sb++) {
                this.v[odd][sb].fill(0);
            }
        }
    }
}

/**
 * SBC audio decoder - converts SBC frames to PCM samples
 */
class SbcDecoder {
    constructor() {
        this._channelStates = [new DecoderState(), new DecoderState()];
        this._numChannels = 0;
        this._numBlocks = 0;
        this._numSubbands = 0;
        this.reset();
    }

    /**
     * Reset decoder state
     */
    reset() {
        this._channelStates[0].reset();
        this._channelStates[1].reset();
        this._numChannels = 0;
        this._numBlocks = 0;
        this._numSubbands = 0;
    }

    /**
     * Probe SBC data and extract frame parameters without full decoding
     * @param {Uint8Array} data - SBC frame data
     * @returns {SbcFrame|null} Frame parameters or null on error
     */
    probe(data) {
        if (!data || data.length < SbcFrame.HEADER_SIZE) {
            return null;
        }

        const bits = new SbcBitStream(data, SbcFrame.HEADER_SIZE, true);
        const frame = new SbcFrame();
        const result = this._decodeHeader(bits, frame);

        if (!result.success) {
            return null;
        }

        return bits.hasError ? null : frame;
    }

    /**
     * Decode an SBC frame to PCM samples
     * @param {Uint8Array} sbcData - SBC encoded frame data
     * @returns {Object|null} Object with pcmLeft, pcmRight (Int16Array), and frame, or null on error
     */
    decode(sbcData) {
        if (!sbcData || sbcData.length < SbcFrame.HEADER_SIZE) {
            return null;
        }

        // Decode header
        const headerBits = new SbcBitStream(sbcData, SbcFrame.HEADER_SIZE, true);
        const frame = new SbcFrame();
        const headerResult = this._decodeHeader(headerBits, frame);

        if (!headerResult.success || headerBits.hasError) {
            return null;
        }

        const frameSize = frame.getFrameSize();
        if (sbcData.length < frameSize) {
            return null;
        }

        // Verify CRC
        const computedCrc = SbcTables.computeCrc(frame, sbcData, sbcData.length);
        if (computedCrc !== headerResult.crc) {
            return null;
        }

        // Decode frame data
        const dataBits = new SbcBitStream(sbcData, frameSize, true);
        dataBits.getBits(SbcFrame.HEADER_SIZE * 8); // Skip header

        const sbSamples = [new Int16Array(SbcFrame.MAX_SAMPLES), new Int16Array(SbcFrame.MAX_SAMPLES)];
        const sbScale = [0, 0];

        this._decodeFrameData(dataBits, frame, sbSamples, sbScale);
        if (dataBits.hasError) {
            return null;
        }

        this._numChannels = frame.mode !== SbcMode.Mono ? 2 : 1;
        this._numBlocks = frame.blocks;
        this._numSubbands = frame.subbands;

        // Synthesize PCM
        const samplesPerChannel = this._numBlocks * this._numSubbands;
        const pcmLeft = new Int16Array(samplesPerChannel);

        this._synthesize(this._channelStates[0], this._numBlocks, this._numSubbands,
            sbSamples[0], sbScale[0], pcmLeft, 1);

        let pcmRight = null;
        if (frame.mode !== SbcMode.Mono) {
            pcmRight = new Int16Array(samplesPerChannel);
            this._synthesize(this._channelStates[1], this._numBlocks, this._numSubbands,
                sbSamples[1], sbScale[1], pcmRight, 1);
        }

        return { pcmLeft, pcmRight, frame };
    }

    _decodeHeader(bits, frame) {
        const syncword = bits.getBits(8);
        frame.isMsbc = (syncword === 0xad);

        if (frame.isMsbc) {
            bits.getBits(16); // reserved
            const msbcFrame = SbcFrame.createMsbc();
            frame.frequency = msbcFrame.frequency;
            frame.mode = msbcFrame.mode;
            frame.allocationMethod = msbcFrame.allocationMethod;
            frame.blocks = msbcFrame.blocks;
            frame.subbands = msbcFrame.subbands;
            frame.bitpool = msbcFrame.bitpool;
        } else if (syncword === 0x9c) {
            const freq = bits.getBits(2);
            frame.frequency = freq;

            const blocks = bits.getBits(2);
            frame.blocks = (1 + blocks) << 2;

            const mode = bits.getBits(2);
            frame.mode = mode;

            const bam = bits.getBits(1);
            frame.allocationMethod = bam;

            const subbands = bits.getBits(1);
            frame.subbands = (1 + subbands) << 2;

            frame.bitpool = bits.getBits(8);
        } else {
            return { success: false, crc: 0 };
        }

        const crc = bits.getBits(8);

        return { success: frame.isValid(), crc };
    }

    _decodeFrameData(bits, frame, sbSamples, sbScale) {
        const nchannels = frame.mode !== SbcMode.Mono ? 2 : 1;
        const nsubbands = frame.subbands;

        // Decode joint stereo mask
        let mjoint = 0;
        if (frame.mode === SbcMode.JointStereo) {
            const v = bits.getBits(nsubbands);
            if (nsubbands === 4) {
                mjoint = ((0x00) << 3) | ((v & 0x02) << 1) |
                    ((v & 0x04) >> 1) | ((v & 0x08) >> 3);
            } else {
                mjoint = ((0x00) << 7) | ((v & 0x02) << 5) |
                    ((v & 0x04) << 3) | ((v & 0x08) << 1) |
                    ((v & 0x10) >> 1) | ((v & 0x20) >> 3) |
                    ((v & 0x40) >> 5) | ((v & 0x80) >> 7);
            }
        }

        // Decode scale factors
        const scaleFactors = [new Int32Array(SbcFrame.MAX_SUBBANDS), new Int32Array(SbcFrame.MAX_SUBBANDS)];

        for (let ch = 0; ch < nchannels; ch++) {
            for (let sb = 0; sb < nsubbands; sb++) {
                scaleFactors[ch][sb] = bits.getBits(4);
            }
        }

        // Compute bit allocation
        const nbits = [new Int32Array(SbcFrame.MAX_SUBBANDS), new Int32Array(SbcFrame.MAX_SUBBANDS)];

        this._computeBitAllocation(frame, scaleFactors, nbits);
        if (frame.mode === SbcMode.DualChannel) {
            const scaleFactors1 = [scaleFactors[1]];
            const nbits1 = [nbits[1]];
            this._computeBitAllocation(frame, scaleFactors1, nbits1);
        }

        // Compute scale for output samples
        for (let ch = 0; ch < nchannels; ch++) {
            let maxScf = 0;
            for (let sb = 0; sb < nsubbands; sb++) {
                const scf = scaleFactors[ch][sb] + ((mjoint >> sb) & 1);
                if (scf > maxScf) maxScf = scf;
            }
            sbScale[ch] = (15 - maxScf) - (17 - 16);
        }

        if (frame.mode === SbcMode.JointStereo) {
            sbScale[0] = sbScale[1] = Math.min(sbScale[0], sbScale[1]);
        }

        // Decode samples
        for (let blk = 0; blk < frame.blocks; blk++) {
            for (let ch = 0; ch < nchannels; ch++) {
                for (let sb = 0; sb < nsubbands; sb++) {
                    const nbit = nbits[ch][sb];
                    const scf = scaleFactors[ch][sb];
                    const idx = blk * nsubbands + sb;

                    if (nbit === 0) {
                        sbSamples[ch][idx] = 0;
                        continue;
                    }

                    let sample = bits.getBits(nbit);
                    sample = ((sample << 1) | 1) * SbcTables.RangeScale[nbit - 1];
                    sbSamples[ch][idx] = (sample - (1 << 28)) >> (28 - ((scf + 1) + sbScale[ch]));
                }
            }
        }

        // Uncouple joint stereo
        for (let sb = 0; sb < nsubbands; sb++) {
            if (((mjoint >> sb) & 1) === 0) continue;

            for (let blk = 0; blk < frame.blocks; blk++) {
                const idx = blk * nsubbands + sb;
                const s0 = sbSamples[0][idx];
                const s1 = sbSamples[1][idx];
                sbSamples[0][idx] = s0 + s1;
                sbSamples[1][idx] = s0 - s1;
            }
        }

        // Skip padding
        const paddingBits = 8 - (bits.bitPosition % 8);
        if (paddingBits < 8) {
            bits.getBits(paddingBits);
        }
    }

    _computeBitAllocation(frame, scaleFactors, nbits) {
        const loudnessOffset = frame.subbands === 4
            ? SbcTables.LoudnessOffset4[frame.frequency]
            : SbcTables.LoudnessOffset8[frame.frequency];

        const stereoMode = frame.mode === SbcMode.Stereo || frame.mode === SbcMode.JointStereo;
        const nsubbands = frame.subbands;
        const nchannels = stereoMode ? 2 : 1;

        const bitneeds = [new Int32Array(SbcFrame.MAX_SUBBANDS), new Int32Array(SbcFrame.MAX_SUBBANDS)];
        let maxBitneed = 0;

        for (let ch = 0; ch < nchannels; ch++) {
            for (let sb = 0; sb < nsubbands; sb++) {
                const scf = scaleFactors[ch][sb];
                let bitneed;

                if (frame.allocationMethod === SbcBitAllocationMethod.Loudness) {
                    bitneed = scf !== 0 ? scf - loudnessOffset[sb] : -5;
                    bitneed >>= (bitneed > 0) ? 1 : 0;
                } else {
                    bitneed = scf;
                }

                if (bitneed > maxBitneed) maxBitneed = bitneed;

                bitneeds[ch][sb] = bitneed;
            }
        }

        // Bit distribution
        let bitpool = frame.bitpool;
        let bitcount = 0;
        let bitslice = maxBitneed + 1;

        for (let bc = 0; bc < bitpool;) {
            const bs = bitslice--;
            bitcount = bc;
            if (bitcount === bitpool) break;

            for (let ch = 0; ch < nchannels; ch++) {
                for (let sb = 0; sb < nsubbands; sb++) {
                    const bn = bitneeds[ch][sb];
                    bc += (bn >= bs && bn < bs + 15 ? 1 : 0) + (bn === bs ? 1 : 0);
                }
            }
        }

        // Assign bits
        for (let ch = 0; ch < nchannels; ch++) {
            for (let sb = 0; sb < nsubbands; sb++) {
                let nbit = bitneeds[ch][sb] - bitslice;
                nbits[ch][sb] = nbit < 2 ? 0 : nbit > 16 ? 16 : nbit;
            }
        }

        // Allocate remaining bits
        for (let sb = 0; sb < nsubbands && bitcount < bitpool; sb++) {
            for (let ch = 0; ch < nchannels && bitcount < bitpool; ch++) {
                const n = (nbits[ch][sb] > 0 && nbits[ch][sb] < 16) ? 1 :
                    (bitneeds[ch][sb] === bitslice + 1 && bitpool > bitcount + 1) ? 2 : 0;
                nbits[ch][sb] += n;
                bitcount += n;
            }
        }

        for (let sb = 0; sb < nsubbands && bitcount < bitpool; sb++) {
            for (let ch = 0; ch < nchannels && bitcount < bitpool; ch++) {
                const n = nbits[ch][sb] < 16 ? 1 : 0;
                nbits[ch][sb] += n;
                bitcount += n;
            }
        }
    }

    _synthesize(state, nblocks, nsubbands, input, scale, output, pitch) {
        for (let blk = 0; blk < nblocks; blk++) {
            const inOffset = blk * nsubbands;
            const outOffset = blk * nsubbands * pitch;

            if (nsubbands === 4) {
                this._synthesize4(state, input, inOffset, scale, output, outOffset, pitch);
            } else {
                this._synthesize8(state, input, inOffset, scale, output, outOffset, pitch);
            }
        }
    }

    _synthesize4(state, input, inOffset, scale, output, outOffset, pitch) {
        // Perform DCT and windowing for 4 subbands
        const dctIdx = state.index !== 0 ? 10 - state.index : 0;
        const odd = dctIdx & 1;

        this._dct4(input, inOffset, scale, state.v[odd], state.v[1 - odd], dctIdx);
        this._applyWindow4(state.v[odd], state.index, output, outOffset, pitch);

        state.index = state.index < 9 ? state.index + 1 : 0;
    }

    _synthesize8(state, input, inOffset, scale, output, outOffset, pitch) {
        // Perform DCT and windowing for 8 subbands
        const dctIdx = state.index !== 0 ? 10 - state.index : 0;
        const odd = dctIdx & 1;

        this._dct8(input, inOffset, scale, state.v[odd], state.v[1 - odd], dctIdx);
        this._applyWindow8(state.v[odd], state.index, output, outOffset, pitch);

        state.index = state.index < 9 ? state.index + 1 : 0;
    }

    _dct4(input, offset, scale, out0, out1, idx) {
        const cos8 = SbcTables.Cos8;

        const s03 = (input[offset + 0] + input[offset + 3]) >> 1;
        const d03 = (input[offset + 0] - input[offset + 3]) >> 1;
        const s12 = (input[offset + 1] + input[offset + 2]) >> 1;
        const d12 = (input[offset + 1] - input[offset + 2]) >> 1;

        let a0 = (s03 - s12) * cos8[2];
        let b1 = -(s03 + s12) << 13;
        let a1 = d03 * cos8[3] - d12 * cos8[1];
        let b0 = -d03 * cos8[1] - d12 * cos8[3];

        const shr = 12 + scale;
        a0 = (a0 + (1 << (shr - 1))) >> shr;
        b0 = (b0 + (1 << (shr - 1))) >> shr;
        a1 = (a1 + (1 << (shr - 1))) >> shr;
        b1 = (b1 + (1 << (shr - 1))) >> shr;

        out0[0][idx] = SbcTables.saturate16(a0);
        out0[3][idx] = SbcTables.saturate16(-a1);
        out0[1][idx] = SbcTables.saturate16(a1);
        out0[2][idx] = SbcTables.saturate16(0);

        out1[0][idx] = SbcTables.saturate16(-a0);
        out1[3][idx] = SbcTables.saturate16(b0);
        out1[1][idx] = SbcTables.saturate16(b0);
        out1[2][idx] = SbcTables.saturate16(b1);
    }

    _dct8(input, offset, scale, out0, out1, idx) {
        const cos16 = SbcTables.Cos16;

        const s07 = (input[offset + 0] + input[offset + 7]) >> 1;
        const d07 = (input[offset + 0] - input[offset + 7]) >> 1;
        const s16 = (input[offset + 1] + input[offset + 6]) >> 1;
        const d16 = (input[offset + 1] - input[offset + 6]) >> 1;
        const s25 = (input[offset + 2] + input[offset + 5]) >> 1;
        const d25 = (input[offset + 2] - input[offset + 5]) >> 1;
        const s34 = (input[offset + 3] + input[offset + 4]) >> 1;
        const d34 = (input[offset + 3] - input[offset + 4]) >> 1;

        let a0 = ((s07 + s34) - (s25 + s16)) * cos16[4];
        let b3 = (-(s07 + s34) - (s25 + s16)) << 13;
        let a2 = (s07 - s34) * cos16[6] + (s25 - s16) * cos16[2];
        let b1 = (s34 - s07) * cos16[2] + (s25 - s16) * cos16[6];
        let a1 = d07 * cos16[5] - d16 * cos16[1] + d25 * cos16[7] + d34 * cos16[3];
        let b2 = -d07 * cos16[1] - d16 * cos16[3] - d25 * cos16[5] - d34 * cos16[7];
        let a3 = d07 * cos16[7] - d16 * cos16[5] + d25 * cos16[3] - d34 * cos16[1];
        let b0 = -d07 * cos16[3] + d16 * cos16[7] + d25 * cos16[1] + d34 * cos16[5];

        const shr = 12 + scale;
        a0 = (a0 + (1 << (shr - 1))) >> shr; b0 = (b0 + (1 << (shr - 1))) >> shr;
        a1 = (a1 + (1 << (shr - 1))) >> shr; b1 = (b1 + (1 << (shr - 1))) >> shr;
        a2 = (a2 + (1 << (shr - 1))) >> shr; b2 = (b2 + (1 << (shr - 1))) >> shr;
        a3 = (a3 + (1 << (shr - 1))) >> shr; b3 = (b3 + (1 << (shr - 1))) >> shr;

        out0[0][idx] = SbcTables.saturate16(a0); out0[7][idx] = SbcTables.saturate16(-a1);
        out0[1][idx] = SbcTables.saturate16(a1); out0[6][idx] = SbcTables.saturate16(-a2);
        out0[2][idx] = SbcTables.saturate16(a2); out0[5][idx] = SbcTables.saturate16(-a3);
        out0[3][idx] = SbcTables.saturate16(a3); out0[4][idx] = SbcTables.saturate16(0);

        out1[0][idx] = SbcTables.saturate16(-a0); out1[7][idx] = SbcTables.saturate16(b0);
        out1[1][idx] = SbcTables.saturate16(b0); out1[6][idx] = SbcTables.saturate16(b1);
        out1[2][idx] = SbcTables.saturate16(b1); out1[5][idx] = SbcTables.saturate16(b2);
        out1[3][idx] = SbcTables.saturate16(b2); out1[4][idx] = SbcTables.saturate16(b3);
    }

    _applyWindow4(input, index, output, offset, pitch) {
        const window = SbcDecoderTables.Window4;

        for (let i = 0; i < 4; i++) {
            let s = 0;
            for (let j = 0; j < 10; j++) {
                s += input[i][j] * window[i][index + j];
            }
            output[offset + i * pitch] = SbcTables.saturate16((s + (1 << 12)) >> 13);
        }
    }

    _applyWindow8(input, index, output, offset, pitch) {
        const window = SbcDecoderTables.Window8;

        for (let i = 0; i < 8; i++) {
            let s = 0;
            for (let j = 0; j < 10; j++) {
                s += input[i][j] * window[i][index + j];
            }
            output[offset + i * pitch] = SbcTables.saturate16((s + (1 << 12)) >> 13);
        }
    }
}

module.exports = SbcDecoder;
