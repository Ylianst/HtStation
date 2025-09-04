'use strict';

const path = require('path');
const { loadConfig } = require('./utils/configLoader');
const Radio = require('./Radio.js');
const MqttReporter = require('./utils/MqttReporter');

// === Load configuration from config.ini ===
let config;
try {
    config = loadConfig(path.join(__dirname, 'config.ini'));
} catch (err) {
    console.error(`[App] ${err.message}`);
    process.exit(1);
}

console.log('[App] Loaded settings from config.ini:');
for (const [key, value] of Object.entries(config)) {
    console.log(`  ${key} = ${value}`);
}

const RADIO_MAC_ADDRESS = config.MACADDRESS;
const RADIO_CALLSIGN = config.CALLSIGN;
const RADIO_STATIONID = config.STATIONID ? parseInt(config.STATIONID, 10) : undefined;
if (!RADIO_MAC_ADDRESS || !RADIO_CALLSIGN || RADIO_STATIONID === undefined || isNaN(RADIO_STATIONID)) {
    console.error('[App] Missing required settings in config.ini (MACADDRESS, CALLSIGN, STATIONID).');
    process.exit(1);
}

// === Background server mode ===
if (process.argv.includes('--server') && !process.env._HTC_BG) {
    const { spawn } = require('child_process');
    const args = process.argv.slice(1).filter(arg => arg !== '--server');
    const child = spawn(process.argv[0], args, {
        detached: true,
        stdio: 'ignore',
        env: { ...process.env, _HTC_BG: '1' }
    });
    child.unref();
    console.log('[App] Started in background (server mode).');
    process.exit(0);
}

// === Main Application Logic ===
console.log('Starting the app...');

// === MQTT Setup ===
const mqttEnabled = config.MQTT_BROKER_URL && config.MQTT_TOPIC;
let mqttReporter = null;
if (mqttEnabled) {
    mqttReporter = new MqttReporter(config);
    try {
        mqttReporter.connect();
    } catch (err) {
        console.error('[App] MQTT setup failed:', err.message);
        mqttReporter = null;
    }
}

// To disable channel info loading, set loadChannels to false
const radio = new Radio(RADIO_MAC_ADDRESS, { loadChannels: true });

// Shared state for MQTT publishing
let lastChannelInfo = null;
let lastChannels = null;
let lastSettingsInfo = null;
let lastDevInfo = null;
let lastBattery = null;
// Ensure discovery/state for VFOs is only published once to avoid spamming MQTT/HA
// Cache last published VFO options (JSON string) so we republish if names change
let lastPublishedVfoOptions = null;

