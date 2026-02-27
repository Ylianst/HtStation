/*
Copyright 2026 Ylian Saint-Hilaire
Licensed under the Apache License, Version 2.0 (the "License");
http://www.apache.org/licenses/LICENSE-2.0
*/

const fs = require('fs');
const path = require('path');

/**
 * A global data broker for dispatching and receiving data across components.
 * Supports device-specific and named data channels with optional persistence.
 *
 * On Linux, Device ID 0 values are persisted to a JSON file (equivalent of
 * the Windows registry used in the C# version).
 */

/** Subscribe to all device IDs. */
const AllDevices = -1;

/** Subscribe to all names. */
const AllNames = '*';

// Internal state
const _dataStore = new Map();       // Map<string, object>  key = "deviceId:name"
const _subscriptions = [];          // Array<{ client, deviceId, name, callback }>
const _dataHandlers = new Map();    // Map<string, object>

let _persistPath = null;
let _persistCache = null;           // In-memory mirror of the persisted JSON
let _initialized = false;
let _persistTimer = null;
const _persistDebounceMs = 60000;   // Write to disk at most once per minute (SD card friendly)

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Build a composite key for the data store.
 * @param {number} deviceId
 * @param {string} name
 * @returns {string}
 */
function makeKey(deviceId, name) {
    return `${deviceId}:${name}`;
}

/**
 * Load the persisted JSON file from disk.
 * @returns {object}
 */
function loadPersisted() {
    if (_persistPath == null) return {};
    try {
        if (fs.existsSync(_persistPath)) {
            const raw = fs.readFileSync(_persistPath, 'utf8');
            return JSON.parse(raw);
        }
    } catch (_) { /* ignore corrupt file */ }
    return {};
}

/**
 * Schedule a debounced write of the persist cache to disk.
 */
