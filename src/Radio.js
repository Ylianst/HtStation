// This module provides a simple class to interact with a GAIA-enabled radio

// Get logger instance
const logger = global.logger ? global.logger.getLogger('Radio') : console;
// like the BTech UV-Pro, RadioOddity GA-5WB, Vero VR-N76, Vero VR-N7500, Vero VR-N7600
// by wrapping the functionality of the GaiaClient.

const { EventEmitter } = require('events');
const GaiaClient = require('./GaiaClient.js');
const { getShort, getInt, bytesToHex, intToBytes } = require('./utils');
const RadioCodec = require('./RadioCodec');

// Enum-like objects for commands and states
const RadioCommandGroup = {
    BASIC: 2,
    EXTENDED: 10,
};

const RadioBasicCommand = {
    UNKNOWN: 0,
    GET_DEV_ID: 1,
    SET_REG_TIMES: 2,
    GET_REG_TIMES: 3,
    GET_DEV_INFO: 4,
    READ_STATUS: 5,
    REGISTER_NOTIFICATION: 6,
    CANCEL_NOTIFICATION: 7,
    GET_NOTIFICATION: 8,
    EVENT_NOTIFICATION: 9,
    READ_SETTINGS: 10,
    WRITE_SETTINGS: 11,
    STORE_SETTINGS: 12,
    READ_RF_CH: 13,
    WRITE_RF_CH: 14,
    GET_IN_SCAN: 15,
    SET_IN_SCAN: 16,
    SET_REMOTE_DEVICE_ADDR: 17,
    GET_TRUSTED_DEVICE: 18,
    DEL_TRUSTED_DEVICE: 19,
    GET_HT_STATUS: 20,
    SET_HT_ON_OFF: 21,
    GET_VOLUME: 22,
    SET_VOLUME: 23,
    RADIO_GET_STATUS: 24,
    RADIO_SET_MODE: 25,
    RADIO_SEEK_UP: 26,
    RADIO_SEEK_DOWN: 27,
    RADIO_SET_FREQ: 28,
    READ_ADVANCED_SETTINGS: 29,
    WRITE_ADVANCED_SETTINGS: 30,
    HT_SEND_DATA: 31,
    SET_POSITION: 32,
    READ_BSS_SETTINGS: 33,
    WRITE_BSS_SETTINGS: 34,
    FREQ_MODE_SET_PAR: 35,
    FREQ_MODE_GET_STATUS: 36,
    READ_RDA1846S_AGC: 37,
    WRITE_RDA1846S_AGC: 38,
    READ_FREQ_RANGE: 39,
    WRITE_DE_EMPH_COEFFS: 40,
    STOP_RINGING: 41,
    SET_TX_TIME_LIMIT: 42,
    SET_IS_DIGITAL_SIGNAL: 43,
    SET_HL: 44,
    SET_DID: 45,
    SET_IBA: 46,
    GET_IBA: 47,
    SET_TRUSTED_DEVICE_NAME: 48,
    SET_VOC: 49,
    GET_VOC: 50,
    SET_PHONE_STATUS: 51,
    READ_RF_STATUS: 52,
    PLAY_TONE: 53,
    GET_DID: 54,
    GET_PF: 55,
    SET_PF: 56,
    RX_DATA: 57,
    WRITE_REGION_CH: 58,
    WRITE_REGION_NAME: 59,
    SET_REGION: 60,
    SET_PP_ID: 61,
    GET_PP_ID: 62,
    READ_ADVANCED_SETTINGS2: 63,
    WRITE_ADVANCED_SETTINGS2: 64,
    UNLOCK: 65,
    DO_PROG_FUNC: 66,
    SET_MSG: 67,
    GET_MSG: 68,
    BLE_CONN_PARAM: 69,
    SET_TIME: 70,
    SET_APRS_PATH: 71,
    GET_APRS_PATH: 72,
    READ_REGION_NAME: 73,
    SET_DEV_ID: 74,
    GET_PF_ACTIONS: 75,
    GET_POSITION: 76
};

const RadioNotification = {
    UNKNOWN: 0,
    HT_STATUS_CHANGED: 1,
    DATA_RXD: 2,
    NEW_INQUIRY_DATA: 3,
    RESTORE_FACTORY_SETTINGS: 4,
    HT_CH_CHANGED: 5,
    HT_SETTINGS_CHANGED: 6,
    RINGING_STOPPED: 7,
    RADIO_STATUS_CHANGED: 8,
    USER_ACTION: 9,
    SYSTEM_EVENT: 10,
    BSS_SETTINGS_CHANGED: 11,
    DATA_TXD: 12,
    POSITION_CHANGE: 13
};

const RadioState = {
    DISCONNECTED: 1,
    CONNECTING: 2,
    CONNECTED: 3,
    UNABLE_TO_CONNECT: 5,
    BLUETOOTH_NOT_AVAILABLE: 6,
    NOT_RADIO_FOUND: 7,
    ACCESS_DENIED: 8,
};

const RadioCommandErrors = {
    SUCCESS: 0,
    NOT_SUPPORTED: 1,
    NOT_AUTHENTICATED: 2,
    INSUFFICIENT_RESOURCES: 3,
    AUTHENTICATING: 4,
    INVALID_PARAMETER: 5,
    INCORRECT_STATE: 6,
    IN_PROGRESS: 7
};

