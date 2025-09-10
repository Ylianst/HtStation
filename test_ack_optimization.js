const AX25Session = require('./AX25Session.js');
const AX25Packet = require('./AX25Packet.js');
const AX25Address = require('./AX25Address.js');

console.log('=== Testing AX25 S-FRAME-RR Optimization ===\n');

// Mock radio object
const mockRadio = {
    sendTncFrame: function(frame) {
        const packet = AX25Packet.decodeAX25Packet(frame);
        if (packet) {
            const typeNames = {
                0: 'I-FRAME',
                1: 'S-FRAME-RR',
                2: 'S-FRAME-RNR', 
                3: 'S-FRAME-REJ',
                47: 'U-FRAME-SABM',
                99: 'U-FRAME-UA',
                67: 'U-FRAME-DISC'
            };
            
            const typeName = typeNames[packet.type] || `TYPE-${packet.type}`;
            const dataInfo = packet.data ? ` [${packet.data.length} bytes]` : '';
            
            console.log(`📡 TRANSMITTED: ${typeName}${dataInfo} (NR=${packet.nr}, NS=${packet.ns})`);
            
            // Track RR frames specifically
            if (packet.type === 1) {
                console.log(`   ⚠️  S-FRAME-RR sent - no optimization applied`);
            }
        }
    }
};

// Mock parent object
const mockParent = {
    callsign: 'TEST1',
    stationId: 1,
    activeChannelIdLock: 1
};

// Create sessions
const sessionA = new AX25Session(mockParent, mockRadio);
const sessionB = new AX25Session(mockParent, mockRadio);

// Counter for tracking RR frames
let rrFrameCount = 0;
const originalSendTncFrame = mockRadio.sendTncFrame;
mockRadio.sendTncFrame = function(frame) {
    const packet = AX25Packet.decodeAX25Packet(frame);
    if (packet && packet.type === 1) {
        rrFrameCount++;
    }
    return originalSendTncFrame.call(this, frame);
};

// Setup echo functionality on session B
sessionB.on('dataReceived', (data) => {
    console.log(`📥 Session B received: ${data.length} bytes`);
    console.log(`🔄 Session B echoing back data (should trigger optimization)`);
    
    // Echo the data back - this should trigger the optimization
    sessionB.send(data);
});

async function runTest() {
    console.log('1. Establishing connection...');
    
    // Create addresses
    const addrA = AX25Address.getAddress('TEST1', 1);
    const addrB = AX25Address.getAddress('TEST2', 2);
    const addresses = [addrB, addrA];
    
    // Connect session A to B
    sessionA.connect(addresses);
    
    // Simulate Session B receiving the SABM
    const sabmPacket = new AX25Packet(
        [addrB, addrA],
        0, 0, true, true,
        AX25Packet.FrameType.U_FRAME_SABM
    );
    sabmPacket.channel_id = 1;
    sessionB.receive(sabmPacket);
    
    // Simulate Session A receiving the UA
    const uaPacket = new AX25Packet(
        [addrA, addrB],
        0, 0, true, false,
        AX25Packet.FrameType.U_FRAME_UA
    );
    sessionA.receive(uaPacket);
    
    console.log('\n2. Testing optimization - sending data that will be echoed...');
    
    // Reset RR counter
    rrFrameCount = 0;
    
    // Send data from A to B (B will echo it back)
    console.log('📤 Session A sending test data');
    sessionA.send('Test data for echo optimization');
    
    // Simulate Session B receiving the I-frame
    setTimeout(() => {
        const dataPacket = new AX25Packet(
            [addrB, addrA],
            0, 0, false, true,
            AX25Packet.FrameType.I_FRAME,
            Buffer.from('Test data for echo optimization')
        );
        dataPacket.ns = 0;
        dataPacket.nr = 0;
        
        console.log('\n📨 Session B receiving I-frame...');
        sessionB.receive(dataPacket);
        
        // Check if optimization worked
        setTimeout(() => {
            console.log(`\n📊 OPTIMIZATION RESULT:`);
            console.log(`   RR frames sent during echo: ${rrFrameCount}`);
            
            if (rrFrameCount === 0) {
                console.log(`   ✅ SUCCESS: S-FRAME-RR was optimized away!`);
                console.log(`   📝 The acknowledgment will be piggybacked on the echo I-frame`);
            } else {
                console.log(`   ⚠️  S-FRAME-RR was still sent (may be due to other conditions)`);
            }
            
            console.log('\n=== Test Complete ===');
        }, 100);
        
    }, 50);
}

runTest().catch(console.error);
