/**
 * Console Logger Utility
 * Provides filtered console logging based on CONSOLEMSG configuration
 */

class ConsoleLogger {
    constructor(config) {
        this.enabledCategories = new Set();
        this.allEnabled = false;
        
        // Parse CONSOLEMSG configuration
        if (config && config.CONSOLEMSG) {
            const consoleMsgValue = config.CONSOLEMSG.trim().toUpperCase();
            
            if (consoleMsgValue === 'ALL' || consoleMsgValue === '') {
                this.allEnabled = true;
            } else if (consoleMsgValue === 'NONE') {
                // Explicitly disable all logging
                this.allEnabled = false;
                this.enabledCategories.clear();
            } else {
                // Parse comma-separated list
                const categories = consoleMsgValue.split(',').map(cat => cat.trim().toUpperCase());
                categories.forEach(cat => {
                    if (cat) {
                        this.enabledCategories.add(cat);
                    }
                });
            }
        } else {
            // Default to all enabled if not configured
            this.allEnabled = true;
        }
    }

    /**
     * Check if a category is enabled for logging
     * @param {string} category - The logging category to check
     * @returns {boolean} True if the category should be logged
     */
    isEnabled(category) {
        if (this.allEnabled) {
            return true;
        }
        
        if (!category) {
            return true; // Messages without category always show
        }
        
        return this.enabledCategories.has(category.toUpperCase());
    }

    /**
     * Log a message if the category is enabled
     * @param {string} category - The logging category
     * @param {...any} args - Arguments to pass to console.log
     */
    log(category, ...args) {
        if (this.isEnabled(category)) {
            console.log(...args);
        }
    }

    /**
     * Log an error message (always shown regardless of category filtering)
     * @param {string} category - The logging category
     * @param {...any} args - Arguments to pass to console.error
     */
    error(category, ...args) {
        // Error messages always display regardless of CONSOLEMSG setting
        console.error(...args);
    }

    /**
     * Log a warning message if the category is enabled
     * @param {string} category - The logging category
     * @param {...any} args - Arguments to pass to console.warn
     */
    warn(category, ...args) {
        if (this.isEnabled(category)) {
            console.warn(...args);
        }
    }

    /**
     * Log an info message if the category is enabled
     * @param {string} category - The logging category
     * @param {...any} args - Arguments to pass to console.info
     */
    info(category, ...args) {
        if (this.isEnabled(category)) {
            console.info(...args);
        }
    }

    /**
     * Get a logger instance for a specific category
     * @param {string} category - The logging category
     * @returns {object} Logger object with log, error, warn, and info methods
     */
    getLogger(category) {
        return {
            log: (...args) => this.log(category, ...args),
            error: (...args) => this.error(category, ...args),
            warn: (...args) => this.warn(category, ...args),
            info: (...args) => this.info(category, ...args)
        };
    }
}

// Singleton instance
let loggerInstance = null;

/**
 * Initialize the console logger with configuration
 * @param {object} config - Configuration object containing CONSOLEMSG
 */
function initializeLogger(config) {
    loggerInstance = new ConsoleLogger(config);
}

/**
 * Get the current logger instance
 * @returns {ConsoleLogger} The logger instance
 */
function getLogger() {
    if (!loggerInstance) {
        // Create default logger if not initialized
        loggerInstance = new ConsoleLogger({});
    }
    return loggerInstance;
}

module.exports = {
    ConsoleLogger,
    initializeLogger,
    getLogger
};
