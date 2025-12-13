#!/usr/bin/env node

/**
 * HtStation Application Launcher
 * 
 * This is the main launcher script that handles command-line arguments
 * and can install/uninstall the service as a systemctl background service.
 */

'use strict';

const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

/**
 * Check if required dependencies are installed
 * Returns an array of missing dependencies
 */
function checkDependencies() {
    const packageJson = require('./package.json');
    const dependencies = packageJson.dependencies || {};
    const missing = [];
    
    for (const [pkg, version] of Object.entries(dependencies)) {
        try {
            require.resolve(pkg);
        } catch (err) {
            missing.push(pkg);
        }
    }
    
    return missing;
}

/**
 * Display missing dependencies and installation instructions
 */
function showDependencyError(missing) {
    console.error('❌ Missing Required Dependencies');
    console.error('='.repeat(50));
    console.error('');
    console.error('The following npm packages are required but not installed:');
    console.error('');
    missing.forEach(pkg => {
        console.error(`  • ${pkg}`);
    });
    console.error('');
    console.error('To install missing dependencies, run:');
    console.error('');
    console.error('  npm install');
    console.error('');
    console.error('Or install them individually:');
    console.error('');
    console.error(`  npm install ${missing.join(' ')}`);
    console.error('');
    console.error('After installation, try running HtStation again.');
    console.error('='.repeat(50));
}

// Parse command-line arguments
const args = process.argv.slice(2);
const hasRun = args.includes('--run');
const hasServer = args.includes('--server');
const hasInstall = args.includes('--install');
const hasUninstall = args.includes('--uninstall');
const hasStart = args.includes('--start');
const hasStop = args.includes('--stop');
const hasHelp = args.includes('--help') || args.includes('-h');
const hasBluetoothHelp = args.includes('--bluetoothhelp');

// Check dependencies first (before loading package.json for version)
// This allows the script to run even with missing dependencies
let packageJson;
try {
    packageJson = require('./package.json');
} catch (err) {
    console.error('ERROR: Could not load package.json');
    process.exit(1);
}
const version = packageJson.version;

// Check for missing dependencies immediately on startup
// This ensures users know about dependency issues right away
const missingDeps = checkDependencies();

if (missingDeps.length > 0) {
    showDependencyError(missingDeps);
    process.exit(1);
}

/**
 * Check if MACADDRESS is configured in config.ini
 * Returns true if MACADDRESS is present and uncommented, false otherwise
 */
function checkMacAddress() {
    const configPath = path.join(__dirname, 'config.ini');
    
    try {
        if (!fs.existsSync(configPath)) {
            return false;
        }
        
        const configContent = fs.readFileSync(configPath, 'utf8');
        const lines = configContent.split('\n');
        
        for (const line of lines) {
            const trimmed = line.trim();
            // Check if line starts with MACADDRESS= (not commented)
            if (trimmed.startsWith('MACADDRESS=') && !trimmed.startsWith('#')) {
                const value = trimmed.substring('MACADDRESS='.length).trim();
                // Check if there's a non-empty value
                if (value.length > 0) {
                    return true;
                }
            }
        }
        
        return false;
    } catch (err) {
        return false;
    }
}

/**
 * Display a helpful message about Bluetooth pairing when MACADDRESS is not configured
 */
function showBluetoothSetupReminder() {
    console.log('');
    console.log('⚠️  BLUETOOTH SETUP REQUIRED');
    console.log('='.repeat(70));
    console.log('');
    console.log('No Bluetooth device MAC address found in config.ini.');
    console.log('');
    console.log('HtStation requires a paired Bluetooth radio to function. To get started:');
    console.log('');
    console.log('1. Pair your radio using Bluetooth:');
    console.log('');
    console.log('   node htstation.js --bluetoothhelp');
    console.log('');
    console.log('2. After pairing, update config.ini with your radio\'s MAC address:');
    console.log('');
    console.log('   MACADDRESS=XX:XX:XX:XX:XX:XX');
    console.log('');
    console.log('For detailed step-by-step instructions, run:');
    console.log('');
    console.log('   node htstation.js --bluetoothhelp');
    console.log('');
    console.log('='.repeat(70));
}