const RadioPowerStatus = {
    UNKNOWN: 0,
    BATTERY_LEVEL: 1,
    BATTERY_VOLTAGE: 2,
    RC_BATTERY_LEVEL: 3,
    BATTERY_LEVEL_AS_PERCENTAGE: 4
}

class Radio extends EventEmitter {
    /**
     * Check if transmission is allowed based on callsign configuration
     * @returns {boolean} True if transmission is allowed, false otherwise
     */
    get TransmitAllowed() {
        return this._transmitAllowed;
    }

    /**
     * Set the callsign for transmission validation
     * @param {string} callsign - The station callsign from configuration
     */
    setCallsign(callsign) {
        this._callsign = callsign;
        // Update transmit allowed status based on callsign validity
        this._transmitAllowed = this._validateCallsign(callsign);
        if (!this._transmitAllowed) {
            logger.warn('[Radio] TRANSMISSION DISABLED: No valid callsign configured');
        } else {
            logger.log(`[Radio] Transmission enabled for callsign: ${callsign}`);
        }
    }

    /**
     * Validate if a callsign is valid for transmission
     * @param {string} callsign - The callsign to validate
     * @returns {boolean} True if callsign is valid, false otherwise
     * @private
     */
    _validateCallsign(callsign) {
        // Check if callsign exists and is not empty/whitespace
        if (!callsign || typeof callsign !== 'string' || callsign.trim().length === 0) {
            return false;
        }
        return true;
    }

    /**
     * Request battery status (internal helper)
     * @param {number} powerStatus - 1: level, 2: voltage, 3: RC level, 4: percentage
     */
    requestPowerStatus(powerStatus) {
        const data = Buffer.alloc(2);
        data[1] = RadioPowerStatus[powerStatus];
        this.sendCommand(RadioCommandGroup.BASIC, RadioBasicCommand.READ_STATUS, data);
    }

    /**
     * Poll battery level (raw)
     */
    getBatteryLevel() {
        this.requestPowerStatus('BATTERY_LEVEL');
    }

    /**
     * Poll battery voltage
     */
    getBatteryVoltage() {
        this.requestPowerStatus('BATTERY_VOLTAGE');
    }

    /**
     * Poll RC battery level
     */
    getRcBatteryLevel() {
        this.requestPowerStatus('RC_BATTERY_LEVEL');
    }

    /**
     * Poll battery status as percentage
     */
    getBatteryLevelAtPercentage() {
        this.requestPowerStatus('BATTERY_LEVEL_AS_PERCENTAGE');
    }

    /**
     * Write radio settings to change channels (cha, chb) and a few flags.
     * Mirrors the C# RadioSettings.ToByteArray + WriteSettings behavior.
     * @param {number} cha - channel A index
     * @param {number} chb - channel B index
     * @param {number} xdouble_channel - 0..3
     * @param {boolean} xscan
     * @param {number} xsquelch - 0..15
     */
    writeSettings(cha, chb, xdouble_channel = 0, xscan = false, xsquelch = 0) {
        if (!this.settings || !this.settings.rawData || !Array.isArray(this.settings.rawData)) {
            logger.error('[Radio] Cannot write settings: settings not loaded');
            return;
        }
        try {
            // rawData is an Array of bytes; C# copies rawData[5..] into buf
            const raw = this.settings.rawData;
            if (raw.length <= 5) {
                logger.error('[Radio] Invalid settings raw data length');
                return;
            }
            const buf = Buffer.from(raw.slice(5));

            // buf[0] = (((cha & 0x0F) << 4) | (chb & 0x0F));
            buf[0] = (((cha & 0x0F) << 4) | (chb & 0x0F)) & 0xFF;

            // preserve aghfp_call_mode bit from current settings when present
            const aghfp_flag = (this.settings.aghfp_call_mode ? 0x40 : 0);
            const scan_flag = (xscan ? 0x80 : 0);
            buf[1] = (scan_flag | aghfp_flag | ((xdouble_channel & 0x03) << 4) | (xsquelch & 0x0F)) & 0xFF;

            // buf[9] = (byte)((cha & 0xF0) | ((chb & 0x0F) >> 4));
            if (buf.length > 9) {
                buf[9] = ((cha & 0xF0) | ((chb & 0xF0) >> 4)) & 0xFF;
            }

            // Send WRITE_SETTINGS (RadioBasicCommand.WRITE_SETTINGS)
            this.sendCommand(RadioCommandGroup.BASIC, RadioBasicCommand.WRITE_SETTINGS, buf);
            logger.log(`[Radio] Sent WRITE_SETTINGS cha=${cha} chb=${chb} dbl=${xdouble_channel} scan=${xscan} squelch=${xsquelch}`);
            // Optionally request READ_SETTINGS to refresh local cache
            setTimeout(() => this.sendCommand(RadioCommandGroup.BASIC, RadioBasicCommand.READ_SETTINGS, null), 200);
        } catch (e) {
            logger.error('[Radio] Error in writeSettings:', e.message);
        }
    }
    
    /**
     * Returns true if the radio is ready to transmit (not in TX or RX)
     */
    IsTncFree() {
        return (this.htStatus && this.htStatus.is_in_tx === false && this.htStatus.is_in_rx === false);
    }

    /**
     * Internal outbound queue for TNC frames
     */
    _tncOutboundQueue = [];
    _tncSending = false;
    _tncPendingPacket = null; // Packet currently being transmitted (not yet confirmed)