// Event listeners to receive updates from the radio
radio.on('infoUpdate', (info) => {
    // Publish Firmware Version sensor when DevInfo is updated
    if (info.type === 'Info' && info.value) {
        lastDevInfo = info.value;
        publishFirmwareVersionSensor(info.value);
    }
    // Store last settings info for later MQTT update
    if (info.type === 'Settings' && info.value) {
        lastSettingsInfo = info.value;
        publishChannelABSensors(info.value);
        // If channels are already loaded, publish VFO selects using channel_a and channel_b
        if (lastChannels && Array.isArray(lastChannels)) {
            const channelAIdx = (lastSettingsInfo && typeof lastSettingsInfo.channel_a === 'number') ? (lastSettingsInfo.channel_a) : 0;
            const channelBIdx = (lastSettingsInfo && typeof lastSettingsInfo.channel_b === 'number') ? (lastSettingsInfo.channel_b) : 0;
            publishVfoSelects(lastChannels, channelAIdx, channelBIdx);
        }
    }
    // Store last channel info for later MQTT update
    if (info.type === 'HtStatus' && radio.htStatus) {
        publishHtStatus(radio.htStatus);
    }
    // When all channels loaded, publish VFO selects
    if (info.type === 'AllChannelsLoaded' && info.value && Array.isArray(info.value)) {
    const channels = info.value;
    lastChannels = channels;
        // DEBUG: show all channel name_str values and lengths to diagnose missing names
        try {
            const names = channels.map((ch, idx) => ({ idx: idx + 1, name: (ch && ch.name_str) || '', len: (ch && ch.name_str) ? ch.name_str.length : 0 }));
            //console.log('[App] AllChannelsLoaded names:', names.slice(0, 30));
            // Show raw bytes for the channel name field for the first 10 channels to diagnose
            const rawNameBytes = channels.slice(0, 10).map((ch, idx) => {
                if (!ch || !ch.raw || ch.raw.length < 30) return { idx: idx + 1, raw: null };
                // raw is an array of bytes; name field starts at offset 20 length 10
                return { idx: idx + 1, raw: ch.raw.slice(20, 30) };
            });
            //console.log('[App] AllChannelsLoaded raw name bytes (first 10):', rawNameBytes);
        } catch (e) {
            console.error('[App] Error logging channel names:', e.message);
        }
    const channelAIdx = (lastSettingsInfo && typeof lastSettingsInfo.channel_a === 'number') ? (lastSettingsInfo.channel_a) : 0;
    const channelBIdx = (lastSettingsInfo && typeof lastSettingsInfo.channel_b === 'number') ? (lastSettingsInfo.channel_b) : 0;
        // Per user request, VFO selection shows index starting at 1; publishVfoSelects expects zero-based indexes
    // Force republish to ensure Home Assistant receives the latest channel names
    lastPublishedVfoOptions = null;
    publishVfoSelects(channels, channelAIdx, channelBIdx);
    }
    // When MQTT connects, publish last channel info if available
    // (Handled by the mqttReporter.connect override below when the MQTT reporter is created.)
    // Publish BatteryAsPercentage locally and store lastBattery
    if (info.type === 'BatteryAsPercentage') {
        lastBattery = info.value;
        if (mqttReporter && config.MQTT_TOPIC) {
            const batteryStateTopic = `${config.MQTT_TOPIC}/battery`;
            mqttReporter.publishStatus(batteryStateTopic, { battery: info.value });
        }
    }

    // Publish status to MQTT if enabled
    if (mqttReporter && info && info.type && info.value) {
        let topic = config.MQTT_TOPIC;
        let payload = { type: info.type, value: info.value };
        mqttReporter.publishStatus(topic, payload);
    }
    
    /*
    if (info.type === 'ChannelInfo') {
        console.log(`[App] Channel ${info.value.channel_id} loaded.`);
    } else if (info.type === 'AllChannelsLoaded') {
        console.log(`[App] All channels loaded.`);
    } else {
        console.log('[App] Received info update:', info);
    }
    */
});

// New handler for received TNC data frames
const AX25Packet = require('./AX25Packet');

radio.on('data', (frame) => {
    // Attempt to decode AX.25 packet
    const packet = AX25Packet.decodeAX25Packet(frame);
    if (packet) {
        console.log('[App] Decoded AX.25 packet:', packet.toString());
        // Check if first address matches our station
        const firstAddr = packet.addresses[0];
        if (firstAddr.address === RADIO_CALLSIGN && firstAddr.SSID === RADIO_STATIONID) {
            // Prepare reply: flip first and second address
            if (packet.addresses.length > 1) {
                const replyAddresses = [...packet.addresses];
                [replyAddresses[0], replyAddresses[1]] = [replyAddresses[1], replyAddresses[0]];
                // Create reply packet
                const AX25PacketClass = require('./AX25Packet');
                const replyPacket = new AX25PacketClass(replyAddresses, packet.nr, packet.ns, packet.pollFinal, packet.command, packet.type, packet.data);
                replyPacket.pid = packet.pid;
                replyPacket.channel_id = packet.channel_id;
                replyPacket.channel_name = packet.channel_name;
                // Serialize replyPacket with header and addresses
                const serialized = replyPacket.ToByteArray ? replyPacket.ToByteArray() : (replyPacket.toByteArray ? replyPacket.toByteArray() : null);
                if (!serialized) {
                    console.warn('[App] AX.25 packet serialization failed:', replyPacket);
                } else if (typeof radio.sendTncFrame !== 'function') {
                    console.warn('[App] radio.sendTncFrame not implemented.');
                } else {
                    radio.sendTncFrame({
                        channel_id: replyPacket.channel_id,
                        data: serialized
                    });
                    console.log('[App] Echoed AX.25 packet back to sender.');
                }
            }
        }
    } else {
        console.log(`[App] Received TNC data frame on channel ${frame.channel_id}${frame.channel_name ? ` (${frame.channel_name})` : ''}:`, frame.data);
    }
});

