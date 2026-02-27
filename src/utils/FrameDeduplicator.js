/*
Copyright 2026 Ylian Saint-Hilaire
Licensed under the Apache License, Version 2.0 (the "License");
http://www.apache.org/licenses/LICENSE-2.0
*/

const DataBroker = require('./DataBroker');
const DataBrokerClient = require('./DataBrokerClient');

/**
 * A data handler that deduplicates DataFrame events received from multiple radios.
 * When multiple radios receive the same data frame, this handler ensures only one
 * UniqueDataFrame event is dispatched for frames not seen in the last 3 seconds.
 */
class FrameDeduplicator {
    /**
     * How long to keep frames in the deduplication cache (in seconds).
     */
    static DEDUPLICATION_WINDOW_SECONDS = 3.0;

    constructor() {
        this._disposed = false;
        this._recentFrames = new Map(); // Map<hexKey, timestamp>
        this._broker = new DataBrokerClient();

        // Subscribe to DataFrame events from all devices
        this._broker.subscribe(DataBroker.AllDevices, 'DataFrame', this._onDataFrame.bind(this));
    }

    /**
     * Whether the handler has been disposed.
     */
    get isDisposed() { return this._disposed; }

    /**
     * Number of frames currently in the deduplication cache.
     */
    get cacheCount() { return this._recentFrames.size; }

    /**
     * Handles incoming DataFrame events and dispatches UniqueDataFrame if the frame is unique.
     * @param {number} deviceId
     * @param {string} name
     * @param {object} data - A TNC data fragment (must have a .data property that is a Buffer or array).
     */
    _onDataFrame(deviceId, name, data) {
        if (this._disposed) return;
        if (!data) return;

        // Build a hex key from the frame's data payload
        const frameKey = this._toHex(data);
        if (!frameKey) return;

        const now = Date.now();

        // Clean up old frames
        this._cleanupOldFrames(now);

        // Check if we've seen this frame recently
        if (!this._recentFrames.has(frameKey)) {
            // Unique frame – cache it and dispatch
            this._recentFrames.set(frameKey, now);
            this._broker.dispatch(deviceId, 'UniqueDataFrame', data, false);
        }
    }

    /**
     * Converts a frame's data payload to a hex string for use as a cache key.
     * @param {object} frame
     * @returns {string|null}
     */
    _toHex(frame) {
        const raw = frame.data;
        if (!raw) return null;
        if (Buffer.isBuffer(raw)) return raw.toString('hex');
        if (raw instanceof Uint8Array || Array.isArray(raw)) return Buffer.from(raw).toString('hex');
        return null;
    }

    /**
     * Removes frames older than the deduplication window from the cache.
     * @param {number} nowMs - Current time in milliseconds.
     */
    _cleanupOldFrames(nowMs) {
        const cutoff = nowMs - (FrameDeduplicator.DEDUPLICATION_WINDOW_SECONDS * 1000);
        for (const [key, ts] of this._recentFrames) {
            if (ts < cutoff) {
                this._recentFrames.delete(key);
            }
        }
    }

    /**
     * Clears all frames from the deduplication cache.
     */
    clearCache() {
        this._recentFrames.clear();
    }

    /**
     * Disposes the handler, unsubscribing from the broker and clearing the cache.
     */
    dispose() {
        if (this._disposed) return;
        this._disposed = true;
        if (this._broker) {
            this._broker.dispose();
        }
        this._recentFrames.clear();
    }
}

module.exports = FrameDeduplicator;