    /**
     * Send a TNC frame (AX.25 packet) over Bluetooth, fragmenting as needed.
     * @param {object} opts - { channel_id, data }
     */
    sendTncFrame(opts) {
        // Check if transmission is allowed
        if (!this.TransmitAllowed) {
            logger.error('[Radio] sendTncFrame: TRANSMISSION BLOCKED - No valid callsign configured');
            return;
        }
        
        // Print the full frame data in HEX before fragmenting
        const data = Buffer.isBuffer(opts.data) ? opts.data : Buffer.from(opts.data);
        //logger.log(`[Radio] sendTncFrame() full data: ${bytesToHex(data)}`);
        const MAX_MTU = 50;
        if (!opts || typeof opts.channel_id !== 'number' || !opts.data) {
            logger.error('[Radio] sendTncFrame: Invalid arguments');
            return;
        }
        const channel_id = opts.channel_id;
        let offset = 0;
        let fragment_id = 0;
        const totalLen = data.length;
        while (offset < totalLen) {
            const remaining = totalLen - offset;
            const fragLen = Math.min(remaining, MAX_MTU);
            const fragData = data.slice(offset, offset + fragLen);
            let flags = fragment_id & 0x3F;
            if (offset + fragLen >= totalLen) flags |= 0x80; // final fragment
            flags |= 0x40; // with_channel_id
            const packet = Buffer.concat([
                Buffer.from([flags]),
                fragData,
                Buffer.from([channel_id])
            ]);
            //logger.log(`[Radio] Queued TNC frame for send: ${bytesToHex(packet)}`);
            this._tncOutboundQueue.push(packet);
            offset += fragLen;
            fragment_id++;
        }
        this._processTncQueue();
    }

    /**
     * Process outbound TNC queue, send next packet if radio is free
     */
    _processTncQueue() {
        // Don't send if already sending, pending confirmation, queue empty, or radio busy
        if (this._tncSending || this._tncPendingPacket || this._tncOutboundQueue.length === 0) return;
        if (!this.IsTncFree()) return;
        
        this._tncSending = true;
        this._tncPendingPacket = this._tncOutboundQueue[0]; // Keep packet in queue until confirmed
        
        /*
        // Extract channel information from packet
        const flags = this._tncPendingPacket[0];
        const with_channel_id = (flags & 0x40) !== 0;
        let channelInfo = 'Unknown';
        
        if (with_channel_id && this._tncPendingPacket.length > 1) {
            const channel_id = this._tncPendingPacket[this._tncPendingPacket.length - 1]; // Channel ID is last byte
            channelInfo = `${channel_id}`;
            
            // Add channel name if available
            if (this.loadChannels && this.channels && this.channels[channel_id] && this.channels[channel_id].name_str) {
                channelInfo += ` (${this.channels[channel_id].name_str})`;
            }
        } else if (this.htStatus && typeof this.htStatus.curr_ch_id === 'number') {
            // Fall back to current channel from HT status
            const channel_id = this.htStatus.curr_ch_id;
            channelInfo = `${channel_id}`;
            
            if (channel_id >= 254) {
                channelInfo += ' (NOAA)';
            } else if (this.loadChannels && this.channels && this.channels.length > channel_id && this.channels[channel_id] && this.channels[channel_id].name_str) {
                channelInfo += ` (${this.channels[channel_id].name_str})`;
            }
        }
        */
       
        // Debug: Print the packet being sent in HEX and channel information
        //logger.log(`[Radio] _processTncQueue sending packet (HEX): ${Array.from(this._tncPendingPacket).map(b => '0x' + b.toString(16).padStart(2, '0')).join(' ')}`);
        //logger.log(`[Radio] _processTncQueue sending packet (length): ${this._tncPendingPacket.length} bytes`);
        //logger.log(`[Radio] _processTncQueue sending packet (channel): ${channelInfo}`);
        
        this.sendCommand(RadioCommandGroup.BASIC, RadioBasicCommand.HT_SEND_DATA, this._tncPendingPacket);
        // Note: _tncSending remains true and packet stays in queue until we get response
    }

