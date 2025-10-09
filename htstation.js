#!/usr/bin/env node

/**
 * HtStation Application Launcher
 * 
 * This is a simple launcher script that starts the main HtStation application
 * from the src directory. This keeps the root folder clean while maintaining
 * the same command-line interface.
 */

'use strict';

const path = require('path');

// Change to the project root directory to maintain proper relative paths
process.chdir(__dirname);

// Start the main application from the src folder
require(path.join(__dirname, 'src', 'htstation.js'));
