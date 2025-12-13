# Bulletin Board System (BBS) Guide

This guide explains how to configure and use the BBS (Bulletin Board System) feature in HtStation for packet radio communications.

## What is a BBS?

A Bulletin Board System (BBS) is a computer system that allows users to connect via radio to:
- **Read and post bulletins** - Share information with other users
- **Play games** - Interactive text-based games over packet radio
- **Download files** - Transfer files using YAPP protocol
- **View station information** - Connection history, APRS messages, system status
- **Exchange messages** - Communicate with other radio operators

BBS systems were popular in the 1980s-90s and remain valuable tools for amateur radio communications, especially when internet is unavailable.

## BBS Features

### 1. Bulletin Board
- **Post bulletins** - Share information (up to 300 characters)
- **View bulletins** - See messages from other stations
- **Delete bulletins** - Remove your own bulletins
- **Automatic expiration** - Bulletins expire after 7 days
- **Limit per user** - Maximum 3 bulletins per callsign

### 2. File Downloads
- **File browser** - View available files organized by category
- **YAPP protocol** - Binary file transfer over packet radio
- **Organized storage** - Files in folders (documents, software, etc.)
- **Resume support** - Can resume interrupted transfers

### 3. Games
- **Guess the Number** - Number guessing game
- **Blackjack** - Card game against the dealer
- **Joke of the Day** - Random jokes for entertainment

### 4. Information Services
- **Connection history** - See who has connected to the BBS
- **APRS messages** - View recent APRS messages received
- **System information** - Current time, system uptime, load average
- **Session statistics** - Track your connection duration

## Configuration

### Enable BBS Server

Edit your `config.ini` file:

```ini
# Station configuration
CALLSIGN=N0CALL
BBS_STATION_ID=1             # Enable BBS on SSID 1
ECHO_STATION_ID=2
WINLINK_STATION_ID=3
```

### Configuration Options

#### BBS_STATION_ID
- **Type:** Integer (0-15, or -1 to disable)
- **Required:** Yes (to enable BBS)
- **Description:** Station ID for BBS service

```ini
BBS_STATION_ID=1    # BBS available at N0CALL-1
```

### Station ID Selection

- **Valid range:** 0-15
- **-1 to disable:** Set to `-1` to turn off BBS server
- **Must be unique:** Don't use the same ID as Echo or WinLink

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

## Connecting to the BBS

### From Terminal/TNC

1. **Connect to BBS station:**
   ```
   C N0CALL-1
   ```

2. **Welcome message appears:**
   ```
   Welcome to N0CALL BBS
   Last connected: 12/13/2024, 10:30:00 (2 hours ago)
   Type 'M' or 'MENU' for main menu.
   ```

3. **Navigate using commands** (see BBS Commands section)

4. **Disconnect:**
   ```
   BYE
   ```

### From Compatible Software

Most packet radio terminal programs can connect:
- **QtTerminal** - Modern cross-platform terminal
- **Outpost PM** - Windows packet radio program
- **LinBPQ** - Linux BBS/node software
- **APRS clients** - Some support direct connections

## BBS Commands

### Main Menu Commands

```
[M]ENU     - Display main menu
[T]IME     - Display current time
UPTIME     - Display system uptime
LC         - Last connections to BBS
APRSMSGS   - Last received APRS messages
[B]ULL     - View active bulletins
NEWB       - Post new bulletin
DELB       - Delete your bulletin
[F]ILES    - Browse and download files
[G]AMES    - Games submenu
BYE        - Disconnect from BBS
```

### Games Menu Commands

```
[M]ENU     - Display games menu
[G]UESS    - Guess the Number game
[B]LKJK    - Blackjack game
[J]OKE     - Joke of the Day
MAIN       - Return to main menu
BYE        - Disconnect from BBS
```

### File Commands

```
FILES           - Display available files
DOWNLOAD <name> - Download file by name
MAIN            - Return to main menu
```

**Example:**
```
DOWNLOAD htstation-manual.txt
```

## Using BBS Features

### Viewing Bulletins

