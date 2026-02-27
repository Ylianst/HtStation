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
const { WinlinkCompression, WinLinkChecksum } = require('./winlink-utils');

// Mail flags enum
const MailFlags = {
    Unread: 1,
    Private: 2,
    P2P: 4
};

class WinLinkMailAttachment {
    constructor() {
        this.name = '';
        this.data = Buffer.alloc(0);
    }
}

class WinLinkMail {
    constructor() {
        this.mid = '';
        this.dateTime = new Date();
        this.from = '';
        this.to = '';
        this.cc = '';
        this.subject = '';
        this.mbo = '';
        this.body = '';
        this.tag = '';
        this.location = '';
        this.attachments = null;
        this.flags = 0;
        this.mailbox = 0;
    }

    static generateMID() {
        const bytes = crypto.randomBytes(12);
        let result = '';
        
        for (const b of bytes) {
            const value = b % 36; // 36 = 10 digits + 26 letters
            if (value < 10) {
                result += String.fromCharCode('0'.charCodeAt(0) + value);
            } else {
                result += String.fromCharCode('A'.charCodeAt(0) + (value - 10));
            }
        }
        
        return result;
    }

    static findFirstDoubleNewline(data) {
        if (!data || data.length < 4) return -1;
        
        for (let i = 0; i <= data.length - 4; i++) {
            if (data[i] === 0x0D && data[i + 1] === 0x0A && 
                data[i + 2] === 0x0D && data[i + 3] === 0x0A) {
                return i;
            }
        }
        return -1;
    }

    static deserializeMail(databuf) {
        const currentMail = new WinLinkMail();

        // Pull the header out of the data
        const headerLimit = WinLinkMail.findFirstDoubleNewline(databuf);
        if (headerLimit < 0) return null;
        
        const header = databuf.slice(0, headerLimit).toString('utf8');

        // Decode the header
        let done = false;
        let bodyLength = -1;
        let ptr = headerLimit + 4;
        const lines = header.replace(/\r\n/g, '\n').split(/[\n\r]/);
        
        for (const line of lines) {
            if (done) continue;
            const i = line.indexOf(':');
            if (i > 0) {
                const key = line.substring(0, i).toLowerCase().trim();
                const value = line.substring(i + 1).trim();

                switch (key) {
                    case '':
                        done = true;
                        break;
                    case 'mid':
                        currentMail.mid = value;
                        break;
                    case 'date':
                        // Parse date in format: yyyy/MM/dd HH:mm
                        currentMail.dateTime = WinLinkMail.parseWinlinkDate(value);
                        break;
                    case 'type':
                        if (value.toLowerCase() === 'private') {
                            currentMail.flags |= MailFlags.Private;
                        }
                        break;
                    case 'to':
                        currentMail.to = value;
                        break;
                    case 'cc':
                        currentMail.cc = value;
                        break;
                    case 'from':
                        currentMail.from = value;
                        break;
                    case 'subject':
                        currentMail.subject = value;
                        break;
                    case 'mbo':
                        currentMail.mbo = value;
                        break;
                    case 'body':
                        bodyLength = parseInt(value);
                        break;
                    case 'file': {
                        const j = value.indexOf(' ');
                        if (j > 0) {
                            const attachment = new WinLinkMailAttachment();
                            attachment.data = Buffer.alloc(parseInt(value.substring(0, j).trim()));
                            attachment.name = value.substring(j + 1).trim();
                            if (!currentMail.attachments) {
                                currentMail.attachments = [];
                            }
                            currentMail.attachments.push(attachment);
                        }
                        break;
                    }
                    case 'x-location':
                        currentMail.location = value;
                        break;
                    case 'x-p2p':
                        if (value.toLowerCase() === 'true') {
                            currentMail.flags |= MailFlags.P2P;
                        }
                        break;
                }
            }
        }

        // Pull the body out of the data
        if (bodyLength > 0) {
            currentMail.body = databuf.slice(ptr, ptr + bodyLength).toString('utf8');
            ptr += bodyLength + 2;
        }

        // Pull the attachments out of the data
        if (currentMail.attachments) {
            for (const attachment of currentMail.attachments) {
                databuf.copy(attachment.data, 0, ptr, ptr + attachment.data.length);
                ptr += attachment.data.length + 2;
            }
        }

        return currentMail;
    }

