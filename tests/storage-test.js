'use strict';

const Storage = require('./storage');

// Example usage and testing of the Storage module
function runStorageTest() {
    console.log('=== Storage Module Test ===');
    
    // Initialize storage
    const storage = new Storage('./data/test-storage.db');
    
    try {
        // Test basic save/load
        console.log('\n1. Testing basic save/load operations...');
        
        const testData = {
            timestamp: Date.now(),
            message: 'Hello from HtStation!',
            config: {
                frequency: 145.500,
                mode: 'FM',
                power: 5
            },
            users: ['W1ABC', 'K2DEF', 'N3GHI']
        };
        
        storage.save('test-config', testData);
        const loaded = storage.load('test-config');
        console.log('Saved and loaded:', JSON.stringify(loaded, null, 2));
        
        // Test existence check
        console.log('\n2. Testing existence check...');
        console.log('test-config exists:', storage.exists('test-config'));
        console.log('nonexistent-key exists:', storage.exists('nonexistent-key'));
        
        // Test multiple saves
        console.log('\n3. Testing multiple saves...');
        const multipleData = {
            'station-info': {
                callsign: 'W1ABC',
                grid: 'FN42aa',
                power: 100
            },
            'last-contacts': [
                { call: 'K2DEF', time: '2025-01-10 21:30:00', freq: '145.500' },
                { call: 'N3GHI', time: '2025-01-10 21:25:00', freq: '146.520' }
            ],
            'settings': {
                theme: 'dark',
                autoSave: true,
                backupInterval: 3600
            }
        };
        
        storage.saveAll(multipleData);
        console.log('Saved multiple items. Total count:', storage.count());
        
        // Test listing keys
        console.log('\n4. Testing key listing...');
        console.log('All keys:', storage.keys());
        console.log('Keys matching "station*":', storage.list('station%'));
        
        // Test loading multiple
        console.log('\n5. Testing load multiple...');
        const loadedMultiple = storage.loadAll(['station-info', 'settings']);
        console.log('Loaded multiple:', JSON.stringify(loadedMultiple, null, 2));
        
        // Test statistics
        console.log('\n6. Testing database statistics...');
        const stats = storage.getStats();
        console.log('Database stats:', JSON.stringify(stats, null, 2));
        
        // Test backup
        console.log('\n7. Testing backup...');
        const backupPath = './data/backup-' + Date.now() + '.db';
        const backupSuccess = storage.backup(backupPath);
        console.log('Backup created:', backupSuccess, 'at', backupPath);
        
        // Test vacuum
        console.log('\n8. Testing database optimization...');
        storage.vacuum();
        
        // Test delete
        console.log('\n9. Testing delete operation...');
        const deleteSuccess = storage.delete('test-config');
        console.log('Deleted test-config:', deleteSuccess);
        console.log('test-config exists after delete:', storage.exists('test-config'));
        
        console.log('\n=== All tests completed successfully! ===');
        
    } catch (error) {
        console.error('Test failed:', error);
    } finally {
        // Always close the database
        storage.close();
    }
}

// Run the test if this file is executed directly
if (require.main === module) {
    runStorageTest();
}

module.exports = { runStorageTest };
