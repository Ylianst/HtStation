# Console Logging System

The HtStation application includes a configurable console logging system that allows you to control which types of messages are displayed in the console. This is useful for reducing noise and focusing on specific areas of the application during debugging or normal operation.

## Configuration

Console logging is controlled by the `CONSOLEMSG` setting in `config.ini`.

### Format

```ini
CONSOLEMSG=<category1>,<category2>,<category3>
```

### Available Categories

The following logging categories are available:

- **App** - Main application lifecycle and routing
- **Radio** - Radio hardware communication and status
- **RadioCtl** - Radio controller and MQTT integration
- **MQTT** - MQTT broker communication
- **WebServer** - Web server and WebSocket communications
- **BBS** - BBS server operations and sessions
- **APRS** - APRS message processing and storage
- **WinLink** - WinLink email server operations
- **Echo** - Echo server operations
- **Storage** - Database operations and file storage
- **YAPP** - YAPP file transfer protocol
- **Session** - AX.25 session management
- **Bulletin** - BBS bulletin operations
- **Files** - File system operations
- **Mail** - Email composition and management
- **Joke** - Joke game operations

### Special Values

- **ALL** - Show all console messages (default)
- **NONE** - Disable all console messages
- **Empty or omitted** - Also shows all messages

### Examples

#### Show only web server and MQTT messages:
```ini
CONSOLEMSG=WebServer,MQTT
```

#### Show APRS and radio-related messages:
```ini
CONSOLEMSG=APRS,Radio,RadioCtl
```

#### Show all messages (default behavior):
```ini
CONSOLEMSG=ALL
```

#### Disable all console messages:
```ini
CONSOLEMSG=NONE
```

#### Disable specific categories (show everything except):
There's no direct "exclude" syntax, but you can list all categories you want to see.

For example, to see everything except YAPP and Joke:
```ini
CONSOLEMSG=App,Radio,RadioCtl,MQTT,WebServer,BBS,APRS,WinLink,Echo,Storage,Session,Bulletin,Files,Mail
```

## Usage in Code

### For Module Developers

When writing new modules or updating existing ones, use the global logger instance:

```javascript
// At the top of your module
const logger = global.logger ? global.logger.getLogger('YourCategory') : console;

// Then use throughout your code:
logger.log('[YourCategory] Normal message');
logger.error('[YourCategory] Error message');
logger.warn('[YourCategory] Warning message');
logger.info('[YourCategory] Info message');
```

### Legacy Code

Existing code with hardcoded `console.log()` calls will continue to work but won't be filtered. To add filtering to existing code:

**Before:**
```javascript
console.log('[WebServer] Starting server...');
console.error('[WebServer] Failed to start:', error);
```

**After:**
```javascript
const logger = global.logger ? global.logger.getLogger('WebServer') : console;

logger.log('[WebServer] Starting server...');
logger.error('[WebServer] Failed to start:', error);
```

## Best Practices

1. **Use appropriate log levels:**
   - `log()` - Normal operational messages
   - `error()` - Errors that need attention
   - `warn()` - Warnings about potential issues
   - `info()` - Informational messages

2. **Include category prefix in messages:**
   ```javascript
   logger.log('[WebServer] Client connected');
   ```

3. **Use consistent category names:**
   - Use the exact category name from the available list
   - Case doesn't matter in config.ini (WebServer = webserver = WEBSERVER)

4. **Keep messages concise but informative:**
   ```javascript
   // Good
   logger.log('[APRS] Stored message from KK7VZT-7');
   
   // Too verbose
   logger.log('[APRS] The APRS subsystem has successfully completed the operation to store a message received from station KK7VZT with SSID 7');
   ```

## Troubleshooting

### No messages appearing

1. Check that `CONSOLEMSG` is set correctly in `config.ini`
2. Verify the category name matches exactly (case-insensitive)
3. Ensure the application was restarted after changing `config.ini`

### Too many messages

Set `CONSOLEMSG` to only the categories you're interested in:
```ini
# Only show critical systems
CONSOLEMSG=App,Radio,WebServer
```

### Message still appears despite filtering

The message might be using direct `console.log()` instead of the logger. These bypass the filtering system and will always appear.

## Migration Guide

To update existing code to use the filtered logging system:

1. Add logger import at module level:
   ```javascript
   const logger = global.logger ? global.logger.getLogger('CategoryName') : console;
   ```

2. Replace `console.log()` with `logger.log()`:
   ```javascript
   // Before
   console.log('[CategoryName] Message');
   
   // After
   logger.log('[CategoryName] Message');
   ```

3. Test with filtering enabled:
   ```ini
   CONSOLEMSG=CategoryName
   ```

4. Verify messages appear when category is enabled and hidden when disabled.
