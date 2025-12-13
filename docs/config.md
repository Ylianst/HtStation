# HtStation Configuration Guide

This document explains all available configuration options in the `config.ini` file.

## Configuration File Format

The `config.ini` file uses a simple key=value format:
- One setting per line
- Lines starting with `#` are comments
- Empty lines are ignored
- Multiple entries of the same key (like AUTH) are supported

## Required Settings

### MACADDRESS
**Type:** MAC Address (format: XX:XX:XX:XX:XX:XX)  
**Required:** Yes  
**Description:** The Bluetooth MAC address of your radio device.

```ini
MACADDRESS=38:D2:00:00:EF:24
```

**Important:** You must pair your radio via Bluetooth before setting this value. See [bluetooth.md](bluetooth.md) for pairing instructions.

### CALLSIGN
**Type:** String (Amateur Radio Callsign)  
**Required:** Yes  
**Description:** Your amateur radio callsign. This identifies your station on the network.

```ini
CALLSIGN=N0CALL
```

## Station ID Settings

Station IDs allow your radio to host multiple services on different addresses. Valid range is 0-15, or -1 to disable a service.

### BBS_STATION_ID
**Type:** Integer (0-15, or -1 to disable)  
**Required:** No (default: -1)  
**Description:** Station ID for the Bulletin Board System (BBS) service.

```ini
BBS_STATION_ID=1
```

When enabled, other stations can connect to your BBS at `YOURCALLSIGN-1`.

### ECHO_STATION_ID
**Type:** Integer (0-15, or -1 to disable)  
**Required:** No (default: -1)  
**Description:** Station ID for the Echo test service.

```ini
ECHO_STATION_ID=2
```

The echo service responds back with any data sent to it, useful for testing connections.

### WINLINK_STATION_ID
**Type:** Integer (0-15, or -1 to disable)  
**Required:** No (default: -1)  
**Description:** Station ID for the WinLink email service.

```ini
WINLINK_STATION_ID=3
```

When enabled, stations can send WinLink email messages through your station at `YOURCALLSIGN-3`.

### WINLINK_PASSWORD
**Type:** String  
**Required:** Only if WinLink is enabled  
**Description:** Password for WinLink CMS (Central Message Server) authentication.

```ini
WINLINK_PASSWORD=yourpassword
```

## Web Server Settings

### WEBSERVERPORT
**Type:** Integer (1-65535)  
**Required:** No (default: 8089)  
**Description:** TCP port for the web management interface.

```ini
WEBSERVERPORT=8089
```

Access the web interface at `http://your-pi-ip:8089/` after starting HtStation.

## MQTT / Home Assistant Integration

HtStation can publish radio status and accept commands via MQTT, enabling Home Assistant integration.

### MQTT_BROKER_URL
**Type:** URL  
**Required:** For MQTT features  
**Description:** Full URL to your MQTT broker.

```ini
MQTT_BROKER_URL=mqtt://192.168.2.192:1883
```

Supported formats:
- `mqtt://hostname:1883` - Standard MQTT
- `mqtts://hostname:8883` - MQTT over TLS
- `ws://hostname:8080` - MQTT over WebSocket
- `wss://hostname:8443` - MQTT over secure WebSocket

### MQTT_TOPIC
**Type:** String  
**Required:** For MQTT features  
**Description:** Base topic prefix for all MQTT messages.

```ini
MQTT_TOPIC=homeassistant/uvpro-radio
```

HtStation will publish to sub-topics like:
- `homeassistant/uvpro-radio/battery`
- `homeassistant/uvpro-radio/volume`
- `homeassistant/uvpro-radio/squelch`
- `homeassistant/uvpro-radio/aprs_message`

### MQTT_USERNAME
**Type:** String  
**Required:** If your MQTT broker requires authentication  
**Description:** Username for MQTT broker authentication.

```ini
MQTT_USERNAME=btradio
```

### MQTT_PASSWORD
**Type:** String  
**Required:** If your MQTT broker requires authentication  
**Description:** Password for MQTT broker authentication.

```ini
MQTT_PASSWORD=mypassword
```

## Authentication Settings

### AUTH
**Type:** String (format: CALLSIGN-SSID,password)  
**Required:** No  
**Multiple:** Yes (can have multiple AUTH entries)  
**Description:** Define authentication credentials for stations connecting to your BBS or WinLink services.

```ini
AUTH=N0CALL,password
AUTH=N0CALL-7,super
AUTH=N0CALL-6,mypassword
```

**Format:** Each AUTH entry consists of:
1. Callsign with optional SSID (e.g., `N0CALL-7`)
2. Comma separator
3. Password

**Usage:**
- Authenticated stations can access trusted features
- APRS messages from authenticated stations are marked as "trusted"
- Required for secure BBS and WinLink operations

## Logging Settings

### CONSOLEMSG
**Type:** String (comma-separated categories or "ALL"/"NONE")  
**Required:** No (default: ALL)  
**Description:** Controls which types of console messages are displayed.

