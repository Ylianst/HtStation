'use strict';

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

/**
 * Storage class for persisting JavaScript objects to SQLite database
 * Optimized for Raspberry Pi and MicroSD card usage
 */
class Storage {
    constructor(dbPath = './data/storage.db') {
        this.dbPath = dbPath;
        this.db = null;
        this.isInitialized = false;
        
        // Ensure data directory exists
        const dbDir = path.dirname(dbPath);
        if (!fs.existsSync(dbDir)) {
            fs.mkdirSync(dbDir, { recursive: true });
        }
        
        this.init();
    }
    
    /**
     * Initialize the database connection and create tables
     */
    init() {
        try {
            this.db = new Database(this.dbPath);
            
            // Optimize for Pi/MicroSD - enable WAL mode for better crash recovery
            this.db.pragma('journal_mode = WAL');
            this.db.pragma('synchronous = NORMAL');
            this.db.pragma('cache_size = 1000');
            this.db.pragma('foreign_keys = ON');
            this.db.pragma('temp_store = MEMORY');
            
            // Create the key-value table
            this.db.exec(`
                CREATE TABLE IF NOT EXISTS storage (
                    key TEXT PRIMARY KEY,
                    value TEXT NOT NULL,
                    created_at INTEGER DEFAULT (strftime('%s', 'now')),
                    updated_at INTEGER DEFAULT (strftime('%s', 'now'))
                )
            `);
            
            // Create update trigger
            this.db.exec(`
                CREATE TRIGGER IF NOT EXISTS update_timestamp 
                AFTER UPDATE ON storage
                BEGIN
                    UPDATE storage SET updated_at = strftime('%s', 'now') WHERE key = NEW.key;
                END
            `);
            
            // Prepare statements for better performance
            this.statements = {
                save: this.db.prepare('INSERT OR REPLACE INTO storage (key, value) VALUES (?, ?)'),
                load: this.db.prepare('SELECT value FROM storage WHERE key = ?'),
                delete: this.db.prepare('DELETE FROM storage WHERE key = ?'),
                exists: this.db.prepare('SELECT 1 FROM storage WHERE key = ? LIMIT 1'),
                list: this.db.prepare('SELECT key FROM storage WHERE key LIKE ?'),
                listAll: this.db.prepare('SELECT key FROM storage'),
                count: this.db.prepare('SELECT COUNT(*) as count FROM storage'),
                clear: this.db.prepare('DELETE FROM storage')
            };
            
            this.isInitialized = true;
            console.log(`[Storage] Initialized database at ${this.dbPath}`);
        } catch (error) {
            console.error('[Storage] Failed to initialize database:', error);
            throw error;
        }
    }
    
    /**
     * Save an object to storage
     * @param {string} key - Storage key
     * @param {*} object - Any JSON-serializable object
     * @returns {boolean} Success status
     */
    save(key, object) {
        if (!this.isInitialized) {
            throw new Error('Storage not initialized');
        }
        
        try {
            const serialized = JSON.stringify(object);
            this.statements.save.run(key, serialized);
            return true;
        } catch (error) {
            console.error(`[Storage] Failed to save key '${key}':`, error);
            return false;
        }
    }
    
    /**
     * Load an object from storage
     * @param {string} key - Storage key
     * @returns {*} The stored object or null if not found
     */
    load(key) {
        if (!this.isInitialized) {
            throw new Error('Storage not initialized');
        }
        
        try {
            const row = this.statements.load.get(key);
            if (!row) return null;
            
            return JSON.parse(row.value);
        } catch (error) {
            console.error(`[Storage] Failed to load key '${key}':`, error);
            return null;
        }
    }
    
    /**
     * Delete an object from storage
     * @param {string} key - Storage key
     * @returns {boolean} True if deleted, false if not found
     */
    delete(key) {
        if (!this.isInitialized) {
            throw new Error('Storage not initialized');
        }
        
        try {
            const result = this.statements.delete.run(key);
            return result.changes > 0;
        } catch (error) {
            console.error(`[Storage] Failed to delete key '${key}':`, error);
            return false;
        }
    }
    
    /**
     * Check if a key exists in storage
     * @param {string} key - Storage key
     * @returns {boolean} True if exists
     */
    exists(key) {
        if (!this.isInitialized) {
            throw new Error('Storage not initialized');
        }
        
        try {
            const row = this.statements.exists.get(key);
            return row !== undefined;
        } catch (error) {
            console.error(`[Storage] Failed to check existence of key '${key}':`, error);
            return false;
        }
    }
    
    /**
     * Save multiple key-value pairs in a transaction
     * @param {Object} keyValuePairs - Object with key-value pairs
     * @returns {boolean} Success status
     */
    saveAll(keyValuePairs) {
        if (!this.isInitialized) {
            throw new Error('Storage not initialized');
        }
        
        const transaction = this.db.transaction((pairs) => {
            for (const [key, value] of Object.entries(pairs)) {
                const serialized = JSON.stringify(value);
                this.statements.save.run(key, serialized);
            }
        });
        
        try {
            transaction(keyValuePairs);
            return true;
        } catch (error) {
            console.error('[Storage] Failed to save multiple keys:', error);
            return false;
        }
    }
    
