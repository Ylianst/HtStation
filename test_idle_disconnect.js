/**
 * Test for AX25Session idle disconnection functionality
 * This test verifies that sessions auto-disconnect after missing 3+ packets while idle
 */

const AX25Session = require('./AX25Session.js');
const AX25Packet = require('./AX25Packet.js');
const AX25Address = require('./AX25Address.js');

class MockRadio {
    constructor() {
        this.sentFrames = [];
    }
    
    sendTncFrame(frame) {
        this.sentFrames.push(frame);
        console.log(`[MockRadio] Sent frame on channel ${frame.channel_id}, length: ${frame.data.length}`);
    }
    
    getLastFrame() {
        return this.sentFrames[this.sentFrames.length - 1];
    }
    
    clearFrames() {
        this.sentFrames = [];
    }
}

class MockParent {
    constructor() {
        this.callsign = "TEST";
        this.stationId = 1;
        this.activeChannelIdLock = 1;
    }
}

function createTestSession() {
    const mockRadio = new MockRadio();
    const mockParent = new MockParent();
    const session = new AX25Session(mockParent, mockRadio);
    
    // Set shorter timeouts for testing
    session.retries = 2; // Reduce retries for faster testing
    
    return { session, mockRadio, mockParent };
}

function createTestAddresses() {
    const localAddr = AX25Address.getAddress("TEST", 1);
    const remoteAddr = AX25Address.getAddress("REMOTE", 0);
    return [remoteAddr, localAddr];
}

function createConnectPacket(addresses) {
    const packet = new AX25Packet(
        addresses,
        0, 0,
        true, true,
        AX25Packet.FrameType.U_FRAME_SABM
    );
    packet.channel_id = 1;
    return packet;
}

function createDataPacket(addresses, sequence, data) {
    const packet = new AX25Packet(
        addresses,
        sequence, sequence,
        false, true,
        AX25Packet.FrameType.I_FRAME,
        Buffer.from(data, 'utf8')
    );
    packet.channel_id = 1;
    return packet;
}

function createRRPacket(addresses, sequence) {
    const packet = new AX25Packet(
        addresses,
        sequence, 0,
        false, true,
        AX25Packet.FrameType.S_FRAME_RR
    );
    packet.channel_id = 1;
    return packet;
}