/**
 * Display help screen
 */
function showHelp() {
    console.log(`Handi-Talky Station v${version}`);
    console.log('https://github.com/Ylianst/HtStation');
    console.log('');
    console.log('Usage: node htstation.js [options]');
    console.log('');
    console.log('Options:');
    console.log('  --help, -h         Display this help message');
    console.log('  --bluetoothhelp    Display Bluetooth pairing guide for Raspberry Pi');
    console.log('  --run              Run in console mode (shows activity until CTRL-C)');
    console.log('  --server           Run in detached background process mode');
    console.log('  --install          Install as systemctl background service');
    console.log('  --uninstall        Uninstall systemctl background service');
    console.log('  --start            Start the systemctl service');
    console.log('  --stop             Stop the systemctl service');
    console.log('');
    console.log('Examples:');
    console.log('  node htstation.js                  Show this help screen');
    console.log('  node htstation.js --bluetoothhelp  Show Bluetooth setup guide');
    console.log('  node htstation.js --run            Run in foreground console mode');
    console.log('  node htstation.js --server         Run detached in background');
    console.log('  node htstation.js --install        Install as system service');
    console.log('  node htstation.js --start          Start the service');
    console.log('  node htstation.js --stop           Stop the service');
    console.log('  node htstation.js --uninstall      Remove system service');
    console.log('');
}

/**
 * Display Bluetooth pairing help
 */
