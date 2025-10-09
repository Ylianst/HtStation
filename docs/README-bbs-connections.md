# BBS Connection Logging Feature

This document describes the new connection logging functionality added to the HtStation BBS system.

## Overview

The BBS server now automatically logs all incoming connections and provides a command to view the connection history. This helps track usage patterns and provides valuable information about who has been connecting to your BBS.

## Features Implemented

### 🔗 **Automatic Connection Logging**
- Every successful BBS connection is automatically logged to a SQLite database
- Records include callsign, timestamp, and formatted local time
- Uses the robust storage.js module for reliable data persistence

### 📊 **LC Command - Last Connections**
- New `LC` or `LASTCONNECTIONS` command shows the 20 most recent connections
- Displays callsign and connection time in an easy-to-read format
- Integrated into the main menu system

### 🗃️ **Storage Management**
- Automatic cleanup maintains only the last 100 connections for performance
- Uses SQLite with WAL mode for crash-resistant logging
- Graceful error handling when storage is unavailable

## Usage

Callsign          Date/Time
----------------------------------------
W1ABC-1           10/04/2025, 21:30:15
K2DEF-1           10/04/2025, 21:25:42
N3GHI-1           10/04/2025, 21:20:08

Total: 3 connections
```
Callsign          Date/Time
----------------------------------------
W1ABC-1           10/04/2025, 21:30:15
K2DEF-1           10/04/2025, 21:25:42
N3GHI-1           10/04/2025, 21:20:08

Total: 3 connections
```

The disconnect command provides a graceful exit with session duration:
```
Thank you for using KK7VZT BBS!
Session duration: 15 minutes
73 and hope to see you again soon.
Disconnecting...
```
### For BBS Users
When connected to the BBS, users can now type:
- `LC` - View last connections
- `LASTCONNECTIONS` - Same as LC (full command name)
- `G` or `GAMES` - Enter Games submenu
- `D`, `DISCONNECT`, or `BYE` - Disconnect from BBS

#### Submenu System
The BBS now features a hierarchical menu system:

**Main Menu Commands:**
- `M` or `MENU` - Display main menu
- `T` or `TIME` - Show current time
- `UPTIME` - Show system uptime
- `LC` - Last connections
- `G` or `GAMES` - Enter Games submenu
- `D` or `BYE` - Disconnect

**Games Menu Commands:**
- `M` or `MENU` - Display games menu
- `MAIN` - Return to main menu
- `D` or `BYE` - Disconnect from BBS

The system tracks which menu each user is currently in and responds appropriately to menu commands.

#### Enhanced Welcome Messages
The BBS now provides personalized welcome messages that show when users last connected:

**First-time users see:**
```
Welcome to KK7VZT BBS
First time connecting - welcome!
Type 'M' or 'MENU' for main menu.
```

**Returning users see:**
```
Welcome to KK7VZT BBS
Last connected: 10/02/2025, 19:15:30 (2 days, 3 hours, 15 minutes ago)
Type 'M' or 'MENU' for main menu.
```

The LC command output looks like:
```
TEST BBS - Last Connections
Callsign          Date/Time
----------------------------------------
W1ABC-1           10/04/2025, 21:30:15
K2DEF-1           10/04/2025, 21:25:42
N3GHI-1           10/04/2025, 21:20:08

Total: 3 connections
```

The disconnect command provides a graceful exit:
```
Thank you for using TEST BBS!
73 and hope to see you again soon.
Disconnecting...
```
Callsign          Date/Time
----------------------------------------
W1ABC-1           10/04/2025, 21:30:15
K2DEF-1           10/04/2025, 21:25:42
N3GHI-1           10/04/2025, 21:20:08

Total: 3 connections
```

The disconnect command provides a graceful exit:
```
Thank you for using TEST BBS!
73 and hope to see you again soon.
Disconnecting...
```
========================================
Callsign          Date/Time
----------------------------------------
W1ABC-1           10/04/2025, 21:30:15
K2DEF-1           10/04/2025, 21:25:42
N3GHI-1           10/04/2025, 21:20:08

Total: 3 connections
```

### For Sysops
The connection logging is completely automatic. The system:
- Creates the database automatically on first use
- Logs connections when sessions reach CONNECTED state
- Maintains reasonable storage limits automatically
- Provides proper cleanup on shutdown

## Technical Details

### Database Location
- Default: `./data/bbs-connections.db`
- Also creates WAL and SHM files for crash recovery

### Storage Format
Each connection record contains:
```javascript
{
  callsign: "W1ABC-1",
  timestamp: "2025-01-10T21:30:00.000Z", 
  localTime: "01/10/2025, 21:30:00",
  sessionKey: "W1ABC-1"
}
```

### Performance Characteristics
- Uses prepared statements for optimal performance
- Automatic cleanup keeps database size reasonable
- Indexed by timestamp for fast sorting
- Minimal impact on BBS response time

## Code Integration

### Key Components Added

1. **Storage Integration** (`bbs.js` lines 15-22)
   ```javascript
   // === Connection Logging Storage ===
   try {
       this.storage = new Storage('./data/bbs-connections.db');
       console.log('[BBS Server] Connection logging initialized');
   } catch (error) {
       console.error('[BBS Server] Failed to initialize connection logging:', error);
       this.storage = null;
   }
   ```

2. **Connection Logging** (triggered on session CONNECTED state)
   ```javascript
   if (state === AX25Session.ConnectionState.CONNECTED) {
       // Log the connection
       this.logConnection(sessionKey);
       // ... welcome message ...
   }
   ```

3. **LC Command Handler** (added to command switch)
   ```javascript
   case 'lc':
   case 'lastconnections':
       response = this.getLastConnections();
       break;
   ```

### Error Handling
- Graceful fallback when storage is unavailable
- All storage operations wrapped in try-catch blocks
- Non-blocking - BBS continues to function even if logging fails
- Detailed console logging for troubleshooting

## File Structure

```
data/
├── bbs-connections.db      # Main connection log database
├── bbs-connections.db-wal  # Write-ahead log for crash recovery
└── bbs-connections.db-shm  # Shared memory file
```

## Testing

Run the included test suite to verify functionality:

```bash
node bbs-test.js
```

This tests:
- Storage initialization
- Connection logging
- Data retrieval (LC command)
- Cleanup operations
- All BBS commands including the new LC command

## Maintenance

### Automatic Maintenance
- Keeps only the last 100 connections automatically
- No manual maintenance required under normal operation

### Manual Maintenance (if needed)
```javascript
// Get storage statistics
const stats = bbs.storage.getStats();

// Force cleanup of old connections
bbs.cleanupOldConnections();

// Create backup
bbs.storage.backup('./backups/connections-backup.db');
```

## Integration Notes

This feature integrates seamlessly with the existing BBS system:
- ✅ No changes to existing AX.25 session handling
- ✅ No impact on existing commands or functionality
- ✅ Uses the same immediate-send pattern for responses
- ✅ Follows existing error handling patterns
- ✅ Consistent with existing logging and console output

## Benefits

1. **Usage Tracking** - See who's using your BBS and when
2. **Debugging** - Helps troubleshoot connection issues
3. **Historical Data** - Maintain records of BBS activity
4. **User Experience** - Users can see recent activity
5. **Reliability** - Crash-resistant logging with automatic recovery

The implementation provides a solid foundation for future BBS enhancements while maintaining the reliability and performance characteristics expected in amateur radio applications.