function schedulePersist() {
    if (_persistPath == null) return;
    if (_persistTimer) return; // already scheduled
    _persistTimer = setTimeout(() => {
        _persistTimer = null;
        try {
            const dir = path.dirname(_persistPath);
            if (!fs.existsSync(dir)) { fs.mkdirSync(dir, { recursive: true }); }
            fs.writeFileSync(_persistPath, JSON.stringify(_persistCache, null, 2), 'utf8');
        } catch (_) { /* best-effort */ }
    }, _persistDebounceMs);
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Initializes the data broker with optional file-based persistence.
 * @param {string} persistPath - Absolute path to the JSON persistence file
 *   (e.g. path.join(__dirname, '../../data/databroker.json')).
 *   Pass null to disable persistence.
 */
function initialize(persistPath) {
    if (_initialized) return;
    _persistPath = persistPath || null;
    _persistCache = loadPersisted();
    _initialized = true;
}

/**
 * Dispatches data to the broker, optionally storing it and notifying subscribers.
 * @param {number} deviceId - The device ID (use 0 for values that should persist to disk).
 * @param {string} name     - The name/key of the data.
 * @param {*}      data     - The data value.
 * @param {boolean} [store=true] - If true, value is stored; if false, only broadcast.
 */
function dispatch(deviceId, name, data, store = true) {
    if (store) {
        const key = makeKey(deviceId, name);
        _dataStore.set(key, data);

        // Persist to file if device 0
        if (deviceId === 0 && _persistCache) {
            _persistCache[name] = data;
            schedulePersist();
        }
    }

    // Find & invoke matching subscriptions
    const matching = _subscriptions.filter(sub => {
        const deviceMatches = (sub.deviceId === AllDevices) || (sub.deviceId === deviceId);
        const nameMatches   = (sub.name === AllNames) || (sub.name === name);
        return deviceMatches && nameMatches;
    });

    for (const sub of matching) {
        try {
            sub.callback(deviceId, name, data);
        } catch (_) {
            // Swallow callback exceptions to prevent broker failure
        }
    }
}

/**
 * Gets a value from the broker.
 * @param {number} deviceId      - The device ID.
 * @param {string} name          - The name/key of the data.
 * @param {*}      [defaultValue=undefined] - Value returned when key is absent.
 * @returns {*} The stored value or defaultValue.
 */
function getValue(deviceId, name, defaultValue = undefined) {
    const key = makeKey(deviceId, name);
    if (_dataStore.has(key)) {
        return _dataStore.get(key);
    }

    // For device 0, try loading from persisted file
    if (deviceId === 0 && _persistCache && name in _persistCache) {
        const val = _persistCache[name];
        _dataStore.set(key, val);   // cache in memory
        return val;
    }

    return defaultValue;
}

/**
 * Checks if a value exists in the broker.
 * @param {number} deviceId
 * @param {string} name
 * @returns {boolean}
 */
function hasValue(deviceId, name) {
    const key = makeKey(deviceId, name);
    if (_dataStore.has(key)) return true;
    if (deviceId === 0 && _persistCache && name in _persistCache) return true;
    return false;
}

/**
 * Removes a value from the broker (and from persistence if device 0).
 * @param {number} deviceId
 * @param {string} name
 * @returns {boolean} True if removed.
 */
function removeValue(deviceId, name) {
    const key = makeKey(deviceId, name);
    const removed = _dataStore.delete(key);

    if (deviceId === 0 && _persistCache && name in _persistCache) {
        delete _persistCache[name];
        schedulePersist();
        return true;
    }
    return removed;
}

/**
 * Subscribe to data changes (called internally by DataBrokerClient).
 * @param {object}   client   - The DataBrokerClient instance.
 * @param {number}   deviceId - Device ID or AllDevices.
 * @param {string}   name     - Name or AllNames.
 * @param {function} callback - (deviceId, name, data) => void
 */
function subscribe(client, deviceId, name, callback) {
    _subscriptions.push({ client, deviceId, name, callback });
}

/**
 * Unsubscribe all subscriptions for a client.
 * @param {object} client
 */
function unsubscribe(client) {
    for (let i = _subscriptions.length - 1; i >= 0; i--) {
        if (_subscriptions[i].client === client) {
            _subscriptions.splice(i, 1);
        }
    }
}

/**
 * Unsubscribe a specific subscription for a client.
 * @param {object} client
 * @param {number} deviceId
 * @param {string} name
 */
function unsubscribeSpecific(client, deviceId, name) {
    for (let i = _subscriptions.length - 1; i >= 0; i--) {
        const s = _subscriptions[i];
        if (s.client === client && s.deviceId === deviceId && s.name === name) {
            _subscriptions.splice(i, 1);
        }
    }
}

/**
 * Gets all stored values for a specific device.
 * @param {number} deviceId
 * @returns {object} A plain object of { name: value } pairs.
 */
function getDeviceValues(deviceId) {
    const prefix = `${deviceId}:`;
    const result = {};
    for (const [key, value] of _dataStore) {
        if (key.startsWith(prefix)) {
            const name = key.slice(prefix.length);
            result[name] = value;
        }
    }
    return result;
}

/**
 * Clears all stored data for a specific device (does NOT notify subscribers).
 * @param {number} deviceId
 */
function clearDevice(deviceId) {
    const prefix = `${deviceId}:`;
    for (const key of [..._dataStore.keys()]) {
        if (key.startsWith(prefix)) {
            _dataStore.delete(key);
        }
    }
}

/**
 * Deletes all data for a device, dispatching null to subscribers first.
 * @param {number} deviceId
 */
function deleteDevice(deviceId) {
    const prefix = `${deviceId}:`;
    const keys = [..._dataStore.keys()].filter(k => k.startsWith(prefix));

    // Notify subscribers with null
    for (const key of keys) {
        const name = key.slice(prefix.length);
        dispatch(deviceId, name, null, false);
    }

    // Remove from store
    for (const key of keys) {
        _dataStore.delete(key);
    }
}

/**
 * Clears all stored data and subscriptions.
 */
function reset() {
    _dataStore.clear();
    _subscriptions.length = 0;
}

// ── Data Handlers ──────────────────────────────────────────────────────────

/**
 * Adds a data handler. Dispatches "DataHandlerAdded" on device 0.
 * @param {string} name    - Unique handler name.
 * @param {object} handler - The handler object.
 * @returns {boolean} True if added, false if name already taken.
 */
function addDataHandler(name, handler) {
    if (!name) throw new Error('name is required');
    if (handler == null) throw new Error('handler is required');

    if (_dataHandlers.has(name)) return false;

    _dataHandlers.set(name, handler);
    dispatch(0, 'DataHandlerAdded', name, false);
    return true;
}

/**
 * Gets a data handler by name.
 * @param {string} name
 * @returns {object|null}
 */
function getDataHandler(name) {
    if (!name) return null;
    return _dataHandlers.get(name) || null;
}

/**
 * Removes a data handler. If it has a dispose() method it will be called.
 * Dispatches "DataHandlerRemoved" on device 0.
 * @param {string} name
 * @returns {boolean} True if removed.
 */
function removeDataHandler(name) {
    if (!name) return false;
    const handler = _dataHandlers.get(name);
    if (!handler) return false;

    _dataHandlers.delete(name);

    // Dispose if possible
    if (typeof handler.dispose === 'function') {
        try { handler.dispose(); } catch (_) { /* swallow */ }
    }

    dispatch(0, 'DataHandlerRemoved', name, false);
    return true;
}

/**
 * Checks if a data handler exists.
 * @param {string} name
 * @returns {boolean}
 */
function hasDataHandler(name) {
    if (!name) return false;
    return _dataHandlers.has(name);
}

/**
 * Removes all data handlers and disposes each one that supports it.
 */
function removeAllDataHandlers() {
    const handlers = [..._dataHandlers.values()];
    _dataHandlers.clear();
    for (const handler of handlers) {
        if (typeof handler.dispose === 'function') {
            try { handler.dispose(); } catch (_) { /* swallow */ }
        }
    }
}

// ── Exports ────────────────────────────────────────────────────────────────

module.exports = {
    AllDevices,
    AllNames,
    initialize,
    dispatch,
    getValue,
    hasValue,
    removeValue,
    subscribe,
    unsubscribe,
    unsubscribeSpecific,
    getDeviceValues,
    clearDevice,
    deleteDevice,
    reset,
    addDataHandler,
    getDataHandler,
    removeDataHandler,
    hasDataHandler,
    removeAllDataHandlers
};