function showBluetoothHelp() {
    console.log(`Handi-Talky Station v${version}`);
    console.log('='.repeat(70));
    console.log('BLUETOOTH PAIRING GUIDE FOR RASPBERRY PI');
    console.log('='.repeat(70));
    console.log('');
    console.log('HtStation requires a Bluetooth connection to your radio (UV-Pro, GA-5WB,');
    console.log('VR-N76, VR-N7500, or VR-N7600). Follow these steps to pair your device:');
    console.log('');
    console.log('PREREQUISITES');
    console.log('-'.repeat(70));
    console.log('1. Ensure your Raspberry Pi has Bluetooth capability');
    console.log('2. Your radio should be powered on and Bluetooth enabled');
    console.log('3. Have your radio within range (typically 10 meters)');
    console.log('');
    console.log('STEP 1: ENABLE BLUETOOTH SERVICE');
    console.log('-'.repeat(70));
    console.log('Ensure Bluetooth service is running on your Raspberry Pi:');
    console.log('');
    console.log('  sudo systemctl start bluetooth');
    console.log('  sudo systemctl enable bluetooth');
    console.log('');
    console.log('STEP 2: START BLUETOOTHCTL');
    console.log('-'.repeat(70));
    console.log('Launch the Bluetooth control utility:');
    console.log('');
    console.log('  bluetoothctl');
    console.log('');
    console.log('You should see a prompt like: [bluetooth]#');
    console.log('');
    console.log('STEP 3: PREPARE FOR PAIRING');
    console.log('-'.repeat(70));
    console.log('At the bluetoothctl prompt, enter these commands:');
    console.log('');
    console.log('  power on              # Turn on Bluetooth adapter');
    console.log('  agent on              # Enable pairing agent');
    console.log('  default-agent         # Set as default agent');
    console.log('  scan on               # Start scanning for devices');
    console.log('');
    console.log('STEP 4: IDENTIFY YOUR RADIO');
    console.log('-'.repeat(70));
    console.log('Watch the scan results for your radio. It may appear as:');
    console.log('  - "UV-Pro"');
    console.log('  - "GA-5WB"');
    console.log('  - "VR-N76" / "VR-N7500" / "VR-N7600"');
    console.log('  - Or a generic Bluetooth name');
    console.log('');
    console.log('Note the MAC address shown (format: XX:XX:XX:XX:XX:XX)');
    console.log('Example: [NEW] Device 38:D2:00:00:EF:24 UV-Pro');
    console.log('');
    console.log('STEP 5: PAIR THE DEVICE');
    console.log('-'.repeat(70));
    console.log('Once you see your radio, pair it (replace with your MAC address):');
    console.log('');
    console.log('  turn on pairing on the radio');
    console.log('  pair 38:D2:00:00:EF:24');
    console.log('');
    console.log('STEP 6: TRUST THE DEVICE');
    console.log('-'.repeat(70));
    console.log('Mark the device as trusted for automatic reconnection:');
    console.log('');
    console.log('  trust 38:D2:00:00:EF:24');
    console.log('');
    console.log('STEP 7: CONNECT (Optional)');
    console.log('-'.repeat(70));
    console.log('You can test the connection now (HtStation will connect automatically):');
    console.log('');
    console.log('  connect 38:D2:00:00:EF:24');
    console.log('');
    console.log('STEP 8: EXIT BLUETOOTHCTL');
    console.log('-'.repeat(70));
    console.log('Stop scanning and exit:');
    console.log('');
    console.log('  scan off');
    console.log('  exit');
    console.log('');
    console.log('STEP 9: CONFIGURE HTSTATION');
    console.log('-'.repeat(70));
    console.log('Edit the config.ini file and set your radio\'s MAC address:');
    console.log('');
    console.log('  nano config.ini');
    console.log('');
    console.log('Uncomment and update the MACADDRESS line:');
    console.log('');
    console.log('  MACADDRESS=38:D2:00:00:EF:24');
    console.log('');
    console.log('Save the file (CTRL+O, ENTER, CTRL+X in nano)');
    console.log('');
    console.log('STEP 10: START HTSTATION');
    console.log('-'.repeat(70));
    console.log('Launch HtStation to test the connection:');
    console.log('');
    console.log('  node htstation.js --run');
    console.log('');
    console.log('You should see Bluetooth connection messages in the console.');
    console.log('');
    console.log('TROUBLESHOOTING');
    console.log('-'.repeat(70));
    console.log('');
    console.log('Device not appearing in scan:');
    console.log('  • Ensure radio Bluetooth is enabled');
    console.log('  • Move radio closer to Raspberry Pi');
    console.log('  • Restart radio and try scanning again');
    console.log('  • Try: sudo systemctl restart bluetooth');
    console.log('');
    console.log('Pairing fails:');
    console.log('  • Try different PIN codes (0000, 1234, 1111)');
    console.log('  • Remove existing pairing: remove <MAC_ADDRESS>');
    console.log('  • Restart Bluetooth: sudo systemctl restart bluetooth');
    console.log('');
    console.log('Connection drops frequently:');
    console.log('  • Check for interference from other devices');
    console.log('  • Ensure radio has sufficient battery');
    console.log('  • Update Raspberry Pi: sudo apt update && sudo apt upgrade');
    console.log('');
    console.log('HtStation cannot connect:');
    console.log('  • Verify MAC address in config.ini matches paired device');
    console.log('  • Ensure device is trusted: bluetoothctl trust <MAC_ADDRESS>');
    console.log('  • Check if bluetooth-serial-port module is installed:');
    console.log('    npm install bluetooth-serial-port');
    console.log('');
    console.log('USEFUL COMMANDS');
    console.log('-'.repeat(70));
    console.log('  bluetoothctl devices           # List paired devices');
    console.log('  bluetoothctl info <MAC>        # Show device details');
    console.log('  bluetoothctl remove <MAC>      # Remove pairing');
    console.log('  sudo systemctl status bluetooth # Check Bluetooth service');
    console.log('  hcitool scan                   # Alternative scan method');
    console.log('');
    console.log('ADDITIONAL RESOURCES');
    console.log('-'.repeat(70));
    console.log('  • Raspberry Pi Bluetooth Guide:');
    console.log('    https://www.raspberrypi.com/documentation/computers/configuration.html#bluetooth');
    console.log('  • HtStation Documentation:');
    console.log('    https://github.com/Ylianst/HtStation');
    console.log('');
    console.log('='.repeat(70));
}

/**
 * Install systemctl service
 */