    static serializeMail(mail) {
        const bodyData = Buffer.from(mail.body || '', 'utf8');
        const between = Buffer.from([0x0D, 0x0A]);
        const end = Buffer.from([0x00]);

        let header = '';
        header += `MID: ${mail.mid}\r\n`;
        header += `Date: ${WinLinkMail.formatWinlinkDate(mail.dateTime)}\r\n`;
        
        if ((mail.flags & MailFlags.Private) !== 0) {
            header += `Type: Private\r\n`;
        }
        if (mail.from) header += `From: ${mail.from}\r\n`;
        if (mail.to) header += `To: ${mail.to}\r\n`;
        if (mail.cc) header += `Cc: ${mail.cc}\r\n`;
        if (mail.subject) header += `Subject: ${mail.subject}\r\n`;
        if (mail.mbo) header += `Mbo: ${mail.mbo}\r\n`;
        if ((mail.flags & MailFlags.P2P) !== 0) {
            header += `X-P2P: True\r\n`;
        }
        if (mail.location) header += `X-Location: ${mail.location}\r\n`;
        if (mail.body) header += `Body: ${bodyData.length}\r\n`;
        
        if (mail.attachments) {
            for (const attachment of mail.attachments) {
                header += `File: ${attachment.data.length} ${attachment.name}\r\n`;
            }
        }
        header += '\r\n';

        // Assemble the binary email
        const headerData = Buffer.from(header, 'utf8');
        const parts = [headerData, bodyData, between];
        
        if (mail.attachments) {
            for (const attachment of mail.attachments) {
                parts.push(attachment.data);
                parts.push(between);
            }
        }
        parts.push(end);

        return Buffer.concat(parts);
    }

    static encodeMailToBlocks(mail) {
        const uncompressedMail = WinLinkMail.serializeMail(mail);
        const uncompressedSize = uncompressedMail.length;
        
        const compResult = WinlinkCompression.encode(uncompressedMail, true);
        if (!compResult.data) return null;
        
        const payloadBuf = compResult.data;
        const subjectBuf = Buffer.from(mail.subject || '', 'utf8');
        const blocks = [];

        // Encode the binary header
        const parts = [];
        parts.push(Buffer.from([0x01]));
        parts.push(Buffer.from([subjectBuf.length + 3]));
        parts.push(subjectBuf);
        parts.push(Buffer.from([0x00, 0x30, 0x00])); // 0x30 is ASCII '0'

        let payloadPtr = 0;
        while (payloadPtr < payloadBuf.length) {
            const blockSize = Math.min(250, payloadBuf.length - payloadPtr);
            parts.push(Buffer.from([0x02]));
            parts.push(Buffer.from([blockSize]));
            parts.push(payloadBuf.slice(payloadPtr, payloadPtr + blockSize));
            payloadPtr += blockSize;
        }

        parts.push(Buffer.from([0x04]));
        parts.push(Buffer.from([WinLinkChecksum.computeChecksum(payloadBuf)]));

        const output = Buffer.concat(parts);
        const compressedSize = output.length;

        // Break the output into 128 byte blocks
        let outputPtr = 0;
        while (outputPtr < output.length) {
            const blockSize = Math.min(128, output.length - outputPtr);
            const block = output.slice(outputPtr, outputPtr + blockSize);
            blocks.push(block);
            outputPtr += blockSize;
        }

        return { blocks, uncompressedSize, compressedSize };
    }

