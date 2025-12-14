# WinLink Server Guide

This guide explains how to configure and use the WinLink Server feature in HtStation for radio email communications.

## What is WinLink?

WinLink is a worldwide radio messaging system that provides email-like communication over amateur radio frequencies. It's particularly valuable for:
- **Emergency communications** - Send messages when internet is unavailable
- **Remote locations** - Email access from areas without cell/internet coverage
- **Maritime operations** - Communication from boats and ships
- **Disaster relief** - Backup communication system during emergencies

## Current Implementation Status

**Important:** HtStation's WinLink server is currently a **local test implementation**:

### ✅ What Works Now:
- **Local mail storage** - Send and receive messages within HtStation
- **B2F protocol** - Compatible with WinLink clients (like Winlink Express)
- **Password authentication** - Secure login to your WinLink server
- **Mail proposals** - Exchange mail lists with connecting stations
- **Binary transfer** - Send/receive compressed email messages
- **Attachment support** - Handle file attachments in emails
- **Web interface** - View and manage WinLink mail through web dashboard

### ⚠️ Current Limitations:
- **Local only** - Messages stay within your HtStation
- **No cloud relay** - Does NOT forward to WinLink CMS (Central Message System)
- **No internet gateway** - Cannot send/receive from regular internet email
- **No routing** - Does not relay messages between stations

### 🚧 Future Development:
- Integration with WinLink CMS servers
- Internet email gateway
- Message routing and forwarding
- Full Telnet/RMS gateway support

**Use Case:** Currently best for testing WinLink clients, local messaging within your station network, or as a learning/development platform.

## How It Works

### Local Mail System

1. **Connecting station** (e.g., using Winlink Express) connects to your WinLink station
2. **Authentication** - Station authenticates using configured password
3. **Mail exchange** - Both stations propose mails they want to send
4. **Binary transfer** - Accepted mails are transferred in compressed binary format
5. **Local storage** - Mails are stored in HtStation's data directory
6. **Web access** - View received mails through the web interface

### Supported Operations

- **Send messages** - Other stations can send messages to your WinLink server
- **Receive messages** - Your station can send stored messages to connecting stations
- **Store and forward** - Messages are stored locally for later retrieval
- **Multiple connections** - Handle different stations connecting at different times

## Configuration

### Enable WinLink Server

Edit your `config.ini` file:

```ini
# Station configuration
CALLSIGN=N0CALL
BBS_STATION_ID=1
ECHO_STATION_ID=2
WINLINK_STATION_ID=3         # Enable WinLink on SSID 3
WINLINK_PASSWORD=MySecurePassword123
```

### Configuration Options

#### WINLINK_STATION_ID
- **Type:** Integer (0-15, or -1 to disable)
- **Required:** Yes (to enable WinLink)
- **Description:** Station ID for WinLink service

```ini
WINLINK_STATION_ID=3    # WinLink available at N0CALL-3
```

#### WINLINK_PASSWORD
- **Type:** String
- **Required:** Strongly recommended
- **Description:** Password for WinLink authentication

```ini
WINLINK_PASSWORD=MySecurePassword123
```

**Security Notes:**
- Use a strong password (minimum 12 characters)
- Mix letters, numbers, and symbols
- Don't reuse passwords from other services
- Change periodically (every 6-12 months)

**Without password:** If WINLINK_PASSWORD is not set, authentication is disabled (not recommended for production).

### Station ID Selection

- **Valid range:** 0-15
- **-1 to disable:** Set to `-1` to turn off WinLink server
- **Must be unique:** Don't use the same ID as BBS or Echo

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

## Using the WinLink Server

### From Winlink Express (or compatible client)

1. **Configure connection to your station:**
   - Target callsign: `N0CALL-3` (your callsign + WinLink SSID)
   - Connection type: Packet (AX.25)
   - Password: Match your `WINLINK_PASSWORD`

2. **Connect from client:**
   - Select your configured connection
   - Click "Open Session"
   - Client will authenticate and exchange mail

3. **Send/receive messages:**
   - Compose messages in your WinLink client
   - On next connection, messages will transfer
   - Received messages appear in client inbox

### From Another HtStation

If you have multiple HtStation installations, they can exchange mail:

```ini
# Station 1 config
CALLSIGN=N0CALL
WINLINK_STATION_ID=3
WINLINK_PASSWORD=Password123

# Station 2 config  
CALLSIGN=W1XYZ
WINLINK_STATION_ID=3
WINLINK_PASSWORD=DifferentPass456
```

Stations can connect to each other to exchange local messages.

### Web Interface Access

View and manage WinLink mail through the web interface:

1. **Open browser:** `http://your-pi-ip:8089/`
2. **Navigate to WinLink section**
3. **View mail:**
   - Inbox - Messages for your station
   - Outbox - Messages to be sent
   - Sent - Messages that were delivered

## Mail Storage

### Storage Location

WinLink mail is stored in the HtStation data directory:
```
data/winlink-mails.json
```

