'use strict';

const BbsServer = require('./bbs');

// Mock configuration for testing
const mockConfig = {
    CALLSIGN: 'TEST',
    STATIONID: 1
};

// Mock radio object for testing
const mockRadio = {
    sendTncFrame: (frame) => {
        console.log(`[Mock Radio] Sending frame on channel ${frame.channel_id}`);
    }
};

// Mock AX25Session for testing (we'll create a minimal implementation)
const mockAX25Session = {
    ConnectionState: {
        CONNECTED: 'CONNECTED',
        DISCONNECTED: 'DISCONNECTED'
    }
};

// Test the BBS server connection logging
function testBbsConnectionLogging() {
    console.log('=== BBS Connection Logging Test ===');
    
    try {
        // Create BBS server instance
        const bbs = new BbsServer(mockConfig, mockRadio);
        
        // Test 1: Check if storage was initialized
        if (bbs.storage) {
            console.log('✓ Storage initialized successfully');
        } else {
            console.log('✗ Storage initialization failed');
            return;
        }
        
        // Test 2: Manually test connection logging
        console.log('\n--- Testing Connection Logging ---');
        
        // Simulate multiple connections
        const testCallsigns = ['W1ABC-1', 'K2DEF-1', 'N3GHI-1'];
        
        for (let i = 0; i < testCallsigns.length; i++) {
            const callsign = testCallsigns[i];
            console.log(`Logging connection from ${callsign}`);
            bbs.logConnection(callsign);
            
            // Add a small delay to ensure different timestamps
            const start = Date.now();
            while (Date.now() - start < 10) { /* small delay */ }
        }
        
        // Test 3: Check connection retrieval
        console.log('\n--- Testing Last Connections Retrieval ---');
        const connectionsOutput = bbs.getLastConnections();
        console.log('Last connections output:');
        console.log(connectionsOutput);
        
        // Test 4: Check storage statistics
        console.log('\n--- Testing Storage Statistics ---');
        if (bbs.storage) {
            const stats = bbs.storage.getStats();
            console.log('Storage statistics:', JSON.stringify(stats, null, 2));
            
            const connectionCount = bbs.storage.list('connection-%').length;
            console.log(`Total connections stored: ${connectionCount}`);
        }
        
        // Test 5: Test cleanup functionality
        console.log('\n--- Testing Cleanup ---');
        bbs.close();
        
        console.log('\n✓ All tests completed successfully!');
        
    } catch (error) {
        console.error('Test failed:', error);
    }
}

