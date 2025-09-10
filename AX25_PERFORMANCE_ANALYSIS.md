# AX25Session Performance Analysis for 1200 Baud Packet Radio

## Identified Inefficiencies from Test Output

### 1. Excessive RR (Receiver Ready) Frames
**Issue**: The test output shows many unnecessary RR frames being sent:
- Line: `07:26:19.043 A --> B: RR (NR=0, NS=0)`
- Line: `07:26:45.596 A --> B: RR (NR=5, NS=0)`
- Line: `07:26:46.738 A --> B: RR (NR=3, NS=0)`

**Impact**: At 1200 baud, each 15-byte RR frame takes ~100ms to transmit. Unnecessary RR frames waste precious bandwidth.

### 2. Premature Timer Expiration and Retransmissions
**Issue**: T2 timer expires too quickly, causing unnecessary retransmissions:
- Line: `[AX25Session] ** Timer - T2 expired`
- This triggers drain operations with `Resend: true`

**Impact**: Retransmitting entire packet sequences wastes bandwidth and increases latency.

### 3. Inefficient Acknowledgment Strategy
**Issue**: The current implementation sends acknowledgments too frequently:
- Every I-frame triggers acknowledgment processing
- T2 timer is set after every received packet

### 4. Window Management Issues
**Issue**: The maxFrames=4 default may be suboptimal for 1200 baud:
- Small window limits throughput
- But larger windows increase retransmission overhead

## Recommended Performance Improvements

### 1. Delayed Acknowledgment Strategy
```javascript
// Add to constructor
this.ackDelay = 200; // 200ms delay before sending RR
this.pendingAck = false;
this.ackTimer = null;

// Modify _setTimer method to include ack timer
_setDelayedAck() {
    if (this.ackTimer) {
        clearTimeout(this.ackTimer);
    }
    this.pendingAck = true;
    this.ackTimer = setTimeout(() => {
        if (this.pendingAck && this._state.connection === AX25Session.ConnectionState.CONNECTED) {
            this._sendRR(false);
            this.pendingAck = false;
        }
    }, this.ackDelay);
}

// Use delayed ack instead of immediate RR
```

### 2. Piggyback Acknowledgments
```javascript
// Modify send() method to include pending acknowledgments
send(info) {
    // Clear pending ACK since we're sending data that will include NR
    if (this.ackTimer) {
        clearTimeout(this.ackTimer);
        this.pendingAck = false;
    }
    // ... existing send logic
}
```

### 3. Adaptive Timer Values for 1200 Baud
```javascript
// Optimize timer calculations for 1200 baud
_getMaxPacketTime() {
    // More conservative timing for 1200 baud
    const headerOverhead = 20; // Account for AX.25 headers and TNC overhead
    return Math.floor((headerOverhead + (this.packetLength * 8)) / this.hBaud * 1000 * 1.5);
}

_getTimerTimeout(timerName) {
    switch (timerName) {
        case 't2':
            // Longer T2 timeout to reduce premature RR transmissions
            return this._getMaxPacketTime() * 3; // Increased from 2 to 3
        // ... other cases
    }
}
```

### 4. Batch Acknowledgment Processing
```javascript
// Only send RR when necessary, not after every packet
_shouldSendAck(packet) {
    // Send ACK if:
    // 1. Poll bit is set
    // 2. Window is getting full
    // 3. Significant delay since last ACK
    return packet.pollFinal || 
           (this._getUnackedCount() >= this.maxFrames / 2) ||
           (Date.now() - this.lastAckTime > this.ackDelay * 2);
}
```

### 5. Optimize Window Size for 1200 Baud
```javascript
// Dynamic window sizing based on baud rate
constructor(parent, radio) {
    // ... existing code
    this.maxFrames = this.hBaud <= 1200 ? 2 : 4; // Smaller window for slow links
}
```

### 6. Reduce Retransmission Aggressiveness
```javascript
// Longer timeouts to avoid premature retransmissions
_getTimeout() {
    let multiplier = 0;
    for (const packet of this._state.sendBuffer) {
        if (packet.sent) multiplier++;
    }
    const addressCount = this.addresses ? this.addresses.length : 2;
    
    // More conservative timeout calculation for 1200 baud
    const baseTimeout = this._getMaxPacketTime() * Math.max(1, addressCount - 2) * 6; // Increased from 4
    const backoff = this._getMaxPacketTime() * Math.max(1, multiplier) * 2; // More gradual backoff
    
    return baseTimeout + backoff;
}
```

### 7. Suppress Redundant RR Frames
```javascript
// Track last RR sent to avoid duplicates
_sendRR(pollFinal) {
    const now = Date.now();
    if (!pollFinal && 
        this.lastRRTime && 
        (now - this.lastRRTime < this._getMaxPacketTime()) &&
        this.lastRRSequence === this._state.receiveSequence) {
        this._trace('Suppressing redundant RR frame');
        return;
    }
    
    this._trace('SendRR');
    const packet = new AX25Packet(
        this.addresses,
        this._state.receiveSequence,
        this._state.sendSequence,
        pollFinal,
        true,
        AX25Packet.FrameType.S_FRAME_RR
    );
    packet.modulo128 = this.modulo128;
    this._emitPacket(packet);
    
    this.lastRRTime = now;
    this.lastRRSequence = this._state.receiveSequence;
}
```

## Expected Performance Improvements

1. **Bandwidth Savings**: 20-30% reduction in control frame overhead
2. **Latency Reduction**: Fewer unnecessary retransmissions
3. **Better Throughput**: More efficient use of the 1200 baud channel
4. **Improved Reliability**: More conservative timeouts reduce false retransmissions

## Implementation Priority

1. **High Priority**: Delayed acknowledgments and RR suppression
2. **Medium Priority**: Adaptive timer values and window sizing
3. **Low Priority**: Advanced features like selective acknowledgment

These optimizations specifically target the inefficiencies observed in the test output while maintaining protocol compliance and reliability.