radio.on('rawCommand', (data) => {
    //console.log('[App] Received raw command data.');
});

radio.on('disconnected', () => {
    console.log('[App] Disconnected from radio.');
});

// Attempt to connect to the radio
radio.connect(RADIO_MAC_ADDRESS)
    .then(() => {
        console.log('Successfully connected to radio!');
    // (removed generic UVPro Radio discovery sensor - individual sensors are published separately)

        // Publish Home Assistant MQTT Discovery config for Battery sensor at startup
        if (mqttReporter && config.MQTT_TOPIC) {
            const uniqueId = `uvpro_radio_${RADIO_STATIONID}`;
            const batterySensorTopic = `homeassistant/sensor/uvpro_radio_battery/config`;
            const batteryStateTopic = `${config.MQTT_TOPIC}/battery`;
            const batterySensorConfig = {
                name: 'UVPro Radio Battery',
                state_topic: batteryStateTopic,
                unique_id: `${uniqueId}_battery`,
                device: {
                    identifiers: [uniqueId],
                    name: 'UVPro Radio',
                    manufacturer: 'BTech',
                    model: 'UV-Pro'
                },
                unit_of_measurement: '%',
                value_template: '{{ value_json.battery }}',
                icon: 'mdi:battery'
            };
            mqttReporter.publishStatus(batterySensorTopic, batterySensorConfig);
            console.log('[MQTT] Published Home Assistant Battery sensor discovery config.');
        }

        // Poll battery percentage immediately and every minute while connected
        let batteryPollInterval = null;
        function pollBattery() {
            if (radio && typeof radio.getBatteryLevelAtPercentage === 'function') {
                radio.getBatteryLevelAtPercentage();
            }
        }
        pollBattery();
        batteryPollInterval = setInterval(() => {
            if (radio.state === 3) { // RadioState.CONNECTED
                pollBattery();
            }
        }, 60000);
        radio.on('disconnected', () => {
            if (batteryPollInterval) {
                clearInterval(batteryPollInterval);
                batteryPollInterval = null;
            }
        });
    })
    .catch((err) => {
        console.error('Failed to connect:', err.message);
    });

// Patch MQTT connect to publish channel info after connection
if (mqttReporter) {
    const origConnect = mqttReporter.connect.bind(mqttReporter);
    mqttReporter.connect = function () {
        origConnect();
        // Wait for MQTT connection event
        this.client.on('connect', () => {
            // Publish last known channel info if available
            if (lastChannelInfo && lastChannelInfo.value) {
                // Prefer htStatus.channel_id if available
                const channel_id = (radio.htStatus && typeof radio.htStatus.channel_id === 'number')
                    ? radio.htStatus.channel_id
                    : lastChannelInfo.value.channel_id;
                const info = Object.assign({}, lastChannelInfo);
                info.value = Object.assign({}, info.value || {}, { channel_id });
                // publishHtStatus expects an object with channel data (use info.value)
                publishHtStatus(info.value);
            }
            // Publish last known battery state if available
            if (lastBattery !== null) {
                const batteryStateTopic = `${config.MQTT_TOPIC}/battery`;
                mqttReporter.publishStatus(batteryStateTopic, { battery: lastBattery });
            }
            // Subscribe to VFO select command topics so HA selections are reflected
            const vfo1CommandTopic = `${config.MQTT_TOPIC}/vfo1/set`;
            const vfo2CommandTopic = `${config.MQTT_TOPIC}/vfo2/set`;
            this.client.subscribe([vfo1CommandTopic, vfo2CommandTopic], (err) => {
                if (!err) console.log('[MQTT] Subscribed to VFO command topics');
            });
            if (!this._vfoHandlerInstalled) {
                this.client.on('message', (topic, message) => {
                    try {
                        const msg = message.toString();
                        if (topic === vfo1CommandTopic) {
                            mqttReporter.publishStatus(`${config.MQTT_TOPIC}/vfo1`, { vfo: msg });
                            console.log(`[MQTT] VFO1 set to: ${msg}`);
                        } else if (topic === vfo2CommandTopic) {
                            mqttReporter.publishStatus(`${config.MQTT_TOPIC}/vfo2`, { vfo: msg });
                            console.log(`[MQTT] VFO2 set to: ${msg}`);
                        }
                    } catch (e) {
                        console.error('[MQTT] Error handling VFO message:', e.message);
                    }
                });
                this._vfoHandlerInstalled = true;
            }
        });
    }
}

