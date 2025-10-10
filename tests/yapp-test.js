#!/usr/bin/env node
'use strict';

/**
 * YAPP Protocol Test
 * 
 * This test simulates a file download from the BBS using the YAPP protocol.
 * It creates a mock AX25 session and tests downloading README.txt from pubfiles.
 */

const EventEmitter = require('events');
const fs = require('fs');
const path = require('path');
const YappTransfer = require('../src/yapp');

// Mock AX25 Session for testing
class MockAX25Session extends EventEmitter {
    constructor() {
        super();
        this.currentState = MockAX25Session.ConnectionState.CONNECTED;
        this.sentPackets = [];
        this.mockRemoteSide = null; // Will be set to the "server" YAPP instance
    }
    
    static get ConnectionState() {
        return {
            DISCONNECTED: 0,
            CONNECTING: 1,
            CONNECTED: 2,
            DISCONNECTING: 3
        };
    }
    
    send(data, immediate = false) {
        console.log(`[Mock Session] Sending ${data.length} bytes (immediate: ${immediate})`);
        this.sentPackets.push(data);
        
        // Simulate sending to remote side
        if (this.mockRemoteSide) {
            // Simulate network delay
            setTimeout(() => {
                this.mockRemoteSide.emit('dataReceived', data);
            }, 10);
        }
        
        return true;
    }
    
    disconnect() {
        console.log('[Mock Session] Disconnecting');
        this.currentState = MockAX25Session.ConnectionState.DISCONNECTED;
        this.emit('disconnected');
    }
    
    // Simulate receiving data from remote
    simulateReceive(data) {
        this.emit('dataReceived', data);
    }
}

