# Web Interface Guide

This guide explains how to configure, access, and use the HtStation web interface for monitoring and managing your packet radio station.

## What is the Web Interface?

The HtStation web interface is a browser-based dashboard that provides:
- **Real-time monitoring** - Live view of radio connections and activity
- **Station management** - Control BBS bulletins and WinLink mail
- **APRS tracking** - View received APRS messages on a map
- **Connection history** - Review past BBS connections and statistics
- **System status** - Monitor uptime, resource usage, and configuration

No additional software required - just a web browser on any device connected to your network.

## Configuration

### Enable Web Server

The web server is enabled by default. Edit your `config.ini` file:

```ini
# Web server configuration
WEBSERVERPORT=8089
```

### Configuration Options

#### WEBSERVERPORT
- **Type:** Integer (1-65535)
- **Required:** No (default: 8089)
- **Description:** TCP port for the web interface

```ini
WEBSERVERPORT=8089    # Web interface at http://your-pi:8089
```

**Common port choices:**
- `8089` - Default HtStation port
- `8080` - Common alternative HTTP port
- `3000` - Common Node.js development port
- `80` - Standard HTTP (requires root/sudo)

### Restart to Apply Changes

After modifying the port:

```bash
# Console mode
Press CTRL+C, then: node htstation.js --run

# Service mode
sudo systemctl restart htstation
```

## Accessing the Web Interface

### From Same Machine (Raspberry Pi)

Open a browser and navigate to:
```
http://localhost:8089
```

### From Local Network

1. **Find your Raspberry Pi's IP address:**
   ```bash
   hostname -I
   ```
   Example output: `192.168.1.100`

2. **Open browser on any network device:**
   ```
   http://192.168.1.100:8089
   ```

### From Remote Network (Advanced)

To access from outside your local network:

1. **Set up port forwarding** on your router
   - Forward external port (e.g., 8089) to Raspberry Pi IP
   - External port → 192.168.1.100:8089

2. **Find your public IP:**
   ```
   http://whatismyip.com
   ```

3. **Access remotely:**
   ```
   http://your-public-ip:8089
   ```

⚠️ **Security Warning:** Exposing your web interface to the internet without authentication is not recommended. Consider using a VPN instead.

## Web Interface Features

### 1. Dashboard Overview

**System Status Panel:**
- Station callsign and IDs
- Radio connection status
- Application uptime
- System uptime
- Active connections count

**Quick Statistics:**
- Total BBS connections
- Active bulletins
- APRS messages received
- Unique APRS stations
- Last activity timestamps

**Real-time Updates:**
- Auto-refreshes every 5-10 seconds
- Live connection notifications
- Instant message alerts

### 2. Active Connections

**Live Connection Monitor:**
- See who's currently connected to BBS
- Connection duration
- Current menu state
- Session status

**Connection Details:**
- Callsign with SSID
- Connection time
- Duration counter
- Activity state (main menu, games, files, etc.)

**Real-time Chat View:**
- See actual BBS session data
- Commands typed by users
- Responses from BBS
- Live scrolling transcript

### 3. Connection History

**BBS Connection Log:**
- Last 20 connections
- Callsign
- Date and time
- Session duration
- Packets sent/received
- Bytes transferred

**Statistics Display:**
- Connection frequency
- Popular connection times
- Average session duration
- Data transfer volumes

**Export Options:**
- Download connection logs
- Generate usage reports
- Historical analysis

### 4. APRS Messages

**Message List:**
- Last 100 APRS messages
- Source callsign
- Destination
- Message content
- Timestamp
- Message type (Position, Weather, Message, etc.)

**Interactive Map:**
- Geographic view of APRS stations
- Position markers for stations
- Click markers for details
- Zoom and pan controls
- Track station movements

**Message Details:**
- GPS coordinates (if available)
- Weather data (if available)
- Message direction (sent/received)
- Authentication status