function installService() {
    console.log('Installing HtStation as systemctl service...');
    
    // Get the absolute path to this script and node
    const scriptPath = path.resolve(__dirname, 'htstation.js');
    const nodeExec = process.execPath;
    const workingDir = __dirname;
    
    // Get the current user
    const username = process.env.USER || process.env.USERNAME;
    if (!username) {
        console.error('ERROR: Could not determine current user');
        process.exit(1);
    }
    
    // Create systemd service file content
    const serviceContent = `[Unit]
Description=HtStation Ham Radio Packet Station
After=network.target

[Service]
Type=simple
User=${username}
WorkingDirectory=${workingDir}
ExecStart=${nodeExec} ${scriptPath} --run
Restart=on-failure
RestartSec=10
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
`;
    
    const serviceName = 'htstation.service';
    const servicePath = `/etc/systemd/system/${serviceName}`;
    const tempServicePath = path.join(__dirname, serviceName);
    
    try {
        // Write service file to temp location
        fs.writeFileSync(tempServicePath, serviceContent);
        console.log(`Created service file: ${tempServicePath}`);
        
        // Check if running with sudo/root
        if (process.getuid && process.getuid() !== 0) {
            console.log('\nPlease run the following commands with sudo to complete installation:');
            console.log(`  sudo cp ${tempServicePath} ${servicePath}`);
            console.log(`  sudo systemctl daemon-reload`);
            console.log(`  sudo systemctl enable ${serviceName}`);
            console.log(`  sudo systemctl start ${serviceName}`);
            console.log(`  sudo systemctl status ${serviceName}`);
            console.log('');
            console.log(`Service file has been created at: ${tempServicePath}`);
            console.log('Once installed, you can manage it with:');
            console.log(`  sudo systemctl status ${serviceName}   # Check status`);
            console.log(`  sudo systemctl stop ${serviceName}     # Stop service`);
            console.log(`  sudo systemctl restart ${serviceName}  # Restart service`);
            console.log(`  sudo journalctl -u ${serviceName} -f  # View logs`);
            return;
        }
        
        // Copy service file to systemd directory
        execSync(`cp ${tempServicePath} ${servicePath}`);
        console.log(`Installed service file to: ${servicePath}`);
        
        // Reload systemd
        execSync('systemctl daemon-reload');
        console.log('Reloaded systemd daemon');
        
        // Enable service
        execSync(`systemctl enable ${serviceName}`);
        console.log('Enabled service to start on boot');
        
        // Start service
        execSync(`systemctl start ${serviceName}`);
        console.log('Started service');
        
        // Show status
        console.log('\nService status:');
        try {
            const status = execSync(`systemctl status ${serviceName}`, { encoding: 'utf8' });
            console.log(status);
        } catch (err) {
            // Status command returns non-zero for non-active services, but still shows output
            console.log(err.stdout || err.message);
        }
        
        console.log('\nHtStation service installed successfully!');
        console.log(`View logs with: sudo journalctl -u ${serviceName} -f`);
        
    } catch (err) {
        console.error('ERROR during installation:', err.message);
        process.exit(1);
    }
}

/**
 * Start systemctl service
 */
function startService() {
    console.log('Starting HtStation service...');
    
    const serviceName = 'htstation.service';
    
    try {
        // Check if running with sudo/root
        if (process.getuid && process.getuid() !== 0) {
            console.log('\nPlease run the following command with sudo:');
            console.log(`  sudo systemctl start ${serviceName}`);
            console.log('');
            console.log('To check status:');
            console.log(`  sudo systemctl status ${serviceName}`);
            return;
        }
        
        // Start service
        execSync(`systemctl start ${serviceName}`);
        console.log('Service started successfully');
        
        // Show status
        console.log('\nService status:');
        try {
            const status = execSync(`systemctl status ${serviceName}`, { encoding: 'utf8' });
            console.log(status);
        } catch (err) {
            console.log(err.stdout || err.message);
        }
        
    } catch (err) {
        console.error('ERROR starting service:', err.message);
        process.exit(1);
    }
}

/**
 * Stop systemctl service
 */