// Test function
async function testYappDownload() {
    console.log('=== YAPP Download Test ===\n');
    
    // Create mock sessions for client and server
    const clientSession = new MockAX25Session();
    const serverSession = new MockAX25Session();
    
    // Cross-connect the sessions
    clientSession.mockRemoteSide = serverSession;
    serverSession.mockRemoteSide = clientSession;
    
    // Create YAPP instances
    const clientYapp = new YappTransfer(clientSession, {
        maxRetries: 3,
        timeout: 30000,
        blockSize: 128,
        useChecksum: true,
        enableResume: false
    });
    
    const serverYapp = new YappTransfer(serverSession, {
        maxRetries: 3,
        timeout: 30000,
        blockSize: 128,
        useChecksum: true,
        enableResume: false
    });
    
    // Track test results
    let clientCompleted = false;
    let serverCompleted = false;
    let downloadedFile = null;
    
    // Set up client event handlers
    clientYapp.on('transferStarted', (info) => {
        console.log(`[Client] Transfer started: ${info.mode}`);
    });
    
    clientYapp.on('transferProgress', (progress) => {
        console.log(`[Client] Progress: ${progress.percentage}% (${progress.bytesTransferred}/${progress.fileSize} bytes)`);
    });
    
    clientYapp.on('fileCompleted', (info) => {
        console.log(`[Client] File completed: ${info.filename} (${info.bytesTransferred} bytes)`);
        downloadedFile = path.join('./tests', info.filename);
    });
    
    clientYapp.on('transferCompleted', (stats) => {
        console.log(`[Client] Transfer completed!`);
        console.log(`  Filename: ${stats.filename}`);
        console.log(`  Size: ${stats.fileSize} bytes`);
        console.log(`  Transferred: ${stats.bytesTransferred} bytes`);
        console.log(`  Time: ${stats.elapsedTime.toFixed(2)}s`);
        console.log(`  Checksum: ${stats.useChecksum ? 'Yes' : 'No'}`);
        clientCompleted = true;
        checkTestCompletion();
    });
    
    clientYapp.on('transferCancelled', (info) => {
        console.error(`[Client] Transfer cancelled: ${info.reason}`);
        process.exit(1);
    });
    
    clientYapp.on('transferAborted', (info) => {
        console.error(`[Client] Transfer aborted: ${info.reason}`);
        process.exit(1);
    });
    
    // Set up server event handlers
    serverYapp.on('transferStarted', (info) => {
        console.log(`[Server] Transfer started: ${info.mode}`);
        if (info.filename) {
            console.log(`  Filename: ${info.filename}`);
            console.log(`  Size: ${info.fileSize} bytes`);
        }
    });
    
    serverYapp.on('transferProgress', (progress) => {
        console.log(`[Server] Progress: ${progress.percentage}% (${progress.bytesTransferred}/${progress.fileSize} bytes)`);
    });
    
    serverYapp.on('transferCompleted', (stats) => {
        console.log(`[Server] Transfer completed!`);
        console.log(`  Filename: ${stats.filename}`);
        console.log(`  Size: ${stats.fileSize} bytes`);
        console.log(`  Transferred: ${stats.bytesTransferred} bytes`);
        console.log(`  Time: ${stats.elapsedTime.toFixed(2)}s`);
        serverCompleted = true;
        checkTestCompletion();
    });
    
    serverYapp.on('transferCancelled', (info) => {
        console.error(`[Server] Transfer cancelled: ${info.reason}`);
        process.exit(1);
    });
    
    serverYapp.on('transferAborted', (info) => {
        console.error(`[Server] Transfer aborted: ${info.reason}`);
        process.exit(1);
    });
    
    // Function to check if test is complete
    function checkTestCompletion() {
        if (clientCompleted && serverCompleted) {
            console.log('\n=== Test Results ===');
            
            // Verify the downloaded file
            if (downloadedFile && fs.existsSync(downloadedFile)) {
                const originalFile = './pubfiles/documents/htstation-manual.txt';
                const originalContent = fs.readFileSync(originalFile);
                const downloadedContent = fs.readFileSync(downloadedFile);
                
                console.log(`Original file size: ${originalContent.length} bytes`);
                console.log(`Downloaded file size: ${downloadedContent.length} bytes`);
                
                if (Buffer.compare(originalContent, downloadedContent) === 0) {
                    console.log('✓ File integrity verified - contents match!');
                    console.log('\n=== Test PASSED ===\n');
                    
                    // Clean up downloaded file
                    fs.unlinkSync(downloadedFile);
                    console.log('Cleaned up test file.');
                    
                    process.exit(0);
                } else {
                    console.error('✗ File integrity check FAILED - contents do not match!');
                    console.error('Performing detailed comparison...');
                    
                    // Show byte-by-byte comparison for first difference
                    for (let i = 0; i < Math.max(originalContent.length, downloadedContent.length); i++) {
                        if (originalContent[i] !== downloadedContent[i]) {
                            console.error(`First difference at byte ${i}:`);
                            console.error(`  Original: 0x${originalContent[i]?.toString(16).padStart(2, '0') || 'EOF'}`);
                            console.error(`  Downloaded: 0x${downloadedContent[i]?.toString(16).padStart(2, '0') || 'EOF'}`);
                            break;
                        }
                    }
                    
                    console.log('\n=== Test FAILED ===\n');
                    process.exit(1);
                }
            } else {
                console.error('✗ Downloaded file not found!');
                console.log('\n=== Test FAILED ===\n');
                process.exit(1);
            }
        }
    }
    
    // Start the test
    console.log('Starting YAPP file transfer test...\n');
    
    // Server starts sending the file
    const testFilePath = './pubfiles/documents/htstation-manual.txt';
    
    if (!fs.existsSync(testFilePath)) {
        console.error(`Error: Test file not found: ${testFilePath}`);
        process.exit(1);
    }
    
    console.log(`Test file: ${testFilePath}`);
    console.log(`File size: ${fs.statSync(testFilePath).size} bytes\n`);
    
    // Client prepares to receive
    clientYapp.startReceive('./tests');
    
    // Server starts sending after a short delay
    setTimeout(() => {
        serverYapp.startSend(testFilePath, 'htstation-manual.txt');
    }, 100);
}

// Run the test
console.log('YAPP Protocol Test Suite');
console.log('========================\n');

// Ensure tests directory exists
if (!fs.existsSync('./tests')) {
    fs.mkdirSync('./tests', { recursive: true });
}

testYappDownload().catch((error) => {
    console.error('Test error:', error);
    process.exit(1);
});