    /**
     * @param {string} macAddress
     * @param {object} [options]
     * @param {boolean} [options.loadChannels=true] - Whether to load channel info on connect
     */
    constructor(macAddress, options = {}) {
        super();
        this.macAddress = macAddress;
        this.loadChannels = options.loadChannels !== undefined ? options.loadChannels : true;
        this._tncFrameAccumulator = null;
        this._tncExpectedFragmentId = 0;
        
        // Transmission safety - default to disabled until callsign is set
        this._transmitAllowed = false;
        this._callsign = null;
        
        // GPS state management
        this.gpsEnabled = false;
        this.gpsLock = 2; // 0 == GPS is locked, other values indicate the GPS is not locked
        this.position = null;
        this.lastGpsUpdate = null; // Track when we last received a GPS position
        this.gpsLockTimer = null; // Timer to check GPS lock timeout
        
        // Auto-reconnection management
        this._reconnectTimer = null;
        this._reconnectInterval = 15000; // 15 seconds
        this._autoReconnectEnabled = false;
        this._isManualDisconnect = false;
    }
    /**
     * Updates the internal state of the radio.
     * @param {number} newState - The new state value.
     */
    updateState(newState) {
        this.state = newState;
    }
    /**
     * Connects to the radio using the provided MAC address.
     * Returns a Promise that resolves when connected, or rejects on error.
     * @param {string} macAddress - The MAC address of the radio device.
     */
    connect(macAddress) {
        this.state = RadioState.CONNECTING;
        this.gaiaClient = new GaiaClient(macAddress);

        // Forward GaiaClient events to Radio using callback registration
        this.gaiaClient.onConnected((connected) => {
            if (connected) {
                this.onConnected();
            } else {
                this.onDisconnected();
                this.emit('disconnected');
            }
        });
        this.gaiaClient.onData((data) => {
            this.onReceivedData(data);
        });

        // Return a promise that resolves/rejects on connection
        return new Promise((resolve, reject) => {
            this.gaiaClient.connect()
                .then(() => {
                    this.state = RadioState.CONNECTED;
                    resolve();
                })
                .catch((err) => {
                    this.state = RadioState.UNABLE_TO_CONNECT;
                    reject(err);
                });
        });
    }
    /**
     * Decodes the payload for HT_STATUS_CHANGED, matching the C# RadioHtStatus logic.
     * @param {Uint8Array|Buffer|Array} msg - The payload bytes (full message, not just sliced payload).
     * @returns {object} Decoded HT status.
     */
    decodeHtStatus(msg) {
        if (!msg || typeof msg.length !== 'number' || msg.length < 7) return {};
        // Two first bytes
        const b5 = msg[5], b6 = msg[6];
        let rssi = null, curr_region = null, curr_channel_id_upper = null;
        if (msg.length >= 9) {
            rssi = (msg[7] >> 4);
            curr_region = ((msg[7] & 0x0F) << 2) + (msg[8] >> 6);
            curr_channel_id_upper = ((msg[8] & 0x3C) >> 2);
        } else {
            rssi = 0;
            curr_region = 0;
            curr_channel_id_upper = 0;
        }
        const curr_ch_id_lower = (b6 >> 4);
        const curr_ch_id = (curr_channel_id_upper << 4) + curr_ch_id_lower;
        return {
            raw: Array.from(msg),
            is_power_on: (b5 & 0x80) !== 0,
            is_in_tx: (b5 & 0x40) !== 0,
            is_sq: (b5 & 0x20) !== 0,
            is_in_rx: (b5 & 0x10) !== 0,
            double_channel: (b5 & 0x0C) >> 2,
            is_scan: (b5 & 0x02) !== 0,
            is_radio: (b5 & 0x01) !== 0,
            curr_ch_id_lower,
            is_gps_locked: (b6 & 0x08) !== 0,
            is_hfp_connected: (b6 & 0x04) !== 0,
            is_aoc_connected: (b6 & 0x02) !== 0,
            channel_id: curr_ch_id, // alias for curr_ch_id
            curr_ch_id,
            rssi,
            curr_region,
            curr_channel_id_upper,
        };
    }

    onConnected() {
        this.updateState(RadioState.CONNECTED);
        this.sendCommand(RadioCommandGroup.BASIC, RadioBasicCommand.GET_DEV_INFO, 3);
        // Always request settings and BSS settings
        this.sendCommand(RadioCommandGroup.BASIC, RadioBasicCommand.READ_SETTINGS, null);
        this.sendCommand(RadioCommandGroup.BASIC, RadioBasicCommand.READ_BSS_SETTINGS, null);
    }

    onDisconnected() {
        this.updateState(RadioState.DISCONNECTED);
        
        // Clean up GPS lock timer
        if (this.gpsLockTimer) {
            clearInterval(this.gpsLockTimer);
            this.gpsLockTimer = null;
        }
        
        // Start auto-reconnection if enabled and not a manual disconnect
        if (this._autoReconnectEnabled && !this._isManualDisconnect) {
            this._scheduleReconnect();
        }
    }

    onDebugMessage(msg) {
        this.emit('debugMessage', msg);
    }

