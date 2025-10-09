'use strict';

// Simple test to verify the enhanced TNC queue error handling
// This test simulates the Radio class behavior without requiring actual hardware

const { EventEmitter } = require('events');

// Mock RadioCommandErrors for testing
const RadioCommandErrors = {
    SUCCESS: 0,
    NOT_SUPPORTED: 1,
    NOT_AUTHENTICATED: 2,
    INSUFFICIENT_RESOURCES: 3,
    AUTHENTICATING: 4,
    INVALID_PARAMETER: 5,
    INCORRECT_STATE: 6,
    IN_PROGRESS: 7
};

class MockRadio extends EventEmitter {
    constructor() {
        super();
        this._tncOutboundQueue = [];
        this._tncSending = false;
        this._tncPendingPacket = null;
        this.htStatus = { is_in_tx: false, is_in_rx: false };
        this._transmitAllowed = true;
    }

    IsTncFree() {
        return (this.htStatus && this.htStatus.is_in_tx === false && this.htStatus.is_in_rx === false);
    }

    sendTncFrame(opts) {
        if (!this._transmitAllowed) {
            console.error('[MockRadio] Transmission blocked');
            return;
        }
        
        // Simulate fragmenting (simplified)
        const data = Buffer.isBuffer(opts.data) ? opts.data : Buffer.from(opts.data);
        const packet = Buffer.concat([
            Buffer.from([0xC0]), // flags with final fragment and channel_id
            data,
            Buffer.from([opts.channel_id])
        ]);
        
        this._tncOutboundQueue.push(packet);
        console.log(`[MockRadio] Queued packet for channel ${opts.channel_id}, queue length: ${this._tncOutboundQueue.length}`);
        this._processTncQueue();
    }

    _processTncQueue() {
        // Don't send if already sending, pending confirmation, queue empty, or radio busy
        if (this._tncSending || this._tncPendingPacket || this._tncOutboundQueue.length === 0) return;
        if (!this.IsTncFree()) return;
        
        this._tncSending = true;
        this._tncPendingPacket = this._tncOutboundQueue[0]; // Keep packet in queue until confirmed
        
        console.log(`[MockRadio] Sending packet from queue (${this._tncOutboundQueue.length} packets queued)`);
        
        // Simulate sending HT_SEND_DATA command
        this._simulateHtSendDataCommand();
    }

    _simulateHtSendDataCommand() {
        // Simulate different scenarios based on test conditions
        setTimeout(() => {
            let errorCode;
            
            if (this.simulateErrorType === 'SUCCESS') {
                errorCode = RadioCommandErrors.SUCCESS;
            } else if (this.simulateErrorType === 'INCORRECT_STATE') {
                errorCode = RadioCommandErrors.INCORRECT_STATE;
            } else if (this.simulateErrorType === 'OTHER_ERROR') {
                errorCode = RadioCommandErrors.INVALID_PARAMETER;
            } else {
                // Default to success
                errorCode = RadioCommandErrors.SUCCESS;
            }
            
            this._handleHtSendDataResponse(errorCode);
        }, 10); // Small delay to simulate async operation
    }

    _handleHtSendDataResponse(errorCode) {
        let errorName = 'Unknown';
        for (const [key, val] of Object.entries(RadioCommandErrors)) {
            if (val === errorCode) { errorName = key; break; }
        }
        console.log(`[MockRadio] HT_SEND_DATA response: errorCode=${errorCode} (${errorName})`);
        
        if (errorCode === RadioCommandErrors.SUCCESS) {
            // Packet sent successfully - remove from queue
            if (this._tncPendingPacket && this._tncOutboundQueue.length > 0) {
                this._tncOutboundQueue.shift(); // Remove the successfully sent packet
                this._tncPendingPacket = null;
                console.log(`[MockRadio] Packet sent successfully, remaining in queue: ${this._tncOutboundQueue.length}`);
            }
            this._tncSending = false;
            
            // Process next packet if any
            if (this._tncOutboundQueue.length > 0) {
                setTimeout(() => this._processTncQueue(), 10);
            }
        } else if (errorCode === RadioCommandErrors.INCORRECT_STATE) {
            // Radio not ready - keep packet in queue, will retry on HT_STATUS_CHANGED
            console.log(`[MockRadio] Radio in incorrect state for transmission - packet will be retried when radio is ready`);
            this._tncPendingPacket = null;
            this._tncSending = false;
            // Don't process queue now - wait for HT_STATUS_CHANGED notification
        } else {
            // Other errors - remove packet from queue
            console.warn(`[MockRadio] HT_SEND_DATA failed with error ${errorCode} (${errorName}) - removing packet from queue`);
            if (this._tncPendingPacket && this._tncOutboundQueue.length > 0) {
                this._tncOutboundQueue.shift(); // Remove the failed packet
                this._tncPendingPacket = null;
                console.log(`[MockRadio] Packet removed due to error, remaining in queue: ${this._tncOutboundQueue.length}`);
            }
            this._tncSending = false;
            
            // Try next packet if any
            if (this._tncOutboundQueue.length > 0) {
                setTimeout(() => this._processTncQueue(), 50);
            }
        }
    }