### Mailbox Types

- **Inbox (0)** - Messages addressed to your callsign
- **Outbox (1)** - Messages waiting to be sent to other stations
- **Sent (3)** - Messages that were successfully delivered

### Message IDs

Each message has a unique 12-character Message ID (MID):
```
Example: B2FIHM8EF2G1
```

This prevents duplicate delivery and tracks message status.

## Example Configurations

### Minimal WinLink Setup

```ini
# Radio connection
MACADDRESS=A1:B2:C3:D4:E5:F6
CALLSIGN=N0CALL

# Enable only WinLink
BBS_STATION_ID=-1
ECHO_STATION_ID=-1
WINLINK_STATION_ID=3
WINLINK_PASSWORD=SecurePass123

# Web interface
WEBSERVERPORT=8089

# Logging
CONSOLEMSG=ALL
```

### Full Station with WinLink

```ini
# Radio connection
MACADDRESS=A1:B2:C3:D4:E5:F6
CALLSIGN=N0CALL

# Multiple services
BBS_STATION_ID=1
ECHO_STATION_ID=2
WINLINK_STATION_ID=3
WINLINK_PASSWORD=WinlinkPass123

# Web interface
WEBSERVERPORT=8089

# MQTT for Home Assistant
MQTT_BROKER_URL=mqtt://192.168.1.100:1883
MQTT_TOPIC=homeassistant/uvpro-radio
MQTT_USERNAME=btradio
MQTT_PASSWORD=myradio

# Logging
CONSOLEMSG=App,Radio,WinLink
```

### Emergency Communications Station

```ini
# Radio connection
MACADDRESS=A1:B2:C3:D4:E5:F6
CALLSIGN=N0CALL

# WinLink for emergency email
BBS_STATION_ID=-1
ECHO_STATION_ID=-1
WINLINK_STATION_ID=3
WINLINK_PASSWORD=EmergencyPass!2024

# Web interface
WEBSERVERPORT=8089

# No MQTT (focus on WinLink)
# MQTT_BROKER_URL=
# MQTT_TOPIC=

# Detailed logging
CONSOLEMSG=ALL
```

## Session Management

### Connection Process

1. **Client initiates connection** to WinLink station (SABM)
2. **Server responds** with greeting and challenge
3. **Client authenticates** using password challenge-response
4. **Mail exchange:**
   - Client proposes outgoing mails (FC commands)
   - Server accepts/rejects (FS response)
   - Client sends binary mail data
   - Server proposes its outgoing mails
   - Client accepts/rejects
   - Server sends binary mail data
5. **Disconnect** (FQ command)

### Busy Detection

If a station tries to connect while already connected to another service (BBS, Echo):

1. **WinLink server detects busy state** via global session registry
2. **Sends DM (Disconnect Mode) response**
3. **Connection is refused**

**Example:**
```
Station W1XYZ-5 connected to BBS (N0CALL-1)
W1XYZ-5 tries to connect to WinLink (N0CALL-3)
→ WinLink server sends DM, refuses connection
```

### Multiple Stations

The WinLink server can handle multiple stations connecting at different times:
- Each station has independent session
- Messages are queued per destination
- Stations retrieve their messages on next connection

## Logging and Monitoring

### Console Output

When `CONSOLEMSG` includes `WinLink`, you'll see:

```
[WinLink] Server initialized on N0CALL-3
[WinLink] Password authentication enabled
[WinLink] Creating new session for W1XYZ-5
[WinLink] W1XYZ-5 connected
[WinLink] W1XYZ-5 authenticated successfully
[WinLink] Accepting mail B2FIHM8EF2G1
[WinLink] Decoded mail B2FIHM8EF2G1 from W1XYZ
[WinLink] Added mail B2FIHM8EF2G1 from W1XYZ to N0CALL
[WinLink] Sent 1 mail proposals
[WinLink] Transfer complete, sent 1 mails, 2048 bytes
[WinLink] W1XYZ-5 disconnected
```

### Web Interface

View WinLink activity through the web dashboard:
- **Mail Management** - View inbox, outbox, sent mail
- **Connection History** - Track WinLink sessions
- **Mail Details** - Read messages, view attachments
- **Real-time Updates** - Live connection status

### Configuration for Detailed Logging

```ini
# Show only WinLink messages
CONSOLEMSG=WinLink,Session

# Show all messages for debugging
CONSOLEMSG=ALL

# Quiet mode (errors only)
CONSOLEMSG=NONE
```

## Troubleshooting

### WinLink Server Not Responding

**Problem:** Clients can't connect to WinLink server

**Solutions:**
1. Verify `WINLINK_STATION_ID` is set (not -1)
2. Check radio is connected via Bluetooth
3. Verify SSID doesn't conflict with other services
4. Check HtStation logs for errors
5. Ensure client is connecting to correct callsign-SSID

### Authentication Fails

**Problem:** Client can't authenticate

