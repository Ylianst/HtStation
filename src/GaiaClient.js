// This module provides a reusable class for managing a Bluetooth connection
// to a GAIA-compatible device using the 'bluetooth-serial-port' library.

let bluetooth;
try {
    bluetooth = require('bluetooth-serial-port');
} catch (err) {
    if (err.code === 'MODULE_NOT_FOUND') {
        console.error('[GaiaClient] Required module "bluetooth-serial-port" is missing.');
        console.error('[GaiaClient] Please run: npm install bluetooth-serial-port');
        process.exit(1);
    } else {
        throw err;
    }
}

// --- GAIA Frame Constants ---
const GAIA_SYNC = 0xFF;
const GAIA_VERSION = 0x01;
const GAIA_HEADER_LENGTH = 8;
const GAIA_CHECKSUM_PRESENT = 1;

/**
 * A client for handling Bluetooth connections to a GAIA-enabled device.
 * It manages connection state, sending and receiving data frames.
 */
class GaiaClient {
    /**
     * @param {string} macAddress The MAC address of the Bluetooth device.
     */
    constructor(macAddress) {
        this.macAddress = macAddress;
        this.btSerial = new bluetooth.BluetoothSerialPort();
        this.accumulator = Buffer.alloc(0);
        this.commandInterval = null;
        
        // Callback properties for handling events
        this.onFrameReceived = () => {};
        this.onConnectionStatusChanged = () => {};
    }
    
    /**
     * Set a callback function to be called when a frame is received.
     * @param {function} callback The function to call with the received frame buffer.
     */
    onData(callback) {
      if (typeof callback === 'function') {
        this.onFrameReceived = callback;
      }
    }
    
    /**
     * Set a callback function to be called when the connection status changes.
     * @param {function} callback The function to call with the new connection status (boolean).
     */
    onConnected(callback) {
      if (typeof callback === 'function') {
        this.onConnectionStatusChanged = callback;
      }
    }

    /**
     * Establishes a connection to the Bluetooth device.
     * @returns {Promise<void>} A promise that resolves on successful connection.
     */
    connect() {
        return new Promise((resolve, reject) => {
            console.log(`Attempting to find a serial port channel on: ${this.macAddress}`);
            this.btSerial.findSerialPortChannel(this.macAddress, (channel) => {
                if (channel === -1) {
                    return reject(new Error('Could not find a serial port service on the device.'));
                }

                console.log(`Found serial port channel: ${channel}`);
                console.log('Attempting to connect...');

                this.btSerial.connect(this.macAddress, channel, () => {
                    console.log('Successfully connected to the radio!');
                    this._setupListeners();
                    this.onConnectionStatusChanged(true);
                    resolve();
                }, (err) => {
                    this.onConnectionStatusChanged(false);
                    reject(new Error(`Connection failed: ${err}`));
                });
            }, () => {
                reject(new Error('Could not find the device. Make sure it is on and paired.'));
            });
        });
    }

    /**
     * Disconnects from the Bluetooth device.
     */
    disconnect() {
        if (this.btSerial.isOpen()) {
            this.btSerial.close();
        }
        if (this.commandInterval) {
            clearInterval(this.commandInterval);
            this.commandInterval = null;
        }
        this.onConnectionStatusChanged(false);
        console.log('Disconnected from the radio.');
    }

    /**
     * Sends a GAIA-encoded frame to the device.
     * @param {Buffer} rawCommand The raw command payload to be encoded and sent.
     */
    sendFrame(rawCommand) {
        const gaiaFrame = this._gaiaEncode(rawCommand);
        if (this.btSerial.isOpen()) {
            this.btSerial.write(gaiaFrame, (err, bytesWritten) => {
                if (err) {
                    console.error('Failed to write to port:', err);
                } else {
                    //console.log(`Command sent: ${gaiaFrame.toString('hex')}`);
                }
            });
        } else {
            console.error('Cannot send frame: not connected.');
        }
    }

    /**
     * Internal method to set up listeners for incoming data.
     */
    _setupListeners() {
        this.btSerial.on('data', (data) => {
            //console.log(`Received ${data.length} bytes.`);
            this.accumulator = Buffer.concat([this.accumulator, data]);
            //console.log(`Current buffer in hex: ${this.accumulator.toString('hex')}`);

            let decodedResult;
            while ((decodedResult = this._gaiaDecode(this.accumulator, 0, this.accumulator.length)).size !== 0) {
                const { size, cmd } = decodedResult;

                if (size < 0) {
                    this.accumulator = this.accumulator.slice(1);
                } else if (cmd) {
                    //console.log(`Decoded GAIA command: ${cmd.toString('hex')}`);
                    this.onFrameReceived(cmd);
                    this.accumulator = this.accumulator.slice(size);
                } else {
                    break;
                }
            }
        });

        this.btSerial.on('error', (err) => {
            console.error('An error occurred:', err);
            this.disconnect();
        });
    }

    /**
     * Encodes a raw payload into a complete GAIA frame.
     * @param {Buffer} cmd The command payload.
     * @returns {Buffer} The complete GAIA frame.
     */
    _gaiaEncode(cmd) {
        const payloadLength = cmd.length - 4;
        const frame = Buffer.alloc(cmd.length + 4);

        frame.writeUInt8(GAIA_SYNC, 0);
        frame.writeUInt8(GAIA_VERSION, 1);
        frame.writeUInt8(0, 2);
        frame.writeUInt8(payloadLength, 3);
        cmd.copy(frame, 4);

        return frame;
    }

    /**
     * Decodes a GAIA frame from a data buffer.
     * @param {Buffer} data The data buffer.
     * @param {number} index The starting index.
     * @param {number} len The buffer length.
     * @returns {{size: number, cmd: Buffer|null}} Decoded command and bytes consumed.
     */
    _gaiaDecode(data, index, len) {
        if (len < GAIA_HEADER_LENGTH) {
            return { size: 0, cmd: null };
        }

        if (data.readUInt8(index) !== GAIA_SYNC || data.readUInt8(index + 1) !== GAIA_VERSION) {
            console.error(`Invalid GAIA frame signature. Discarding first byte: ${data.readUInt8(index).toString(16)}`);
            return { size: -1, cmd: null };
        }

        const payloadLength = data.readUInt8(index + 3);
        const hasChecksum = (data.readUInt8(index + 2) & GAIA_CHECKSUM_PRESENT);
        const totalLength = payloadLength + GAIA_HEADER_LENGTH + hasChecksum;

        if (totalLength > len) {
            return { size: 0, cmd: null };
        }

        const cmd = Buffer.alloc(4 + payloadLength);
        data.copy(cmd, 0, index + 4, index + 4 + cmd.length);

        return { size: totalLength, cmd };
    }
}

module.exports = GaiaClient;