    onReceivedData(value) {
        //logger.log(`[Radio] Received data: ${bytesToHex(value)}`);
        this.emit('rawCommand', value);

        const commandGroup = getShort(value, 0);
        if (commandGroup === RadioCommandGroup.BASIC) {
            const command = getShort(value, 2) & 0x7FFF;
            const payload = value.slice(4);

            //logger.log(`[Radio] Received command: ${Object.keys(RadioBasicCommand).find(key => RadioBasicCommand[key] === command)}`);

            switch (command) {
                case RadioBasicCommand.HT_SEND_DATA:
                    // Handle HT_SEND_DATA response (error code in value[4])
                    const errorCode = value[4];
                    let errorName = 'Unknown';
                    for (const [key, val] of Object.entries(RadioCommandErrors)) {
                        if (val === errorCode) { errorName = key; break; }
                    }
                    logger.log(`[Radio] HT_SEND_DATA response: errorCode=${errorCode} (${errorName})`);
                    
                    if (errorCode === RadioCommandErrors.SUCCESS) {
                        // Packet sent successfully - remove from queue
                        if (this._tncPendingPacket && this._tncOutboundQueue.length > 0) {
                            this._tncOutboundQueue.shift(); // Remove the successfully sent packet
                            this._tncPendingPacket = null;
                        }
                        this._tncSending = false;
                        
                        // Process next packet if any
                        if (this._tncOutboundQueue.length > 0) {
                            setTimeout(() => this._processTncQueue(), 10);
                        }
                    } else if (errorCode === RadioCommandErrors.INCORRECT_STATE) {
                        // Radio not ready - keep packet in queue, will retry on HT_STATUS_CHANGED
                        logger.log(`[Radio] Radio in incorrect state for transmission - packet will be retried when radio is ready`);
                        this._tncPendingPacket = null;
                        this._tncSending = false;
                        // Don't process queue now - wait for HT_STATUS_CHANGED notification
                    } else {
                        // Other errors - could be retried or discarded based on error type
                        logger.warn(`[Radio] HT_SEND_DATA failed with error ${errorCode} (${errorName}) - removing packet from queue`);
                        if (this._tncPendingPacket && this._tncOutboundQueue.length > 0) {
                            this._tncOutboundQueue.shift(); // Remove the failed packet
                            this._tncPendingPacket = null;
                        }
                        this._tncSending = false;
                        
                        // Try next packet if any
                        if (this._tncOutboundQueue.length > 0) {
                            setTimeout(() => this._processTncQueue(), 50); // Slightly longer delay for other errors
                        }
                    }
                    break;
                case RadioBasicCommand.GET_DEV_INFO:
                    this.info = RadioCodec.decodeDevInfo(value);
                    this.updateState(RadioState.CONNECTED);
                    this.emit('infoUpdate', { type: 'Info', value: this.info });
                    this.sendCommand(RadioCommandGroup.BASIC, RadioBasicCommand.REGISTER_NOTIFICATION, RadioNotification.HT_STATUS_CHANGED);
                    // Only request channels if loadChannels is true
                    if (this.loadChannels && this.info && typeof this.info.channel_count === 'number') {
                        this.channels = new Array(this.info.channel_count);
                        for (let i = 0; i < this.info.channel_count; ++i) {
                            this.sendCommand(RadioCommandGroup.BASIC, RadioBasicCommand.READ_RF_CH, i);
                        }
                    } else {
                        this.channels = null;
                    }
                    break;
                case RadioBasicCommand.READ_BSS_SETTINGS:
                    // Decode BSS settings using the C# logic
                    this.bssSettings = RadioCodec.decodeBssSettings(value);
                    this.emit('infoUpdate', { type: 'BssSettings', value: this.bssSettings });
                    break;
                case RadioBasicCommand.READ_RF_CH:
                    // Decode channel info and store in channels array
                    if (this.info && typeof this.info.channel_count === 'number') {
                        const channelId = value[5];
                        const channelInfo = RadioCodec.decodeChannelInfo(value);
                        if (Array.isArray(this.channels) && channelId < this.channels.length) {
                            this.channels[channelId] = channelInfo;
                            // Emit event for each channel as it is loaded
                            this.emit('infoUpdate', { type: 'ChannelInfo', value: channelInfo });
                            // Only emit when all channels are loaded
                            if (this.channels.every(ch => ch)) {
                                this.emit('infoUpdate', { type: 'AllChannelsLoaded', value: this.channels });
                            }
                        }
                    }
                    break;
                case RadioBasicCommand.READ_SETTINGS:
                    // Decode radio settings using the C# logic
                    this.settings = RadioCodec.decodeRadioSettings(value);
                    this.emit('infoUpdate', { type: 'Settings', value: this.settings });
                    break;
                case RadioBasicCommand.READ_STATUS: {
                    // Battery status decoding (C# logic port)
                    if (value.length > 7) {
                        const powerStatus = getShort(value, 5);
                        switch (powerStatus) {
                            case 1: // BATTERY_LEVEL
                                const batteryLevel = value[7];
                                this.emit('infoUpdate', { type: 'BatteryLevel', value: batteryLevel });
                                logger.log(`[Radio] BatteryLevel: ${batteryLevel}`);
                                break;
                            case 2: // BATTERY_VOLTAGE
                                const batteryVoltage = getShort(value, 7) / 1000;
                                this.emit('infoUpdate', { type: 'BatteryVoltage', value: batteryVoltage });
                                logger.log(`[Radio] BatteryVoltage: ${batteryVoltage}`);
                                break;
                            case 3: // RC_BATTERY_LEVEL
                                const rcBatteryLevel = value[7];
                                this.emit('infoUpdate', { type: 'RcBatteryLevel', value: rcBatteryLevel });
                                logger.log(`[Radio] RcBatteryLevel: ${rcBatteryLevel}`);
                                break;
                            case 4: // BATTERY_LEVEL_AS_PERCENTAGE
                                const batteryPercent = value[7];
                                this.emit('infoUpdate', { type: 'BatteryAsPercentage', value: batteryPercent });
                                //logger.log(`[Radio] BatteryAsPercentage: ${batteryPercent}`);
                                break;
                            default:
                                logger.log(`[Radio] Unexpected Power Status: ${powerStatus}`);
                                break;
                        }
                    }
                    break;
                }
                case RadioBasicCommand.EVENT_NOTIFICATION:
                    const notificationType = payload[0];
                    //logger.log(`[Radio] Received notification: ${Object.keys(RadioNotification).find(key => RadioNotification[key] === notificationType)}`);
                    switch (notificationType) {
                        case RadioNotification.HT_STATUS_CHANGED:
                            // Decode HT status using the C# logic
                            this.htStatus = RadioCodec.decodeHtStatus(value);
                            this.emit('infoUpdate', { type: 'HtStatus', value: this.htStatus });
                            this._processTncQueue();
                            break;
                        case RadioNotification.HT_SETTINGS_CHANGED:
                            // Decode HT settings using the C# logic
                            this.settings = RadioCodec.decodeRadioSettings(value);
                            this.emit('infoUpdate', { type: 'Settings', value: this.settings });
                            break;
                        case RadioNotification.DATA_RXD:
                            // Decode TNC data fragment
                            const fragment = {};
                            const flags = value[5];
                            fragment.final_fragment = (flags & 0x80) !== 0;
                            const with_channel_id = (flags & 0x40) !== 0;
                            fragment.fragment_id = flags & 0x3F;
                            const dataLen = value.length - 6 - (with_channel_id ? 1 : 0);
                            fragment.data = value.slice(6, 6 + dataLen);
                            fragment.time = new Date();
                            if (with_channel_id && value.length > 6) {
                                fragment.channel_id = value[value.length - 1];
                                // Only set channel_name if channels are loaded
                                if (this.loadChannels && this.channels && this.channels[fragment.channel_id] && this.channels[fragment.channel_id].name_str) {
                                    fragment.channel_name = this.channels[fragment.channel_id].name_str;
                                } else {
                                    fragment.channel_name = String(fragment.channel_id);
                                }
                            } else if (this.htStatus && typeof this.htStatus.curr_ch_id === 'number') {
                                fragment.channel_id = this.htStatus.curr_ch_id;
                                if (fragment.channel_id >= 254) {
                                    fragment.channel_name = 'NOAA';
                                } else if (this.loadChannels && this.channels && this.channels.length > fragment.channel_id && this.channels[fragment.channel_id] && this.channels[fragment.channel_id].name_str) {
                                    fragment.channel_name = this.channels[fragment.channel_id].name_str;
                                } else {
                                    fragment.channel_name = String(fragment.channel_id);
                                }
                            } else {
                                fragment.channel_id = -1;
                                fragment.channel_name = '';
                            }

                            // TNC fragment accumulation logic
                            if (!this._tncFrameAccumulator) {
                                if (fragment.fragment_id === 0) {
                                    this._tncFrameAccumulator = fragment;
                                    this._tncExpectedFragmentId = 1;
                                } else {
                                    // Ignore out-of-order start
                                    this._tncFrameAccumulator = null;
                                    this._tncExpectedFragmentId = 0;
                                }
                            } else {
                                // If fragment_id is not expected, reset accumulator
                                if (fragment.fragment_id !== this._tncExpectedFragmentId) {
                                    this._tncFrameAccumulator = null;
                                    if (fragment.fragment_id === 0) {
                                        this._tncFrameAccumulator = fragment;
                                        this._tncExpectedFragmentId = 1;
                                    } else {
                                        this._tncExpectedFragmentId = 0;
                                    }
                                } else {
                                    // Append data
                                    const merged = {};
                                    Object.assign(merged, fragment);
                                    merged.data = Buffer.concat([this._tncFrameAccumulator.data, fragment.data]);
                                    merged.fragment_id = fragment.fragment_id;
                                    merged.final_fragment = fragment.final_fragment;
                                    merged.channel_id = fragment.channel_id;
                                    merged.channel_name = fragment.channel_name;
                                    merged.time = fragment.time;
                                    this._tncFrameAccumulator = merged;
                                    this._tncExpectedFragmentId++;
                                }
                            }
                            // Emit only when final fragment is received
                            if (this._tncFrameAccumulator && this._tncFrameAccumulator.final_fragment) {
                                const packet = Object.assign({}, this._tncFrameAccumulator);
                                packet.incoming = true;
                                packet.time = new Date();
                                this._tncFrameAccumulator = null;
                                this._tncExpectedFragmentId = 0;
                                this.emit('data', packet);
                            }
                            break;
                        case RadioNotification.POSITION_CHANGE:
                            // Set status to success and decode position
                            value[4] = 0; // Set status to success
                            this.position = this.decodeRadioPosition(value);
                            this.lastGpsUpdate = new Date(); // Record when we received this update
                            
                            if (this.gpsLock > 0) { 
                                this.gpsLock--; // Decrease the GPS lock counter
                            }
                            this.position.locked = (this.gpsLock === 0);
                            logger.log(`[Radio] GPS Position update - Locked: ${this.position.locked}, Lat: ${this.position.latitude}, Lng: ${this.position.longitude}`);
                            this.emit('positionUpdate', this.position);
                            break;
                        default:
                            logger.warn(`[Radio] Unhandled notification type: ${notificationType}`);
                    }
                    break;
                case RadioBasicCommand.GET_VOLUME:
                    this.volume = payload[1];
                    this.emit('infoUpdate', { type: 'Volume', value: this.volume });
                    break;
                default:
                    logger.warn(`[Radio] Unhandled basic command: ${command}`);
            }
        } else {
            logger.warn(`[Radio] Unhandled command group: ${commandGroup}`);
        }
    }