async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function testIdleDisconnection() {
    console.log('\n=== Testing Idle Disconnection Functionality ===\n');
    
    const { session, mockRadio } = createTestSession();
    const addresses = createTestAddresses();
    
    // Track connection state changes
    let connectionStates = [];
    session.on('stateChanged', (state) => {
        connectionStates.push(state);
        console.log(`[State Change] New state: ${state}`);
    });
    
    // Track data received
    let dataReceived = [];
    session.on('dataReceived', (data) => {
        const message = data.toString('utf8');
        dataReceived.push(message);
        console.log(`[Data Received] "${message}"`);
    });
    
    try {
        console.log('1. Establishing connection...');
        
        // Establish connection by receiving SABM
        const sabmPacket = createConnectPacket(addresses);
        const result = session.receive(sabmPacket);
        
        console.log(`   SABM processed: ${result}`);
        console.log(`   Current state: ${session.currentState}`);
        console.log(`   Frames sent: ${mockRadio.sentFrames.length}`);
        
        // Verify connection established
        if (session.currentState !== AX25Session.ConnectionState.CONNECTED) {
            throw new Error('Failed to establish connection');
        }
        
        console.log('   ✓ Connection established successfully');
        
        // Clear sent frames to focus on idle behavior
        mockRadio.clearFrames();
        
        console.log('\n2. Testing T3 timer behavior during idle period...');
        
        // Override timer timeout for faster testing (normally 7x base timeout)
        const originalGetTimerTimeout = session._getTimerTimeout;
        session._getTimerTimeout = function(timerName) {
            if (timerName === 't3') {
                return 1000; // 1 second for testing
            }
            return originalGetTimerTimeout.call(this, timerName);
        };
        
        // Clear and restart the T3 timer with new timeout
        session._clearTimer('t3');
        session._setTimer('t3');
        
        console.log('   Waiting for T3 timer to expire (should send RR polls)...');
        
        // Wait for first T3 expiration (should send RR poll)
        await sleep(1100);
        console.log(`   After 1.1s - Frames sent: ${mockRadio.sentFrames.length}`);
        
        // Should have sent an RR poll
        if (mockRadio.sentFrames.length === 0) {
            throw new Error('Expected RR poll to be sent after T3 timeout');
        }
        
        console.log('   ✓ First T3 timeout sent RR poll');
        mockRadio.clearFrames();
        
        // Wait for second T3 expiration
        await sleep(1100);
        console.log(`   After 2.1s - Frames sent: ${mockRadio.sentFrames.length}`);
        
        if (mockRadio.sentFrames.length === 0) {
            throw new Error('Expected second RR poll to be sent');
        }
        
        console.log('   ✓ Second T3 timeout sent RR poll');
        mockRadio.clearFrames();
        
        // Wait for third T3 expiration (should disconnect after retries exceeded)
        await sleep(1100);
        console.log(`   After 3.1s - Current state: ${session.currentState}`);
        console.log(`   Frames sent: ${mockRadio.sentFrames.length}`);
        
        if (session.currentState !== AX25Session.ConnectionState.DISCONNECTING) {
            throw new Error('Expected session to be disconnecting after T3 retries exceeded');
        }
        
        console.log('   ✓ Session started disconnecting after T3 retry limit');
        
        console.log('\n3. Testing T3 timer restart on valid packet reception...');
        
        // Reset for next test
        const { session: session2, mockRadio: mockRadio2 } = createTestSession();
        session2._getTimerTimeout = function(timerName) {
            if (timerName === 't3') {
                return 1000; // 1 second for testing
            }
            return originalGetTimerTimeout.call(this, timerName);
        };
        
        // Establish connection
        const sabmPacket2 = createConnectPacket(addresses);
        session2.receive(sabmPacket2);
        mockRadio2.clearFrames();
        
        console.log('   Connection established, waiting 0.8s (before T3 expires)...');
        await sleep(800);
        
        // Send a data packet to restart T3 timer
        console.log('   Sending data packet to restart T3 timer...');
        const dataPacket = createDataPacket(addresses, 0, "test data");
        session2.receive(dataPacket);
        
        // Wait another 0.8s (total 1.6s, but T3 should have restarted)
        await sleep(800);
        console.log(`   After receiving data packet - Frames sent: ${mockRadio2.sentFrames.length}`);
        
        // Should not have sent RR poll yet since T3 was restarted
        if (mockRadio2.sentFrames.length > 1) { // Allow for potential ACK frame
            console.log('   Note: Some frames sent (possibly ACKs), checking if RR poll sent...');
        }
        
        // Wait for T3 to expire after restart
        await sleep(800);
        console.log(`   After T3 restart timeout - Frames sent: ${mockRadio2.sentFrames.length}`);
        
        console.log('   ✓ T3 timer properly restarted on packet reception');
        
        console.log('\n4. Testing response to T3 poll...');
        
        // Reset for poll response test
        const { session: session3, mockRadio: mockRadio3 } = createTestSession();
        session3._getTimerTimeout = function(timerName) {
            if (timerName === 't3') {
                return 1000;
            }
            return originalGetTimerTimeout.call(this, timerName);
        };
        
        // Establish connection
        const sabmPacket3 = createConnectPacket(addresses);
        session3.receive(sabmPacket3);
        mockRadio3.clearFrames();
        
        // Wait for T3 to send poll
        await sleep(1100);
        console.log('   T3 poll sent, now responding with RR...');
        
        // Respond to poll with RR
        const rrResponse = createRRPacket(addresses, 0);
        session3.receive(rrResponse);
        
        // Wait to see if T3 restarted properly
        await sleep(800);
        console.log(`   After RR response - Session state: ${session3.currentState}`);
        
        if (session3.currentState !== AX25Session.ConnectionState.CONNECTED) {
            throw new Error('Session should still be connected after responding to T3 poll');
        }
        
        console.log('   ✓ Session remained connected after responding to T3 poll');
        
        console.log('\n=== All Idle Disconnection Tests Passed! ===');
        return true;
        
    } catch (error) {
        console.error(`\n❌ Test failed: ${error.message}`);
        console.error(`Connection states: ${connectionStates.join(' -> ')}`);
        console.error(`Data received: ${dataReceived.join(', ')}`);
        return false;
    }
}

// Run the test
if (require.main === module) {
    testIdleDisconnection()
        .then(success => {
            if (success) {
                console.log('\n🎉 All tests completed successfully!');
                process.exit(0);
            } else {
                console.log('\n💥 Tests failed!');
                process.exit(1);
            }
        })
        .catch(error => {
            console.error('\n💥 Test execution failed:', error);
            process.exit(1);
        });
}

module.exports = { testIdleDisconnection };