    static decodeBlocksToEmail(block) {
        if (!block || block.length === 0) {
            return { mail: null, fail: false, dataConsumed: 0 };
        }

        // Figure out if we have a full mail and the size of the mail
        let cmdlen, payloadLen = 0, ptr = 0;
        let completeMail = false;
        
        while (!completeMail && (ptr + 1) < block.length) {
            const cmd = block[ptr];
            switch (cmd) {
                case 1:
                    cmdlen = block[ptr + 1];
                    ptr += 2 + cmdlen;
                    break;
                case 2:
                    cmdlen = block[ptr + 1];
                    payloadLen += cmdlen;
                    ptr += 2 + cmdlen;
                    break;
                case 4:
                    ptr += 2;
                    completeMail = true;
                    break;
                default:
                    return { mail: null, fail: false, dataConsumed: 0 };
            }
        }
        
        if (!completeMail) {
            return { mail: null, fail: false, dataConsumed: 0 };
        }

        ptr = 0;
        const payload = Buffer.alloc(payloadLen);
        let payloadPtr = 0;
        completeMail = false;
        
        while (!completeMail && (ptr + 1) < block.length) {
            const cmd = block[ptr];
            switch (cmd) {
                case 1:
                    cmdlen = block[ptr + 1];
                    ptr += 2 + cmdlen;
                    break;
                case 2:
                    cmdlen = block[ptr + 1];
                    block.copy(payload, payloadPtr, ptr + 2, ptr + 2 + cmdlen);
                    payloadPtr += cmdlen;
                    ptr += 2 + cmdlen;
                    break;
                case 4:
                    cmdlen = block[ptr + 1];
                    if (WinLinkChecksum.computeChecksum(payload) !== cmdlen) {
                        return { mail: null, fail: true, dataConsumed: 0 };
                    }
                    ptr += 2;
                    break;
            }
        }

        // Decompress the mail
        const expectedLength = payload[2] + (payload[3] << 8) + 
                             (payload[4] << 16) + (payload[5] << 24);
        let decResult;
        try {
            decResult = WinlinkCompression.decode(payload, true, expectedLength);
        } catch (e) {
            return { mail: null, fail: true, dataConsumed: 0 };
        }

        if (decResult.size !== expectedLength) {
            return { mail: null, fail: true, dataConsumed: 0 };
        }

        // Decode the mail
        const mail = WinLinkMail.deserializeMail(decResult.data);
        if (!mail) {
            return { mail: null, fail: true, dataConsumed: 0 };
        }

        return { mail, fail: false, dataConsumed: ptr };
    }

    static parseWinlinkDate(dateStr) {
        // Parse date in format: yyyy/MM/dd HH:mm
        const parts = dateStr.split(/[\/\s:]/);
        if (parts.length >= 5) {
            return new Date(
                parseInt(parts[0]),
                parseInt(parts[1]) - 1,
                parseInt(parts[2]),
                parseInt(parts[3]),
                parseInt(parts[4])
            );
        }
        return new Date();
    }

    static formatWinlinkDate(date) {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        const hour = String(date.getHours()).padStart(2, '0');
        const minute = String(date.getMinutes()).padStart(2, '0');
        return `${year}/${month}/${day} ${hour}:${minute}`;
    }

    static isMailForStation(callsign, to, cc) {
        const result1 = WinLinkMail.isMailForStationEx(callsign, to);
        const result2 = WinLinkMail.isMailForStationEx(callsign, cc);
        
        return {
            forStation: result1.forStation || result2.forStation,
            others: result1.others || result2.others
        };
    }

    static isMailForStationEx(callsign, t) {
        let others = false;
        let forStation = false;
        
        if (!callsign || !t) return { forStation, others };
        
        const recipients = t.split(';');
        for (const recipient of recipients) {
            if (!recipient) continue;
            
            let match = false;
            const s3 = recipient.trim();
            const i = s3.indexOf('@');
            
            if (i === -1) {
                // Callsign
                if (callsign.toUpperCase() === s3.toUpperCase()) {
                    match = true;
                }
                if (s3.toUpperCase().startsWith(callsign.toUpperCase() + '-')) {
                    match = true;
                }
            } else {
                // Email
                const key = s3.substring(0, i).toUpperCase();
                const value = s3.substring(i + 1).toUpperCase();
                
                if (value === 'WINLINK.ORG') {
                    if (callsign.toUpperCase() === key || 
                        key.startsWith(callsign.toUpperCase() + '-')) {
                        match = true;
                    }
                }
            }
            
            if (match) {
                forStation = true;
            } else {
                others = true;
            }
        }
        
        return { forStation, others };
    }

