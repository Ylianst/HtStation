# Echo Server Guide

This guide explains how to configure and use the Echo Server feature in HtStation for debugging and testing your radio connections.

## What is the Echo Server?

The Echo Server is a diagnostic tool that reflects back (echoes) any data or APRS messages sent to it. This is useful for:
- **Testing connections** - Verify your radio can send and receive data
- **Debugging packet radio** - Check if your packets are being transmitted correctly
- **Validating configurations** - Ensure your station settings are working
- **Training new operators** - Practice sending messages without bothering other stations

## How It Works

When the Echo Server is enabled on a specific Station ID:

1. **Another station connects** to your echo station (e.g., `N0CALL-2`)
2. **They send data** via AX.25 connection or UI frames
3. **Echo Server immediately sends it back** to the sender
4. **Sender receives their own message** confirming the round-trip works

### Supported Frame Types

The Echo Server handles two types of packets:

#### 1. Connected Mode (I-frames)
- **Connection established** via SABM/SABME
- **Data exchanged** through I-frames (information frames)
- **Data echoed back** during active connection
- **Connection terminated** via DISC

#### 2. Connectionless Mode (UI-frames)
- **No connection required** (fire and forget)
- **UI frames with payload** echoed back immediately
- **Useful for quick tests** without full connection setup

## Configuration

### Enable Echo Server

Edit your `config.ini` file and set the `ECHO_STATION_ID`:

```ini
# Station configuration
CALLSIGN=N0CALL
BBS_STATION_ID=1
ECHO_STATION_ID=2        # Enable echo server on SSID 2
WINLINK_STATION_ID=3
```

### Station ID Selection

- **Valid range:** 0-15
- **-1 to disable:** Set to `-1` to turn off echo server
- **Must be unique:** Don't use the same ID as BBS or WinLink

**Example:**
```ini
# Multiple services with different SSIDs
BBS_STATION_ID=1         # BBS on N0CALL-1
ECHO_STATION_ID=2        # Echo on N0CALL-2
WINLINK_STATION_ID=3     # WinLink on N0CALL-3
```

### Restart HtStation

Apply the configuration:

```bash
# Console mode
Press CTRL+C, then: node htstation.js --run

# Service mode
sudo systemctl restart htstation
```

## Using the Echo Server

### From Another Station

Once your echo server is running, other stations can connect:

#### Connected Mode Test

1. **Connect to echo station:**
   ```
   C N0CALL-2
   ```

2. **Send a test message:**
   ```
   Hello Echo!
   ```

3. **Receive echo back:**
   ```
   Hello Echo!
   ```

4. **Disconnect:**
   ```
   D
   ```

#### UI Frame Test

Send a UI frame to the echo station:
```
UI N0CALL-2 Test message
```

The echo server will reflect it back immediately.

### From Your Own Station

You can test the echo server from the same machine using the web interface or by sending APRS messages addressed to your echo station ID.

## Use Cases

### 1. New Installation Testing

**Scenario:** You just set up HtStation and want to verify everything works

```ini
# Minimal test configuration
MACADDRESS=38:D2:00:00:EF:24
CALLSIGN=N0CALL
ECHO_STATION_ID=2
WEBSERVERPORT=8089
```

**Test procedure:**
1. Start HtStation: `node htstation.js --run`
2. From another radio, connect to `N0CALL-2`
3. Send test messages
4. Verify you receive them back

### 2. Debugging Connection Issues

**Scenario:** BBS connections are failing, use echo to isolate the problem

**Steps:**
1. Test with echo server first (simpler than BBS)
2. If echo works, problem is in BBS configuration
3. If echo fails, problem is in radio/Bluetooth connection

### 3. Radio Performance Testing

**Scenario:** Test signal quality and packet loss

**Procedure:**
1. Send a series of numbered messages: `Test 1`, `Test 2`, `Test 3`...
2. Check which messages echo back
3. Calculate packet loss percentage
4. Adjust antenna, location, or power settings

### 4. Training New Operators

**Scenario:** Teaching someone packet radio operations