    sendCommand(group, command, data) {
        if (this.state !== RadioState.CONNECTED) {
            logger.error('[Radio] Not connected to send command.');
            return;
        }

        // This is a simplified command builder.
        // The C# code uses a more complex structure, but for this example,
        // we'll build a basic command packet.
        const header = new Uint8Array(4);
        header.set(intToBytes(group, 2), 0);
        header.set(intToBytes(command, 2), 2);

        let payload = new Uint8Array(0);
        if (data !== undefined && data !== null) {
            if (typeof data === 'number') {
                payload = intToBytes(data, 1);
            } else if (data instanceof Uint8Array || data instanceof ArrayBuffer) {
                payload = new Uint8Array(data);
            } else {
                logger.error('[Radio] Invalid data type for command payload.');
                return;
            }
        }

        const packet = new Uint8Array(header.length + payload.length);
        packet.set(header, 0);
        packet.set(payload, header.length);

        this.gaiaClient.sendFrame(Buffer.from(packet));
    }

    getVolumeLevel() {
        this.sendCommand(RadioCommandGroup.BASIC, RadioBasicCommand.GET_VOLUME, null);
    }

    setVolumeLevel(level) {
        if (level < 0 || level > 15) {
            logger.error('[Radio] Volume level must be between 0 and 15.');
            return;
        }
        this.sendCommand(RadioCommandGroup.BASIC, RadioBasicCommand.SET_VOLUME, level);
    }

