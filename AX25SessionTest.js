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

const EventEmitter = require('events');
const AX25Session = require('./AX25Session.js');
const AX25Address = require('./AX25Address.js');
const AX25Packet = require('./AX25Packet.js');

class DirectFrameRouter {
    constructor() {
        this.sessionA = null;
        this.sessionB = null;
    }

    setSessionA(session) {
        this.sessionA = session;
    }

    setSessionB(session) {
        this.sessionB = session;
    }

    routeFromA(frame) {
        if (this.sessionB) {
            // Route TNC frame directly from A to B
            setTimeout(() => {
                const packet = AX25Packet.decodeAX25Packet(frame);
                if (packet) {
                    this.sessionB.receive(packet);
                }
            }, 1); // Minimal delay to simulate transmission
        }
    }

    routeFromB(frame) {
        if (this.sessionA) {
            // Route TNC frame directly from B to A
            setTimeout(() => {
                const packet = AX25Packet.decodeAX25Packet(frame);
                if (packet) {
                    this.sessionA.receive(packet);
                }
            }, 1); // Minimal delay to simulate transmission
        }
    }
}

class MockRadio extends EventEmitter {
    constructor(name, router, isSessionA = true) {
        super();
        this.name = name;
        this.router = router;
        this.isSessionA = isSessionA;
    }

    sendTncFrame(frame) {
        if (!this.router) return;

        // Route frame directly to the other session
        if (this.isSessionA) {
            this.router.routeFromA(frame);
        } else {
            this.router.routeFromB(frame);
        }
    }
}

class MockParent {
    constructor(callsign, stationId) {
        this.callsign = callsign;
        this.stationId = stationId;
        this.activeChannelIdLock = 1;
    }
}

class AX25SessionTest {
    constructor() {
        this.testResults = [];
        this.currentTest = null;
        this.startTime = null;
    }

    log(message, direction = '', timestamp = true) {
        const time = timestamp ? new Date().toISOString().substr(11, 12) : '';
        const directionStr = direction ? ` ${direction} ` : ' ';
        console.log(`${time}${directionStr}${message}`);
    }

    logTraffic(from, to, packetType, data = '', extraInfo = '') {
        const direction = from === 'A' ? '-->' : '<--';
        const timestamp = new Date().toISOString().substr(11, 12);
        const dataStr = data ? ` [${data.length} bytes]` : '';
        const extra = extraInfo ? ` (${extraInfo})` : '';
        console.log(`${timestamp} ${from} ${direction} ${to}: ${packetType}${dataStr}${extra}`);
    }

    async delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    createTestSessions() {
        // Create direct frame router
        const router = new DirectFrameRouter();

        // Create mock radios with direct routing
        const radioA = new MockRadio('Radio-A', router, true);  // A is initiator
        const radioB = new MockRadio('Radio-B', router, false); // B is receiver

        // Create mock parents
        const parentA = new MockParent('TEST1', 1);
        const parentB = new MockParent('TEST2', 2);

        // Create AX25 sessions
        const sessionA = new AX25Session(parentA, radioA);
        const sessionB = new AX25Session(parentB, radioB);

        // Configure router with sessions
        router.setSessionA(sessionA);
        router.setSessionB(sessionB);

        // Enable tracing for debugging
        sessionA.tracing = true;
        sessionB.tracing = true;

        // Set up traffic monitoring by intercepting the router methods
        const originalRouteFromA = router.routeFromA.bind(router);
        const originalRouteFromB = router.routeFromB.bind(router);

        router.routeFromA = (frame) => {
            const packet = AX25Packet.decodeAX25Packet(frame);
            if (packet) {
                this.logTraffic('A', 'B', this.getPacketTypeString(packet.type), packet.data, this.getPacketInfo(packet));
            }
            originalRouteFromA(frame);
        };

        router.routeFromB = (frame) => {
            const packet = AX25Packet.decodeAX25Packet(frame);
            if (packet) {
                this.logTraffic('B', 'A', this.getPacketTypeString(packet.type), packet.data, this.getPacketInfo(packet));
            }
            originalRouteFromB(frame);
        };

        // Set up Session B to automatically echo back data received from A
        sessionB.on('dataReceived', (data) => {
            // Echo the data back to A after a small delay
            setTimeout(() => {
                this.log(`🔄 Session B echoing back ${data.length} bytes to A`);
                sessionB.send(data);
            }, 10);
        });

        return { sessionA, sessionB, radioA, radioB, router };
    }

