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
let lastVolume = null;
let lastSquelch = null;
let lastScan = null;
let lastDoubleChannel = null;
let lastRegion = null;
let lastGpsEnabled = null;
let lastGpsPosition = null;
// Ensure discovery/state for VFOs is only published once to avoid spamming MQTT/HA
// Cache last published VFO options (JSON string) so we republish if names change
let lastPublishedVfoOptions = null;

// Event listeners to receive updates from the radio
radio.on('infoUpdate', (info) => {
    // Publish Firmware Version sensor when DevInfo is updated
    if (info.type === 'Info' && info.value) {
        lastDevInfo = info.value;
        publishFirmwareVersionSensor(info.value);

        // Publish Region select discovery when DevInfo is available
        if (typeof info.value.region_count === 'number') {
            publishRegionSelect(info.value.region_count);
        }
    }
    // Store last settings info for later MQTT update
    if (info.type === 'Settings' && info.value) {
        lastSettingsInfo = info.value;

        // Publish squelch level state
        if (typeof info.value.squelch_level === 'number') {
            lastSquelch = info.value.squelch_level;
            if (mqttReporter && config.MQTT_TOPIC) {
                const squelchStateTopic = `${config.MQTT_TOPIC}/squelch`;
                mqttReporter.publishStatus(squelchStateTopic, { squelch: info.value.squelch_level });
            }
        }

        // Publish scan state
        if (typeof info.value.scan === 'boolean') {
            lastScan = info.value.scan;
            if (mqttReporter && config.MQTT_TOPIC) {
                const scanStateTopic = `${config.MQTT_TOPIC}/scan`;
                mqttReporter.publishStatus(scanStateTopic, { scan: info.value.scan ? 'ON' : 'OFF' });
            }
        }

        // Publish double_channel state
        if (typeof info.value.double_channel === 'number') {
            lastDoubleChannel = info.value.double_channel;
            if (mqttReporter && config.MQTT_TOPIC) {
                const doubleChannelStateTopic = `${config.MQTT_TOPIC}/double_channel`;
                mqttReporter.publishStatus(doubleChannelStateTopic, { double_channel: info.value.double_channel === 1 ? 'ON' : 'OFF' });
            }
        }

        // If channels are already loaded, publish VFO selects using channel_a and channel_b
        if (lastChannels && Array.isArray(lastChannels)) {
            const channelAIdx = (lastSettingsInfo && typeof lastSettingsInfo.channel_a === 'number') ? (lastSettingsInfo.channel_a) : 0;
            const channelBIdx = (lastSettingsInfo && typeof lastSettingsInfo.channel_b === 'number') ? (lastSettingsInfo.channel_b) : 0;
            publishVfoSelects(lastChannels, channelAIdx, channelBIdx);
        }
    }
    // Store last channel info for later MQTT update
    if (info.type === 'HtStatus' && radio.htStatus) {

        // Publish region state when HtStatus is updated
        if (typeof radio.htStatus.curr_region === 'number') {
            lastRegion = radio.htStatus.curr_region;
            if (mqttReporter && config.MQTT_TOPIC) {
                const regionStateTopic = `${config.MQTT_TOPIC}/region_select`;
                const regionLabel = `Region ${radio.htStatus.curr_region + 1}`;
                mqttReporter.publishStatus(regionStateTopic, { region: regionLabel });
            }
        }
    }
    // When all channels loaded, publish VFO selects
    if (info.type === 'AllChannelsLoaded' && info.value && Array.isArray(info.value)) {
        const channels = info.value;
        //console.log('[App] AllChannelsLoaded channels:', channels);
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
        // Force republish to ensure Home Assistant receives the latest channel names (especially after region changes)
        lastPublishedVfoOptions = null;
        publishVfoSelects(channels, channelAIdx, channelBIdx);
        //console.log('[App] Updated VFO selects with reloaded channels.');
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

    // Publish VolumeLevel locally and store lastVolume
    if (info.type === 'Volume') {
        lastVolume = info.value;
        if (mqttReporter && config.MQTT_TOPIC) {
            const volumeStateTopic = `${config.MQTT_TOPIC}/volume`;
            mqttReporter.publishStatus(volumeStateTopic, { volume: info.value });
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

radio.on('positionUpdate', (position) => {
    console.log(`[App] GPS Position: ${position.latitudeStr}, ${position.longitudeStr}, Alt: ${position.altitude}m, Lock: ${position.locked}`);
    
    // Publish GPS position data to MQTT
    if (mqttReporter && config.MQTT_TOPIC) {
        const gpsPositionTopic = `${config.MQTT_TOPIC}/gps_position`;
        const positionData = {
            latitude: Math.round(position.latitude * 100000) / 100000,
            longitude: Math.round(position.longitude * 100000) / 100000,
            altitude: position.altitude,
            speed: position.speed,
            heading: position.heading,
            accuracy: position.accuracy,
            locked: position.locked,
            lock_status: position.locked ? 'Locked' : 'No Lock',
            latitude_dms: position.latitudeStr,
            longitude_dms: position.longitudeStr,
            timestamp: position.receivedTime.toISOString()
        };
        mqttReporter.publishStatus(gpsPositionTopic, positionData);
        //console.log(`[MQTT] DEBUG: Published GPS position data to ${gpsPositionTopic}`);
        //console.log(`[MQTT] DEBUG: Position data:`, JSON.stringify(positionData, null, 2));
    } else {
        console.log('[MQTT] Cannot publish GPS position - mqttReporter or config.MQTT_TOPIC not available');
    }
});// Attempt to connect to the radio
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

            // Publish Home Assistant MQTT Discovery config for Volume number entity
            const volumeNumberTopic = `homeassistant/number/uvpro_radio_volume/config`;
            const volumeStateTopic = `${config.MQTT_TOPIC}/volume`;
            const volumeCommandTopic = `${config.MQTT_TOPIC}/volume/set`;
            const volumeNumberConfig = {
                name: 'UVPro Radio Volume',
                state_topic: volumeStateTopic,
                command_topic: volumeCommandTopic,
                unique_id: `${uniqueId}_volume`,
                device: {
                    identifiers: [uniqueId],
                    name: 'UVPro Radio',
                    manufacturer: 'BTech',
                    model: 'UV-Pro'
                },
                min: 0,
                max: 15,
                step: 1,
                value_template: '{{ value_json.volume }}',
                icon: 'mdi:volume-high'
            };
            mqttReporter.publishStatus(volumeNumberTopic, volumeNumberConfig);
            console.log('[MQTT] Published Home Assistant Volume number discovery config.');

            // Publish Home Assistant MQTT Discovery config for Squelch number entity
            const squelchNumberTopic = `homeassistant/number/uvpro_radio_squelch/config`;
            const squelchStateTopic = `${config.MQTT_TOPIC}/squelch`;
            const squelchCommandTopic = `${config.MQTT_TOPIC}/squelch/set`;
            const squelchNumberConfig = {
                name: 'UVPro Radio Squelch',
                state_topic: squelchStateTopic,
                command_topic: squelchCommandTopic,
                unique_id: `${uniqueId}_squelch`,
                device: {
                    identifiers: [uniqueId],
                    name: 'UVPro Radio',
                    manufacturer: 'BTech',
                    model: 'UV-Pro'
                },
                min: 0,
                max: 15,
                step: 1,
                value_template: '{{ value_json.squelch }}',
                icon: 'mdi:volume-off'
            };
            mqttReporter.publishStatus(squelchNumberTopic, squelchNumberConfig);
            console.log('[MQTT] Published Home Assistant Squelch number discovery config.');

            // Publish Home Assistant MQTT Discovery config for Scan switch entity
            const scanSwitchTopic = `homeassistant/switch/uvpro_radio_scan/config`;
            const scanStateTopic = `${config.MQTT_TOPIC}/scan`;
            const scanCommandTopic = `${config.MQTT_TOPIC}/scan/set`;
            const scanSwitchConfig = {
                name: 'UVPro Radio Scan',
                state_topic: scanStateTopic,
                command_topic: scanCommandTopic,
                unique_id: `${uniqueId}_scan`,
                device: {
                    identifiers: [uniqueId],
                    name: 'UVPro Radio',
                    manufacturer: 'BTech',
                    model: 'UV-Pro'
                },
                payload_on: 'ON',
                payload_off: 'OFF',
                value_template: '{{ value_json.scan }}',
                icon: 'mdi:radar'
            };
            mqttReporter.publishStatus(scanSwitchTopic, scanSwitchConfig);
            console.log('[MQTT] Published Home Assistant Scan switch discovery config.');

            // Publish Home Assistant MQTT Discovery config for Double Channel switch entity
            const doubleChannelSwitchTopic = `homeassistant/switch/uvpro_radio_double_channel/config`;
            const doubleChannelStateTopic = `${config.MQTT_TOPIC}/double_channel`;
            const doubleChannelCommandTopic = `${config.MQTT_TOPIC}/double_channel/set`;
            const doubleChannelSwitchConfig = {
                name: 'UVPro Radio Dual Watch',
                state_topic: doubleChannelStateTopic,
                command_topic: doubleChannelCommandTopic,
                unique_id: `${uniqueId}_double_channel`,
                device: {
                    identifiers: [uniqueId],
                    name: 'UVPro Radio',
                    manufacturer: 'BTech',
                    model: 'UV-Pro'
                },
                payload_on: 'ON',
                payload_off: 'OFF',
                value_template: '{{ value_json.double_channel }}',
                icon: 'mdi:swap-horizontal'
            };
            mqttReporter.publishStatus(doubleChannelSwitchTopic, doubleChannelSwitchConfig);
            console.log('[MQTT] Published Home Assistant Dual Watch switch discovery config.');
        }

        // Publish GPS enable/disable switch
        if (mqttReporter && config.MQTT_TOPIC) {
            const uniqueId = `uvpro_radio_${RADIO_STATIONID}`;
            const gpsSwitchTopic = `homeassistant/switch/uvpro_radio_gps/config`;
            const gpsCommandTopic = `${config.MQTT_TOPIC}/gps/set`;
            const gpsStateTopic = `${config.MQTT_TOPIC}/gps`;
            const gpsSwitchConfig = {
                name: 'UVPro Radio GPS',
                state_topic: gpsStateTopic,
                command_topic: gpsCommandTopic,
                unique_id: `${uniqueId}_gps`,
                device: {
                    identifiers: [uniqueId],
                    name: 'UVPro Radio',
                    manufacturer: 'BTech',
                    model: 'UV-Pro'
                },
                payload_on: 'ON',
                payload_off: 'OFF',
                value_template: '{{ value_json.gps }}',
                icon: 'mdi:crosshairs-gps'
            };
            mqttReporter.publishStatus(gpsSwitchTopic, gpsSwitchConfig);
            console.log('[MQTT] Published Home Assistant GPS switch discovery config.');

            // Publish initial GPS state as OFF since GPS starts disabled
            mqttReporter.publishStatus(gpsStateTopic, { gps: 'OFF' });
        }

        // Publish GPS position sensors (simplified without availability topics)
        if (mqttReporter && config.MQTT_TOPIC) {
            const uniqueId = `uvpro_radio_${RADIO_STATIONID}`;
            const gpsStateTopic = `${config.MQTT_TOPIC}/gps_position`;

            // GPS Latitude sensor
            const latSensorTopic = `homeassistant/sensor/uvpro_radio_gps_lat/config`;
            const latSensorConfig = {
                name: 'UVPro Radio GPS Latitude',
                state_topic: gpsStateTopic,
                unique_id: `${uniqueId}_gps_lat`,
                device: {
                    identifiers: [uniqueId],
                    name: 'UVPro Radio',
                    manufacturer: 'BTech',
                    model: 'UV-Pro'
                },
                value_template: '{{ value_json.latitude }}',
                unit_of_measurement: '°',
                icon: 'mdi:latitude'
            };
            mqttReporter.publishStatus(latSensorTopic, latSensorConfig);

            // GPS Longitude sensor
            const lngSensorTopic = `homeassistant/sensor/uvpro_radio_gps_lng/config`;
            const lngSensorConfig = {
                name: 'UVPro Radio GPS Longitude',
                state_topic: gpsStateTopic,
                unique_id: `${uniqueId}_gps_lng`,
                device: {
                    identifiers: [uniqueId],
                    name: 'UVPro Radio',
                    manufacturer: 'BTech',
                    model: 'UV-Pro'
                },
                value_template: '{{ value_json.longitude }}',
                unit_of_measurement: '°',
                icon: 'mdi:longitude'
            };
            mqttReporter.publishStatus(lngSensorTopic, lngSensorConfig);

            // GPS Altitude sensor
            const altSensorTopic = `homeassistant/sensor/uvpro_radio_gps_alt/config`;
            const altSensorConfig = {
                name: 'UVPro Radio GPS Altitude',
                state_topic: gpsStateTopic,
                unique_id: `${uniqueId}_gps_alt`,
                device: {
                    identifiers: [uniqueId],
                    name: 'UVPro Radio',
                    manufacturer: 'BTech',
                    model: 'UV-Pro'
                },
                value_template: '{{ value_json.altitude }}',
                unit_of_measurement: 'm',
                icon: 'mdi:altimeter'
            };
            mqttReporter.publishStatus(altSensorTopic, altSensorConfig);

            // GPS Lock status sensor (using regular sensor for text display)
            const lockSensorTopic = `homeassistant/sensor/uvpro_radio_gps_lock/config`;
            const lockSensorConfig = {
                name: 'UVPro Radio GPS Lock',
                state_topic: gpsStateTopic,
                unique_id: `${uniqueId}_gps_lock`,
                device: {
                    identifiers: [uniqueId],
                    name: 'UVPro Radio',
                    manufacturer: 'BTech',
                    model: 'UV-Pro'
                },
                value_template: '{{ value_json.lock_status }}',
                icon: 'mdi:satellite-variant'
            };
            mqttReporter.publishStatus(lockSensorTopic, lockSensorConfig);

            console.log('[MQTT] Published Home Assistant GPS sensors discovery config.');

            // Publish initial "GPS disabled" position data 
            publishGpsDisabledState();
        }

        // Poll battery percentage and volume immediately and every minute while connected
        let batteryPollInterval = null;
        function pollStatus() {
            if (radio) {
                if (typeof radio.getBatteryLevelAtPercentage === 'function') {
                    radio.getBatteryLevelAtPercentage();
                }
                if (typeof radio.getVolumeLevel === 'function') {
                    try {
                        radio.getVolumeLevel();
                    } catch (e) {
                        // avoid throwing from a poll call
                        console.error('[App] Error calling getVolumeLevel():', e.message);
                    }
                }
            }
        }
        // Call once immediately after connect, then every minute while connected
        pollStatus();
        batteryPollInterval = setInterval(() => {
            if (radio.state === 3) { // RadioState.CONNECTED
                pollStatus();
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
// Ensure VFO MQTT handlers are installed whether the client connected earlier or will connect later.
if (mqttReporter) {
    const origConnect = mqttReporter.connect.bind(mqttReporter);

    // Helper to attach the post-connect logic (runs immediately if already connected)
    const installPostConnectHandlers = function () {
        // If there's no client yet, nothing to do
        if (!mqttReporter.client) return;

        const setup = () => {
            // Publish last known battery state if available
            if (lastBattery !== null) {
                const batteryStateTopic = `${config.MQTT_TOPIC}/battery`;
                mqttReporter.publishStatus(batteryStateTopic, { battery: lastBattery });
            }

            // Publish last known volume state if available
            if (lastVolume !== null) {
                const volumeStateTopic = `${config.MQTT_TOPIC}/volume`;
                mqttReporter.publishStatus(volumeStateTopic, { volume: lastVolume });
            }

            // Publish last known squelch state if available
            if (lastSquelch !== null) {
                const squelchStateTopic = `${config.MQTT_TOPIC}/squelch`;
                mqttReporter.publishStatus(squelchStateTopic, { squelch: lastSquelch });
            }

            // Publish last known scan state if available
            if (lastScan !== null) {
                const scanStateTopic = `${config.MQTT_TOPIC}/scan`;
                mqttReporter.publishStatus(scanStateTopic, { scan: lastScan ? 'ON' : 'OFF' });
            }

            // Publish last known double_channel state if available
            if (lastDoubleChannel !== null) {
                const doubleChannelStateTopic = `${config.MQTT_TOPIC}/double_channel`;
                mqttReporter.publishStatus(doubleChannelStateTopic, { double_channel: lastDoubleChannel === 1 ? 'ON' : 'OFF' });
            }

            // Publish last known region state if available
            if (lastRegion !== null) {
                const regionStateTopic = `${config.MQTT_TOPIC}/region_select`;
                const regionLabel = `Region ${lastRegion + 1}`;
                mqttReporter.publishStatus(regionStateTopic, { region: regionLabel });
            }

            // Subscribe to VFO select command topics so HA selections are reflected
            const vfo1CommandTopic = `${config.MQTT_TOPIC}/vfo1/set`;
            const vfo2CommandTopic = `${config.MQTT_TOPIC}/vfo2/set`;
            mqttReporter.client.subscribe([vfo1CommandTopic, vfo2CommandTopic], (err) => {
                if (!err) console.log('[MQTT] Subscribed to VFO command topics');
            });

            // Subscribe to Volume command topic 
            const volumeCommandTopic = `${config.MQTT_TOPIC}/volume/set`;
            mqttReporter.client.subscribe(volumeCommandTopic, (err) => {
                if (!err) console.log('[MQTT] Subscribed to Volume command topic');
            });

            // Subscribe to Squelch command topic 
            const squelchCommandTopic = `${config.MQTT_TOPIC}/squelch/set`;
            mqttReporter.client.subscribe(squelchCommandTopic, (err) => {
                if (!err) console.log('[MQTT] Subscribed to Squelch command topic');
            });

            // Subscribe to Scan command topic 
            const scanCommandTopic = `${config.MQTT_TOPIC}/scan/set`;
            mqttReporter.client.subscribe(scanCommandTopic, (err) => {
                if (!err) console.log('[MQTT] Subscribed to Scan command topic');
            });

            // Subscribe to Double Channel command topic 
            const doubleChannelCommandTopic = `${config.MQTT_TOPIC}/double_channel/set`;
            mqttReporter.client.subscribe(doubleChannelCommandTopic, (err) => {
                if (!err) console.log('[MQTT] Subscribed to Double Channel command topic');
            });

            // Subscribe to Region Select command topic 
            const regionCommandTopic = `${config.MQTT_TOPIC}/region_select/set`;
            mqttReporter.client.subscribe(regionCommandTopic, (err) => {
                if (!err) console.log('[MQTT] Subscribed to Region Select command topic');
            });

            // Subscribe to GPS command topic
            const gpsCommandTopic = `${config.MQTT_TOPIC}/gps/set`;
            mqttReporter.client.subscribe(gpsCommandTopic, (err) => {
                if (!err) console.log('[MQTT] Subscribed to GPS command topic');
            });

            if (!mqttReporter._vfoHandlerInstalled) {
                mqttReporter.client.on('message', (topic, message) => {
                    try {
                        const msg = message.toString();
                        if (topic === vfo1CommandTopic) {
                            mqttReporter.publishStatus(`${config.MQTT_TOPIC}/vfo1`, { vfo: msg });
                            console.log(`[MQTT] VFO1 set to: ${msg}`);
                            const m = msg.match(/^\s*(\d+)\s*:/);
                            if (m) {
                                const idx = parseInt(m[1], 10) - 1;
                                const cha = (lastSettingsInfo && typeof lastSettingsInfo.channel_a === 'number') ? lastSettingsInfo.channel_a : 0;
                                const chb = (lastSettingsInfo && typeof lastSettingsInfo.channel_b === 'number') ? lastSettingsInfo.channel_b : 0;
                                if (radio && typeof radio.writeSettings === 'function') {
                                    radio.writeSettings(idx, chb, (lastSettingsInfo && lastSettingsInfo.double_channel) ? lastSettingsInfo.double_channel : 0, (lastSettingsInfo && lastSettingsInfo.scan) ? lastSettingsInfo.scan : false, (lastSettingsInfo && lastSettingsInfo.squelch_level) ? lastSettingsInfo.squelch_level : 0);
                                }
                            }
                        } else if (topic === vfo2CommandTopic) {
                            mqttReporter.publishStatus(`${config.MQTT_TOPIC}/vfo2`, { vfo: msg });
                            console.log(`[MQTT] VFO2 set to: ${msg}`);
                            const m = msg.match(/^\s*(\d+)\s*:/);
                            if (m) {
                                const idx = parseInt(m[1], 10) - 1;
                                const cha = (lastSettingsInfo && typeof lastSettingsInfo.channel_a === 'number') ? lastSettingsInfo.channel_a : 0;
                                const chb = (lastSettingsInfo && typeof lastSettingsInfo.channel_b === 'number') ? lastSettingsInfo.channel_b : 0;
                                if (radio && typeof radio.writeSettings === 'function') {
                                    radio.writeSettings(cha, idx, (lastSettingsInfo && lastSettingsInfo.double_channel) ? lastSettingsInfo.double_channel : 0, (lastSettingsInfo && lastSettingsInfo.scan) ? lastSettingsInfo.scan : false, (lastSettingsInfo && lastSettingsInfo.squelch_level) ? lastSettingsInfo.squelch_level : 0);
                                }
                            }
                        } else if (topic === volumeCommandTopic) {
                            const volumeLevel = parseInt(msg, 10);
                            if (!isNaN(volumeLevel) && volumeLevel >= 0 && volumeLevel <= 15) {
                                console.log(`[MQTT] Volume set to: ${volumeLevel}`);
                                if (radio && typeof radio.setVolumeLevel === 'function') {
                                    radio.setVolumeLevel(volumeLevel);
                                }
                                // Optimistically publish the new volume state 
                                mqttReporter.publishStatus(`${config.MQTT_TOPIC}/volume`, { volume: volumeLevel });
                            } else {
                                console.warn(`[MQTT] Invalid volume level: ${msg} (expected 0-15)`);
                            }
                        } else if (topic === squelchCommandTopic) {
                            const squelchLevel = parseInt(msg, 10);
                            if (!isNaN(squelchLevel) && squelchLevel >= 0 && squelchLevel <= 15) {
                                console.log(`[MQTT] Squelch set to: ${squelchLevel}`);
                                if (radio && typeof radio.writeSettings === 'function' && lastSettingsInfo) {
                                    // Use current settings but update squelch level
                                    const cha = (lastSettingsInfo && typeof lastSettingsInfo.channel_a === 'number') ? lastSettingsInfo.channel_a : 0;
                                    const chb = (lastSettingsInfo && typeof lastSettingsInfo.channel_b === 'number') ? lastSettingsInfo.channel_b : 0;
                                    const xdouble_channel = (lastSettingsInfo && lastSettingsInfo.double_channel) ? lastSettingsInfo.double_channel : 0;
                                    const xscan = (lastSettingsInfo && lastSettingsInfo.scan) ? lastSettingsInfo.scan : false;
                                    radio.writeSettings(cha, chb, xdouble_channel, xscan, squelchLevel);
                                }
                                // Optimistically publish the new squelch state 
                                mqttReporter.publishStatus(`${config.MQTT_TOPIC}/squelch`, { squelch: squelchLevel });
                            } else {
                                console.warn(`[MQTT] Invalid squelch level: ${msg} (expected 0-15)`);
                            }
                        } else if (topic === scanCommandTopic) {
                            const scanState = msg.toUpperCase();
                            if (scanState === 'ON' || scanState === 'OFF') {
                                const scanValue = scanState === 'ON';
                                console.log(`[MQTT] Scan set to: ${scanValue ? 'ON' : 'OFF'}`);
                                if (radio && typeof radio.writeSettings === 'function' && lastSettingsInfo) {
                                    // Use current settings but update scan value
                                    const cha = (lastSettingsInfo && typeof lastSettingsInfo.channel_a === 'number') ? lastSettingsInfo.channel_a : 0;
                                    const chb = (lastSettingsInfo && typeof lastSettingsInfo.channel_b === 'number') ? lastSettingsInfo.channel_b : 0;
                                    const xdouble_channel = (lastSettingsInfo && lastSettingsInfo.double_channel) ? lastSettingsInfo.double_channel : 0;
                                    const xsquelch = (lastSettingsInfo && typeof lastSettingsInfo.squelch_level === 'number') ? lastSettingsInfo.squelch_level : 0;
                                    radio.writeSettings(cha, chb, xdouble_channel, scanValue, xsquelch);
                                }
                                // Optimistically publish the new scan state 
                                mqttReporter.publishStatus(`${config.MQTT_TOPIC}/scan`, { scan: scanState });
                            } else {
                                console.warn(`[MQTT] Invalid scan state: ${msg} (expected ON or OFF)`);
                            }
                        } else if (topic === doubleChannelCommandTopic) {
                            const doubleChannelState = msg.toUpperCase();
                            if (doubleChannelState === 'ON' || doubleChannelState === 'OFF') {
                                const doubleChannelValue = doubleChannelState === 'ON' ? 1 : 0;
                                console.log(`[MQTT] Dual Watch set to: ${doubleChannelState} (${doubleChannelValue})`);
                                if (radio && typeof radio.writeSettings === 'function' && lastSettingsInfo) {
                                    // Use current settings but update double_channel value
                                    const cha = (lastSettingsInfo && typeof lastSettingsInfo.channel_a === 'number') ? lastSettingsInfo.channel_a : 0;
                                    const chb = (lastSettingsInfo && typeof lastSettingsInfo.channel_b === 'number') ? lastSettingsInfo.channel_b : 0;
                                    const xscan = (lastSettingsInfo && typeof lastSettingsInfo.scan === 'boolean') ? lastSettingsInfo.scan : false;
                                    const xsquelch = (lastSettingsInfo && typeof lastSettingsInfo.squelch_level === 'number') ? lastSettingsInfo.squelch_level : 0;
                                    radio.writeSettings(cha, chb, doubleChannelValue, xscan, xsquelch);
                                }
                                // Optimistically publish the new double_channel state 
                                mqttReporter.publishStatus(`${config.MQTT_TOPIC}/double_channel`, { double_channel: doubleChannelState });
                            } else {
                                console.warn(`[MQTT] Invalid dual watch state: ${msg} (expected ON or OFF)`);
                            }
                        } else if (topic === regionCommandTopic) {
                            const regionLabel = msg.trim();
                            const match = regionLabel.match(/^Region (\d+)$/i);
                            if (match) {
                                const regionNumber = parseInt(match[1], 10);
                                const regionIndex = regionNumber - 1; // Convert to 0-based index
                                console.log(`[MQTT] Region set to: ${regionLabel} (index ${regionIndex})`);
                                if (radio && typeof radio.setRegion === 'function') {
                                    radio.setRegion(regionIndex);
                                }
                                // Optimistically publish the new region state 
                                mqttReporter.publishStatus(`${config.MQTT_TOPIC}/region_select`, { region: regionLabel });
                            } else {
                                console.warn(`[MQTT] Invalid region format: ${msg} (expected "Region N")`);
                            }
                        } else if (topic === gpsCommandTopic) {
                            const gpsState = msg.trim().toUpperCase();
                            if (gpsState === 'ON' || gpsState === 'OFF') {
                                const enableGps = (gpsState === 'ON');
                                console.log(`[MQTT] GPS set to: ${gpsState}`);
                                if (radio && typeof radio.setGpsEnabled === 'function') {
                                    radio.setGpsEnabled(enableGps);
                                }
                                // Optimistically publish the new GPS state
                                mqttReporter.publishStatus(`${config.MQTT_TOPIC}/gps`, { gps: gpsState });

                                // Set GPS sensor state based on GPS enable/disable
                                if (enableGps) {
                                    // When GPS is enabled, publish initial "waiting for GPS" position data
                                    const gpsPositionTopic = `${config.MQTT_TOPIC}/gps_position`;
                                    const waitingPositionData = {
                                        latitude: 0,
                                        longitude: 0,
                                        altitude: 0,
                                        speed: 0,
                                        heading: 0,
                                        accuracy: 0,
                                        locked: false,
                                        lock_status: "Waiting for GPS",
                                        latitude_dms: "Waiting for GPS",
                                        longitude_dms: "Waiting for GPS",
                                        timestamp: new Date().toISOString()
                                    };
                                    mqttReporter.publishStatus(gpsPositionTopic, waitingPositionData);
                                    //console.log(`[MQTT] DEBUG: Published initial GPS position data to ${gpsPositionTopic}`);
                                } else {
                                    console.log('[MQTT] DEBUG: GPS disabled, publishing disabled state');
                                    publishGpsDisabledState();
                                }
                            } else {
                                console.warn(`[MQTT] Invalid GPS state: ${msg} (expected ON or OFF)`);
                            }
                        }
                    } catch (e) {
                        console.error('[MQTT] Error handling message:', e.message);
                    }
                });
                mqttReporter._vfoHandlerInstalled = true;
            }
        };

        // If client is already connected, run setup now, otherwise run once on next connect
        if (mqttReporter.client.connected) setup();
        else mqttReporter.client.once('connect', setup);
    };

    // Preserve original connect behavior but ensure post-connect handlers are installed after connect
    mqttReporter.connect = function () {
        origConnect();
        // origConnect may have created the client and even connected already; ensure our handlers are installed
        installPostConnectHandlers();
    };

    // Also attempt to install handlers immediately in case the original connect was called earlier
    installPostConnectHandlers();

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

// Helper to publish GPS "disabled" state when GPS is disabled
function publishGpsDisabledState() {
    if (!mqttReporter || !config.MQTT_TOPIC) return;
    
    const gpsPositionTopic = `${config.MQTT_TOPIC}/gps_position`;
    // Publish "GPS disabled" state with clear indication
    const disabledPositionData = {
        latitude: null,
        longitude: null,
        altitude: null,
        speed: null,
        heading: null,
        accuracy: null,
        locked: false,
        lock_status: "GPS Disabled",
        latitude_dms: "GPS Disabled",
        longitude_dms: "GPS Disabled",
        timestamp: new Date().toISOString()
    };
    mqttReporter.publishStatus(gpsPositionTopic, disabledPositionData);
    //console.log(`[MQTT] DEBUG: Published GPS disabled state to ${gpsPositionTopic}`);
}// Helper to republish GPS sensor discovery configs (useful for troubleshooting)
function republishGpsDiscoveryConfigs() {
    if (!mqttReporter || !config.MQTT_TOPIC) return;

    const uniqueId = `uvpro_radio_${RADIO_STATIONID}`;
    const gpsStateTopic = `${config.MQTT_TOPIC}/gps_position`;

    // Re-publish all GPS sensor discovery configs (simplified without availability)
    const sensors = [
        {
            topic: `homeassistant/sensor/uvpro_radio_gps_lat/config`,
            config: {
                name: 'UVPro Radio GPS Latitude',
                state_topic: gpsStateTopic,
                unique_id: `${uniqueId}_gps_lat`,
                device: {
                    identifiers: [uniqueId],
                    name: 'UVPro Radio',
                    manufacturer: 'BTech',
                    model: 'UV-Pro'
                },
                value_template: '{{ value_json.latitude }}',
                unit_of_measurement: '°',
                icon: 'mdi:latitude'
            }
        },
        {
            topic: `homeassistant/sensor/uvpro_radio_gps_lng/config`,
            config: {
                name: 'UVPro Radio GPS Longitude',
                state_topic: gpsStateTopic,
                unique_id: `${uniqueId}_gps_lng`,
                device: {
                    identifiers: [uniqueId],
                    name: 'UVPro Radio',
                    manufacturer: 'BTech',
                    model: 'UV-Pro'
                },
                value_template: '{{ value_json.longitude }}',
                unit_of_measurement: '°',
                icon: 'mdi:longitude'
            }
        },
        {
            topic: `homeassistant/sensor/uvpro_radio_gps_alt/config`,
            config: {
                name: 'UVPro Radio GPS Altitude',
                state_topic: gpsStateTopic,
                unique_id: `${uniqueId}_gps_alt`,
                device: {
                    identifiers: [uniqueId],
                    name: 'UVPro Radio',
                    manufacturer: 'BTech',
                    model: 'UV-Pro'
                },
                value_template: '{{ value_json.altitude }}',
                unit_of_measurement: 'm',
                icon: 'mdi:altimeter'
            }
        },
        {
            topic: `homeassistant/sensor/uvpro_radio_gps_lock/config`,
            config: {
                name: 'UVPro Radio GPS Lock',
                state_topic: gpsStateTopic,
                unique_id: `${uniqueId}_gps_lock`,
                device: {
                    identifiers: [uniqueId],
                    name: 'UVPro Radio',
                    manufacturer: 'BTech',
                    model: 'UV-Pro'
                },
                value_template: '{{ value_json.lock_status }}',
                icon: 'mdi:satellite-variant'
            }
        }
    ];

    sensors.forEach(sensor => {
        mqttReporter.publishStatus(sensor.topic, sensor.config);
    });

    console.log('[MQTT] Republished GPS sensor discovery configs');
}

// (moved shared state declarations earlier)

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

// Helper to publish Region select sensor
function publishRegionSelect(regionCount) {
    if (!mqttReporter || typeof regionCount !== 'number' || regionCount <= 0) return;

    const uniqueId = `uvpro_radio_${RADIO_STATIONID}`;
    const regionSelectTopic = `homeassistant/select/uvpro_radio_region/config`;
    const regionStateTopic = `${config.MQTT_TOPIC}/region_select`;
    const regionCommandTopic = `${config.MQTT_TOPIC}/region_select/set`;

    // Build options like "Region 1", "Region 2", etc.
    const options = [];
    for (let i = 1; i <= regionCount; i++) {
        options.push(`Region ${i}`);
    }

    const regionSelectConfig = {
        name: 'UVPro Radio Region',
        command_topic: regionCommandTopic,
        state_topic: regionStateTopic,
        unique_id: `${uniqueId}_region_select`,
        device: {
            identifiers: [uniqueId],
            name: 'UVPro Radio',
            manufacturer: 'BTech',
            model: 'UV-Pro'
        },
        options: options,
        value_template: '{{ value_json.region }}',
        icon: 'mdi:map'
    };

    mqttReporter.publishStatus(regionSelectTopic, regionSelectConfig);
    console.log(`[MQTT] Published Region select discovery with ${regionCount} regions.`);

    // Publish initial state if we know the current region
    if (lastRegion !== null) {
        const regionLabel = `Region ${lastRegion + 1}`;
        mqttReporter.publishStatus(regionStateTopic, { region: regionLabel });
    }
}