// Test the main menu and LC command response
function testBbsCommands() {
    console.log('\n=== BBS Commands Test ===');
    
    try {
        const bbs = new BbsServer(mockConfig, mockRadio);
        
        // Test main menu
        console.log('\n--- Main Menu ---');
        const menu = bbs.getMainMenu();
        console.log(menu);
        
        // Test time command
        console.log('\n--- Time Command ---');
        const time = bbs.getCurrentTime();
        console.log(time);
        
        // Test uptime command
        console.log('\n--- Uptime Command ---');
        const uptime = bbs.getSystemUptime();
        console.log(uptime);
        
        // Log a few test connections first
        bbs.logConnection('W1TEST-1');
        bbs.logConnection('K2TEST-1');
        
        // Test LC command
        console.log('\n--- LC Command ---');
        const lastConnections = bbs.getLastConnections();
        console.log(lastConnections);
        
        // Test Disconnect command
        console.log('\n--- Disconnect Command ---');
        
        // Test disconnect without session key (fallback)
        const disconnectMessage = bbs.getDisconnectMessage();
        console.log('Disconnect without session duration:');
        console.log(disconnectMessage);
        
        // Test disconnect with session duration
        const testSessionKey = 'W1TEST-1';
        bbs.sessionStartTimes.set(testSessionKey, new Date(Date.now() - 15 * 60 * 1000)); // 15 minutes ago
        const disconnectWithDuration = bbs.getDisconnectMessage(testSessionKey);
        console.log('\nDisconnect with session duration:');
        console.log(disconnectWithDuration);
        
        // Test Submenu System
        console.log('\n--- Submenu System Tests ---');
        
        // Test main menu command processing
        const menuTestSessionKey = 'W1TEST-1';
        bbs.sessionMenuStates.set(menuTestSessionKey, 'main');
        
        console.log('Main menu response:');
        console.log(bbs.processMainMenuCommand(menuTestSessionKey, 'menu'));
        
        console.log('Switching to games menu:');
        const gamesResponse = bbs.processMainMenuCommand(menuTestSessionKey, 'games');
        console.log(gamesResponse);
        
        console.log('Games menu response:');
        console.log(bbs.processGamesMenuCommand(menuTestSessionKey, 'menu'));
        
        console.log('Returning to main menu:');
        const mainResponse = bbs.processGamesMenuCommand(menuTestSessionKey, 'main');
        console.log(mainResponse);
        
        // Test Guess the Number game
        console.log('\n--- Guess the Number Game Tests ---');
        
        // Start the game
        console.log('Starting Guess the Number game:');
        bbs.sessionMenuStates.set(menuTestSessionKey, 'games');
        const gameStartResponse = bbs.processGamesMenuCommand(menuTestSessionKey, 'guess');
        console.log(gameStartResponse);
        
        // Test invalid input using modular system
        console.log('Testing invalid input:');
        bbs.sessionMenuStates.set(menuTestSessionKey, 'guess_number');
        const invalidResponse = bbs.processGameCommand(menuTestSessionKey, 'not-a-number', 'guess_number');
        console.log(invalidResponse);
        
        // Test out of range using modular system
        console.log('Testing out of range:');
        bbs.sessionMenuStates.set(menuTestSessionKey, 'guess_number');
        const outOfRangeResponse = bbs.processGameCommand(menuTestSessionKey, '1500', 'guess_number');
        console.log(outOfRangeResponse);
        
        // Test a guess (we'll guess 500 to see if it's high or low)
        console.log('Testing a guess (500):');
        bbs.sessionMenuStates.set(menuTestSessionKey, 'guess_number');
        const guessResponse = bbs.processGameCommand(menuTestSessionKey, '500', 'guess_number');
        console.log(guessResponse);
        
        // Test exit command using modular system
        console.log('Testing exit command:');
        bbs.sessionMenuStates.set(menuTestSessionKey, 'guess_number');
        const exitResponse = bbs.processGameCommand(menuTestSessionKey, 'exit', 'guess_number');
        console.log(exitResponse);
        
        // Test Blackjack game
        console.log('\n--- Blackjack Game Tests ---');
        
        // Start Blackjack
        console.log('Starting Blackjack game:');
        bbs.sessionMenuStates.set(menuTestSessionKey, 'games');
        const blackjackStartResponse = bbs.processGamesMenuCommand(menuTestSessionKey, 'blackjack');
        console.log(blackjackStartResponse);
        
        // Test invalid command in blackjack using modular system
        console.log('Testing invalid command in Blackjack:');
        bbs.sessionMenuStates.set(menuTestSessionKey, 'blackjack');
        const invalidBlackjackResponse = bbs.processGameCommand(menuTestSessionKey, 'invalid', 'blackjack');
        console.log(invalidBlackjackResponse);
        
        // Test exit from blackjack using modular system
        console.log('Testing exit from Blackjack:');
        bbs.sessionMenuStates.set(menuTestSessionKey, 'blackjack');
        const exitBlackjackResponse = bbs.processGameCommand(menuTestSessionKey, 'exit', 'blackjack');
        console.log(exitBlackjackResponse);
        
        // Test Welcome Message Generation
        console.log('\n--- Welcome Message Tests ---');
        
        // Test first-time user (no previous connection)
        const firstTimeWelcome = bbs.generateWelcomeMessage('W9NEW-1', null);
        console.log('First-time user welcome:');
        console.log(firstTimeWelcome);
        
        // Test returning user with last connection info
        const lastConnectionInfo = {
            timestamp: new Date(Date.now() - (2 * 24 * 60 * 60 * 1000) - (3 * 60 * 60 * 1000) - (15 * 60 * 1000)), // 2 days, 3 hours, 15 minutes ago
            localTime: '10/02/2025, 19:15:30'
        };
        const returningUserWelcome = bbs.generateWelcomeMessage('W1ABC-1', lastConnectionInfo);
        console.log('\nReturning user welcome:');
        console.log(returningUserWelcome);
        
        // Test time formatting
        console.log('\n--- Time Since Formatting Tests ---');
        const now = new Date();
        
        // Test different time periods
        const testTimes = [
            new Date(now.getTime() - 30 * 1000), // 30 seconds ago
            new Date(now.getTime() - 5 * 60 * 1000), // 5 minutes ago
            new Date(now.getTime() - 2 * 60 * 60 * 1000), // 2 hours ago
            new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000), // 1 day ago
            new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000 - 4 * 60 * 60 * 1000), // 3 days, 4 hours ago
            new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000) // 1 week ago
        ];
        
        testTimes.forEach((testTime, index) => {
            const formatted = bbs.formatTimeSince(testTime);
            console.log(`Test ${index + 1}: ${formatted}`);
        });
        
        // Cleanup
        bbs.close();
        
        console.log('\n✓ Command tests completed successfully!');
        
    } catch (error) {
        console.error('Command test failed:', error);
    }
}

// Run the tests
if (require.main === module) {
    testBbsConnectionLogging();
    testBbsCommands();
}

module.exports = { testBbsConnectionLogging, testBbsCommands };
