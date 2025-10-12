#!/usr/bin/env node
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

const Storage = require('./src/storage.js');

// Mailbox type names
const MAILBOX_NAMES = {
    0: 'Inbox',
    1: 'Outbox',
    3: 'Sent'
};

// Initialize storage
const storage = new Storage();

console.log('='.repeat(80));
console.log('WinLink Mail Storage Viewer');
console.log('='.repeat(80));
console.log();

// Load mails from storage
const stored = storage.load('winlink-mails');

if (!stored || !Array.isArray(stored)) {
    console.log('No mails found in storage.');
    process.exit(0);
}

console.log(`Total mails in storage: ${stored.length}`);
console.log();

// Display each mail
stored.forEach((mail, index) => {
    console.log(`Mail #${index + 1}`);
    console.log('-'.repeat(80));
    console.log(`  MID:         ${mail.mid || 'N/A'}`);
    console.log(`  From:        ${mail.from || 'N/A'}`);
    console.log(`  To:          ${mail.to || 'N/A'}`);
    if (mail.cc) {
        console.log(`  CC:          ${mail.cc}`);
    }
    console.log(`  Subject:     ${mail.subject || '(no subject)'}`);
    console.log(`  Date:        ${mail.dateTime || 'N/A'}`);
    console.log(`  Mailbox:     ${MAILBOX_NAMES[mail.mailbox] || mail.mailbox} (${mail.mailbox})`);
    console.log(`  Flags:       ${mail.flags || 0} (${formatFlags(mail.flags)})`);
    
    if (mail.mbo) {
        console.log(`  MBO:         ${mail.mbo}`);
    }
    
    if (mail.location) {
        console.log(`  Location:    ${mail.location}`);
    }
    
    if (mail.attachments && mail.attachments.length > 0) {
        console.log(`  Attachments: ${mail.attachments.length} file(s)`);
        mail.attachments.forEach((att, i) => {
            const size = att.data ? Buffer.from(att.data, 'base64').length : 0;
            console.log(`    ${i + 1}. ${att.name} (${formatBytes(size)})`);
        });
    }
    
    // Show first 200 chars of body
    if (mail.body) {
        const bodyPreview = mail.body.length > 200 ? mail.body.substring(0, 200) + '...' : mail.body;
        console.log(`  Body:        ${bodyPreview.replace(/\n/g, '\n               ')}`);
    }
    
    console.log();
});

console.log('='.repeat(80));
console.log(`Total: ${stored.length} mail(s)`);
console.log('='.repeat(80));

// Close storage
storage.close();

/**
 * Format flags to human-readable string
 */
function formatFlags(flags) {
    if (!flags) return 'None';
    
    const flagNames = [];
    if (flags & 1) flagNames.push('Unread');
    if (flags & 2) flagNames.push('Private');
    if (flags & 4) flagNames.push('P2P');
    
    return flagNames.length > 0 ? flagNames.join(', ') : 'None';
}

/**
 * Format bytes to human-readable size
 */
function formatBytes(bytes) {
    if (bytes === 0) return '0 Bytes';
    
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}