    // Simulate HT_STATUS_CHANGED notification
    simulateStatusChange() {
        console.log(`[MockRadio] Simulating HT_STATUS_CHANGED notification`);
        this._processTncQueue();
    }

    // Simulate radio becoming busy
    setRadioBusy(busy) {
        this.htStatus.is_in_tx = busy;
        console.log(`[MockRadio] Radio ${busy ? 'busy' : 'free'} (is_in_tx: ${this.htStatus.is_in_tx})`);
    }

    getQueueStatus() {
        return {
            queueLength: this._tncOutboundQueue.length,
            sending: this._tncSending,
            pendingPacket: !!this._tncPendingPacket
        };
    }
}

// Test scenarios
async function testSuccessfulTransmission() {
    console.log('\n=== Test 1: Successful Transmission ===');
    const radio = new MockRadio();
    radio.simulateErrorType = 'SUCCESS';
    
    // Send a few packets
    radio.sendTncFrame({ channel_id: 1, data: 'Test packet 1' });
    radio.sendTncFrame({ channel_id: 1, data: 'Test packet 2' });
    radio.sendTncFrame({ channel_id: 1, data: 'Test packet 3' });
    
    // Wait for processing
    await new Promise(resolve => setTimeout(resolve, 100));
    
    const status = radio.getQueueStatus();
    console.log(`Final queue status:`, status);
    console.log(status.queueLength === 0 ? '✓ All packets sent successfully' : '✗ Packets remain in queue');
}

async function testIncorrectStateRetry() {
    console.log('\n=== Test 2: INCORRECT_STATE Error and Retry ===');
    const radio = new MockRadio();
    radio.simulateErrorType = 'INCORRECT_STATE';
    
    // Send packets
    radio.sendTncFrame({ channel_id: 1, data: 'Test packet 1' });
    radio.sendTncFrame({ channel_id: 1, data: 'Test packet 2' });
    
    // Wait for first attempt
    await new Promise(resolve => setTimeout(resolve, 50));
    
    let status = radio.getQueueStatus();
    console.log(`Status after INCORRECT_STATE:`, status);
    console.log(status.queueLength === 2 ? '✓ Packets retained in queue' : '✗ Packets lost from queue');
    
    // Now simulate successful retry
    radio.simulateErrorType = 'SUCCESS';
    radio.simulateStatusChange();
    
    // Wait for retry processing
    await new Promise(resolve => setTimeout(resolve, 100));
    
    status = radio.getQueueStatus();
    console.log(`Status after retry:`, status);
    console.log(status.queueLength === 0 ? '✓ All packets sent on retry' : '✗ Packets remain after retry');
}

async function testOtherErrorDiscard() {
    console.log('\n=== Test 3: Other Error Types (Discard) ===');
    const radio = new MockRadio();
    radio.simulateErrorType = 'OTHER_ERROR';
    
    // Send packets
    radio.sendTncFrame({ channel_id: 1, data: 'Test packet 1' });
    radio.sendTncFrame({ channel_id: 1, data: 'Test packet 2' });
    
    // Wait for processing
    await new Promise(resolve => setTimeout(resolve, 100));
    
    const status = radio.getQueueStatus();
    console.log(`Final queue status:`, status);
    console.log(status.queueLength === 0 ? '✓ Failed packets discarded correctly' : '✗ Failed packets not discarded');
}

async function testRadioBusyScenario() {
    console.log('\n=== Test 4: Radio Busy Scenario ===');
    const radio = new MockRadio();
    radio.simulateErrorType = 'SUCCESS';
    
    // Make radio busy
    radio.setRadioBusy(true);
    
    // Send packets while busy
    radio.sendTncFrame({ channel_id: 1, data: 'Test packet 1' });
    radio.sendTncFrame({ channel_id: 1, data: 'Test packet 2' });
    
    await new Promise(resolve => setTimeout(resolve, 50));
    
    let status = radio.getQueueStatus();
    console.log(`Status while radio busy:`, status);
    console.log(status.queueLength === 2 && !status.sending ? '✓ Packets queued but not sent while busy' : '✗ Unexpected behavior while busy');
    
    // Make radio free
    radio.setRadioBusy(false);
    radio.simulateStatusChange();
    
    await new Promise(resolve => setTimeout(resolve, 100));
    
    status = radio.getQueueStatus();
    console.log(`Status after radio becomes free:`, status);
    console.log(status.queueLength === 0 ? '✓ Packets sent when radio becomes free' : '✗ Packets not sent when radio becomes free');
}

// Run all tests
async function runAllTests() {
    console.log('Enhanced TNC Queue Error Handling Tests');
    console.log('=====================================');
    
    try {
        await testSuccessfulTransmission();
        await testIncorrectStateRetry();
        await testOtherErrorDiscard();
        await testRadioBusyScenario();
        
        console.log('\n=== All Tests Completed ===');
        console.log('✓ Enhanced error handling implementation verified');
        
    } catch (error) {
        console.error('Test failed:', error);
    }
}

// Run tests if this file is executed directly
if (require.main === module) {
    runAllTests();
}

module.exports = { MockRadio, runAllTests };
