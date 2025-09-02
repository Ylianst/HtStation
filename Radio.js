// This module provides a simple class to interact with a GAIA-enabled radio
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

class Radio extends EventEmitter {
    constructor(...args) {
        super(...args);
        this._tncFrameAccumulator = null;
        this._tncExpectedFragmentId = 0;
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
        this.updateState(RadioState.CONNECTED); // Update the state here
        // Send initial commands after connection is established
        // In this example, we'll only send GET_DEV_INFO for demonstration
        this.sendCommand(RadioCommandGroup.BASIC, RadioBasicCommand.GET_DEV_INFO, 3);
        // The C# code also sends READ_SETTINGS, READ_BSS_SETTINGS, and GET_BATTERY_LEVEL_AS_PERCENTAGE
        // To be fully functional, you would add those commands here.
    }

    onDisconnected() {
        this.updateState(RadioState.DISCONNECTED);
    }

    onDebugMessage(msg) {
        this.emit('debugMessage', msg);
    }

    onReceivedData(value) {
        console.log(`[Radio] Received data: ${bytesToHex(value)}`);
        this.emit('rawCommand', value);

        const commandGroup = getShort(value, 0);
        if (commandGroup === RadioCommandGroup.BASIC) {
            const command = getShort(value, 2) & 0x7FFF;
            const payload = value.slice(4);

            console.log(`[Radio] Received command: ${Object.keys(RadioBasicCommand).find(key => RadioBasicCommand[key] === command)}`);

            switch (command) {
                case RadioBasicCommand.GET_DEV_INFO:
                    // Pass the full value (including commandGroup/command) to decodeDevInfo
                    this.info = RadioCodec.decodeDevInfo(value);
                    this.updateState(RadioState.CONNECTED);
                    this.emit('infoUpdate', { type: 'Info', value: this.info });
                    // Register for HT_STATUS_CHANGED notifications
                    this.sendCommand(RadioCommandGroup.BASIC, RadioBasicCommand.REGISTER_NOTIFICATION, RadioNotification.HT_STATUS_CHANGED);
                    // Request radio settings
                    this.sendCommand(RadioCommandGroup.BASIC, RadioBasicCommand.READ_SETTINGS, null);
                    // Request BSS settings
                    this.sendCommand(RadioCommandGroup.BASIC, RadioBasicCommand.READ_BSS_SETTINGS, null);
                    // Request all channels
                    if (this.info && typeof this.info.channel_count === 'number') {
                        this.channels = new Array(this.info.channel_count);
                        for (let i = 0; i < this.info.channel_count; ++i) {
                            this.sendCommand(RadioCommandGroup.BASIC, RadioBasicCommand.READ_RF_CH, i);
                        }
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
                case RadioBasicCommand.EVENT_NOTIFICATION:
                    const notificationType = payload[0];
                    console.log(`[Radio] Received notification: ${Object.keys(RadioNotification).find(key => RadioNotification[key] === notificationType)}`);
                    switch (notificationType) {
                        case RadioNotification.HT_STATUS_CHANGED:
                            // Decode HT status using the C# logic
                            this.htStatus = RadioCodec.decodeHtStatus(value);
                            this.emit('infoUpdate', { type: 'HtStatus', value: this.htStatus });
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
                                if (this.channels && this.channels[fragment.channel_id] && this.channels[fragment.channel_id].name_str) {
                                    fragment.channel_name = this.channels[fragment.channel_id].name_str;
                                } else {
                                    fragment.channel_name = String(fragment.channel_id);
                                }
                            } else if (this.htStatus && typeof this.htStatus.curr_ch_id === 'number') {
                                fragment.channel_id = this.htStatus.curr_ch_id;
                                if (fragment.channel_id >= 254) {
                                    fragment.channel_name = 'NOAA';
                                } else if (this.channels && this.channels.length > fragment.channel_id && this.channels[fragment.channel_id] && this.channels[fragment.channel_id].name_str) {
                                    fragment.channel_name = this.channels[fragment.channel_id].name_str;
                                } else {
                                    fragment.channel_name = '';
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
                                this.emit('infoUpdate', { type: 'TncDataFragment', value: packet });
                            }
                            break;
                        default:
                            console.warn(`[Radio] Unhandled notification type: ${notificationType}`);
                    }
                    break;
                case RadioBasicCommand.GET_VOLUME:
                    this.volume = payload[0];
                    this.emit('infoUpdate', { type: 'Volume', value: this.volume });
                    break;
                default:
                    console.warn(`[Radio] Unhandled basic command: ${command}`);
            }
        } else {
            console.warn(`[Radio] Unhandled command group: ${commandGroup}`);
        }
    }

    sendCommand(group, command, data) {
        if (this.state !== RadioState.CONNECTED) {
            console.error('[Radio] Not connected to send command.');
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
                console.error('[Radio] Invalid data type for command payload.');
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
            console.error('[Radio] Volume level must be between 0 and 15.');
            return;
        }
        this.sendCommand(RadioCommandGroup.BASIC, RadioBasicCommand.SET_VOLUME, level);
    }
}

module.exports = Radio;
