/*
Copyright 2025 Ylian Saint-Hilaire

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

   http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

'use strict';

const crypto = require('crypto');

// Useful Github stuff for WinLink
// https://github.com/la5nta/wl2k-go
// https://github.com/la5nta/wl2k-go/blob/c52b1a2774edb0c7829d377ae4f21b2ae75c907a/docs/F6FBB-B2F/protocole.html
// https://outpostpm.org/index.php?content=bbs/bbswl2k
// https://raw.githubusercontent.com/ham-radio-software/lzhuf/refs/heads/main/lzhuf.c
// https://raw.githubusercontent.com/ARSFI/Winlink-Compression/refs/heads/master/WinlinkSupport.vb
// https://raw.githubusercontent.com/nwdigitalradio/paclink-unix/cc7b2f9474959a70856cabaf812bfce53d2da145/lzhuf_1.c
// https://kg4nxo.com/wp-content/uploads/2021/04/WINLINK-COMMAND-CODES.pdf

class WinlinkSecurity {
    static WINLINK_SECURE_SALT = Buffer.from([
        77, 197, 101, 206, 190, 249, 93, 200, 51, 243, 93, 237, 71, 94, 239, 138, 68, 108,
        70, 185, 225, 137, 217, 16, 51, 122, 193, 48, 194, 195, 198, 175, 172, 169, 70, 84, 61, 62, 104, 186, 114, 52,
        61, 168, 66, 129, 192, 208, 187, 249, 232, 193, 41, 113, 41, 45, 240, 16, 29, 228, 208, 228, 61, 20
    ]);

    static test() {
        if (WinlinkSecurity.secureLoginResponse('23753528', 'FOOBAR') !== '72768415') return false;
        if (WinlinkSecurity.secureLoginResponse('23753528', 'FooBar') !== '95074758') return false;
        return true;
    }

    // Used for WinLink login
    static secureLoginResponse(challenge, password) {
        // MD5(challenge + password + WinlinkSecureSalt)
        const a1 = Buffer.from(challenge, 'ascii');
        const a2 = Buffer.from(password, 'ascii');
        const a3 = WinlinkSecurity.WINLINK_SECURE_SALT;

        const combined = Buffer.concat([a1, a2, a3]);
        const hash = crypto.createHash('md5').update(combined).digest();
        
        let pr = hash[3] & 0x3f;
        for (let i = 2; i >= 0; i--) {
            pr = (pr << 8) | hash[i];
        }
        
        const str = pr.toString().padStart(8, '0');
        return str.substring(str.length - 8);
    }

    static generateChallenge() {
        const bytes = crypto.randomBytes(8);
        const rndNum = bytes.readBigUInt64LE(0);
        const rndStr = rndNum.toString().padStart(9, '0');
        return rndStr.substring(rndStr.length - 8);
    }
}

class WinlinkCompression {
    // Constants
    static N = 2048;
    static F = 60;
    static THRESHOLD = 2;
    static NODE_NIL = WinlinkCompression.N;
    static NCHAR = (256 - WinlinkCompression.THRESHOLD) + WinlinkCompression.F;
    static T = (WinlinkCompression.NCHAR * 2) - 1;
    static R = WinlinkCompression.T - 1;
    static MAX_FREQ = 0x8000;
    static TB_SIZE = WinlinkCompression.N + WinlinkCompression.F - 2;

    // State variables
    static textBuf = null;
    static lSon = null;
    static dad = null;
    static rSon = null;
    static freq = null;
    static son = null;
    static parent = null;
    static inBuf = null;
    static outBuf = null;
    static inPtr = 0;
    static inEnd = 0;
    static outPtr = 0;
    static CRC = 0;
    static encDec = false;
    static getBuf = 0;
    static getLen = 0;
    static putBuf = 0;
    static putLen = 0;
    static textSize = 0;
    static codeSize = 0;
    static matchPosition = 0;
    static matchLength = 0;

    // Position encode tables
    static p_len = Buffer.from([
        0x3, 0x4, 0x4, 0x4, 0x5, 0x5, 0x5, 0x5, 0x5, 0x5, 0x5, 0x5,
        0x6, 0x6, 0x6, 0x6, 0x6, 0x6, 0x6, 0x6, 0x6, 0x6, 0x6, 0x6,
        0x7, 0x7, 0x7, 0x7, 0x7, 0x7, 0x7, 0x7, 0x7, 0x7, 0x7, 0x7,
        0x7, 0x7, 0x7, 0x7, 0x7, 0x7, 0x7, 0x7, 0x7, 0x7, 0x7, 0x7,
        0x8, 0x8, 0x8, 0x8, 0x8, 0x8, 0x8, 0x8, 0x8, 0x8, 0x8, 0x8,
        0x8, 0x8, 0x8, 0x8
    ]);

    static p_code = [
        0x0, 0x20, 0x30, 0x40, 0x50, 0x58, 0x60, 0x68, 0x70, 0x78, 0x80, 0x88,
        0x90, 0x94, 0x98, 0x9C, 0xA0, 0xA4, 0xA8, 0xAC, 0xB0, 0xB4, 0xB8, 0xBC,
        0xC0, 0xC2, 0xC4, 0xC6, 0xC8, 0xCA, 0xCC, 0xCE, 0xD0, 0xD2, 0xD4, 0xD6,
        0xD8, 0xDA, 0xDC, 0xDE, 0xE0, 0xE2, 0xE4, 0xE6, 0xE8, 0xEA, 0xEC, 0xEE,
        0xF0, 0xF1, 0xF2, 0xF3, 0xF4, 0xF5, 0xF6, 0xF7, 0xF8, 0xF9, 0xFA, 0xFB,
        0xFC, 0xFD, 0xFE, 0xFF
    ];

    static d_code = [
        0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01, 0x01, 0x01, 0x01,
        0x01, 0x01, 0x01, 0x01, 0x01, 0x01, 0x01, 0x01, 0x01, 0x01, 0x01, 0x01,
        0x02, 0x02, 0x02, 0x02, 0x02, 0x02, 0x02, 0x02, 0x02, 0x02, 0x02, 0x02,
        0x02, 0x02, 0x02, 0x02, 0x03, 0x03, 0x03, 0x03, 0x03, 0x03, 0x03, 0x03,
        0x03, 0x03, 0x03, 0x03, 0x03, 0x03, 0x03, 0x03, 0x04, 0x04, 0x04, 0x04,
        0x04, 0x04, 0x04, 0x04, 0x05, 0x05, 0x05, 0x05, 0x05, 0x05, 0x05, 0x05,
        0x06, 0x06, 0x06, 0x06, 0x06, 0x06, 0x06, 0x06, 0x07, 0x07, 0x07, 0x07,
        0x07, 0x07, 0x07, 0x07, 0x08, 0x08, 0x08, 0x08, 0x08, 0x08, 0x08, 0x08,
        0x09, 0x09, 0x09, 0x09, 0x09, 0x09, 0x09, 0x09, 0x0A, 0x0A, 0x0A, 0x0A,
        0x0A, 0x0A, 0x0A, 0x0A, 0x0B, 0x0B, 0x0B, 0x0B, 0x0B, 0x0B, 0x0B, 0x0B,
        0x0C, 0x0C, 0x0C, 0x0C, 0x0D, 0x0D, 0x0D, 0x0D, 0x0E, 0x0E, 0x0E, 0x0E,
        0x0F, 0x0F, 0x0F, 0x0F, 0x10, 0x10, 0x10, 0x10, 0x11, 0x11, 0x11, 0x11,
        0x12, 0x12, 0x12, 0x12, 0x13, 0x13, 0x13, 0x13, 0x14, 0x14, 0x14, 0x14,
        0x15, 0x15, 0x15, 0x15, 0x16, 0x16, 0x16, 0x16, 0x17, 0x17, 0x17, 0x17,
        0x18, 0x18, 0x19, 0x19, 0x1A, 0x1A, 0x1B, 0x1B, 0x1C, 0x1C, 0x1D, 0x1D,
        0x1E, 0x1E, 0x1F, 0x1F, 0x20, 0x20, 0x21, 0x21, 0x22, 0x22, 0x23, 0x23,
        0x24, 0x24, 0x25, 0x25, 0x26, 0x26, 0x27, 0x27, 0x28, 0x28, 0x29, 0x29,
        0x2A, 0x2A, 0x2B, 0x2B, 0x2C, 0x2C, 0x2D, 0x2D, 0x2E, 0x2E, 0x2F, 0x2F,
        0x30, 0x31, 0x32, 0x33, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3A, 0x3B,
        0x3C, 0x3D, 0x3E, 0x3F
    ];

    static d_len = [
        0x3, 0x3, 0x3, 0x3, 0x3, 0x3, 0x3, 0x3, 0x3, 0x3, 0x3, 0x3,
        0x3, 0x3, 0x3, 0x3, 0x3, 0x3, 0x3, 0x3, 0x3, 0x3, 0x3, 0x3,
        0x3, 0x3, 0x3, 0x3, 0x3, 0x3, 0x3, 0x3, 0x4, 0x4, 0x4, 0x4,
        0x4, 0x4, 0x4, 0x4, 0x4, 0x4, 0x4, 0x4, 0x4, 0x4, 0x4, 0x4,
        0x4, 0x4, 0x4, 0x4, 0x4, 0x4, 0x4, 0x4, 0x4, 0x4, 0x4, 0x4,
        0x4, 0x4, 0x4, 0x4, 0x4, 0x4, 0x4, 0x4, 0x4, 0x4, 0x4, 0x4,
        0x4, 0x4, 0x4, 0x4, 0x4, 0x4, 0x4, 0x4, 0x5, 0x5, 0x5, 0x5,
        0x5, 0x5, 0x5, 0x5, 0x5, 0x5, 0x5, 0x5, 0x5, 0x5, 0x5, 0x5,
        0x5, 0x5, 0x5, 0x5, 0x5, 0x5, 0x5, 0x5, 0x5, 0x5, 0x5, 0x5,
        0x5, 0x5, 0x5, 0x5, 0x5, 0x5, 0x5, 0x5, 0x5, 0x5, 0x5, 0x5,
        0x5, 0x5, 0x5, 0x5, 0x5, 0x5, 0x5, 0x5, 0x5, 0x5, 0x5, 0x5,
        0x5, 0x5, 0x5, 0x5, 0x5, 0x5, 0x5, 0x5, 0x5, 0x5, 0x5, 0x5,
        0x6, 0x6, 0x6, 0x6, 0x6, 0x6, 0x6, 0x6, 0x6, 0x6, 0x6, 0x6,
        0x6, 0x6, 0x6, 0x6, 0x6, 0x6, 0x6, 0x6, 0x6, 0x6, 0x6, 0x6,
        0x6, 0x6, 0x6, 0x6, 0x6, 0x6, 0x6, 0x6, 0x6, 0x6, 0x6, 0x6,
        0x6, 0x6, 0x6, 0x6, 0x6, 0x6, 0x6, 0x6, 0x6, 0x6, 0x6, 0x6,
        0x7, 0x7, 0x7, 0x7, 0x7, 0x7, 0x7, 0x7, 0x7, 0x7, 0x7, 0x7,
        0x7, 0x7, 0x7, 0x7, 0x7, 0x7, 0x7, 0x7, 0x7, 0x7, 0x7, 0x7,
        0x7, 0x7, 0x7, 0x7, 0x7, 0x7, 0x7, 0x7, 0x7, 0x7, 0x7, 0x7,
        0x7, 0x7, 0x7, 0x7, 0x7, 0x7, 0x7, 0x7, 0x7, 0x7, 0x7, 0x7,
        0x8, 0x8, 0x8, 0x8, 0x8, 0x8, 0x8, 0x8, 0x8, 0x8, 0x8, 0x8,
        0x8, 0x8, 0x8, 0x8
    ];

    static CRC_MASK = 0xFFFF;
    static CRC_TABLE = [
        0x0000, 0x1021, 0x2042, 0x3063, 0x4084, 0x50A5, 0x60C6, 0x70E7,
        0x8108, 0x9129, 0xA14A, 0xB16B, 0xC18C, 0xD1AD, 0xE1CE, 0xF1EF,
        0x1231, 0x0210, 0x3273, 0x2252, 0x52B5, 0x4294, 0x72F7, 0x62D6,
        0x9339, 0x8318, 0xB37B, 0xA35A, 0xD3BD, 0xC39C, 0xF3FF, 0xE3DE,
        0x2462, 0x3443, 0x0420, 0x1401, 0x64E6, 0x74C7, 0x44A4, 0x5485,
        0xA56A, 0xB54B, 0x8528, 0x9509, 0xE5EE, 0xF5CF, 0xC5AC, 0xD58D,
        0x3653, 0x2672, 0x1611, 0x0630, 0x76D7, 0x66F6, 0x5695, 0x46B4,
        0xB75B, 0xA77A, 0x9719, 0x8738, 0xF7DF, 0xE7FE, 0xD79D, 0xC7BC,
        0x48C4, 0x58E5, 0x6886, 0x78A7, 0x0840, 0x1861, 0x2802, 0x3823,
        0xC9CC, 0xD9ED, 0xE98E, 0xF9AF, 0x8948, 0x9969, 0xA90A, 0xB92B,
        0x5AF5, 0x4AD4, 0x7AB7, 0x6A96, 0x1A71, 0x0A50, 0x3A33, 0x2A12,
        0xDBFD, 0xCBDC, 0xFBBF, 0xEB9E, 0x9B79, 0x8B58, 0xBB3B, 0xAB1A,
        0x6CA6, 0x7C87, 0x4CE4, 0x5CC5, 0x2C22, 0x3C03, 0x0C60, 0x1C41,
        0xEDAE, 0xFD8F, 0xCDEC, 0xDDCD, 0xAD2A, 0xBD0B, 0x8D68, 0x9D49,
        0x7E97, 0x6EB6, 0x5ED5, 0x4EF4, 0x3E13, 0x2E32, 0x1E51, 0x0E70,
        0xFF9F, 0xEFBE, 0xDFDD, 0xCFFC, 0xBF1B, 0xAF3A, 0x9F59, 0x8F78,
        0x9188, 0x81A9, 0xB1CA, 0xA1EB, 0xD10C, 0xC12D, 0xF14E, 0xE16F,
        0x1080, 0x00A1, 0x30C2, 0x20E3, 0x5004, 0x4025, 0x7046, 0x6067,
        0x83B9, 0x9398, 0xA3FB, 0xB3DA, 0xC33D, 0xD31C, 0xE37F, 0xF35E,
        0x02B1, 0x1290, 0x22F3, 0x32D2, 0x4235, 0x5214, 0x6277, 0x7256,
        0xB5EA, 0xA5CB, 0x95A8, 0x8589, 0xF56E, 0xE54F, 0xD52C, 0xC50D,
        0x34E2, 0x24C3, 0x14A0, 0x0481, 0x7466, 0x6447, 0x5424, 0x4405,
        0xA7DB, 0xB7FA, 0x8799, 0x97B8, 0xE75F, 0xF77E, 0xC71D, 0xD73C,
        0x26D3, 0x36F2, 0x0691, 0x16B0, 0x6657, 0x7676, 0x4615, 0x5634,
        0xD94C, 0xC96D, 0xF90E, 0xE92F, 0x99C8, 0x89E9, 0xB98A, 0xA9AB,
        0x5844, 0x4865, 0x7806, 0x6827, 0x18C0, 0x08E1, 0x3882, 0x28A3,
        0xCB7D, 0xDB5C, 0xEB3F, 0xFB1E, 0x8BF9, 0x9BD8, 0xABBB, 0xBB9A,
        0x4A75, 0x5A54, 0x6A37, 0x7A16, 0x0AF1, 0x1AD0, 0x2AB3, 0x3A92,
        0xFD2E, 0xED0F, 0xDD6C, 0xCD4D, 0xBDAA, 0xAD8B, 0x9DE8, 0x8DC9,
        0x7C26, 0x6C07, 0x5C64, 0x4C45, 0x3CA2, 0x2C83, 0x1CE0, 0x0CC1,
        0xEF1F, 0xFF3E, 0xCF5D, 0xDF7C, 0xAF9B, 0xBFBA, 0x8FD9, 0x9FF8,
        0x6E17, 0x7E36, 0x4E55, 0x5E74, 0x2E93, 0x3EB2, 0x0ED1, 0x1EF0
    ];

    static init() {
        this.inPtr = 0;
        this.inEnd = 0;
        this.outPtr = 0;
        this.getBuf = 0;
        this.getLen = 0;
        this.putBuf = 0;
        this.putLen = 0;
        this.textSize = 0;
        this.codeSize = 0;
        this.matchPosition = 0;
        this.matchLength = 0;
        this.textBuf = Buffer.alloc(this.TB_SIZE + 1);
        this.lSon = new Array(this.N + 1).fill(0);
        this.dad = new Array(this.N + 1).fill(0);
        this.rSon = new Array(this.N + 256 + 1).fill(0);
        this.freq = new Array(this.T + 1).fill(0);
        this.parent = new Array(this.T + this.NCHAR).fill(0);
        this.son = new Array(this.T).fill(0);
        this.inBuf = null;
        this.outBuf = null;
        this.CRC = 0;
    }

    static doCRC(c) {
        this.CRC = ((this.CRC << 8) ^ this.CRC_TABLE[((this.CRC >> 8) ^ c) & 0xFF]) & this.CRC_MASK;
    }

    static getc() {
        let c = 0;
        if (this.inPtr < this.inEnd) {
            c = this.inBuf[this.inPtr++] & 0xFF;
            if (!this.encDec) {
                this.doCRC(c);
            }
        }
        return c;
    }

    static putc(c) {
        this.outBuf[this.outPtr++] = c;
        if (this.encDec) {
            this.doCRC(c);
        }
    }

    static initTree() {
        for (let i = this.N + 1; i <= this.N + 256; i++) {
            this.rSon[i] = this.NODE_NIL;
        }
        for (let i = 0; i < this.N; i++) {
            this.dad[i] = this.NODE_NIL;
        }
    }

    static insertNode(r) {
        let i, p, c;
        let geq = true;

        p = this.N + 1 + this.textBuf[r];
        this.rSon[r] = this.NODE_NIL;
        this.lSon[r] = this.NODE_NIL;
        this.matchLength = 0;

        while (true) {
            if (geq) {
                if (this.rSon[p] === this.NODE_NIL) {
                    this.rSon[p] = r;
                    this.dad[r] = p;
                    return;
                } else {
                    p = this.rSon[p];
                }
            } else {
                if (this.lSon[p] === this.NODE_NIL) {
                    this.lSon[p] = r;
                    this.dad[r] = p;
                    return;
                } else {
                    p = this.lSon[p];
                }
            }

            i = 1;
            while ((i < this.F) && (this.textBuf[r + i] === this.textBuf[p + i])) {
                i++;
            }

            geq = (this.textBuf[r + i] >= this.textBuf[p + i]) || (i === this.F);

            if (i > this.THRESHOLD) {
                if (i > this.matchLength) {
                    this.matchPosition = ((r - p) & (this.N - 1)) - 1;
                    this.matchLength = i;
                    if (this.matchLength >= this.F) {
                        break;
                    }
                }
                if (i === this.matchLength) {
                    c = ((r - p) & (this.N - 1)) - 1;
                    if (c < this.matchPosition) {
                        this.matchPosition = c;
                    }
                }
            }
        }

        this.dad[r] = this.dad[p];
        this.lSon[r] = this.lSon[p];
        this.rSon[r] = this.rSon[p];
        this.dad[this.lSon[p]] = r;
        this.dad[this.rSon[p]] = r;
        if (this.rSon[this.dad[p]] === p) {
            this.rSon[this.dad[p]] = r;
        } else {
            this.lSon[this.dad[p]] = r;
        }
        this.dad[p] = this.NODE_NIL;
    }

    static deleteNode(p) {
        let q;

        if (this.dad[p] === this.NODE_NIL) return;

        if (this.rSon[p] === this.NODE_NIL) {
            q = this.lSon[p];
        } else if (this.lSon[p] === this.NODE_NIL) {
            q = this.rSon[p];
        } else {
            q = this.lSon[p];
            if (this.rSon[q] !== this.NODE_NIL) {
                do {
                    q = this.rSon[q];
                } while (this.rSon[q] !== this.NODE_NIL);
                this.rSon[this.dad[q]] = this.lSon[q];
                this.dad[this.lSon[q]] = this.dad[q];
                this.lSon[q] = this.lSon[p];
                this.dad[this.lSon[p]] = q;
            }
            this.rSon[q] = this.rSon[p];
            this.dad[this.rSon[p]] = q;
        }
        this.dad[q] = this.dad[p];
        if (this.rSon[this.dad[p]] === p) {
            this.rSon[this.dad[p]] = q;
        } else {
            this.lSon[this.dad[p]] = q;
        }
        this.dad[p] = this.NODE_NIL;
    }

    static getBit() {
        let retVal;
        while (this.getLen <= 8) {
            this.getBuf = (this.getBuf | (this.getc() << (8 - this.getLen))) & 0xFFFF;
            this.getLen += 8;
        }
        retVal = (this.getBuf >> 15) & 0x1;
        this.getBuf = (this.getBuf << 1) & 0xFFFF;
        this.getLen--;
        return retVal;
    }

    static getByte() {
        let retVal;
        while (this.getLen <= 8) {
            this.getBuf = (this.getBuf | (this.getc() << (8 - this.getLen))) & 0xFFFF;
            this.getLen += 8;
        }
        retVal = this.hi(this.getBuf) & 0xFF;
        this.getBuf = (this.getBuf << 8) & 0xFFFF;
        this.getLen -= 8;
        return retVal;
    }

    static putcode(n, c) {
        this.putBuf = (this.putBuf | (c >> this.putLen)) & 0xFFFF;
        this.putLen += n;
        if (this.putLen >= 8) {
            this.putc(this.hi(this.putBuf) & 0xFF);
            this.putLen -= 8;
            if (this.putLen >= 8) {
                this.putc(this.lo(this.putBuf) & 0xFF);
                this.codeSize += 2;
                this.putLen -= 8;
                this.putBuf = (c << (n - this.putLen)) & 0xFFFF;
            } else {
                this.putBuf = this.swap(this.putBuf & 0xFF);
                this.codeSize += 1;
            }
        }
    }

    static startHuff() {
        let i, j;
        for (i = 0; i < this.NCHAR; i++) {
            this.freq[i] = 1;
            this.son[i] = i + this.T;
            this.parent[i + this.T] = i;
        }
        i = 0;
        j = this.NCHAR;
        while (j <= this.R) {
            this.freq[j] = (this.freq[i] + this.freq[i + 1]) & 0xFFFF;
            this.son[j] = i;
            this.parent[i] = j;
            this.parent[i + 1] = j;
            i += 2;
            j++;
        }
        this.freq[this.T] = 0xFFFF;
        this.parent[this.R] = 0;
    }

    static reconst() {
        let i, j = 0, k, f, n;

        for (i = 0; i < this.T; i++) {
            if (this.son[i] >= this.T) {
                this.freq[j] = (this.freq[i] + 1) >> 1;
                this.son[j] = this.son[i];
                j++;
            }
        }

        i = 0;
        j = this.NCHAR;
        while (j < this.T) {
            k = i + 1;
            f = (this.freq[i] + this.freq[k]) & 0xFFFF;
            this.freq[j] = f;
            k = j - 1;
            while (f < this.freq[k]) { k--; }
            k++;

            for (n = j; n >= k + 1; n--) {
                this.freq[n] = this.freq[n - 1];
                this.son[n] = this.son[n - 1];
            }
            this.freq[k] = f;
            this.son[k] = i;

            i += 2;
            j++;
        }

        for (i = 0; i < this.T; i++) {
            k = this.son[i];
            this.parent[k] = i;
            if (k < this.T) { this.parent[k + 1] = i; }
        }
    }

    static update(c) {
        let i, j, k, n;

        if (this.freq[this.R] === this.MAX_FREQ) { this.reconst(); }
        c = this.parent[c + this.T];
        do {
            this.freq[c]++;
            k = this.freq[c];

            n = c + 1;
            if (k > this.freq[n]) {
                while (k > this.freq[n + 1]) { n++; }
                this.freq[c] = this.freq[n];
                this.freq[n] = k;

                i = this.son[c];
                this.parent[i] = n;
                if (i < this.T) { this.parent[i + 1] = n; }
                j = this.son[n];
                this.son[n] = i;

                this.parent[j] = c;
                if (j < this.T) { this.parent[j + 1] = c; }
                this.son[c] = j;

                c = n;
            }
            c = this.parent[c];
        } while (c !== 0);
    }

    static encodeChar(c) {
        let code = 0, k = this.parent[c + this.T];
        let len = 0;

        do {
            code >>= 1;
            if ((k & 1) > 0) { code += 0x8000; }
            len++;
            k = this.parent[k];
        } while (k !== this.R);
        this.putcode(len, code);
        this.update(c);
    }

    static encodePosition(c) {
        let i = c >> 6;
        this.putcode(this.p_len[i], this.p_code[i] << 8);
        this.putcode(6, (c & 0x3F) << 10);
    }

    static encodeEnd() {
        if (this.putLen > 0) {
            this.putc(this.hi(this.putBuf));
            this.codeSize++;
        }
    }

    static decodeChar() {
        let c;
        let retVal;
        c = this.son[this.R];

        while (c < this.T) {
            c = this.son[c + this.getBit()];
        }
        c -= this.T;
        this.update(c);
        retVal = c & 0xFFFF;
        return retVal;
    }

    static decodePosition() {
        let i, j, c, retVal;

        i = this.getByte();
        c = (this.d_code[i] << 6) & 0xFFFF;
        j = this.d_len[i];

        j -= 2;
        while (j > 0) {
            j--;
            i = ((i << 1) | this.getBit()) & 0xFFFF;
        }
        retVal = c | (i & 0x3F);
        return retVal;
    }

    static hi(x) {
        return (x >> 8) & 0xFF;
    }

    static lo(x) {
        return x & 0xFF;
    }

    static swap(x) {
        return (((x >> 8) & 0xFF) | ((x & 0xFF) << 8)) & 0xFFFF;
    }

    static getCRC() {
        return this.swap(this.CRC & 0xFFFF);
    }

    static encode(iBuf, prependCRC = false) {
        let i, c, len, r, s, lastMatchLength;

        this.init();
        this.encDec = true;

        this.inBuf = Buffer.alloc(iBuf.length + 100);
        this.outBuf = Buffer.alloc(iBuf.length * 2 + 10000);

        for (i = 0; i < iBuf.length; i++) {
            this.inBuf[this.inEnd++] = iBuf[i];
        }

        this.putc(this.inEnd & 0xFF);
        this.putc((this.inEnd >> 8) & 0xFF);
        this.putc((this.inEnd >> 16) & 0xFF);
        this.putc((this.inEnd >> 24) & 0xFF);

        this.codeSize += 4;

        if (this.inEnd === 0) {
            return { data: Buffer.alloc(0), crc: 0, size: this.codeSize };
        }

        this.textSize = 0;
        this.startHuff();
        this.initTree();
        s = 0;
        r = this.N - this.F;

        for (i = 0; i < r; i++) {
            this.textBuf[i] = 0x20;
        }

        len = 0;
        while ((len < this.F) && (this.inPtr < this.inEnd)) {
            this.textBuf[r + len++] = this.getc() & 0xFF;
        }

        this.textSize = len;
        for (i = 1; i <= this.F; i++) {
            this.insertNode(r - i);
        }
        this.insertNode(r);

        do {
            if (this.matchLength > len) { this.matchLength = len; }
            if (this.matchLength <= this.THRESHOLD) {
                this.matchLength = 1;
                this.encodeChar(this.textBuf[r]);
            } else {
                this.encodeChar((255 - this.THRESHOLD) + this.matchLength);
                this.encodePosition(this.matchPosition);
            }
            lastMatchLength = this.matchLength;
            i = 0;
            while ((i < lastMatchLength) && (this.inPtr < this.inEnd)) {
                i++;
                this.deleteNode(s);
                c = this.getc();
                this.textBuf[s] = c & 0xFF;
                if (s < this.F - 1) { this.textBuf[s + this.N] = c; }
                s = (s + 1) & (this.N - 1);
                r = (r + 1) & (this.N - 1);
                this.insertNode(r);
            }
            this.textSize += i;
            while (i < lastMatchLength) {
                i++;
                this.deleteNode(s);
                s = (s + 1) & (this.N - 1);
                r = (r + 1) & (this.N - 1);
                len--;
                if (len > 0) { this.insertNode(r); }
            }
        } while (len > 0);

        this.encodeEnd();
        const retCRC = this.getCRC();

        let j = 0;
        let oBuf;
        if (prependCRC) {
            oBuf = Buffer.alloc(this.codeSize + 2);
            oBuf[0] = (retCRC >> 8) & 0xFF;
            oBuf[1] = retCRC & 0xFF;
            j = 2;
        } else {
            oBuf = Buffer.alloc(this.codeSize);
            j = 0;
        }

        for (i = 0; i < this.codeSize; i++) {
            oBuf[j++] = this.outBuf[i];
        }

        if (prependCRC) { this.codeSize += 2; }

        this.inBuf = null;
        this.outBuf = null;

        return { data: oBuf, crc: retCRC, size: this.codeSize };
    }

    static decode(iBuf, checkCRC = false, expectedUncompressedSize = 0) {
        let i, j, k, r, c, count, iBufStart = 0, suppliedCRC = 0;

        this.encDec = false;
        this.init();

        this.inBuf = Buffer.alloc(iBuf.length + 100);
        this.outBuf = Buffer.alloc(expectedUncompressedSize + 10000);

        if (checkCRC) {
            iBufStart = 2;
            suppliedCRC = (iBuf[1] & 0xFF);
            suppliedCRC |= (iBuf[0] << 8);
        }

        for (i = iBufStart; i < iBuf.length; i++) {
            this.inBuf[this.inEnd++] = iBuf[i];
        }

        this.textSize = this.getc();
        this.textSize |= (this.getc() << 8);
        this.textSize |= (this.getc() << 16);
        this.textSize |= (this.getc() << 24);

        if (this.textSize === 0) {
            return { data: Buffer.alloc(0), crc: 0, size: this.textSize };
        }

        this.startHuff();

        for (i = 0; i < (this.N - this.F); i++) {
            this.textBuf[i] = 0x20;
        }

        r = this.N - this.F;
        count = 0;
        while (count < this.textSize) {
            c = this.decodeChar();
            if (c < 256) {
                this.putc(c & 0xFF);
                this.textBuf[r] = c & 0xFF;
                r = (r + 1) & (this.N - 1);
                count++;
            } else {
                i = ((r - this.decodePosition()) - 1) & (this.N - 1);
                j = (c - 255) + this.THRESHOLD;
                for (k = 0; k < j; k++) {
                    c = this.textBuf[(i + k) & (this.N - 1)];
                    this.putc(c & 0xFF);
                    this.textBuf[r] = c & 0xFF;
                    r = (r + 1) & (this.N - 1);
                    count++;
                }
            }
        }

        const oBuf = Buffer.alloc(count);
        const retCRC = this.getCRC();

        for (i = 0; i < count; i++) {
            oBuf[i] = this.outBuf[i];
        }

        if (checkCRC && (retCRC !== suppliedCRC)) {
            count = 0;
        }

        this.inBuf = null;
        this.outBuf = null;

        return { data: oBuf, crc: retCRC, size: count };
    }

    static test() {
        const xm1 = '8A34C7000000ECF57A1C6D66F79F7F89E6E9F47BBD7E9736D6672D87ED00F8E160EFB7961C1DDD7D2A3AD354A1BFA14D52D6D3C00BFCA805FB9FEFA81500825CCB99EFDFE6955BA77C3F15F51C50E4BB8E517FECE77F565F46BF86D198D8F322DCB49688BC56EBDF096CD99DF01F77D993EC16DB62F23CE6914315EA40BF0E3BF26E7B06282D35CE8E6D9E0574026E297E2321BB5B86B0155CB49B091E10E90F187697B0D25C047355ECDFE06D4E379C8A6126C0C4E3503CEE1122';
        const xm2 = 'F05B9A010000ECF57A1C6D676FB1DEEB79B7BC2E96FFAFD4E9E672D87ED00F8E160EFB795FC1DDD753ACAB3D3BBE2D2A3336967E005FE4605FB9FEFA814F882549B99DFDFE69D4B781C3F15E51440E4B3AE50FFECA73F563F46BF86D15B5873231E339388BC2EEBDF056CD99DF01F77D98BF4069A56EE38FE01A6E2BCC817E1477E4DCDF98A0C4D73635A69CEB5FEE0D95E21361DADC346D34CA49325D7414878C1B4B5868FC0041AAF467EFDB534CE7229450038FE8445165D954D200F01160F273EA006213D0FF86E9F662B3C86BB61AF60D350340';
        
        const m1 = Buffer.from(xm1, 'hex');
        const m2 = Buffer.from(xm2, 'hex');

        const d1Result = WinlinkCompression.decode(m1, true, 199);
        const re1Result = WinlinkCompression.encode(d1Result.data, true);

        const d2Result = WinlinkCompression.decode(m2, true, 410);
        const re2Result = WinlinkCompression.encode(d2Result.data, true);

        if (xm1 !== re1Result.data.toString('hex').toUpperCase()) return false;
        if (xm2 !== re2Result.data.toString('hex').toUpperCase()) return false;
        return true;
    }
}

class WinLinkChecksum {
    static computeChecksum(data, off = 0, len = data.length) {
        let crc = 0;
        for (let i = off; i < len; i++) {
            crc += data[i];
        }
        return ((~(crc % 256) + 1) % 256) & 0xFF;
    }

    static checkChecksum(data, checksum) {
        let crc = 0;
        for (let i = 0; i < data.length; i++) {
            crc += data[i];
        }
        return ((crc + checksum) & 0xFF) === 0;
    }

    static test() {
        const m1 = Buffer.from('8A34C7000000ECF57A1C6D66F79F7F89E6E9F47BBD7E9736D6672D87ED00F8E160EFB7961C1DDD7D2A3AD354A1BFA14D52D6D3C00BFCA805FB9FEFA81500825CCB99EFDFE6955BA77C3F15F51C50E4BB8E517FECE77F565F46BF86D198D8F322DCB49688BC56EBDF096CD99DF01F77D993EC16DB62F23CE6914315EA40BF0E3BF26E7B06282D35CE8E6D9E0574026E297E2321BB5B86B0155CB49B091E10E90F187697B0D25C047355ECDFE06D4E379C8A6126C0C4E3503CEE1122', 'hex');
        const m2 = Buffer.from('F05B9A010000ECF57A1C6D676FB1DEEB79B7BC2E96FFAFD4E9E672D87ED00F8E160EFB795FC1DDD753ACAB3D3BBE2D2A3336967E005FE4605FB9FEFA814F882549B99DFDFE69D4B781C3F15E51440E4B3AE50FFECA73F563F46BF86D15B5873231E339388BC2EEBDF056CD99DF01F77D98BF4069A56EE38FE01A6E2BCC817E1477E4DCDF98A0C4D73635A69CEB5FEE0D95E21361DADC346D34CA49325D7414878C1B4B5868FC0041AAF467EFDB534CE7229450038FE8445165D954D200F01160F273EA006213D0FF86E9F662B3C86BB61AF60D350340', 'hex');
        
        if (!WinLinkChecksum.checkChecksum(m1, 0x53)) return false;
        if (!WinLinkChecksum.checkChecksum(m2, 0x2A)) return false;
        if (WinLinkChecksum.computeChecksum(m1) !== 0x53) return false;
        if (WinLinkChecksum.computeChecksum(m2) !== 0x2A) return false;
        return true;
    }
}

class WinlinkCrc16 {
    static CRC16_TABLE = [
        0x0000, 0x1021, 0x2042, 0x3063, 0x4084, 0x50a5, 0x60c6, 0x70e7,
        0x8108, 0x9129, 0xa14a, 0xb16b, 0xc18c, 0xd1ad, 0xe1ce, 0xf1ef,
        0x1231, 0x0210, 0x3273, 0x2252, 0x52b5, 0x4294, 0x72f7, 0x62d6,
        0x9339, 0x8318, 0xb37b, 0xa35a, 0xd3bd, 0xc39c, 0xf3ff, 0xe3de,
        0x2462, 0x3443, 0x0420, 0x1401, 0x64e6, 0x74c7, 0x44a4, 0x5485,
        0xa56a, 0xb54b, 0x8528, 0x9509, 0xe5ee, 0xf5cf, 0xc5ac, 0xd58d,
        0x3653, 0x2672, 0x1611, 0x0630, 0x76d7, 0x66f6, 0x5695, 0x46b4,
        0xb75b, 0xa77a, 0x9719, 0x8738, 0xf7df, 0xe7fe, 0xd79d, 0xc7bc,
        0x48c4, 0x58e5, 0x6886, 0x78a7, 0x0840, 0x1861, 0x2802, 0x3823,
        0xc9cc, 0xd9ed, 0xe98e, 0xf9af, 0x8948, 0x9969, 0xa90a, 0xb92b,
        0x5af5, 0x4ad4, 0x7ab7, 0x6a96, 0x1a71, 0x0a50, 0x3a33, 0x2a12,
        0xdbfd, 0xcbdc, 0xfbbf, 0xeb9e, 0x9b79, 0x8b58, 0xbb3b, 0xab1a,
        0x6ca6, 0x7c87, 0x4ce4, 0x5cc5, 0x2c22, 0x3c03, 0x0c60, 0x1c41,
        0xedae, 0xfd8f, 0xcdec, 0xddcd, 0xad2a, 0xbd0b, 0x8d68, 0x9d49,
        0x7e97, 0x6eb6, 0x5ed5, 0x4ef4, 0x3e13, 0x2e32, 0x1e51, 0x0e70,
        0xff9f, 0xefbe, 0xdfdd, 0xcffc, 0xbf1b, 0xaf3a, 0x9f59, 0x8f78,
        0x9188, 0x81a9, 0xb1ca, 0xa1eb, 0xd10c, 0xc12d, 0xf14e, 0xe16f,
        0x1080, 0x00a1, 0x30c2, 0x20e3, 0x5004, 0x4025, 0x7046, 0x6067,
        0x83b9, 0x9398, 0xa3fb, 0xb3da, 0xc33d, 0xd31c, 0xe37f, 0xf35e,
        0x02b1, 0x1290, 0x22f3, 0x32d2, 0x4235, 0x5214, 0x6277, 0x7256,
        0xb5ea, 0xa5cb, 0x95a8, 0x8589, 0xf56e, 0xe54f, 0xd52c, 0xc50d,
        0x34e2, 0x24c3, 0x14a0, 0x0481, 0x7466, 0x6447, 0x5424, 0x4405,
        0xa7db, 0xb7fa, 0x8799, 0x97b8, 0xe75f, 0xf77e, 0xc71d, 0xd73c,
        0x26d3, 0x36f2, 0x0691, 0x16b0, 0x6657, 0x7676, 0x4615, 0x5634,
        0xd94c, 0xc96d, 0xf90e, 0xe92f, 0x99c8, 0x89e9, 0xb98a, 0xa9ab,
        0x5844, 0x4865, 0x7806, 0x6827, 0x18c0, 0x08e1, 0x3882, 0x28a3,
        0xcb7d, 0xdb5c, 0xeb3f, 0xfb1e, 0x8bf9, 0x9bd8, 0xabbb, 0xbb9a,
        0x4a75, 0x5a54, 0x6a37, 0x7a16, 0x0af1, 0x1ad0, 0x2ab3, 0x3a92,
        0xfd2e, 0xed0f, 0xdd6c, 0xcd4d, 0xbdaa, 0xad8b, 0x9de8, 0x8dc9,
        0x7c26, 0x6c07, 0x5c64, 0x4c45, 0x3ca2, 0x2c83, 0x1ce0, 0x0cc1,
        0xef1f, 0xff3e, 0xcf5d, 0xdf7c, 0xaf9b, 0xbfba, 0x8fd9, 0x9ff8,
        0x6e17, 0x7e36, 0x4e55, 0x5e74, 0x2e93, 0x3eb2, 0x0ed1, 0x1ef0
    ];

    static udpCRC16(cp, sum) {
        return (((sum << 8) & 0xff00) ^ this.CRC16_TABLE[((sum >> 8) & 0xff)] ^ cp) & 0xFFFF;
    }

    static compute(p) {
        let sum = 0;
        const extendedP = Buffer.alloc(p.length + 2);
        p.copy(extendedP);
        extendedP[p.length] = 0;
        extendedP[p.length + 1] = 0;
        
        for (const c of extendedP) {
            sum = this.udpCRC16(c, sum);
        }
        return sum;
    }

    static test() {
        const m1 = Buffer.from('C7000000ECF57A1C6D66F79F7F89E6E9F47BBD7E9736D6672D87ED00F8E160EFB7961C1DDD7D2A3AD354A1BFA14D52D6D3C00BFCA805FB9FEFA81500825CCB99EFDFE6955BA77C3F15F51C50E4BB8E517FECE77F565F46BF86D198D8F322DCB49688BC56EBDF096CD99DF01F77D993EC16DB62F23CE6914315EA40BF0E3BF26E7B06282D35CE8E6D9E0574026E297E2321BB5B86B0155CB49B091E10E90F187697B0D25C047355ECDFE06D4E379C8A6126C0C4E3503CEE1122', 'hex');
        const m2 = Buffer.from('9A010000ECF57A1C6D676FB1DEEB79B7BC2E96FFAFD4E9E672D87ED00F8E160EFB795FC1DDD753ACAB3D3BBE2D2A3336967E005FE4605FB9FEFA814F882549B99DFDFE69D4B781C3F15E51440E4B3AE50FFECA73F563F46BF86D15B5873231E339388BC2EEBDF056CD99DF01F77D98BF4069A56EE38FE01A6E2BCC817E1477E4DCDF98A0C4D73635A69CEB5FEE0D95E21361DADC346D34CA49325D7414878C1B4B5868FC0041AAF467EFDB534CE7229450038FE8445165D954D200F01160F273EA006213D0FF86E9F662B3C86BB61AF60D350340', 'hex');
        
        if (WinlinkCrc16.compute(m1) !== 0x348A) return false;
        if (WinlinkCrc16.compute(m2) !== 0x5BF0) return false;
        return true;
    }
}

module.exports = {
    WinlinkSecurity,
    WinlinkCompression,
    WinLinkChecksum,
    WinlinkCrc16
};