**Filtering:**
- By callsign
- By message type
- By time range
- By authenticated/unauthenticated

### 5. BBS Bulletins

**Bulletin Management:**
- View all active bulletins
- See poster callsign
- Post date and expiration
- Message content
- Days until expiration

**Create New Bulletin:**
- Web-based bulletin posting
- Up to 300 characters
- Posted as station callsign
- 7-day default expiration

**Delete Bulletins:**
- Admin can delete any bulletin
- Confirmation dialog
- Immediate update across all clients

**Bulletin Organization:**
- Sorted by newest first
- Color-coded by age
- Expiration warnings
- Auto-cleanup of expired

### 6. WinLink Mail

**Mail Management:**
- **Inbox** - Messages for your station
- **Outbox** - Messages waiting to send
- **Drafts** - Incomplete messages
- **Sent** - Delivered messages
- **Archive** - Archived messages
- **Trash** - Deleted messages

**Compose Mail:**
- Web-based email composition
- To/From/Subject/Body fields
- Save as draft or add to outbox
- Simple text format

**Mail Actions:**
- Read messages
- Move to trash
- Permanently delete
- View attachments (if supported)

**Mail Details:**
- Message ID (MID)
- From/To addresses
- Subject and body
- Timestamp
- Read/unread status
- Attachment count

### 7. System Information

**Application Status:**
- HtStation version
- Uptime since start
- Node.js version
- Memory usage

**System Resources:**
- CPU load average (1, 5, 15 min)
- System uptime
- Available disk space
- Network interfaces

**Configuration Display:**
- Callsign and station IDs
- Enabled services (BBS, Echo, WinLink)
- MQTT status
- Web server port

**Service Status:**
- Radio connected/disconnected
- BBS server running
- WinLink server running
- MQTT connected/disconnected

## Using the Web Interface

### Monitoring Active Sessions

1. **Open web interface** in browser
2. **Navigate to "Active Connections" tab**
3. **View live sessions:**
   - Callsign of connected station
   - How long connected
   - What they're doing (menu state)
4. **Watch live chat:**
   - See commands typed
   - View BBS responses
   - Real-time scrolling

**Example session view:**
```
W1XYZ-5 | Connected 5m 32s | In Games Menu
Recent Activity:
  → M
  ← Games Menu displayed
  → G
  ← Guess the Number game started
  → 50
  ← "Too high! Try again."
```

### Managing Bulletins

#### Viewing Bulletins

1. **Click "Bulletins" tab**
2. **See all active bulletins:**
   - Posted by which callsign
   - When posted
   - Message content
   - Days until expiration

#### Creating a Bulletin

1. **Click "New Bulletin" button**
2. **Enter message** (up to 300 characters)
3. **Click "Post"**
4. **Bulletin appears** immediately
5. **Posted as:** Station callsign (from config.ini)

**Note:** Web-posted bulletins use your station's callsign (CALLSIGN from config.ini), not individual operator callsigns.

#### Deleting a Bulletin

1. **Find bulletin** in list
2. **Click "Delete" button**
3. **Confirm deletion**
4. **Bulletin removed** immediately
5. **All clients updated** via WebSocket

**Permission:** Web interface has admin access - can delete any bulletin.

### Viewing APRS Activity

#### Message List View

1. **Click "APRS Messages" tab**
2. **See message list:**
   - Source → Destination
   - Message content
   - Timestamp
   - Message type

#### Map View

1. **Click "Map" sub-tab**
2. **Interactive map displays:**
   - Station positions
   - Movement tracks
   - Coverage area
3. **Click markers** for details:
   - Callsign
   - Coordinates
   - Last heard
   - Message history

#### Filtering Messages

1. **Use filter controls:**
   - Callsign filter
   - Type filter (Position, Weather, Message)
   - Date range
2. **Apply filters**
3. **View filtered results**

### Managing WinLink Mail

#### Reading Mail