    getPacketTypeString(type) {
        const types = {
            [AX25Packet.FrameType.I_FRAME]: 'I-FRAME',
            [AX25Packet.FrameType.S_FRAME_RR]: 'RR',
            [AX25Packet.FrameType.S_FRAME_RNR]: 'RNR',
            [AX25Packet.FrameType.S_FRAME_REJ]: 'REJ',
            [AX25Packet.FrameType.S_FRAME_SREJ]: 'SREJ',
            [AX25Packet.FrameType.U_FRAME_SABM]: 'SABM',
            [AX25Packet.FrameType.U_FRAME_SABME]: 'SABME',
            [AX25Packet.FrameType.U_FRAME_DISC]: 'DISC',
            [AX25Packet.FrameType.U_FRAME_DM]: 'DM',
            [AX25Packet.FrameType.U_FRAME_UA]: 'UA',
            [AX25Packet.FrameType.U_FRAME_UI]: 'UI',
            [AX25Packet.FrameType.U_FRAME_FRMR]: 'FRMR',
            [AX25Packet.FrameType.U_FRAME_XID]: 'XID',
            [AX25Packet.FrameType.U_FRAME_TEST]: 'TEST'
        };
        return types[type] || `UNKNOWN(${type})`;
    }

    getPacketInfo(packet) {
        let info = '';
        if (packet.nr !== undefined && packet.nr !== null) {
            info += `NR=${packet.nr}`;
        }
        if (packet.ns !== undefined && packet.ns !== null) {
            info += info ? `, NS=${packet.ns}` : `NS=${packet.ns}`;
        }
        if (packet.pollFinal) {
            info += info ? ', P/F' : 'P/F';
        }
        return info;
    }

    createSequenceData(sequenceId, length = 32) {
        // Create verifiable sequence data
        const data = Buffer.alloc(length);
        const header = `SEQ${sequenceId.toString().padStart(3, '0')}:`;
        Buffer.from(header).copy(data, 0);
        
        // Fill with predictable pattern
        for (let i = header.length; i < length; i++) {
            data[i] = (sequenceId + i) % 256;
        }
        
        return data;
    }

    verifySequenceData(receivedData, expectedSequenceId) {
        if (!receivedData || receivedData.length < 7) return false;
        
        const header = receivedData.toString('utf8', 0, 7);
        const expectedHeader = `SEQ${expectedSequenceId.toString().padStart(3, '0')}:`;
        
        if (header !== expectedHeader) {
            return false;
        }
        
        // Verify the pattern
        for (let i = 7; i < receivedData.length; i++) {
            const expected = (expectedSequenceId + i) % 256;
            if (receivedData[i] !== expected) {
                return false;
            }
        }
        
        return true;
    }

    async testBasicConnection() {
        this.log('🧪 Testing: Basic Connection Establishment', '===');
        
        const { sessionA, sessionB } = this.createTestSessions();
        let testPassed = false;
        
        return new Promise((resolve) => {
            const timeout = setTimeout(() => {
                this.log('❌ Test failed: Connection timeout');
                resolve(false);
            }, 5000);
            
            sessionA.on('stateChanged', (state) => {
                this.log(`Session A state: ${this.getStateString(state)}`);
                if (state === AX25Session.ConnectionState.CONNECTED) {
                    this.log('✅ Test passed: Connection established');
                    testPassed = true;
                    clearTimeout(timeout);
                    resolve(true);
                }
            });
            
            sessionB.on('stateChanged', (state) => {
                this.log(`Session B state: ${this.getStateString(state)}`);
            });
            
            // Create addresses for connection
            const addrA = AX25Address.getAddress('TEST1', 1);
            const addrB = AX25Address.getAddress('TEST2', 2);
            const addresses = [addrB, addrA]; // [destination, source]
            
            this.log('Initiating connection from A to B...');
            sessionA.connect(addresses);
        });
    }