    static serialize(mails) {
        const FIELD_SEPARATOR = ';';
        const RECORD_SEPARATOR = '\n';
        const ESCAPE_CHARACTER = '\\';
        
        const escapeString = (data) => {
            if (!data) return data;
            let result = '';
            for (const c of data) {
                if (c === FIELD_SEPARATOR || c === RECORD_SEPARATOR || c === ESCAPE_CHARACTER) {
                    result += ESCAPE_CHARACTER + c;
                } else {
                    result += c;
                }
            }
            return result;
        };

        let output = '';
        for (const mail of mails) {
            output += 'Mail:\n';
            output += `MID=${mail.mid}\n`;
            output += `Time=${mail.dateTime.toISOString()}\n`;
            if (mail.from) output += `From=${mail.from}\n`;
            if (mail.to) output += `To=${mail.to}\n`;
            if (mail.cc) output += `Cc=${mail.cc}\n`;
            output += `Subject=${mail.subject}\n`;
            if (mail.mbo) output += `Mbo=${mail.mbo}\n`;
            output += `Body=${escapeString(mail.body)}\n`;
            if (mail.tag) output += `Tag=${mail.tag}\n`;
            if (mail.location) output += `Location=${mail.location}\n`;
            if (mail.flags !== 0) output += `Flags=${mail.flags}\n`;
            output += `Mailbox=${mail.mailbox}\n`;
            
            if (mail.attachments) {
                for (const attachment of mail.attachments) {
                    output += `File=${attachment.name}\n`;
                    output += `FileData=${attachment.data.toString('base64')}\n`;
                }
            }
            output += '\n';
        }
        return output;
    }

    static deserialize(data) {
        const ESCAPE_CHARACTER = '\\';
        
        const unescapeString = (escapedData) => {
            if (!escapedData) return escapedData;
            let result = '';
            let escaping = false;
            
            for (const c of escapedData) {
                if (escaping) {
                    result += c;
                    escaping = false;
                } else if (c === ESCAPE_CHARACTER) {
                    escaping = true;
                } else {
                    result += c;
                }
            }
            return result;
        };

        const mails = [];
        let currentMail = null;
        let fileName = null;
        
        const lines = data.split(/[\n\r]+/).filter(l => l.trim());
        
        for (const line of lines) {
            const trimmedLine = line.trim();
            
            if (trimmedLine === 'Mail:') {
                if (currentMail) {
                    if (!currentMail.mid) {
                        currentMail.mid = WinLinkMail.generateMID();
                    }
                    mails.push(currentMail);
                }
                currentMail = new WinLinkMail();
            } else if (currentMail) {
                const i = trimmedLine.indexOf('=');
                if (i > 0) {
                    const key = trimmedLine.substring(0, i).trim();
                    const value = trimmedLine.substring(i + 1).trim();

                    switch (key) {
                        case 'MID':
                            currentMail.mid = value;
                            break;
                        case 'Time':
                            currentMail.dateTime = new Date(value);
                            break;
                        case 'From':
                            currentMail.from = value;
                            break;
                        case 'To':
                            currentMail.to = value;
                            break;
                        case 'Cc':
                            currentMail.cc = value;
                            break;
                        case 'Subject':
                            currentMail.subject = value;
                            break;
                        case 'Mbo':
                            currentMail.mbo = value;
                            break;
                        case 'Body':
                            currentMail.body = unescapeString(value);
                            break;
                        case 'Tag':
                            currentMail.tag = value;
                            break;
                        case 'Location':
                            currentMail.location = value;
                            break;
                        case 'Flags':
                            currentMail.flags = parseInt(value);
                            break;
                        case 'Mailbox':
                            currentMail.mailbox = parseInt(value);
                            break;
                        case 'File':
                            fileName = value;
                            break;
                        case 'FileData':
                            if (fileName) {
                                if (!currentMail.attachments) {
                                    currentMail.attachments = [];
                                }
                                const attachment = new WinLinkMailAttachment();
                                attachment.name = fileName;
                                attachment.data = Buffer.from(value, 'base64');
                                currentMail.attachments.push(attachment);
                                fileName = null;
                            }
                            break;
                    }
                }
            }
        }

        if (currentMail) {
            if (!currentMail.mid) {
                currentMail.mid = WinLinkMail.generateMID();
            }
            mails.push(currentMail);
        }

        return mails;
    }
}

module.exports = {
    WinLinkMail,
    WinLinkMailAttachment,
    MailFlags
};