1. **Click "WinLink" tab**
2. **Select mailbox** (Inbox, Outbox, etc.)
3. **Click message** to read
4. **View full content:**
   - Headers (From, To, Subject)
   - Body text
   - Attachments (if any)
   - Timestamp

#### Composing Mail

1. **Click "Compose" button**
2. **Fill in fields:**
   - **To:** Destination callsign
   - **Subject:** Message subject
   - **Body:** Message content
3. **Choose action:**
   - **Send to Outbox** - Ready to send on next connection
   - **Save as Draft** - Save for later

**Example:**
```
To: W1AW
Subject: Test Message
Body: This is a test message from the web interface.
```

#### Deleting Mail

1. **Select message**
2. **Click "Delete" button**
3. **Choose:**
   - **Move to Trash** - Can recover later
   - **Permanently Delete** - Cannot recover
4. **Confirm action**

### Reviewing Connection History

1. **Click "Connection History" tab**
2. **View recent connections:**
   - Callsign
   - Connection time
   - Duration
   - Data transferred
3. **Sort by:**
   - Most recent
   - Longest duration
   - Most data transferred
4. **Export data** if needed

## WebSocket Real-Time Updates

The web interface uses WebSocket technology for instant updates:

### What Gets Updated in Real-Time

- **Active connections** - New connections appear instantly
- **Disconnections** - Removed immediately from list
- **Chat messages** - BBS session data streams live
- **APRS messages** - New messages appear as received
- **Bulletins** - Posted/deleted bulletins update all clients
- **System status** - Counters and statistics refresh
- **WinLink mail** - New mail notifications

### Benefits

- **No page refresh needed** - Updates push automatically
- **Multiple users** - Everyone sees same data
- **Low bandwidth** - Only changes are sent
- **Instant notifications** - Know immediately when something happens

### Connection Status

**Indicator shows:**
- 🟢 Connected - Receiving real-time updates
- 🟡 Connecting - Establishing connection
- 🔴 Disconnected - Auto-reconnect in progress

## Mobile Access

The web interface works on mobile devices:

### Mobile Optimization

- **Responsive design** - Adapts to screen size
- **Touch-friendly** - Large tap targets
- **Swipe gestures** - Navigate between tabs
- **Mobile browsers** - Chrome, Safari, Firefox supported

### Mobile Usage Tips

1. **Bookmark the URL** on home screen
2. **Enable landscape** for map view
3. **Use WiFi** for best performance
4. **Refresh** if connection drops

**Example mobile URL:**
```
http://192.168.1.100:8089
```

## Troubleshooting

### Can't Access Web Interface

**Problem:** Browser shows "Cannot connect"

**Solutions:**
1. Verify HtStation is running:
   ```bash
   systemctl status htstation
   ```
2. Check correct IP address:
   ```bash
   hostname -I
   ```
3. Verify port number in config.ini
4. Check firewall rules:
   ```bash
   sudo ufw allow 8089
   ```
5. Try localhost if on same machine:
   ```
   http://localhost:8089
   ```

### Page Loads But No Data

**Problem:** Web interface loads but shows no information

**Solutions:**
1. Check radio is connected via Bluetooth
2. Verify BBS server is enabled (BBS_STATION_ID set)
3. Check browser console for JavaScript errors (F12)
4. Refresh page (Ctrl+F5 or Cmd+Shift+R)
5. Check HtStation logs for errors

### Real-Time Updates Not Working

**Problem:** Page doesn't update automatically

**Solutions:**
1. Check WebSocket connection status (indicator)
2. Verify firewall allows WebSocket connections
3. Try different browser
4. Check for browser extensions blocking WebSockets
5. Manually refresh to see latest data

### Bulletin/Mail Actions Fail

**Problem:** Can't post bulletin or send mail

**Solutions:**
1. Check BBS/WinLink server is enabled
2. Verify storage directory is writable
3. Check browser console for errors
4. Try refreshing page
5. Check HtStation logs for server errors