    setRegion(region) {
        if (typeof region !== 'number' || !Number.isInteger(region)) {
            logger.error('[Radio] Region must be an integer.');
            return;
        }
        
        // Validate region against region_count from DevInfo (typically 0-5 for region_count=6)
        const maxRegion = (this.info && typeof this.info.region_count === 'number') ? this.info.region_count - 1 : 5;
        if (region < 0 || region > maxRegion) {
            logger.error(`[Radio] Region must be between 0 and ${maxRegion} (region_count: ${this.info ? this.info.region_count : 'unknown'}).`);
            return;
        }
        
        this.sendCommand(RadioCommandGroup.BASIC, RadioBasicCommand.SET_REGION, region);
        logger.log(`[Radio] Set region to: ${region}`);
        
        // After changing region, reload all channels since they may be different
        if (this.loadChannels && this.info && typeof this.info.channel_count === 'number') {
            logger.log('[Radio] Reloading channels after region change...');
            this.channels = new Array(this.info.channel_count);
            for (let i = 0; i < this.info.channel_count; ++i) {
                this.sendCommand(RadioCommandGroup.BASIC, RadioBasicCommand.READ_RF_CH, i);
            }
        }
    }

    /**
     * Enables or disables GPS position notifications
     * @param {boolean} enabled - True to enable GPS, false to disable
     */
    setGpsEnabled(enabled) {
        if (this.gpsEnabled === enabled) return;
        
        this.gpsEnabled = enabled;
        
        if (this.state === RadioState.CONNECTED) {
            this.gpsLock = 2; // Reset GPS lock status
            this.lastGpsUpdate = null; // Reset last update time
            
            // Clear any existing timer
            if (this.gpsLockTimer) {
                clearInterval(this.gpsLockTimer);
                this.gpsLockTimer = null;
            }
            
            if (this.gpsEnabled) {
                logger.log('[Radio] Enabling GPS position notifications');
                this.sendCommand(RadioCommandGroup.BASIC, RadioBasicCommand.REGISTER_NOTIFICATION, RadioNotification.POSITION_CHANGE);
                
                // Start GPS lock timeout checker (runs every 5 seconds)
                this.gpsLockTimer = setInterval(() => {
                    this.checkGpsLockTimeout();
                }, 5000);
            } else {
                logger.log('[Radio] Disabling GPS position notifications');
                this.sendCommand(RadioCommandGroup.BASIC, RadioBasicCommand.CANCEL_NOTIFICATION, RadioNotification.POSITION_CHANGE);
            }
        }
    }

    /**
     * Checks if GPS lock has timed out (no position updates in 30 seconds)
     */
    checkGpsLockTimeout() {
        if (!this.gpsEnabled || !this.lastGpsUpdate) return;
        
        const timeSinceLastUpdate = Date.now() - this.lastGpsUpdate.getTime();
        const thirtySecondsMs = 30 * 1000;
        
        if (timeSinceLastUpdate > thirtySecondsMs) {
            // GPS lock has timed out
            if (this.gpsLock === 0) {
                logger.log('[Radio] GPS lock timeout - setting lock to false');
                this.gpsLock = 1; // Set to unlocked
                
                // Update position lock status and emit update
                if (this.position) {
                    this.position.locked = false;
                    this.emit('positionUpdate', this.position);
                }
            }
        }
    }

    /**
     * Returns current GPS status
     * @returns {object} GPS status information
     */
    getGpsStatus() {
        return {
            enabled: this.gpsEnabled,
            locked: this.gpsLock === 0,
            position: this.position
        };
    }

    /**
     * Decodes radio position data from GPS notification
     * @param {Uint8Array} msg - The GPS position message
     * @returns {object} Decoded position information
     */
    decodeRadioPosition(msg) {
        const status = msg[4];
        const position = {
            status,
            latitudeRaw: 0,
            longitudeRaw: 0,
            altitude: 0,
            speed: 0,
            heading: 0,
            timeRaw: 0,
            accuracy: 0,
            latitudeStr: '',
            longitudeStr: '',
            latitude: 0,
            longitude: 0,
            timeUTC: null,
            time: null,
            receivedTime: new Date(),
            locked: false
        };

        if (status === RadioCommandErrors.SUCCESS) {
            // Extract raw latitude and longitude (24-bit values)
            position.latitudeRaw = (msg[5] << 16) + (msg[6] << 8) + msg[7];
            position.longitudeRaw = (msg[8] << 16) + (msg[9] << 8) + msg[10];
            
            // Convert to decimal degrees and DMS strings
            position.latitude = this.convertLatitude(position.latitudeRaw);
            position.longitude = this.convertLatitude(position.longitudeRaw);
            position.latitudeStr = this.convertLatitudeToDms(position.latitudeRaw, true);
            position.longitudeStr = this.convertLatitudeToDms(position.longitudeRaw, false);
            
            // Extract additional fields if message is long enough
            if (msg.length > 11) {
                position.altitude = (msg[11] << 8) + msg[12];
                position.speed = (msg[13] << 8) + msg[14];
                position.heading = (msg[15] << 8) + msg[16];
                position.timeRaw = (msg[17] << 24) + (msg[18] << 16) + (msg[19] << 8) + msg[20];
                position.timeUTC = new Date(position.timeRaw * 1000);
                position.time = new Date(position.timeRaw * 1000);
                position.accuracy = (msg[21] << 8) + msg[22];
            }
        }

        return position;
    }

