/*
Copyright 2026 Ylian Saint-Hilaire
Licensed under the Apache License, Version 2.0 (the "License");
http://www.apache.org/licenses/LICENSE-2.0
*/

/**
 * Bitstream reader/writer for SBC encoding and decoding
 */
class SbcBitStream {
    /**
     * Create a new bitstream
     * @param {Uint8Array} data - Data buffer
     * @param {number} size - Buffer size
     * @param {boolean} isReader - True for reading, false for writing
     */
    constructor(data, size, isReader) {
        this._data = data;
        this._maxBytes = size;
        this._isReader = isReader;
        this._bytePosition = 0;
        this._accumulator = 0;
        this._bitsInAccumulator = 0;
        this._error = false;
    }

    /**
     * Check if an error has occurred
     * @returns {boolean}
     */
    get hasError() {
        return this._error;
    }

    /**
     * Get the current bit position in the stream
     * @returns {number}
     */
    get bitPosition() {
        if (this._isReader) {
            // For reader: bits already consumed from loaded bytes
            return (this._bytePosition * 8) - this._bitsInAccumulator;
        } else {
            // For writer: bytes written + bits pending in accumulator
            return (this._bytePosition * 8) + this._bitsInAccumulator;
        }
    }

    /**
     * Read bits from the stream (1-32 bits)
     * @param {number} numBits - Number of bits to read
     * @returns {number} The bits read as an unsigned integer
     */
    getBits(numBits) {
        if (numBits === 0) {
            return 0;
        }

        if (numBits < 0 || numBits > 32) {
            this._error = true;
            return 0;
        }

        // Refill accumulator if needed
        while (this._bitsInAccumulator < numBits && this._bytePosition < this._maxBytes) {
            this._accumulator = ((this._accumulator << 8) | this._data[this._bytePosition++]) >>> 0;
            this._bitsInAccumulator += 8;
        }

        // Check if we have enough bits
        if (this._bitsInAccumulator < numBits) {
            // Not enough data - return what we have padded with zeros
            const result = (this._accumulator << (numBits - this._bitsInAccumulator)) >>> 0;
            this._bitsInAccumulator = 0;
            this._accumulator = 0;
            this._error = true;
            return (result & ((1 << numBits) - 1)) >>> 0;
        }

        // Extract the requested bits
        this._bitsInAccumulator -= numBits;
        const value = ((this._accumulator >>> this._bitsInAccumulator) & ((1 << numBits) - 1)) >>> 0;
        this._accumulator = (this._accumulator & ((1 << this._bitsInAccumulator) - 1)) >>> 0;

        return value;
    }

    /**
     * Read bits and verify they match expected value
     * @param {number} numBits - Number of bits to read
     * @param {number} expectedValue - Expected value
     */
    getFixedBits(numBits, expectedValue) {
        const value = this.getBits(numBits);
        if (value !== expectedValue) {
            this._error = true;
        }
    }

    /**
     * Write bits to the stream (0-32 bits)
     * @param {number} value - Value to write
     * @param {number} numBits - Number of bits to write
     */
    putBits(value, numBits) {
        if (numBits === 0) {
            return;
        }

        if (numBits < 0 || numBits > 32) {
            this._error = true;
            return;
        }

        // Mask the value to the requested number of bits
        value = (value & ((1 << numBits) - 1)) >>> 0;

        // Add to accumulator
        this._accumulator = ((this._accumulator << numBits) | value) >>> 0;
        this._bitsInAccumulator += numBits;

        // Flush full bytes
        while (this._bitsInAccumulator >= 8) {
            if (this._bytePosition >= this._maxBytes) {
                this._error = true;
                return;
            }

            this._bitsInAccumulator -= 8;
            this._data[this._bytePosition++] = (this._accumulator >>> this._bitsInAccumulator) & 0xFF;
            this._accumulator = (this._accumulator & ((1 << this._bitsInAccumulator) - 1)) >>> 0;
        }
    }

    /**
     * Flush any remaining bits in the accumulator to the output
     */
    flush() {
        if (this._bitsInAccumulator > 0) {
            if (this._bytePosition >= this._maxBytes) {
                this._error = true;
                return;
            }

            // Pad with zeros and write the final byte
            this._data[this._bytePosition++] = (this._accumulator << (8 - this._bitsInAccumulator)) & 0xFF;
            this._bitsInAccumulator = 0;
            this._accumulator = 0;
        }
    }
}

module.exports = SbcBitStream;