1. **From main menu, type:** `B` or `BULL`
2. **Bulletins display:**
   ```
   N0CALL BBS - Active Bulletins
   =============================
   [1] From: W1XYZ
       Posted: 12/13/2024, 08:00:00
       Expires: 5 days
       Message: Club meeting this Saturday at 2pm
   
   [2] From: K2ABC
       Posted: 12/12/2024, 14:30:00
       Expires: 6 days
       Message: Looking for QSOs on 146.520 MHz
   
   Total: 2 bulletins
   ```

### Posting a Bulletin

1. **From main menu, type:** `NEWB`
2. **See your bulletin count:**
   ```
   N0CALL BBS - Post New Bulletin
   ================================
   You currently have 0/3 bulletins.
   
   Enter your bulletin message (300 char max):
   Or type 'MAIN' to return to main menu.
   ```
3. **Type your message** (up to 300 characters)
4. **Bulletin is posted:**
   ```
   Bulletin posted successfully!
   Bulletin ID: 1734123456789
   Expires: 12/20/2024, 10:30:00
   ```

**Notes:**
- Maximum 3 bulletins per callsign
- Maximum 300 characters per bulletin
- Bulletins expire after 7 days
- Only you can delete your bulletins

### Deleting a Bulletin

1. **From main menu, type:** `DELB`
2. **See your bulletins:**
   ```
   N0CALL BBS - Delete Your Bulletins
   ====================================
   Your bulletins:
   
   [1] ID: 1734123456789
       Posted: 12/13/2024, 10:30:00
       Expires: 5 days
       Message: Testing bulletin system
   
   Enter bulletin number (1-1) to delete,
   or type 'MAIN' to return to main menu.
   ```
3. **Enter number:** `1`
4. **Bulletin deleted:**
   ```
   Bulletin deleted successfully!
   ```

### Downloading Files

1. **From main menu, type:** `F` or `FILES`
2. **File list displays:**
   ```
   N0CALL BBS - Available Files
   =============================
   Name                    Size     Category
   ----                    ----     --------
   htstation-manual.txt    45 KB    documents
   packet-utils.txt        12 KB    software
   README.txt              3 KB     main
   
   Total: 3 files
   Use: DOWNLOAD <filename> to download a file
   ```
3. **Download a file:** `DOWNLOAD htstation-manual.txt`
4. **Transfer begins using YAPP protocol**
5. **Completion message:**
   ```
   File transfer completed.
   File: htstation-manual.txt, Size: 45 KB
   [M] for menu.
   ```

**Note:** Your terminal software must support YAPP protocol for file transfers.

### Playing Games

#### Guess the Number

1. **From main menu:** `G` (Games)
2. **From games menu:** `G` or `GUESS`
3. **Game starts:**
   ```
   Guess the Number Game
   =====================
   I'm thinking of a number between 1 and 100
   You have 7 tries
   
   Enter your guess (1-100):
   ```
4. **Make guesses** until you win or run out of tries
5. **Type** `Q` to quit game

#### Blackjack

1. **From games menu:** `B` or `BLKJK`
2. **Game starts:**
   ```
   Blackjack
   =========
   Dealer: 7 [?]
   You: 10 K (20)
   
   [H]it, [S]tand, or [Q]uit?
   ```
3. **Play your hand:** `H` (hit) or `S` (stand)
4. **See results and play again**

#### Joke of the Day

1. **From games menu:** `J` or `JOKE`
2. **Random joke displays:**
   ```
   Joke of the Day
   ===============
   Why did the ham radio operator bring a ladder?
   To reach the high frequencies!
   
   [MAIN] to return to games menu
   ```

## File Management

### Adding Files to BBS

Files are served from the `pubfiles` directory:

```
pubfiles/
├── README.txt
├── documents/
│   └── htstation-manual.txt
└── software/
    └── packet-utils.txt
```

**To add files:**

1. **Navigate to pubfiles directory:**
   ```bash
   cd /home/default/HtStation/pubfiles
   ```

2. **Create category folders** (optional):
   ```bash
   mkdir documents
   mkdir software
   mkdir images
   ```

