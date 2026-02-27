/*
Copyright 2026 Ylian Saint-Hilaire
Licensed under the Apache License, Version 2.0 (the "License");
http://www.apache.org/licenses/LICENSE-2.0
*/

const DataBroker = require('./DataBroker');

/**
 * A client for the DataBroker that manages subscriptions for a specific component.
 * When dispose() is called, all subscriptions are automatically removed.
 */
class DataBrokerClient {
    constructor() {
        this._disposed = false;
    }

    /**
     * Subscribes to data changes for a specific device ID and name.
     * @param {number}          deviceId - Device ID, or DataBroker.AllDevices (-1).
     * @param {string|string[]} name     - Name/key, DataBroker.AllNames ('*'), or an array of names.
     * @param {function}        callback - (deviceId, name, data) => void
     */
    subscribe(deviceId, name, callback) {
        if (this._disposed) throw new Error('DataBrokerClient has been disposed');
        if (callback == null) throw new Error('callback is required');
        if (name == null) throw new Error('name is required');

        // Support subscribing to multiple names at once
        if (Array.isArray(name)) {
            for (const n of name) {
                if (n != null) {
                    DataBroker.subscribe(this, deviceId, n, callback);
                }
            }
        } else {
            DataBroker.subscribe(this, deviceId, name, callback);
        }
    }

    /**
     * Subscribes to all names for a given device ID.
     * @param {number}   deviceId - Device ID, or DataBroker.AllDevices (-1).
     * @param {function} callback - (deviceId, name, data) => void
     */
    subscribeAll(deviceId, callback) {
        if (arguments.length === 1) {
            // subscribeAll(callback) — convenience for all devices + all names
            this.subscribe(DataBroker.AllDevices, DataBroker.AllNames, deviceId);
        } else {
            this.subscribe(deviceId, DataBroker.AllNames, callback);
        }
    }

    /**
     * Unsubscribes from a specific device ID and name.
     * @param {number} deviceId
     * @param {string} name
     */
    unsubscribe(deviceId, name) {
        if (this._disposed) return;
        DataBroker.unsubscribeSpecific(this, deviceId, name);
    }

    /**
     * Unsubscribes from all subscriptions for this client.
     */
    unsubscribeAll() {
        if (this._disposed) return;
        DataBroker.unsubscribe(this);
    }

    /**
     * Dispatches data to the broker.
     * @param {number}  deviceId       - Device ID (use 0 for persisted values).
     * @param {string}  name           - Name/key of the data.
     * @param {*}       data           - The data value.
     * @param {boolean} [store=true]   - Store in broker; false = broadcast only.
     */
    dispatch(deviceId, name, data, store = true) {
        if (this._disposed) return;
        DataBroker.dispatch(deviceId, name, data, store);
    }

    /**
     * Gets a value from the broker.
     * @param {number} deviceId
     * @param {string} name
     * @param {*}      [defaultValue]
     * @returns {*}
     */
    getValue(deviceId, name, defaultValue = undefined) {
        return DataBroker.getValue(deviceId, name, defaultValue);
    }

    /**
     * Checks if a value exists in the broker.
     * @param {number} deviceId
     * @param {string} name
     * @returns {boolean}
     */
    hasValue(deviceId, name) {
        return DataBroker.hasValue(deviceId, name);
    }

    /**
     * Publishes an informational log message (device 1, "LogInfo", not stored).
     * @param {string} msg
     */
    logInfo(msg) {
        if (this._disposed) return;
        DataBroker.dispatch(1, 'LogInfo', msg, false);
    }

    /**
     * Publishes an error log message (device 1, "LogError", not stored).
     * @param {string} msg
     */
    logError(msg) {
        if (this._disposed) return;
        DataBroker.dispatch(1, 'LogError', msg, false);
    }

    /**
     * Disposes the client, removing all its subscriptions.
     */
    dispose() {
        if (this._disposed) return;
        this._disposed = true;
        DataBroker.unsubscribe(this);
    }
}

module.exports = DataBrokerClient;