    /**
     * Converts raw latitude/longitude to decimal degrees
     * @param {number} rawValue - 24-bit raw coordinate value
     * @returns {number} Decimal degrees
     */
    convertLatitude(rawValue) {
        // Handle 24-bit two's complement
        if ((rawValue & 0x800000) !== 0) {
            // Sign-extend from 24 bits to 32 bits
            rawValue |= 0xFF000000;
        } else {
            // Ensure no higher bits are set if positive
            rawValue &= 0x00FFFFFF;
        }

        return rawValue / 60.0 / 500.0;
    }

    /**
     * Converts raw coordinate to DMS (Degrees, Minutes, Seconds) string
     * @param {number} rawValue - 24-bit raw coordinate value
     * @param {boolean} isLatitude - True for latitude (N/S), false for longitude (E/W)
     * @returns {string} DMS formatted string
     */
    convertLatitudeToDms(rawValue, isLatitude = true) {
        // Handle 24-bit two's complement
        if ((rawValue & 0x800000) !== 0) {
            // Sign-extend from 24 bits to 32 bits
            rawValue |= 0xFF000000;
        } else {
            // Ensure no higher bits are set if positive
            rawValue &= 0x00FFFFFF;
        }

        let degreesDecimal = rawValue / 60.0 / 500.0;

        // Determine the cardinal direction
        let direction;
        if (isLatitude) {
            direction = degreesDecimal >= 0 ? 'N' : 'S';
        } else {
            direction = degreesDecimal >= 0 ? 'E' : 'W';
        }
        
        degreesDecimal = Math.abs(degreesDecimal); // Work with positive value

        const degrees = Math.floor(degreesDecimal);
        const minutesDecimal = (degreesDecimal - degrees) * 60;
        const minutes = Math.floor(minutesDecimal);
        const seconds = (minutesDecimal - minutes) * 60;

        return `${degrees}° ${minutes}' ${seconds.toFixed(2)}" ${direction}`;
    }

    /**
     * Enable or disable automatic reconnection
     * @param {boolean} enabled - True to enable auto-reconnection, false to disable
     */
    setAutoReconnectEnabled(enabled) {
        this._autoReconnectEnabled = enabled;
        logger.log(`[Radio] Auto-reconnection ${enabled ? 'enabled' : 'disabled'}`);
        
        // If disabling and there's a pending reconnect, cancel it
        if (!enabled && this._reconnectTimer) {
            clearTimeout(this._reconnectTimer);
            this._reconnectTimer = null;
        }
    }

    /**
     * Schedule a reconnection attempt
     * @private
     */
    _scheduleReconnect() {
        // Clear any existing timer
        if (this._reconnectTimer) {
            clearTimeout(this._reconnectTimer);
        }
        
        logger.log(`[Radio] Scheduling reconnection attempt in ${this._reconnectInterval / 1000} seconds...`);
        
        this._reconnectTimer = setTimeout(() => {
            this._attemptReconnect();
        }, this._reconnectInterval);
    }

    /**
     * Attempt to reconnect to the radio
     * @private
     */
    async _attemptReconnect() {
        // Clear the timer since we're processing the reconnect now
        this._reconnectTimer = null;
        
        // Only attempt reconnect if auto-reconnection is still enabled
        if (!this._autoReconnectEnabled) {
            return;
        }
        
        // Don't attempt reconnect if already connected or connecting
        if (this.state === RadioState.CONNECTED || this.state === RadioState.CONNECTING) {
            return;
        }
        
        logger.log('[Radio] Attempting automatic reconnection...');
        
        try {
            await this.connect(this.macAddress);
            logger.log('[Radio] Automatic reconnection successful!');
            
            // Clear the manual disconnect flag since we successfully reconnected
            this._isManualDisconnect = false;
            
        } catch (error) {
            logger.log(`[Radio] Automatic reconnection failed: ${error.message}`);
            
            // Schedule another reconnection attempt if auto-reconnect is still enabled
            if (this._autoReconnectEnabled) {
                this._scheduleReconnect();
            }
        }
    }

    /**
     * Disconnect from the radio manually (disables auto-reconnection temporarily)
     */
    disconnect() {
        logger.log('[Radio] Manual disconnect requested');
        this._isManualDisconnect = true;
        
        // Clear any pending reconnection timer
        if (this._reconnectTimer) {
            clearTimeout(this._reconnectTimer);
            this._reconnectTimer = null;
        }
        
        // Disconnect the underlying client if connected
        if (this.gaiaClient && this.state === RadioState.CONNECTED) {
            this.gaiaClient.disconnect();
        } else {
            // If not connected, just update state
            this.updateState(RadioState.DISCONNECTED);
        }
    }
}

module.exports = Radio;