**Benefits:**
- Safe practice environment (messages go nowhere)
- Immediate feedback (echo confirms reception)
- No risk of disrupting other stations
- Can practice connect/disconnect procedures

### 5. APRS Message Testing

**Scenario:** Testing APRS message functionality

```ini
CALLSIGN=N0CALL
ECHO_STATION_ID=2
BBS_STATION_ID=1
```

**Test:**
1. Send APRS message to `N0CALL-2`
2. Echo server reflects it back
3. Verify message format and authentication (if configured)

## Session Management

### Single Connection at a Time

The echo server handles **one connection per remote station** at a time:

- If station `W1XYZ` is connected to echo server
- And station `K2ABC` tries to connect
- `K2ABC` will be accepted (different station)
- Each gets their own independent echo session

### Busy Detection

If a station tries to connect to the echo server while already connected to another service (BBS, WinLink):

1. **Echo server detects busy state** via global session registry
2. **Sends DM (Disconnect Mode) response** indicating busy
3. **Connection is refused** to prevent conflicts

**Example:**
```
Station W1XYZ-5 connected to BBS (N0CALL-1)
W1XYZ-5 tries to connect to Echo (N0CALL-2)
→ Echo server sends DM, refuses connection
```

## Logging and Monitoring

### Console Output

When `CONSOLEMSG` includes `Echo`, you'll see:

```
[Echo Session] Creating new session for W1XYZ-5
[Echo Session] W1XYZ-5 state changed to CONNECTED
[Echo Session] W1XYZ-5 received 12 bytes: Hello World!
[Echo Session] Echoing 12 bytes back to W1XYZ-5
[Echo Session] W1XYZ-5 state changed to DISCONNECTED
[Echo Session] Removing disconnected session for W1XYZ-5
```

### Web Interface

Check the HtStation web interface at `http://your-pi-ip:8089/`:
- **Active connections** shows echo sessions
- **Connection history** logs all echo activity
- **Real-time updates** as messages are echoed

### Configuration for Detailed Logging

```ini
# Show only echo server messages
CONSOLEMSG=Echo,Session

# Show all messages for debugging
CONSOLEMSG=ALL
```

## Troubleshooting

### Echo Server Not Responding

**Problem:** Stations can't connect to echo server

**Solutions:**
1. Verify `ECHO_STATION_ID` is set (not -1)
2. Check radio is connected via Bluetooth
3. Verify SSID doesn't conflict with other services
4. Check HtStation logs for errors:
   ```bash
   # View logs if running as service
   sudo journalctl -u htstation -f
   ```
5. Restart HtStation to reload configuration

### No Echo Back

**Problem:** Connection succeeds but messages aren't echoed

**Solutions:**
1. Check connection state (must be CONNECTED for I-frames)
2. Verify packet format (UI frames need payload data)
3. Check HtStation logs for "Echoing X bytes back"
4. Test with simple text first (avoid binary data initially)
5. Verify sender is listening for response

### Station Busy Response

**Problem:** Echo server sends DM (busy) response

**Solution:**
- Station is already connected to another service (BBS or WinLink)
- Disconnect from other service first
- Then connect to echo server

### Echo Session Hangs

**Problem:** Session stays connected but stops echoing

**Solutions:**
1. Disconnect and reconnect
2. Check radio connection status
3. Restart HtStation if issue persists
4. Review logs for error messages

## Advanced Usage

### Automated Testing Script

Create a test script to verify echo functionality:

```bash
#!/bin/bash
# Echo server test script

ECHO_STATION="N0CALL-2"
TEST_COUNT=10

echo "Testing echo server: $ECHO_STATION"
echo "Sending $TEST_COUNT test messages..."

for i in $(seq 1 $TEST_COUNT); do
    # Send message via radio command
    echo "Test message $i" | send_aprs_message $ECHO_STATION
    sleep 2
done

echo "Test complete. Check logs for results."
```

### Performance Benchmarking

Test throughput by sending progressively larger messages:

```
Test 1: 10 bytes
Test 2: 50 bytes  
Test 3: 100 bytes
Test 4: 200 bytes
Test 5: 500 bytes (may fragment)
```