    async testDataTransmission() {
        this.log('🧪 Testing: Data Transmission and Verification', '===');
        
        const { sessionA, sessionB } = this.createTestSessions();
        const receivedData = [];
        const sentSequences = [];
        const numPackets = 5;
        
        return new Promise((resolve) => {
            const timeout = setTimeout(() => {
                this.log('❌ Test failed: Data transmission timeout');
                resolve(false);
            }, 10000);
            
            sessionB.on('dataReceived', (data) => {
                receivedData.push(data);
                this.log(`📥 Session B received data: ${data.length} bytes`);
                
                // Try to verify the sequence
                for (let i = 0; i < sentSequences.length; i++) {
                    if (this.verifySequenceData(data, sentSequences[i])) {
                        this.log(`✅ Verified sequence ${sentSequences[i]}`);
                        sentSequences.splice(i, 1);
                        break;
                    }
                }
                
                if (sentSequences.length === 0) {
                    this.log('✅ Test passed: All data received and verified');
                    clearTimeout(timeout);
                    resolve(true);
                }
            });
            
            sessionA.on('stateChanged', (state) => {
                if (state === AX25Session.ConnectionState.CONNECTED) {
                    this.log('Connected! Starting data transmission...');
                    
                    // Send multiple packets with sequence verification
                    for (let i = 1; i <= numPackets; i++) {
                        const sequenceData = this.createSequenceData(i, 64);
                        sentSequences.push(i);
                        this.log(`📤 Session A sending sequence ${i}`);
                        sessionA.send(sequenceData);
                    }
                }
            });
            
            // Establish connection
            const addrA = AX25Address.getAddress('TEST1', 1);
            const addrB = AX25Address.getAddress('TEST2', 2);
            const addresses = [addrB, addrA];
            
            sessionA.connect(addresses);
        });
    }

    async testBidirectionalTraffic() {
        this.log('🧪 Testing: Bidirectional Traffic', '===');
        
        const { sessionA, sessionB } = this.createTestSessions();
        const receivedA = [];
        const receivedB = [];
        const sentFromA = [];
        const sentFromB = [];
        
        return new Promise((resolve) => {
            const timeout = setTimeout(() => {
                this.log('❌ Test failed: Bidirectional traffic timeout');
                resolve(false);
            }, 15000);
            
            sessionA.on('dataReceived', (data) => {
                receivedA.push(data);
                this.log(`📥 Session A received: ${data.length} bytes`);
                
                // Verify data from B
                for (let i = 0; i < sentFromB.length; i++) {
                    if (this.verifySequenceData(data, sentFromB[i])) {
                        this.log(`✅ A verified sequence ${sentFromB[i]} from B`);
                        sentFromB.splice(i, 1);
                        break;
                    }
                }
                
                this.checkBidirectionalComplete();
            });
            
            sessionB.on('dataReceived', (data) => {
                receivedB.push(data);
                this.log(`📥 Session B received: ${data.length} bytes`);
                
                // Verify data from A
                for (let i = 0; i < sentFromA.length; i++) {
                    if (this.verifySequenceData(data, sentFromA[i])) {
                        this.log(`✅ B verified sequence ${sentFromA[i]} from A`);
                        sentFromA.splice(i, 1);
                        break;
                    }
                }
                
                this.checkBidirectionalComplete();
            });
            
            const checkBidirectionalComplete = () => {
                if (sentFromA.length === 0 && sentFromB.length === 0) {
                    this.log('✅ Test passed: All bidirectional data verified');
                    clearTimeout(timeout);
                    resolve(true);
                }
            };
            this.checkBidirectionalComplete = checkBidirectionalComplete;
            
            sessionA.on('stateChanged', (state) => {
                if (state === AX25Session.ConnectionState.CONNECTED) {
                    this.log('Connected! Starting bidirectional transmission...');
                    
                    // Both sessions send data
                    setTimeout(() => {
                        for (let i = 101; i <= 103; i++) {
                            const sequenceData = this.createSequenceData(i, 48);
                            sentFromA.push(i);
                            this.log(`📤 Session A sending sequence ${i}`);
                            sessionA.send(sequenceData);
                        }
                    }, 100);
                    
                    setTimeout(() => {
                        for (let i = 201; i <= 203; i++) {
                            const sequenceData = this.createSequenceData(i, 56);
                            sentFromB.push(i);
                            this.log(`📤 Session B sending sequence ${i}`);
                            sessionB.send(sequenceData);
                        }
                    }, 500);
                }
            });
            
            // Establish connection
            const addrA = AX25Address.getAddress('TEST1', 1);
            const addrB = AX25Address.getAddress('TEST2', 2);
            const addresses = [addrB, addrA];
            
            sessionA.connect(addresses);
        });
    }