function stopService() {
    console.log('Stopping HtStation service...');
    
    const serviceName = 'htstation.service';
    
    try {
        // Check if running with sudo/root
        if (process.getuid && process.getuid() !== 0) {
            console.log('\nPlease run the following command with sudo:');
            console.log(`  sudo systemctl stop ${serviceName}`);
            console.log('');
            console.log('To check status:');
            console.log(`  sudo systemctl status ${serviceName}`);
            return;
        }
        
        // Stop service
        execSync(`systemctl stop ${serviceName}`);
        console.log('Service stopped successfully');
        
        // Show status
        console.log('\nService status:');
        try {
            const status = execSync(`systemctl status ${serviceName}`, { encoding: 'utf8' });
            console.log(status);
        } catch (err) {
            console.log(err.stdout || err.message);
        }
        
    } catch (err) {
        console.error('ERROR stopping service:', err.message);
        process.exit(1);
    }
}

/**
 * Uninstall systemctl service
 */
function uninstallService() {
    console.log('Uninstalling HtStation systemctl service...');
    
    const serviceName = 'htstation.service';
    const servicePath = `/etc/systemd/system/${serviceName}`;
    
    try {
        // Check if running with sudo/root
        if (process.getuid && process.getuid() !== 0) {
            console.log('\nPlease run the following commands with sudo to complete uninstallation:');
            console.log(`  sudo systemctl stop ${serviceName}`);
            console.log(`  sudo systemctl disable ${serviceName}`);
            console.log(`  sudo rm ${servicePath}`);
            console.log(`  sudo systemctl daemon-reload`);
            return;
        }
        
        // Stop service
        try {
            execSync(`systemctl stop ${serviceName}`);
            console.log('Stopped service');
        } catch (err) {
            console.log('Service was not running');
        }
        
        // Disable service
        try {
            execSync(`systemctl disable ${serviceName}`);
            console.log('Disabled service');
        } catch (err) {
            console.log('Service was not enabled');
        }
        
        // Remove service file
        if (fs.existsSync(servicePath)) {
            fs.unlinkSync(servicePath);
            console.log(`Removed service file: ${servicePath}`);
        } else {
            console.log('Service file not found');
        }
        
        // Reload systemd
        execSync('systemctl daemon-reload');
        console.log('Reloaded systemd daemon');
        
        console.log('\nHtStation service uninstalled successfully!');
        
    } catch (err) {
        console.error('ERROR during uninstallation:', err.message);
        process.exit(1);
    }
}

/**
 * Run the application
 */
function runApplication() {
    // Change to the project root directory to maintain proper relative paths
    process.chdir(__dirname);
    
    // Start the main application from the src folder
    require(path.join(__dirname, 'src', 'htstation.js'));
}

// Main logic
if (hasHelp) {
    showHelp();
    // Check for MACADDRESS after showing help
    if (!checkMacAddress()) {
        showBluetoothSetupReminder();
    }
    process.exit(0);
} else if (hasBluetoothHelp) {
    showBluetoothHelp();
    process.exit(0);
} else if (hasInstall) {
    // Check for MACADDRESS before installing
    if (!checkMacAddress()) {
        showBluetoothSetupReminder();
        console.log('');
        console.log('Please configure Bluetooth before installing the service.');
        console.log('');
        process.exit(1);
    }
    installService();
    process.exit(0);
} else if (hasUninstall) {
    uninstallService();
    process.exit(0);
} else if (hasStart) {
    startService();
    process.exit(0);
} else if (hasStop) {
    stopService();
    process.exit(0);
} else if (hasRun || hasServer) {
    // Check for MACADDRESS before running
    if (!checkMacAddress()) {
        showBluetoothSetupReminder();
        console.log('');
        console.log('Please configure Bluetooth before running HtStation.');
        console.log('');
        process.exit(1);
    }
    // Both --run and --server start the application
    // --server flag is handled inside src/htstation.js for background mode
    runApplication();
} else {
    // Default behavior: show help
    showHelp();
    // Check for MACADDRESS after showing help
    if (!checkMacAddress()) {
        showBluetoothSetupReminder();
    }
    process.exit(0);
}
