# Storage Module for HtStation

A robust SQLite-based storage module optimized for Raspberry Pi and MicroSD card usage. This module provides a simple key-value interface for persisting JavaScript objects with excellent crash recovery and performance characteristics.

## Features

- **Single File Database**: All data stored in one SQLite file
- **Crash Recovery**: WAL (Write-Ahead Logging) mode for better crash resistance
- **MicroSD Optimized**: Configured for minimal write wear on SD cards
- **Atomic Transactions**: Batch operations with ACID compliance
- **Backup Support**: Simple file-based backup system
- **Pattern Matching**: SQL LIKE pattern support for key searches
- **Statistics**: Database size and performance metrics

## Installation

The storage module requires `better-sqlite3` version 11.3.0 (compatible with Node.js 18.x):

```bash
npm install better-sqlite3@11.3.0
```

## Basic Usage

```javascript
const Storage = require('./storage');

// Initialize storage (creates database if it doesn't exist)
const storage = new Storage('./data/my-app.db');

// Save an object
const config = {
    frequency: 145.500,
    mode: 'FM',
    power: 5,
    users: ['W1ABC', 'K2DEF']
};
storage.save('radio-config', config);

// Load an object
const loadedConfig = storage.load('radio-config');
console.log(loadedConfig); // { frequency: 145.5, mode: 'FM', ... }

// Check if key exists
if (storage.exists('radio-config')) {
    console.log('Configuration found!');
}

// Always close when done
storage.close();
```

## API Reference

### Constructor

```javascript
new Storage(dbPath = './data/storage.db')
```

Creates a new storage instance. The database file and directory will be created if they don't exist.

### Core Methods

#### `save(key, object)`
Saves any JSON-serializable object to storage.
- **key**: String identifier
- **object**: Any JSON-serializable data
- **Returns**: Boolean success status

#### `load(key)`
Loads an object from storage.
- **key**: String identifier
- **Returns**: The stored object or `null` if not found

#### `delete(key)`
Removes an object from storage.
- **key**: String identifier
- **Returns**: Boolean indicating if something was deleted

#### `exists(key)`
Checks if a key exists in storage.
- **key**: String identifier
- **Returns**: Boolean

### Batch Operations

#### `saveAll(keyValuePairs)`
Saves multiple objects in a single transaction.
```javascript
storage.saveAll({
    'config1': { setting: 'value1' },
    'config2': { setting: 'value2' }
});
```

#### `loadAll(keys)`
Loads multiple objects by their keys.
```javascript
const configs = storage.loadAll(['config1', 'config2']);
```

### Query Methods

#### `keys()`
Returns an array of all keys in storage.

#### `list(pattern)`
Returns keys matching a SQL LIKE pattern.
```javascript
// Find all keys starting with "config"
const configKeys = storage.list('config%');
```

#### `count()`
Returns the total number of stored items.

### Maintenance

#### `backup(backupPath)`
Creates a backup copy of the database.
```javascript
storage.backup('./backups/backup-' + Date.now() + '.db');
```

#### `vacuum()`
Optimizes the database (should be called periodically).

#### `getStats()`
Returns database statistics including file size, page count, etc.

#### `clear()`
Removes all data from storage.

#### `close()`
Closes the database connection. Always call this when shutting down.

## Ham Radio Use Cases

### Station Configuration
```javascript
const stationConfig = {
    callsign: 'W1ABC',
    grid: 'FN42aa',
    power: 100,
    antennas: ['2m/70cm Dual Band', '6m Beam']
};
storage.save('station-info', stationConfig);
```

### Contact Log
```javascript
const contacts = [
    { call: 'K2DEF', time: '2025-01-10 21:30:00', freq: '145.500', mode: 'FM' },
    { call: 'N3GHI', time: '2025-01-10 21:25:00', freq: '146.520', mode: 'FM' }
];
storage.save('recent-contacts', contacts);
```

### Memory Channels
```javascript
const channels = {
    1: { freq: 145.500, offset: -0.600, tone: 88.5, name: 'Repeater 1' },
    2: { freq: 146.520, offset: 0, tone: null, name: 'Simplex' }
};
storage.save('memory-channels', channels);
```

### Message Storage
```javascript
// Store APRS messages
storage.save('aprs-msg-' + Date.now(), {
    from: 'W1ABC',
    to: 'K2DEF',
    message: 'QRT for dinner',
    timestamp: new Date().toISOString()
});
```

## Configuration for Raspberry Pi

The storage module is pre-configured for optimal Raspberry Pi performance:

- **WAL Mode**: Better crash recovery and concurrent access
- **Reduced Sync**: Less frequent disk syncing to reduce SD card wear
- **Memory Temp Store**: Temporary data kept in memory
- **Optimized Cache**: 1000-page cache for better performance

## Backup Strategy

For production use, implement regular backups:

```javascript
// Daily backup
setInterval(() => {
    const date = new Date().toISOString().split('T')[0];
    storage.backup(`./backups/daily-${date}.db`);
}, 24 * 60 * 60 * 1000);

// Weekly optimization
setInterval(() => {
    storage.vacuum();
}, 7 * 24 * 60 * 60 * 1000);
```

## Error Handling

The storage module includes comprehensive error handling:

```javascript
try {
    const result = storage.save('test-key', data);
    if (!result) {
        console.error('Failed to save data');
    }
} catch (error) {
    console.error('Storage error:', error);
}
```

## File Structure

When using the default path, the storage module creates:

```
data/
├── storage.db          # Main database file
├── storage.db-wal      # Write-ahead log (WAL file)
└── storage.db-shm      # Shared memory file
```

## Testing

Run the included test suite:

```bash
node storage-test.js
```

This will create a test database and verify all functionality.

## Performance Notes

- Prepared statements provide excellent performance for repeated operations
- Transactions ensure batch operations are atomic and fast
- WAL mode allows concurrent readers while writing
- Database is optimized for the typical access patterns of embedded applications

## Integration Example

Here's how you might integrate the storage module into your HtStation application:

```javascript
// app-storage.js
const Storage = require('./storage');

class AppStorage {
    constructor() {
        this.storage = new Storage('./data/htstation.db');
        
        // Set up periodic maintenance
        this.setupMaintenance();
    }
    
    // Station settings
    saveStationConfig(config) {
        return this.storage.save('station-config', config);
    }
    
    getStationConfig() {
        return this.storage.load('station-config') || this.getDefaultConfig();
    }
    
    // Recent contacts
    addContact(contact) {
        const contacts = this.getRecentContacts();
        contacts.unshift(contact);
        // Keep only last 100 contacts
        if (contacts.length > 100) {
            contacts.splice(100);
        }
        return this.storage.save('recent-contacts', contacts);
    }
    
    getRecentContacts() {
        return this.storage.load('recent-contacts') || [];
    }
    
    // Cleanup
    close() {
        this.storage.close();
    }
    
    setupMaintenance() {
        // Daily backup
        setInterval(() => {
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            this.storage.backup(`./backups/htstation-${timestamp}.db`);
        }, 24 * 60 * 60 * 1000);
    }
    
    getDefaultConfig() {
        return {
            callsign: '',
            grid: '',
            power: 5,
            mode: 'FM'
        };
    }
}

module.exports = AppStorage;
```

This provides a foundation for reliable data persistence in your Ham radio applications!