    async testEchoBackFunctionality() {
        this.log('🧪 Testing: Echo Back Functionality (A->B->A)', '===');
        
        const { sessionA, sessionB } = this.createTestSessions();
        const sentData = [];
        const receivedEchos = [];
        const numPackets = 3;
        
        return new Promise((resolve) => {
            const timeout = setTimeout(() => {
                this.log(`❌ Test failed: Echo back timeout. Sent ${sentData.length}, received ${receivedEchos.length} echoes`);
                resolve(false);
            }, 15000);
            
            // Session A receives echoed data from B
            sessionA.on('dataReceived', (data) => {
                receivedEchos.push(data);
                this.log(`📥 Session A received echo: ${data.length} bytes (${receivedEchos.length}/${numPackets})`);
                
                // Verify that the echoed data matches what we sent
                let matchFound = false;
                for (let i = 0; i < sentData.length; i++) {
                    if (Buffer.compare(data, sentData[i]) === 0) {
                        this.log(`✅ Echo verified: data matches original transmission`);
                        sentData.splice(i, 1);
                        matchFound = true;
                        break;
                    }
                }
                
                if (!matchFound) {
                    this.log(`❌ Echo mismatch: received data doesn't match any sent data`);
                }
                
                if (sentData.length === 0) {
                    this.log('✅ Test passed: All echo data verified correctly');
                    clearTimeout(timeout);
                    resolve(true);
                }
            });
            
            sessionA.on('stateChanged', (state) => {
                if (state === AX25Session.ConnectionState.CONNECTED) {
                    this.log('Connected! Starting echo test transmission...');
                    
                    // Send test data that B will echo back
                    setTimeout(() => {
                        for (let i = 1; i <= numPackets; i++) {
                            const testData = this.createSequenceData(100 + i, 64);
                            sentData.push(Buffer.from(testData)); // Store copy for verification
                            this.log(`📤 Session A sending test data ${i} for echo back`);
                            sessionA.send(testData);
                        }
                    }, 100);
                }
            });
            
            // Establish connection
            const addrA = AX25Address.getAddress('TEST1', 1);
            const addrB = AX25Address.getAddress('TEST2', 2);
            const addresses = [addrB, addrA];
            
            sessionA.connect(addresses);
        });
    }

    async testDirectRouting() {
        this.log('🧪 Testing: Direct TNC Frame Routing', '===');
        
        const { sessionA, sessionB } = this.createTestSessions();
        const receivedData = [];
        const sentSequences = [];
        const numPackets = 5;
        
        return new Promise((resolve) => {
            const timeout = setTimeout(() => {
                this.log('❌ Test failed: Direct routing timeout');
                resolve(false);
            }, 10000);
            
            sessionB.on('dataReceived', (data) => {
                receivedData.push(data);
                this.log(`📥 Session B received data via direct routing: ${data.length} bytes`);
                
                // Verify the sequence
                for (let i = 0; i < sentSequences.length; i++) {
                    if (this.verifySequenceData(data, sentSequences[i])) {
                        this.log(`✅ Verified sequence ${sentSequences[i]} via direct routing`);
                        sentSequences.splice(i, 1);
                        break;
                    }
                }
                
                if (sentSequences.length === 0) {
                    this.log('✅ Test passed: All data transmitted correctly via direct routing');
                    clearTimeout(timeout);
                    resolve(true);
                }
            });
            
            sessionA.on('stateChanged', (state) => {
                if (state === AX25Session.ConnectionState.CONNECTED) {
                    this.log('Connected! Testing direct routing transmission...');
                    
                    // Send packets to test direct routing
                    for (let i = 1; i <= numPackets; i++) {
                        const sequenceData = this.createSequenceData(i, 48);
                        sentSequences.push(i);
                        this.log(`📤 Session A sending sequence ${i} via direct routing`);
                        sessionA.send(sequenceData);
                    }
                }
            });
            
            // Establish connection
            const addrA = AX25Address.getAddress('TEST1', 1);
            const addrB = AX25Address.getAddress('TEST2', 2);
            const addresses = [addrB, addrA];
            
            sessionA.connect(addresses);
        });
    }