    /**
     * Load multiple objects by keys
     * @param {string[]} keys - Array of storage keys
     * @returns {Object} Object with key-value pairs
     */
    loadAll(keys) {
        if (!this.isInitialized) {
            throw new Error('Storage not initialized');
        }
        
        const result = {};
        
        try {
            for (const key of keys) {
                const value = this.load(key);
                if (value !== null) {
                    result[key] = value;
                }
            }
            return result;
        } catch (error) {
            console.error('[Storage] Failed to load multiple keys:', error);
            return {};
        }
    }
    
    /**
     * List keys matching a pattern
     * @param {string} pattern - SQL LIKE pattern (use % as wildcard)
     * @returns {string[]} Array of matching keys
     */
    list(pattern = '%') {
        if (!this.isInitialized) {
            throw new Error('Storage not initialized');
        }
        
        try {
            const rows = this.statements.list.all(pattern);
            return rows.map(row => row.key);
        } catch (error) {
            console.error(`[Storage] Failed to list keys with pattern '${pattern}':`, error);
            return [];
        }
    }
    
    /**
     * Get all keys in storage
     * @returns {string[]} Array of all keys
     */
    keys() {
        if (!this.isInitialized) {
            throw new Error('Storage not initialized');
        }
        
        try {
            const rows = this.statements.listAll.all();
            return rows.map(row => row.key);
        } catch (error) {
            console.error('[Storage] Failed to list all keys:', error);
            return [];
        }
    }
    
    /**
     * Get the number of stored items
     * @returns {number} Number of items in storage
     */
    count() {
        if (!this.isInitialized) {
            throw new Error('Storage not initialized');
        }
        
        try {
            const row = this.statements.count.get();
            return row.count;
        } catch (error) {
            console.error('[Storage] Failed to get count:', error);
            return 0;
        }
    }
    
    /**
     * Clear all data from storage
     * @returns {boolean} Success status
     */
    clear() {
        if (!this.isInitialized) {
            throw new Error('Storage not initialized');
        }
        
        try {
            this.statements.clear.run();
            return true;
        } catch (error) {
            console.error('[Storage] Failed to clear storage:', error);
            return false;
        }
    }
    
    /**
     * Create a backup copy of the database
     * @param {string} backupPath - Path for the backup file
     * @returns {boolean} Success status
     */
    backup(backupPath) {
        if (!this.isInitialized) {
            throw new Error('Storage not initialized');
        }
        
        try {
            // Ensure backup directory exists
            const backupDir = path.dirname(backupPath);
            if (!fs.existsSync(backupDir)) {
                fs.mkdirSync(backupDir, { recursive: true });
            }
            
            // Simple file copy backup for compatibility
            fs.copyFileSync(this.dbPath, backupPath);
            
            console.log(`[Storage] Backup created at ${backupPath}`);
            return true;
        } catch (error) {
            console.error(`[Storage] Failed to create backup at '${backupPath}':`, error);
            return false;
        }
    }
    
    /**
     * Optimize the database (VACUUM operation)
     * This should be called periodically to maintain performance
     * @returns {boolean} Success status
     */
    vacuum() {
        if (!this.isInitialized) {
            throw new Error('Storage not initialized');
        }
        
        try {
            this.db.exec('VACUUM');
            console.log('[Storage] Database optimized (VACUUM completed)');
            return true;
        } catch (error) {
            console.error('[Storage] Failed to vacuum database:', error);
            return false;
        }
    }
    
    /**
     * Get database statistics
     * @returns {Object} Database statistics
     */
    getStats() {
        if (!this.isInitialized) {
            throw new Error('Storage not initialized');
        }
        
        try {
            const stats = {
                path: this.dbPath,
                itemCount: this.count(),
                fileSize: 0,
                journalMode: '',
                pageSize: 0,
                pageCount: 0
            };
            
            // Get file size
            if (fs.existsSync(this.dbPath)) {
                stats.fileSize = fs.statSync(this.dbPath).size;
            }
            
            // Get SQLite info
            const journalMode = this.db.pragma('journal_mode', { simple: true });
            const pageSize = this.db.pragma('page_size', { simple: true });
            const pageCount = this.db.pragma('page_count', { simple: true });
            
            stats.journalMode = journalMode;
            stats.pageSize = pageSize;
            stats.pageCount = pageCount;
            
            return stats;
        } catch (error) {
            console.error('[Storage] Failed to get statistics:', error);
            return { error: error.message };
        }
    }
    
    /**
     * Close the database connection
     * Should be called when shutting down the application
     */
    close() {
        if (this.db && this.isInitialized) {
            try {
                // Note: better-sqlite3 prepared statements don't have a finalize method
                // They are automatically cleaned up when the database is closed
                
                this.db.close();
                this.isInitialized = false;
                console.log('[Storage] Database connection closed');
            } catch (error) {
                console.error('[Storage] Error closing database:', error);
            }
        }
    }
}

module.exports = Storage;