Monitor time-to-echo for each size to identify optimal packet size.

### Multi-Station Testing

Set up multiple echo servers for concurrent testing:

```ini
# Station 1 config
CALLSIGN=N0CALL
ECHO_STATION_ID=2

# Station 2 config
CALLSIGN=W1XYZ  
ECHO_STATION_ID=5

# Station 3 config
CALLSIGN=K2ABC
ECHO_STATION_ID=7
```

Test cross-station communication by having each connect to others' echo servers.

## Example Configurations

### Echo Only (Testing Setup)

```ini
# Radio connection
MACADDRESS=38:D2:00:00:EF:24
CALLSIGN=N0CALL

# Enable only echo server
BBS_STATION_ID=-1
ECHO_STATION_ID=2
WINLINK_STATION_ID=-1

# Web interface
WEBSERVERPORT=8089

# Verbose logging for testing
CONSOLEMSG=ALL
```

### Echo + BBS (Normal Operation)

```ini
# Radio connection
MACADDRESS=38:D2:00:00:EF:24
CALLSIGN=N0CALL

# Multiple services
BBS_STATION_ID=1         # Production BBS
ECHO_STATION_ID=2        # Testing/debugging
WINLINK_STATION_ID=3     # Email service

# Web interface
WEBSERVERPORT=8089

# Standard logging
CONSOLEMSG=App,Radio,BBS,Echo,WinLink
```

### Field Testing Configuration

```ini
# Radio connection
MACADDRESS=38:D2:00:00:EF:24
CALLSIGN=N0CALL-9        # Mobile station

# Echo only for field testing
BBS_STATION_ID=-1
ECHO_STATION_ID=2
WINLINK_STATION_ID=-1

# Web interface
WEBSERVERPORT=8089

# Minimal logging to reduce overhead
CONSOLEMSG=Echo,Radio
```

## Best Practices

### 1. Use Dedicated SSID

Always use a separate SSID for echo server:
```ini
BBS_STATION_ID=1      # Don't use for echo
ECHO_STATION_ID=2     # Dedicated echo SSID
```

### 2. Document Your Echo Station

Let other operators know your echo server is available:
- Announce on local nets
- List in club directories
- Include in repeater info

### 3. Keep Echo Server Running

Echo server is most useful when consistently available:
```bash
# Install as service for 24/7 operation
node htstation.js --install
sudo systemctl start htstation
```

### 4. Monitor Echo Activity

Regularly check echo server logs:
```bash
# View recent echo activity
sudo journalctl -u htstation | grep Echo | tail -20
```

### 5. Test Periodically

Even when services are working, periodically test echo server:
- Confirms radio connectivity
- Validates configuration
- Ensures backup testing method is available

## Security Considerations

### Echo Server is Public

- **Anyone can connect** to your echo server
- **All messages are echoed** without filtering
- **No authentication required** (by design)

### Potential Issues

- **Spam/abuse:** Malicious stations could flood echo server
- **Resource usage:** Many connections consume resources
- **Log bloat:** Heavy echo usage creates large logs

### Mitigation

While echo server is intentionally open, you can:
1. **Monitor activity** for unusual patterns
2. **Set logging to NONE** to reduce log size if needed
3. **Disable echo server** (`ECHO_STATION_ID=-1`) if abused
4. **Report abuse** to appropriate authorities if necessary

## Additional Resources

- [Configuration Guide](config.md) - Complete config.ini documentation
- [AX.25 Protocol](https://www.tapr.org/pdf/AX25.2.2.pdf) - Technical protocol details
- [Packet Radio Introduction](https://www.arrl.org/packet-radio) - ARRL packet radio guide

## Summary

The Echo Server is a valuable diagnostic tool for:
- ✅ Testing new installations
- ✅ Debugging connection problems
- ✅ Training new operators
- ✅ Validating configurations
- ✅ Measuring performance

Enable it by setting `ECHO_STATION_ID` in `config.ini` to a value between 0-15, and any station can connect to test their radio communications.