// Helper to publish channel sensor discovery and state
function publishHtStatus(info) {
    if (!mqttReporter || !info || !info.channel_id) return;
    const uniqueId = `uvpro_radio_${RADIO_STATIONID}`;

    // Publish dedicated curr_region sensor
    const regionSensorTopic = `homeassistant/sensor/uvpro_radio_region/config`;
    const regionStateTopic = `${config.MQTT_TOPIC}/region`;
    const regionSensorConfig = {
        name: 'UVPro Radio Current Region',
        state_topic: regionStateTopic,
        unique_id: `${uniqueId}_region`,
        device: {
            identifiers: [uniqueId],
            name: 'UVPro Radio',
            manufacturer: 'BTech',
            model: 'UV-Pro'
        },
        value_template: '{{ value_json.curr_region }}'
    };
    let curr_region = (radio.htStatus && typeof radio.htStatus.curr_region === 'number')
        ? radio.htStatus.curr_region
        : (info.value.curr_region);
    mqttReporter.publishStatus(regionSensorTopic, regionSensorConfig);
    mqttReporter.publishStatus(regionStateTopic, { curr_region });
    console.log('[MQTT] Published channel and region sensor discovery and state.');
}

// (moved shared state declarations earlier)

// Helper to convert soft_ver to version string
function getFirmwareVersionString(soft_ver) {
    if (typeof soft_ver !== 'number') return '';
    return ((soft_ver >> 8) & 0xF) + '.' + ((soft_ver >> 4) & 0xF) + '.' + (soft_ver & 0xF);
}

// Helper to publish Firmware Version sensor
function publishFirmwareVersionSensor(devInfo) {
    if (!mqttReporter || !devInfo || typeof devInfo.soft_ver !== 'number') return;
    const uniqueId = `uvpro_radio_${RADIO_STATIONID}`;
    const fwSensorTopic = `homeassistant/sensor/uvpro_radio_firmware/config`;
    const fwStateTopic = `${config.MQTT_TOPIC}/firmware_version`;
    const fwSensorConfig = {
        name: 'UVPro Radio Firmware Version',
        state_topic: fwStateTopic,
        unique_id: `${uniqueId}_firmware`,
        device: {
            identifiers: [uniqueId],
            name: 'UVPro Radio',
            manufacturer: 'BTech',
            model: 'UV-Pro'
        },
        value_template: '{{ value_json.firmware_version }}',
        icon: 'mdi:chip'
    };
    const versionString = getFirmwareVersionString(devInfo.soft_ver);
    mqttReporter.publishStatus(fwSensorTopic, fwSensorConfig);
    mqttReporter.publishStatus(fwStateTopic, { firmware_version: versionString });
    console.log('[MQTT] Published Firmware Version sensor:', versionString);
}

// (moved shared state declarations earlier)

// Helper to publish Channel A and Channel B sensors
function publishChannelABSensors(settings) {
    if (!mqttReporter || !settings) return;
    const uniqueId = `uvpro_radio_${RADIO_STATIONID}`;
    // Channel A sensor
    const channelASensorTopic = `homeassistant/sensor/uvpro_radio_channel_a/config`;
    const channelAStateTopic = `${config.MQTT_TOPIC}/channel_a`;
    const channelASensorConfig = {
        name: 'UVPro Radio Channel A',
        state_topic: channelAStateTopic,
        unique_id: `${uniqueId}_channel_a`,
        device: {
            identifiers: [uniqueId],
            name: 'UVPro Radio',
            manufacturer: 'BTech',
            model: 'UV-Pro'
        },
        value_template: '{{ value_json.channel_a }}',
        icon: 'mdi:gauge',
    };
    mqttReporter.publishStatus(channelASensorTopic, channelASensorConfig);
    mqttReporter.publishStatus(channelAStateTopic, { channel_a: settings.channel_a });

    // Channel B sensor
    const channelBSensorTopic = `homeassistant/sensor/uvpro_radio_channel_b/config`;
    const channelBStateTopic = `${config.MQTT_TOPIC}/channel_b`;
    const channelBSensorConfig = {
        name: 'UVPro Radio Channel B',
        state_topic: channelBStateTopic,
        unique_id: `${uniqueId}_channel_b`,
        device: {
            identifiers: [uniqueId],
            name: 'UVPro Radio',
            manufacturer: 'BTech',
            model: 'UV-Pro'
        },
        value_template: '{{ value_json.channel_b }}',
        icon: 'mdi:gauge',
    };
    mqttReporter.publishStatus(channelBSensorTopic, channelBSensorConfig);
    mqttReporter.publishStatus(channelBStateTopic, { channel_b: settings.channel_b });
    console.log('[MQTT] Published Channel A and Channel B sensors.');
}