**Solutions:**
1. Verify `WINLINK_PASSWORD` matches in both config and client
2. Check for typos or extra spaces in password
3. Ensure client supports secure login (SL) method
4. Restart HtStation after password changes
5. Check logs for authentication attempts

### Messages Not Transferring

**Problem:** Mail exchange doesn't complete

**Solutions:**
1. Verify connection stays active during transfer
2. Check radio signal quality
3. Ensure sufficient time for binary transfer
4. Review logs for transfer errors
5. Test with smaller messages first

### Mail Not Appearing in Web Interface

**Problem:** Received mail doesn't show up

**Solutions:**
1. Refresh web browser
2. Check mail storage file exists: `data/winlink-mails.json`
3. Verify mail was actually received (check logs)
4. Restart web server
5. Check file permissions on data directory

### Station Busy Response

**Problem:** WinLink server sends DM (busy) response

**Solution:**
- Station is already connected to another service (BBS or Echo)
- Disconnect from other service first
- Then connect to WinLink server

## Protocol Details

### B2F Protocol

HtStation implements the B2F (Basic to Full-service) protocol:
- Text-based command exchange
- Binary mail transfer with compression
- Challenge-response authentication
- Proposal/acceptance system for mail exchange

### Supported Commands

- **`;PR:`** - Password response (authentication)
- **`FC`** - Mail proposal (propose outgoing mail)
- **`F>`** - End proposals with checksum
- **`FS`** - Proposal responses (accept/reject)
- **`FF`** - Request outgoing mail from server
- **`FQ`** - Quit (disconnect)

### Mail Format

Messages are encoded in WinLink's binary format:
- MIME-like headers (To, From, Subject, Date)
- Message body (plain text or HTML)
- Optional file attachments
- Compression using LZHUF algorithm
- CRC checksums for integrity

## Security Considerations

### Authentication

- **Always use WINLINK_PASSWORD** for production
- **Use strong passwords** (minimum 12 characters)
- **Change passwords periodically**
- **Don't share passwords** over the radio

### Message Privacy

⚠️ **Important:** Amateur radio transmissions are **not encrypted**:
- **Messages are transmitted in clear** (readable by anyone)
- **Don't send sensitive information** (passwords, personal data, etc.)
- **Authentication prevents impersonation** but doesn't hide content
- **Complies with FCC regulations** (encryption prohibited)

### Local Storage Security

- Mail files stored in plain text JSON
- Protect the Raspberry Pi's file system
- Use strong system passwords
- Consider disk encryption for sensitive deployments

## Best Practices

### 1. Use Strong Authentication

```ini
WINLINK_PASSWORD=Str0ng!P@ssw0rd#2024
```

### 2. Regular Monitoring

Check WinLink activity regularly:
```bash
sudo journalctl -u htstation | grep WinLink | tail -30
```

### 3. Backup Mail Data

Periodically backup the mail storage:
```bash
cp data/winlink-mails.json data/winlink-mails.backup.json
```

### 4. Document Your Station

Let other operators know:
- Your WinLink station callsign-SSID
- Password sharing method (secure channel)
- Operating hours/availability
- Current limitations (local only)

### 5. Test Regularly

Periodically test WinLink functionality:
- Connect from client
- Send test message
- Verify receipt
- Check web interface

## Future Development

The WinLink server will be enhanced with:

### Planned Features

1. **WinLink CMS Integration**
   - Connect to WinLink Central Message Servers
   - Forward messages to/from internet email
   - Full internet gateway capability

2. **Message Routing**
   - Forward messages between stations
   - Multi-hop message delivery
   - Store-and-forward for offline stations

3. **Telnet/RMS Gateway**
   - Support Telnet connections to CMS
   - RMS (Radio Message Server) functionality
   - Full gateway station capability

4. **Enhanced Features**
   - Position reporting integration
   - Message priority handling
   - Delivery notifications
   - Message expiration

### Contributing

If you're interested in helping develop these features:
- Check the [GitHub repository](https://github.com/Ylianst/HtStation)
- Review the WinLink protocol documentation
- Test the current implementation
- Report issues and suggestions

## Additional Resources

- [WinLink Official Website](https://www.winlink.org/) - Main WinLink information
- [Winlink Express](https://winlink.org/content/winlink_express_installation) - Popular WinLink client
- [B2F Protocol](https://www.winlink.org/content/b2f_protocol_specification) - Technical protocol details
- [ARRL WinLink Guide](https://www.arrl.org/winlink) - Getting started with WinLink
- [Configuration Guide](config.md) - Complete config.ini documentation

## Summary

HtStation's WinLink server provides:
- ✅ Local WinLink message exchange
- ✅ Compatible with standard WinLink clients
- ✅ Password authentication
- ✅ Binary mail transfer with compression
- ✅ Web interface for mail management

**Current limitation:** Messages stay local - no internet gateway (yet!)

Enable it by setting `WINLINK_STATION_ID` and `WINLINK_PASSWORD` in `config.ini`, then connect using any compatible WinLink client to test radio email communications.