### Map Not Displaying

**Problem:** APRS map doesn't load

**Solutions:**
1. Verify APRS messages have position data
2. Check internet connection (map tiles require internet)
3. Try different map provider
4. Check browser console for JavaScript errors
5. Ensure GPS data is valid in APRS messages

## Security Considerations

### Local Network Only (Recommended)

**Best practice:** Keep web interface on local network only
- No port forwarding
- Access via LAN IP only
- Network security protects interface

### No Built-in Authentication

**Current limitation:** Web interface has no password protection
- Anyone on network can access
- Admin capabilities for all users
- Trust your network security

**Mitigation strategies:**
1. **Use trusted network** only
2. **Enable firewall** rules
3. **Monitor access logs**
4. **Use VPN** for remote access
5. **Restrict network access** to authorized devices

### Future Security Features

Planned enhancements:
- User authentication
- Role-based access control
- HTTPS/SSL support
- API authentication tokens
- Activity logging

## Performance Tips

### For Best Performance

1. **Use modern browser:**
   - Chrome, Firefox, Safari, Edge (latest versions)
   
2. **Optimize network:**
   - Use Ethernet instead of WiFi when possible
   - Stay on same network as Raspberry Pi
   - Reduce network congestion

3. **Limit concurrent users:**
   - WebSocket updates scale to multiple users
   - But each user consumes bandwidth

4. **Regular cleanup:**
   - Delete old bulletins
   - Archive old mail
   - Limit stored APRS messages

## Example Configurations

### Standard Setup

```ini
# Radio and services
MACADDRESS=A1:B2:C3:D4:E5:F6
CALLSIGN=N0CALL
BBS_STATION_ID=1
ECHO_STATION_ID=2
WINLINK_STATION_ID=3

# Web interface
WEBSERVERPORT=8089

# Standard logging
CONSOLEMSG=App,Radio,BBS,WinLink
```

### High-Traffic Station

```ini
# Radio and services
MACADDRESS=A1:B2:C3:D4:E5:F6
CALLSIGN=N0CALL
BBS_STATION_ID=1
WINLINK_STATION_ID=3

# Web interface on standard port
WEBSERVERPORT=8080

# Detailed logging for monitoring
CONSOLEMSG=ALL
```

### Minimal Setup (Monitoring Only)

```ini
# Radio only
MACADDRESS=A1:B2:C3:D4:E5:F6
CALLSIGN=N0CALL

# All services disabled
BBS_STATION_ID=-1
ECHO_STATION_ID=-1
WINLINK_STATION_ID=-1

# Web interface for monitoring
WEBSERVERPORT=8089

# Minimal logging
CONSOLEMSG=App,Radio
```

## Browser Compatibility

### Supported Browsers

✅ **Fully Supported:**
- Chrome 90+ (Desktop & Mobile)
- Firefox 88+ (Desktop & Mobile)
- Safari 14+ (Desktop & Mobile)
- Edge 90+ (Desktop)

⚠️ **Limited Support:**
- Internet Explorer (not recommended)
- Older browser versions

### Required Features

- WebSocket support
- JavaScript enabled
- Local storage enabled
- CSS Grid layout support

## Additional Resources

- [Configuration Guide](config.md) - Complete config.ini documentation
- [BBS Guide](bbs.md) - BBS features and usage
- [WinLink Guide](winlink.md) - WinLink mail system
- [Home Assistant Integration](homeassistant.md) - MQTT features

## Summary

HtStation's web interface provides:
- ✅ Real-time monitoring of all station activity
- ✅ Live BBS session chat view
- ✅ APRS message tracking with map
- ✅ Bulletin and mail management
- ✅ Connection history and statistics
- ✅ Mobile-friendly responsive design
- ✅ WebSocket real-time updates

Access it at `http://your-pi-ip:8089` to monitor and manage your packet radio station from any device on your network!