// Helper to publish VFO select sensors (VFO1, VFO2)
function publishVfoSelects(channels, channelAIndex, channelBIndex) {
    if (!mqttReporter || !channels || !Array.isArray(channels)) return;
    // Build a dense options array like '1: Name' by iterating indices so holes are filled
    const uniqueId = `uvpro_radio_${RADIO_STATIONID}`;
    const vfo1SensorTopic = `homeassistant/select/uvpro_radio_vfo1/config`;
    const vfo2SensorTopic = `homeassistant/select/uvpro_radio_vfo2/config`;
    const vfo1StateTopic = `${config.MQTT_TOPIC}/vfo1`;
    const vfo2StateTopic = `${config.MQTT_TOPIC}/vfo2`;
    const vfo1CommandTopic = `${config.MQTT_TOPIC}/vfo1/set`;
    const vfo2CommandTopic = `${config.MQTT_TOPIC}/vfo2/set`;

    // Build a dense options array like '1: Name' by iterating indices so holes are filled.
    // Prefer the provided channels' name_str, but if missing, try to look up radio.channels (may arrive later).
    const options = [];
    for (let idx = 0; idx < channels.length; idx++) {
        const ch = channels[idx];
        let name = (ch && ch.name_str) ? ch.name_str : '';
        // fallback to radio.channels if available
        if (!name && radio && radio.channels && radio.channels[idx] && radio.channels[idx].name_str) {
            name = radio.channels[idx].name_str;
        }
        if (!name) name = `Channel ${idx + 1}`;
        options.push(`${idx + 1}: ${name}`);
    }

    // Log a concise summary to help debugging
    //console.log(`[App] publishVfoSelects: channels.length=${channels.length}, options.length=${options.length}`);
    //console.log('[App] publishVfoSelects: options[0..9]=', options.slice(0, Math.min(10, options.length)));

    // If options haven't changed since last publish, skip republishing
    const optionsKey = JSON.stringify(options);
    if (lastPublishedVfoOptions === optionsKey) {
        //console.log('[App] publishVfoSelects: options unchanged, skipping republish.');
        return;
    }

    const vfo1Config = {
        name: 'UVPro Radio VFO1',
        command_topic: vfo1CommandTopic,
        state_topic: vfo1StateTopic,
        unique_id: `${uniqueId}_vfo1`,
        device: {
            identifiers: [uniqueId],
            name: 'UVPro Radio',
            manufacturer: 'BTech',
            model: 'UV-Pro'
        },
        options: options,
        value_template: '{{ value_json.vfo }}'
    };

    const vfo2Config = Object.assign({}, vfo1Config, {
        name: 'UVPro Radio VFO2',
        command_topic: vfo2CommandTopic,
        state_topic: vfo2StateTopic,
        unique_id: `${uniqueId}_vfo2`
    });

    mqttReporter.publishStatus(vfo1SensorTopic, vfo1Config);
    mqttReporter.publishStatus(vfo2SensorTopic, vfo2Config);

    // Publish initial states
    const selA = options[(typeof channelAIndex === 'number' ? channelAIndex : 0)] || options[0];
    const selB = options[(typeof channelBIndex === 'number' ? channelBIndex : 0)] || options[0];
    mqttReporter.publishStatus(vfo1StateTopic, { vfo: selA });
    mqttReporter.publishStatus(vfo2StateTopic, { vfo: selB });
    //console.log('[MQTT] Published VFO1/VFO2 select discovery and initial state.');

    lastPublishedVfoOptions = optionsKey;
}