```ini
# Show only specific categories
CONSOLEMSG=WebServer,MQTT,APRS

# Show all messages
CONSOLEMSG=ALL

# Show no messages (quiet mode)
CONSOLEMSG=NONE

# Show multiple categories
CONSOLEMSG=App,Radio,BBS,WinLink
```

**Available Categories:**
- `App` - Application startup/shutdown messages
- `Radio` - Radio connection and status messages
- `RadioCtl` - Radio control commands and responses
- `MQTT` - MQTT connection and publishing messages
- `WebServer` - Web server requests and events
- `BBS` - BBS session and message handling
- `APRS` - APRS packet processing and routing
- `WinLink` - WinLink email operations
- `Echo` - Echo service activity
- `Storage` - File storage operations
- `YAPP` - YAPP file transfer protocol messages
- `Session` - AX.25 session management
- `Bulletin` - Bulletin board operations
- `Files` - File operations
- `Mail` - Mail handling
- `Joke` - Joke of the day feature

## Complete Example Configurations

### Minimal Configuration (BBS Only)

```ini
# Radio connection
MACADDRESS=38:D2:00:00:EF:24
CALLSIGN=N0CALL

# Enable BBS service
BBS_STATION_ID=1

# Web interface
WEBSERVERPORT=8089

# Authentication
AUTH=N0CALL,mypassword
AUTH=N0CALL-5,friend123

# Logging
CONSOLEMSG=App,Radio,BBS
```

### Full Featured Configuration (All Services)

```ini
# Radio connection
MACADDRESS=38:D2:00:00:EF:24
CALLSIGN=N0CALL

# All services enabled
BBS_STATION_ID=1
ECHO_STATION_ID=2
WINLINK_STATION_ID=3
WINLINK_PASSWORD=your_winlink_password

# Web interface
WEBSERVERPORT=8089

# MQTT / Home Assistant integration
MQTT_BROKER_URL=mqtt://192.168.2.192:1883
MQTT_TOPIC=homeassistant/uvpro-radio
MQTT_USERNAME=btradio
MQTT_PASSWORD=myradio

# Authentication for multiple stations
AUTH=N0CALL,password1
AUTH=N0CALL-5,password2
AUTH=N0CALL-7,password3
AUTH=W1AW,password4
AUTH=W1AW-9,password5

# Show all logging
CONSOLEMSG=ALL
```

### Home Assistant Only (No Services)

```ini
# Radio connection
MACADDRESS=38:D2:00:00:EF:24
CALLSIGN=N0CALL

# Disable all services (use -1)
BBS_STATION_ID=-1
ECHO_STATION_ID=-1
WINLINK_STATION_ID=-1

# Web interface
WEBSERVERPORT=8089

# MQTT for Home Assistant control
MQTT_BROKER_URL=mqtt://192.168.1.100:1883
MQTT_TOPIC=homeassistant/uvpro-radio
MQTT_USERNAME=homeassistant
MQTT_PASSWORD=ha_password

# Quiet logging - only show important messages
CONSOLEMSG=App,Radio,MQTT
```

### Testing Configuration

```ini
# Radio connection
MACADDRESS=38:D2:00:00:EF:24
CALLSIGN=N0CALL

# Only enable Echo service for testing
BBS_STATION_ID=-1
ECHO_STATION_ID=2
WINLINK_STATION_ID=-1

# Web interface
WEBSERVERPORT=8089

# No MQTT
# MQTT_BROKER_URL=
# MQTT_TOPIC=

# Testing authentication
AUTH=N0CALL,test123

# Verbose logging for debugging
CONSOLEMSG=ALL
```

## Configuration Tips

### Security Best Practices

1. **Use strong passwords** in AUTH entries
2. **Secure your MQTT broker** with authentication
3. **Change default passwords** (like WINLINK_PASSWORD)
4. **Limit AUTH entries** to trusted stations only

### Performance Optimization

1. **Use CONSOLEMSG filtering** to reduce log noise in production
2. **Disable unused services** (set station ID to -1)
3. **Use local MQTT broker** for best performance

### Troubleshooting

1. **Check MACADDRESS format** - must match exactly with paired device
2. **Verify station IDs** - must be unique (0-15)
3. **Test MQTT connection** separately before enabling
4. **Use CONSOLEMSG=ALL** when debugging issues

## Applying Configuration Changes

After modifying `config.ini`:

1. **Save the file**
2. **Restart HtStation:**
   ```bash
   # If running in console mode (--run)
   Press CTRL+C, then restart with: node htstation.js --run
   
   # If running as a service
   sudo systemctl restart htstation
   ```

## Additional Resources

- [Bluetooth Pairing Guide](bluetooth.md) - How to pair your radio
- [HtStation GitHub](https://github.com/Ylianst/HtStation) - Project repository
- [Home Assistant MQTT](https://www.home-assistant.io/integrations/mqtt/) - HA integration docs
