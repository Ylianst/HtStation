/*
Copyright 2026 Ylian Saint-Hilaire
Licensed under the Apache License, Version 2.0 (the "License");
http://www.apache.org/licenses/LICENSE-2.0
*/

const { SbcFrequency, SbcMode, SbcBitAllocationMethod } = require('./SbcEnums');
const SbcFrame = require('./SbcFrame');
const SbcBitStream = require('./SbcBitStream');
const SbcTables = require('./SbcTables');
const SbcEncoderTables = require('./SbcEncoderTables');

/**
 * Encoder state for a single channel
 */
class EncoderState {
    constructor() {
        this.index = 0;
        // X[2][MaxSubbands][5]
        this.x = [[], []];
        for (let odd = 0; odd < 2; odd++) {
            for (let i = 0; i < SbcFrame.MAX_SUBBANDS; i++) {
                this.x[odd][i] = new Int16Array(5);
            }
        }
        // Y[4]
        this.y = new Int32Array(4);
    }

    reset() {
        this.index = 0;
        for (let odd = 0; odd < 2; odd++) {
            for (let sb = 0; sb < SbcFrame.MAX_SUBBANDS; sb++) {
                this.x[odd][sb].fill(0);
            }
        }
        this.y.fill(0);
    }
}

/**
 * SBC audio encoder - converts PCM samples to SBC frames
 */
class SbcEncoder {
    constructor() {
        this._channelStates = [new EncoderState(), new EncoderState()];
        this.reset();
    }

    /**
     * Reset encoder state
     */
    reset() {
        this._channelStates[0].reset();
        this._channelStates[1].reset();
    }

    /**
     * Encode PCM samples to an SBC frame
     * @param {Int16Array} pcmLeft - Input PCM samples for left channel
     * @param {Int16Array|null} pcmRight - Input PCM samples for right channel (can be null for mono)
     * @param {SbcFrame} frame - Frame configuration parameters
     * @returns {Uint8Array|null} Encoded SBC frame data, or null on error
     */
    encode(pcmLeft, pcmRight, frame) {
        if (!pcmLeft || !frame) {
            return null;
        }

        // Override with mSBC if signaled
        if (frame.isMsbc) {
            frame = SbcFrame.createMsbc();
        }

        // Validate frame
        if (!frame.isValid()) {
            return null;
        }

        const frameSize = frame.getFrameSize();
        const samplesPerChannel = frame.blocks * frame.subbands;

        if (pcmLeft.length < samplesPerChannel) {
            return null;
        }

        if (frame.mode !== SbcMode.Mono && (!pcmRight || pcmRight.length < samplesPerChannel)) {
            return null;
        }

        // Analyze PCM to subband samples
        const sbSamples = [new Int16Array(SbcFrame.MAX_SAMPLES), new Int16Array(SbcFrame.MAX_SAMPLES)];

        this._analyze(this._channelStates[0], frame, pcmLeft, 1, sbSamples[0]);
        if (frame.mode !== SbcMode.Mono && pcmRight) {
            this._analyze(this._channelStates[1], frame, pcmRight, 1, sbSamples[1]);
        }

        // Allocate output buffer
        const output = new Uint8Array(frameSize);

        // Encode frame data
        const dataBits = new SbcBitStream(output, frameSize, false);
        dataBits.putBits(0, SbcFrame.HEADER_SIZE * 8); // Reserve space for header

        this._encodeFrameData(dataBits, frame, sbSamples);
        dataBits.flush();

        if (dataBits.hasError) {
            return null;
        }

        // Encode header
        const headerBits = new SbcBitStream(output, SbcFrame.HEADER_SIZE, false);
        this._encodeHeader(headerBits, frame);
        headerBits.flush();

        if (headerBits.hasError) {
            return null;
        }

        // Compute and set CRC
        const crc = SbcTables.computeCrc(frame, output, frameSize);
        if (crc < 0) {
            return null;
        }

        output[3] = crc;

        return output;
    }

    _encodeHeader(bits, frame) {
        bits.putBits(frame.isMsbc ? 0xad : 0x9c, 8);

        if (!frame.isMsbc) {
            bits.putBits(frame.frequency, 2);
            bits.putBits((frame.blocks >> 2) - 1, 2);
            bits.putBits(frame.mode, 2);
            bits.putBits(frame.allocationMethod, 1);
            bits.putBits((frame.subbands >> 2) - 1, 1);
            bits.putBits(frame.bitpool, 8);
        } else {
            bits.putBits(0, 16); // reserved
        }

        bits.putBits(0, 8); // CRC placeholder
    }