    async testDisconnection() {
        this.log('🧪 Testing: Clean Disconnection', '===');
        
        const { sessionA, sessionB } = this.createTestSessions();
        
        return new Promise((resolve) => {
            const timeout = setTimeout(() => {
                this.log('❌ Test failed: Disconnection timeout');
                resolve(false);
            }, 8000);
            
            let aDisconnected = false;
            let bDisconnected = false;
            
            const checkComplete = () => {
                if (aDisconnected && bDisconnected) {
                    this.log('✅ Test passed: Clean disconnection completed');
                    clearTimeout(timeout);
                    resolve(true);
                }
            };
            
            sessionA.on('stateChanged', (state) => {
                this.log(`Session A state: ${this.getStateString(state)}`);
                if (state === AX25Session.ConnectionState.CONNECTED) {
                    this.log('Connected! Initiating disconnection in 1 second...');
                    setTimeout(() => {
                        this.log('📤 Session A initiating disconnect');
                        sessionA.disconnect();
                    }, 1000);
                } else if (state === AX25Session.ConnectionState.DISCONNECTED) {
                    aDisconnected = true;
                    checkComplete();
                }
            });
            
            sessionB.on('stateChanged', (state) => {
                this.log(`Session B state: ${this.getStateString(state)}`);
                if (state === AX25Session.ConnectionState.DISCONNECTED) {
                    bDisconnected = true;
                    checkComplete();
                }
            });
            
            // Establish connection
            const addrA = AX25Address.getAddress('TEST1', 1);
            const addrB = AX25Address.getAddress('TEST2', 2);
            const addresses = [addrB, addrA];
            
            sessionA.connect(addresses);
        });
    }

    getStateString(state) {
        const states = {
            [AX25Session.ConnectionState.DISCONNECTED]: 'DISCONNECTED',
            [AX25Session.ConnectionState.CONNECTED]: 'CONNECTED',
            [AX25Session.ConnectionState.CONNECTING]: 'CONNECTING',
            [AX25Session.ConnectionState.DISCONNECTING]: 'DISCONNECTING'
        };
        return states[state] || `UNKNOWN(${state})`;
    }

    async runAllTests() {
        this.log('🚀 Starting AX25 Session Test Suite', '===');
        this.log('');
        
        const tests = [
            { name: 'Basic Connection', fn: () => this.testBasicConnection() },
            { name: 'Direct Routing', fn: () => this.testDirectRouting() },
            { name: 'Echo Back Functionality', fn: () => this.testEchoBackFunctionality() },
            { name: 'Data Transmission', fn: () => this.testDataTransmission() },
            { name: 'Bidirectional Traffic', fn: () => this.testBidirectionalTraffic() },
            { name: 'Clean Disconnection', fn: () => this.testDisconnection() }
        ];
        
        let passed = 0;
        let failed = 0;
        
        for (const test of tests) {
            this.log('');
            const startTime = Date.now();
            
            try {
                const result = await test.fn();
                const duration = Date.now() - startTime;
                
                if (result) {
                    this.log(`✅ ${test.name} PASSED (${duration}ms)`, '');
                    passed++;
                } else {
                    this.log(`❌ ${test.name} FAILED (${duration}ms)`, '');
                    failed++;
                }
            } catch (error) {
                const duration = Date.now() - startTime;
                this.log(`💥 ${test.name} ERROR: ${error.message} (${duration}ms)`, '');
                failed++;
            }
            
            // Wait between tests
            await this.delay(1000);
        }
        
        this.log('');
        this.log('📊 Test Results Summary', '===');
        this.log(`✅ Passed: ${passed}`);
        this.log(`❌ Failed: ${failed}`);
        this.log(`📈 Success Rate: ${Math.round((passed / (passed + failed)) * 100)}%`);
        this.log('');
        
        if (failed === 0) {
            this.log('🎉 All tests passed! AX25Session appears to be working correctly.');
        } else {
            this.log('⚠️  Some tests failed. Check the logs above for details.');
        }
        
        return { passed, failed };
    }
}

// Export for use as a module
module.exports = AX25SessionTest;

// If run directly, execute the tests
if (require.main === module) {
    const tester = new AX25SessionTest();
    tester.runAllTests().then(() => {
        process.exit(0);
    }).catch((error) => {
        console.error('Test suite error:', error);
        process.exit(1);
    });
}