3. **Copy files:**
   ```bash
   cp /path/to/your/file.txt documents/
   ```

4. **Files automatically appear** in BBS file browser

**File organization tips:**
- **documents/** - Manuals, guides, documentation
- **software/** - Programs, utilities, scripts
- **images/** - Photos, diagrams, maps
- **main/** (root) - General files, README

## Data Storage

### Connection Logging

Connection history stored in:
```
data/bbs-connections.db
```

Records include:
- Callsign
- Connection time
- Session duration
- Packets sent/received
- Bytes transferred

**Retention:** Last 100 connections kept

### Bulletin Storage

Bulletins stored in:
```
data/bbs-bulletins.db
```

Records include:
- Bulletin ID
- Callsign
- Message content
- Posted time
- Expiration time

**Cleanup:** Expired bulletins automatically deleted

### APRS Message Access

BBS can display APRS messages from:
```
data/aprs-messages.db
```

Shows last 20 received APRS messages

## Session Management

### Connection Process

1. **Client initiates** (SABM/SABME)
2. **BBS responds** with welcome message
3. **Session tracked:**
   - Start time recorded
   - Menu state maintained
   - Game state preserved
4. **Statistics collected:**
   - Packets sent/received
   - Bytes transferred
   - Connection duration
5. **Clean disconnect** (DISC or BYE command)

### Busy Detection

If a station tries to connect while already connected to another service:

1. **BBS detects busy state**
2. **Sends DM (Disconnect Mode) response**
3. **Connection refused**

**Example:**
```
Station W1XYZ-5 connected to WinLink (N0CALL-3)
W1XYZ-5 tries to connect to BBS (N0CALL-1)
→ BBS sends DM, refuses connection
```

### Multiple Concurrent Sessions

BBS handles multiple stations connecting simultaneously:
- Each station has independent session
- Separate menu states and game states
- No interference between connections

## Example Configurations

### BBS Only Setup

```ini
# Radio connection
MACADDRESS=38:D2:00:00:EF:24
CALLSIGN=N0CALL

# Enable only BBS
BBS_STATION_ID=1
ECHO_STATION_ID=-1
WINLINK_STATION_ID=-1

# Web interface
WEBSERVERPORT=8089

# Logging
CONSOLEMSG=ALL
```

### Full Station with BBS

```ini
# Radio connection
MACADDRESS=38:D2:00:00:EF:24
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
CONSOLEMSG=App,Radio,BBS
```

### Community BBS Station

```ini
# Radio connection
MACADDRESS=38:D2:00:00:EF:24
CALLSIGN=N0CALL

# BBS with support services
BBS_STATION_ID=1
ECHO_STATION_ID=2          # For testing
WINLINK_STATION_ID=-1      # Disable WinLink

# Web interface
WEBSERVERPORT=8089

# Detailed logging for community use
CONSOLEMSG=BBS,Session,APRS
```

## Logging and Monitoring

### Console Output

When `CONSOLEMSG` includes `BBS`, you'll see:

```
[BBS Session] Creating new session for W1XYZ-5
[BBS Session] W1XYZ-5 state changed to CONNECTED
[BBS Session] Sending welcome message to W1XYZ-5
[BBS Session] W1XYZ-5 received 2 bytes: M
[BBS Session] Sending command response to W1XYZ-5
[BBS Bulletin] Created bulletin 1734123456789 by W1XYZ: "Testing BBS"
[BBS YAPP] Transfer started for W1XYZ-5: manual.txt
[BBS YAPP] Transfer progress for W1XYZ-5: 50% (25000/50000 bytes)
[BBS YAPP] Transfer completed for W1XYZ-5: manual.txt (50000 bytes in 45s)
[BBS Session] W1XYZ-5 state changed to DISCONNECTED
```

### Web Interface

Monitor BBS activity through web dashboard:
- **Active connections** - See who's connected now
- **Connection history** - Review past connections
- **Bulletin management** - View/delete bulletins from web
- **Real-time chat** - See command exchanges live
- **Session statistics** - Packets, bytes, duration

### Configuration for Detailed Logging

```ini
# Show only BBS messages
CONSOLEMSG=BBS,Session

# Show all messages for debugging
CONSOLEMSG=ALL

# Quiet mode (errors only)
CONSOLEMSG=NONE
```

## Troubleshooting

### BBS Not Responding

**Problem:** Stations can't connect to BBS

**Solutions:**
1. Verify `BBS_STATION_ID` is set (not -1)
2. Check radio is connected via Bluetooth
3. Verify SSID doesn't conflict with other services
4. Check logs for errors
5. Test with Echo server first

### Commands Not Working

**Problem:** BBS doesn't respond to commands

**Solutions:**
1. Check spelling (case insensitive)
2. Try single-letter shortcuts (M, T, B, etc.)
3. Type `MENU` to see current menu
4. Type `MAIN` to return to main menu
5. Reconnect if session seems stuck

### File Transfer Fails

**Problem:** YAPP downloads don't complete

**Solutions:**
1. Verify terminal supports YAPP protocol
2. Check file exists in pubfiles directory
3. Test with smaller files first
4. Check signal quality
5. Ensure sufficient transfer timeout

### Bulletins Not Saving

**Problem:** Posted bulletins disappear

**Solutions:**
1. Check storage directory exists and writable
2. Verify bulletin is under 300 characters
3. Ensure you haven't reached 3 bulletin limit
4. Check for database errors in logs
5. Verify disk space available

### Station Busy Response

**Problem:** BBS sends DM (busy) response

**Solution:**
- Station already connected to another service
- Disconnect from other service first
- Then connect to BBS

## Best Practices

### 1. Organize Files Well

```bash
pubfiles/
├── README.txt                    # Explain file structure
├── documents/
│   ├── station-info.txt
│   └── operating-guide.txt
├── software/
│   └── packet-utilities.txt
└── images/
    └── station-map.png
```

### 2. Regular Maintenance

```bash
# Check connection logs
sudo journalctl -u htstation | grep BBS | tail -50

# Review bulletins periodically
# Clean up expired ones via web interface

# Monitor disk space
df -h /home/default/HtStation/data
```

### 3. Welcome New Users

- Keep README.txt in pubfiles with instructions
- Post welcome bulletin for first-time visitors
- Include station info and operating hours
- Provide contact information

### 4. Monitor Activity

```bash
# View recent BBS connections
# From web interface: http://your-pi-ip:8089/

# Check active sessions
# View real-time connection statistics
```

### 5. Backup Important Data

```bash
# Backup bulletins and connection logs
tar -czf bbs-backup-$(date +%Y%m%d).tar.gz data/bbs-*.db

# Backup pubfiles
tar -czf pubfiles-backup-$(date +%Y%m%d).tar.gz pubfiles/
```

## Security Considerations

### Access Control

- **No authentication required** - Public BBS access
- **Bulletin ownership** - Users can only delete their own
- **No private messaging** - All bulletins are public
- **File access** - All files publicly available

### Resource Limits

- **3 bulletins per user** - Prevent spam
- **300 character limit** - Keep messages concise
- **7 day expiration** - Automatic cleanup
- **100 connection history** - Limit database growth

### Content Guidelines

- Amateur radio regulations apply
- No encryption or obscured messages
- No commercial content
- No offensive material
- Station identification required

## Additional Resources

- [Configuration Guide](config.md) - Complete config.ini documentation
- [AX.25 Protocol](https://www.tapr.org/pdf/AX25.2.2.pdf) - Technical details
- [YAPP Protocol](http://www.ka9q.net/papers/yapp.html) - File transfer protocol
- [Packet Radio Guide](https://www.arrl.org/packet-radio) - ARRL packet radio info

## Summary

HtStation's BBS provides:
- ✅ Bulletin board for information sharing
- ✅ File downloads via YAPP protocol
- ✅ Interactive games over packet radio
- ✅ Connection history and APRS message viewing
- ✅ Multi-user concurrent access
- ✅ Web-based monitoring and management

Enable it by setting `BBS_STATION_ID` in `config.ini`, and stations can connect to share information, download files, and have fun with packet radio!