    _encodeFrameData(bits, frame, sbSamples) {
        const nchannels = frame.mode !== SbcMode.Mono ? 2 : 1;
        const nsubbands = frame.subbands;

        // Compute scale factors
        const scaleFactors = [new Int32Array(SbcFrame.MAX_SUBBANDS), new Int32Array(SbcFrame.MAX_SUBBANDS)];
        let mjoint = 0;

        if (frame.mode === SbcMode.JointStereo) {
            const result = this._computeScaleFactorsJointStereo(frame, sbSamples, scaleFactors);
            mjoint = result.mjoint;
        } else {
            this._computeScaleFactors(frame, sbSamples, scaleFactors);
        }

        if (frame.mode === SbcMode.DualChannel) {
            const sbSamples1 = [sbSamples[1]];
            const scaleFactors1 = [scaleFactors[1]];
            this._computeScaleFactors(frame, sbSamples1, scaleFactors1);
        }

        // Write joint stereo mask
        if (frame.mode === SbcMode.JointStereo) {
            if (nsubbands === 4) {
                const v = ((mjoint & 0x01) << 3) | ((mjoint & 0x02) << 1) |
                    ((mjoint & 0x04) >> 1) | ((0x00) >> 3);
                bits.putBits(v, 4);
            } else {
                const v = ((mjoint & 0x01) << 7) | ((mjoint & 0x02) << 5) |
                    ((mjoint & 0x04) << 3) | ((mjoint & 0x08) << 1) |
                    ((mjoint & 0x10) >> 1) | ((mjoint & 0x20) >> 3) |
                    ((mjoint & 0x40) >> 5) | ((0x00) >> 7);
                bits.putBits(v, 8);
            }
        }

        // Write scale factors
        for (let ch = 0; ch < nchannels; ch++) {
            for (let sb = 0; sb < nsubbands; sb++) {
                bits.putBits(scaleFactors[ch][sb], 4);
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

        // Apply joint stereo coupling
        for (let sb = 0; sb < nsubbands; sb++) {
            if (((mjoint >> sb) & 1) === 0) continue;

            for (let blk = 0; blk < frame.blocks; blk++) {
                const idx = blk * nsubbands + sb;
                const s0 = sbSamples[0][idx];
                const s1 = sbSamples[1][idx];
                sbSamples[0][idx] = (s0 + s1) >> 1;
                sbSamples[1][idx] = (s0 - s1) >> 1;
            }
        }

        // Quantize and write samples
        for (let blk = 0; blk < frame.blocks; blk++) {
            for (let ch = 0; ch < nchannels; ch++) {
                for (let sb = 0; sb < nsubbands; sb++) {
                    const nbit = nbits[ch][sb];
                    if (nbit === 0) continue;

                    const scf = scaleFactors[ch][sb];
                    const idx = blk * nsubbands + sb;
                    const sample = sbSamples[ch][idx];
                    const range = (1 << nbit) - 1;

                    const quantized = ((((sample * range) >> (scf + 1)) + range) >> 1) >>> 0;
                    bits.putBits(quantized, nbit);
                }
            }
        }

        // Write padding
        const paddingBits = 8 - (bits.bitPosition % 8);
        if (paddingBits < 8) {
            bits.putBits(0, paddingBits);
        }
    }

    _computeScaleFactorsJointStereo(frame, sbSamples, scaleFactors) {
        let mjoint = 0;

        for (let sb = 0; sb < frame.subbands; sb++) {
            let m0 = 0, m1 = 0;
            let mj0 = 0, mj1 = 0;

            for (let blk = 0; blk < frame.blocks; blk++) {
                const idx = blk * frame.subbands + sb;
                const s0 = sbSamples[0][idx];
                const s1 = sbSamples[1][idx];

                const abs0 = s0 < 0 ? -s0 : s0;
                const abs1 = s1 < 0 ? -s1 : s1;
                m0 |= abs0;
                m1 |= abs1;

                const sum = s0 + s1;
                const diff = s0 - s1;
                const absSum = sum < 0 ? -sum : sum;
                const absDiff = diff < 0 ? -diff : diff;
                mj0 |= absSum;
                mj1 |= absDiff;
            }

            let scf0 = m0 !== 0 ? 31 - SbcTables.countLeadingZeros(m0 >>> 0) : 0;
            let scf1 = m1 !== 0 ? 31 - SbcTables.countLeadingZeros(m1 >>> 0) : 0;

            const js0 = mj0 !== 0 ? 31 - SbcTables.countLeadingZeros(mj0 >>> 0) : 0;
            const js1 = mj1 !== 0 ? 31 - SbcTables.countLeadingZeros(mj1 >>> 0) : 0;

            if (sb < frame.subbands - 1 && js0 + js1 < scf0 + scf1) {
                mjoint |= 1 << sb;
                scf0 = js0;
                scf1 = js1;
            }

            scaleFactors[0][sb] = scf0;
            scaleFactors[1][sb] = scf1;
        }

        return { mjoint };
    }

    _computeScaleFactors(frame, sbSamples, scaleFactors) {
        const nchannels = frame.mode !== SbcMode.Mono ? 2 : 1;

        for (let ch = 0; ch < nchannels; ch++) {
            for (let sb = 0; sb < frame.subbands; sb++) {
                let m = 0;

                for (let blk = 0; blk < frame.blocks; blk++) {
                    const idx = blk * frame.subbands + sb;
                    const sample = sbSamples[ch][idx];
                    const abs = sample < 0 ? -sample : sample;
                    m |= abs;
                }

                const scf = m !== 0 ? 31 - SbcTables.countLeadingZeros(m >>> 0) : 0;
                scaleFactors[ch][sb] = scf;
            }
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
        const bitpool = frame.bitpool;
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

    _analyze(state, frame, input, pitch, output) {
        for (let blk = 0; blk < frame.blocks; blk++) {
            const inOffset = blk * frame.subbands * pitch;
            const outOffset = blk * frame.subbands;

            if (frame.subbands === 4) {
                this._analyze4(state, input, inOffset, pitch, output, outOffset);
            } else {
                this._analyze8(state, input, inOffset, pitch, output, outOffset);
            }
        }
    }

    _analyze4(state, input, inOffset, pitch, output, outOffset) {
        const window = SbcEncoderTables.Window4;
        const cos8 = SbcTables.Cos8;

        const idx = state.index >> 1;
        const odd = state.index & 1;
        const inIdx = idx !== 0 ? 5 - idx : 0;

        // Load PCM samples into circular buffer (check bounds)
        state.x[odd][0][inIdx] = inOffset + 3 * pitch < input.length ? input[inOffset + 3 * pitch] : 0;
        state.x[odd][1][inIdx] = inOffset + 1 * pitch < input.length ? input[inOffset + 1 * pitch] : 0;
        state.x[odd][2][inIdx] = inOffset + 2 * pitch < input.length ? input[inOffset + 2 * pitch] : 0;
        state.x[odd][3][inIdx] = inOffset + 0 * pitch < input.length ? input[inOffset + 0 * pitch] : 0;

        // Apply window and process
        let y0 = 0, y1 = 0, y2 = 0, y3 = 0;

        for (let j = 0; j < 5; j++) {
            y0 += state.x[odd][0][j] * window[0][idx + j];
            y1 += state.x[odd][2][j] * window[2][idx + j] + state.x[odd][3][j] * window[3][idx + j];
            y3 += state.x[odd][1][j] * window[1][idx + j];
        }

        y0 += state.y[0];
        state.y[0] = 0;
        for (let j = 0; j < 5; j++) {
            state.y[0] += state.x[odd][0][j] * window[0][idx + 5 + j];
        }

        y2 = state.y[1];
        state.y[1] = 0;
        for (let j = 0; j < 5; j++) {
            state.y[1] += state.x[odd][2][j] * window[2][idx + 5 + j] - state.x[odd][3][j] * window[3][idx + 5 + j];
        }

        for (let j = 0; j < 5; j++) {
            y3 += state.x[odd][1][j] * window[1][idx + 5 + j];
        }

        const y = new Int16Array(4);
        y[0] = SbcTables.saturate16((y0 + (1 << 14)) >> 15);
        y[1] = SbcTables.saturate16((y1 + (1 << 14)) >> 15);
        y[2] = SbcTables.saturate16((y2 + (1 << 14)) >> 15);
        y[3] = SbcTables.saturate16((y3 + (1 << 14)) >> 15);

        state.index = state.index < 9 ? state.index + 1 : 0;

        // DCT to get subband samples
        let s0 = y[0] * cos8[2] + y[1] * cos8[1] + y[2] * cos8[3] + (y[3] << 13);
        let s1 = -y[0] * cos8[2] + y[1] * cos8[3] - y[2] * cos8[1] + (y[3] << 13);
        let s2 = -y[0] * cos8[2] - y[1] * cos8[3] + y[2] * cos8[1] + (y[3] << 13);
        let s3 = y[0] * cos8[2] - y[1] * cos8[1] - y[2] * cos8[3] + (y[3] << 13);

        output[outOffset + 0] = SbcTables.saturate16((s0 + (1 << 12)) >> 13);
        output[outOffset + 1] = SbcTables.saturate16((s1 + (1 << 12)) >> 13);
        output[outOffset + 2] = SbcTables.saturate16((s2 + (1 << 12)) >> 13);
        output[outOffset + 3] = SbcTables.saturate16((s3 + (1 << 12)) >> 13);
    }

    _analyze8(state, input, inOffset, pitch, output, outOffset) {
        const window = SbcEncoderTables.Window8;
        const cosmat = SbcEncoderTables.CosMatrix8;

        const idx = state.index >> 1;
        const odd = state.index & 1;
        const inIdx = idx !== 0 ? 5 - idx : 0;

        // Load PCM samples into circular buffer
        const maxIdx = input.length;
        state.x[odd][0][inIdx] = inOffset + 7 * pitch < maxIdx ? input[inOffset + 7 * pitch] : 0;
        state.x[odd][1][inIdx] = inOffset + 3 * pitch < maxIdx ? input[inOffset + 3 * pitch] : 0;
        state.x[odd][2][inIdx] = inOffset + 6 * pitch < maxIdx ? input[inOffset + 6 * pitch] : 0;
        state.x[odd][3][inIdx] = inOffset + 0 * pitch < maxIdx ? input[inOffset + 0 * pitch] : 0;
        state.x[odd][4][inIdx] = inOffset + 5 * pitch < maxIdx ? input[inOffset + 5 * pitch] : 0;
        state.x[odd][5][inIdx] = inOffset + 1 * pitch < maxIdx ? input[inOffset + 1 * pitch] : 0;
        state.x[odd][6][inIdx] = inOffset + 4 * pitch < maxIdx ? input[inOffset + 4 * pitch] : 0;
        state.x[odd][7][inIdx] = inOffset + 2 * pitch < maxIdx ? input[inOffset + 2 * pitch] : 0;

        // Apply window and process
        const yTemp = new Int32Array(8);

        for (let i = 0; i < 8; i++) {
            yTemp[i] = 0;
            for (let j = 0; j < 5; j++) {
                yTemp[i] += state.x[odd][i][j] * window[i][idx + j];
            }
        }

        let y0 = yTemp[0] + state.y[0];
        let y1 = yTemp[2] + yTemp[3];
        let y2 = yTemp[4] + yTemp[5];
        let y3 = yTemp[6] + yTemp[7];
        let y4 = state.y[1];
        let y5 = state.y[2];
        let y6 = state.y[3];
        let y7 = yTemp[1];

        state.y[0] = state.y[1] = state.y[2] = state.y[3] = 0;
        for (let j = 0; j < 5; j++) {
            state.y[0] += state.x[odd][0][j] * window[0][idx + 5 + j];
            state.y[1] += state.x[odd][2][j] * window[2][idx + 5 + j] - state.x[odd][3][j] * window[3][idx + 5 + j];
            state.y[2] += state.x[odd][4][j] * window[4][idx + 5 + j] - state.x[odd][5][j] * window[5][idx + 5 + j];
            state.y[3] += state.x[odd][6][j] * window[6][idx + 5 + j] - state.x[odd][7][j] * window[7][idx + 5 + j];
            y7 += state.x[odd][1][j] * window[1][idx + 5 + j];
        }

        const y = new Int16Array(8);
        y[0] = SbcTables.saturate16((y0 + (1 << 14)) >> 15);
        y[1] = SbcTables.saturate16((y1 + (1 << 14)) >> 15);
        y[2] = SbcTables.saturate16((y2 + (1 << 14)) >> 15);
        y[3] = SbcTables.saturate16((y3 + (1 << 14)) >> 15);
        y[4] = SbcTables.saturate16((y4 + (1 << 14)) >> 15);
        y[5] = SbcTables.saturate16((y5 + (1 << 14)) >> 15);
        y[6] = SbcTables.saturate16((y6 + (1 << 14)) >> 15);
        y[7] = SbcTables.saturate16((y7 + (1 << 14)) >> 15);

        state.index = state.index < 9 ? state.index + 1 : 0;

        // Apply cosine matrix to get subband samples
        for (let i = 0; i < 8; i++) {
            let s = 0;
            for (let j = 0; j < 8; j++) {
                s += y[j] * cosmat[i][j];
            }
            output[outOffset + i] = SbcTables.saturate16((s + (1 << 12)) >> 13);
        }
    }
}

module.exports = SbcEncoder;
