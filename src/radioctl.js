'use strict';

class RadioController {
    constructor(config, radio, mqttReporter) {
        this.config = config;
        this.radio = radio;
        this.mqttReporter = mqttReporter;
        
        // Shared state for MQTT publishing
        this.lastChannelInfo = null;
        this.lastChannels = null;
        this.lastSettingsInfo = null;
        this.lastDevInfo = null;
        this.lastBattery = null;
        this.lastVolume = null;
        this.lastSquelch = null;
        this.lastScan = null;
        this.lastDoubleChannel = null;
        this.lastRegion = null;
        this.lastGpsEnabled = null;
        this.lastGpsPosition = null;
        // Ensure discovery/state for VFOs is only published once to avoid spamming MQTT/HA
        // Cache last published VFO options (JSON string) so we republish if names change
        this.lastPublishedVfoOptions = null;
        
        this.setupRadioEventHandlers();
        this.setupMqttHandlers();
    }
    
    setupRadioEventHandlers() {
        // Event listeners to receive updates from the radio
        this.radio.on('infoUpdate', (info) => {
            // Publish Firmware Version sensor when DevInfo is updated
            if (info.type === 'Info' && info.value) {
                this.lastDevInfo = info.value;
                this.publishFirmwareVersionSensor(info.value);

                // Publish Region select discovery when DevInfo is available
                if (typeof info.value.region_count === 'number') {
                    this.publishRegionSelect(info.value.region_count);
                }
            }
            // Store last settings info for later MQTT update
            if (info.type === 'Settings' && info.value) {
                this.lastSettingsInfo = info.value;

                // Publish squelch level state
                if (typeof info.value.squelch_level === 'number') {
                    this.lastSquelch = info.value.squelch_level;
                    if (this.mqttReporter && this.config.MQTT_TOPIC) {
                        const squelchStateTopic = `${this.config.MQTT_TOPIC}/squelch`;
                        this.mqttReporter.publishStatus(squelchStateTopic, { squelch: info.value.squelch_level });
                    }
                }

                // Publish scan state
                if (typeof info.value.scan === 'boolean') {
                    this.lastScan = info.value.scan;
                    if (this.mqttReporter && this.config.MQTT_TOPIC) {
                        const scanStateTopic = `${this.config.MQTT_TOPIC}/scan`;
                        this.mqttReporter.publishStatus(scanStateTopic, { scan: info.value.scan ? 'ON' : 'OFF' });
                    }
                }

                // Publish double_channel state
                if (typeof info.value.double_channel === 'number') {
                    this.lastDoubleChannel = info.value.double_channel;
                    if (this.mqttReporter && this.config.MQTT_TOPIC) {
                        const doubleChannelStateTopic = `${this.config.MQTT_TOPIC}/double_channel`;
                        this.mqttReporter.publishStatus(doubleChannelStateTopic, { double_channel: info.value.double_channel === 1 ? 'ON' : 'OFF' });
                    }
                }

                // If channels are already loaded, publish VFO selects using channel_a and channel_b
                if (this.lastChannels && Array.isArray(this.lastChannels)) {
                    const channelAIdx = (this.lastSettingsInfo && typeof this.lastSettingsInfo.channel_a === 'number') ? (this.lastSettingsInfo.channel_a) : 0;
                    const channelBIdx = (this.lastSettingsInfo && typeof this.lastSettingsInfo.channel_b === 'number') ? (this.lastSettingsInfo.channel_b) : 0;
                    this.publishVfoSelects(this.lastChannels, channelAIdx, channelBIdx);
                }
            }
            // Store last channel info for later MQTT update
            if (info.type === 'HtStatus' && this.radio.htStatus) {

                // Publish region state when HtStatus is updated
                if (typeof this.radio.htStatus.curr_region === 'number') {
                    this.lastRegion = this.radio.htStatus.curr_region;
                    if (this.mqttReporter && this.config.MQTT_TOPIC) {
                        const regionStateTopic = `${this.config.MQTT_TOPIC}/region_select`;
                        const regionLabel = `Region ${this.radio.htStatus.curr_region + 1}`;
                        this.mqttReporter.publishStatus(regionStateTopic, { region: regionLabel });
                    }
                }
            }
            // When all channels loaded, publish VFO selects
            if (info.type === 'AllChannelsLoaded' && info.value && Array.isArray(info.value)) {
                const channels = info.value;
                //console.log('[RadioCtl] AllChannelsLoaded channels:', channels);
                this.lastChannels = channels;
                // DEBUG: show all channel name_str values and lengths to diagnose missing names
                try {
                    const names = channels.map((ch, idx) => ({ idx: idx + 1, name: (ch && ch.name_str) || '', len: (ch && ch.name_str) ? ch.name_str.length : 0 }));
                    //console.log('[RadioCtl] AllChannelsLoaded names:', names.slice(0, 30));
                    // Show raw bytes for the channel name field for the first 10 channels to diagnose
                    const rawNameBytes = channels.slice(0, 10).map((ch, idx) => {
                        if (!ch || !ch.raw || ch.raw.length < 30) return { idx: idx + 1, raw: null };
                        // raw is an array of bytes; name field starts at offset 20 length 10
                        return { idx: idx + 1, raw: ch.raw.slice(20, 30) };
                    });
                    //console.log('[RadioCtl] AllChannelsLoaded raw name bytes (first 10):', rawNameBytes);
                } catch (e) {
                    console.error('[RadioCtl] Error logging channel names:', e.message);
                }
                const channelAIdx = (this.lastSettingsInfo && typeof this.lastSettingsInfo.channel_a === 'number') ? (this.lastSettingsInfo.channel_a) : 0;
                const channelBIdx = (this.lastSettingsInfo && typeof this.lastSettingsInfo.channel_b === 'number') ? (this.lastSettingsInfo.channel_b) : 0;
                // Per user request, VFO selection shows index starting at 1; publishVfoSelects expects zero-based indexes
                // Force republish to ensure Home Assistant receives the latest channel names (especially after region changes)
                this.lastPublishedVfoOptions = null;
                this.publishVfoSelects(channels, channelAIdx, channelBIdx);
                //console.log('[RadioCtl] Updated VFO selects with reloaded channels.');
            }
            // When MQTT connects, publish last channel info if available
            // (Handled by the mqttReporter.connect override below when the MQTT reporter is created.)
            // Publish BatteryAsPercentage locally and store lastBattery
            if (info.type === 'BatteryAsPercentage') {
                this.lastBattery = info.value;
                if (this.mqttReporter && this.config.MQTT_TOPIC) {
                    const batteryStateTopic = `${this.config.MQTT_TOPIC}/battery`;
                    this.mqttReporter.publishStatus(batteryStateTopic, { battery: info.value });
                }
            }

            // Publish VolumeLevel locally and store lastVolume
            if (info.type === 'Volume') {
                this.lastVolume = info.value;
                if (this.mqttReporter && this.config.MQTT_TOPIC) {
                    const volumeStateTopic = `${this.config.MQTT_TOPIC}/volume`;
                    this.mqttReporter.publishStatus(volumeStateTopic, { volume: info.value });
                }
            }

            // Publish status to MQTT if enabled
            if (this.mqttReporter && info && info.type && info.value) {
                let topic = this.config.MQTT_TOPIC;
                let payload = { type: info.type, value: info.value };
                this.mqttReporter.publishStatus(topic, payload);
            }

            /*
            if (info.type === 'ChannelInfo') {
                console.log(`[RadioCtl] Channel ${info.value.channel_id} loaded.`);
            } else if (info.type === 'AllChannelsLoaded') {
                console.log(`[RadioCtl] All channels loaded.`);
            } else {
                console.log('[RadioCtl] Received info update:', info);
            }
            */
        });

        this.radio.on('positionUpdate', (position) => {
            console.log(`[RadioCtl] GPS Position: ${position.latitudeStr}, ${position.longitudeStr}, Alt: ${position.altitude}m, Lock: ${position.locked}`);
            
            // Publish GPS position data to MQTT
            if (this.mqttReporter && this.config.MQTT_TOPIC) {
                const gpsPositionTopic = `${this.config.MQTT_TOPIC}/gps_position`;
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
                this.mqttReporter.publishStatus(gpsPositionTopic, positionData);
                //console.log(`[MQTT] DEBUG: Published GPS position data to ${gpsPositionTopic}`);
                //console.log(`[MQTT] DEBUG: Position data:`, JSON.stringify(positionData, null, 2));
            } else {
                console.log('[MQTT] Cannot publish GPS position - mqttReporter or config.MQTT_TOPIC not available');
            }
        });
    }
    
    setupMqttHandlers() {
        // Patch MQTT connect to publish channel info after connection
        // Ensure VFO MQTT handlers are installed whether the client connected earlier or will connect later.
        if (this.mqttReporter) {
            const origConnect = this.mqttReporter.connect.bind(this.mqttReporter);

            // Helper to attach the post-connect logic (runs immediately if already connected)
            const installPostConnectHandlers = () => {
                // If there's no client yet, nothing to do
                if (!this.mqttReporter.client) return;

                const setup = () => {
                    // Publish last known battery state if available
                    if (this.lastBattery !== null) {
                        const batteryStateTopic = `${this.config.MQTT_TOPIC}/battery`;
                        this.mqttReporter.publishStatus(batteryStateTopic, { battery: this.lastBattery });
                    }

                    // Publish last known volume state if available
                    if (this.lastVolume !== null) {
                        const volumeStateTopic = `${this.config.MQTT_TOPIC}/volume`;
                        this.mqttReporter.publishStatus(volumeStateTopic, { volume: this.lastVolume });
                    }

                    // Publish last known squelch state if available
                    if (this.lastSquelch !== null) {
                        const squelchStateTopic = `${this.config.MQTT_TOPIC}/squelch`;
                        this.mqttReporter.publishStatus(squelchStateTopic, { squelch: this.lastSquelch });
                    }

                    // Publish last known scan state if available
                    if (this.lastScan !== null) {
                        const scanStateTopic = `${this.config.MQTT_TOPIC}/scan`;
                        this.mqttReporter.publishStatus(scanStateTopic, { scan: this.lastScan ? 'ON' : 'OFF' });
                    }

                    // Publish last known double_channel state if available
                    if (this.lastDoubleChannel !== null) {
                        const doubleChannelStateTopic = `${this.config.MQTT_TOPIC}/double_channel`;
                        this.mqttReporter.publishStatus(doubleChannelStateTopic, { double_channel: this.lastDoubleChannel === 1 ? 'ON' : 'OFF' });
                    }

                    // Publish last known region state if available
                    if (this.lastRegion !== null) {
                        const regionStateTopic = `${this.config.MQTT_TOPIC}/region_select`;
                        const regionLabel = `Region ${this.lastRegion + 1}`;
                        this.mqttReporter.publishStatus(regionStateTopic, { region: regionLabel });
                    }

                    // Subscribe to VFO select command topics so HA selections are reflected
                    const vfo1CommandTopic = `${this.config.MQTT_TOPIC}/vfo1/set`;
                    const vfo2CommandTopic = `${this.config.MQTT_TOPIC}/vfo2/set`;
                    this.mqttReporter.client.subscribe([vfo1CommandTopic, vfo2CommandTopic], (err) => {
                        if (!err) console.log('[MQTT] Subscribed to VFO command topics');
                    });

                    // Subscribe to Volume command topic 
                    const volumeCommandTopic = `${this.config.MQTT_TOPIC}/volume/set`;
                    this.mqttReporter.client.subscribe(volumeCommandTopic, (err) => {
                        if (!err) console.log('[MQTT] Subscribed to Volume command topic');
                    });

                    // Subscribe to Squelch command topic 
                    const squelchCommandTopic = `${this.config.MQTT_TOPIC}/squelch/set`;
                    this.mqttReporter.client.subscribe(squelchCommandTopic, (err) => {
                        if (!err) console.log('[MQTT] Subscribed to Squelch command topic');
                    });

                    // Subscribe to Scan command topic 
                    const scanCommandTopic = `${this.config.MQTT_TOPIC}/scan/set`;
                    this.mqttReporter.client.subscribe(scanCommandTopic, (err) => {
                        if (!err) console.log('[MQTT] Subscribed to Scan command topic');
                    });

                    // Subscribe to Double Channel command topic 
                    const doubleChannelCommandTopic = `${this.config.MQTT_TOPIC}/double_channel/set`;
                    this.mqttReporter.client.subscribe(doubleChannelCommandTopic, (err) => {
                        if (!err) console.log('[MQTT] Subscribed to Double Channel command topic');
                    });

                    // Subscribe to Region Select command topic 
                    const regionCommandTopic = `${this.config.MQTT_TOPIC}/region_select/set`;
                    this.mqttReporter.client.subscribe(regionCommandTopic, (err) => {
                        if (!err) console.log('[MQTT] Subscribed to Region Select command topic');
                    });

                    // Subscribe to GPS command topic
                    const gpsCommandTopic = `${this.config.MQTT_TOPIC}/gps/set`;
                    this.mqttReporter.client.subscribe(gpsCommandTopic, (err) => {
                        if (!err) console.log('[MQTT] Subscribed to GPS command topic');
                    });

                    if (!this.mqttReporter._vfoHandlerInstalled) {
                        this.mqttReporter.client.on('message', (topic, message) => {
                            try {
                                const msg = message.toString();
                                if (topic === vfo1CommandTopic) {
                                    this.mqttReporter.publishStatus(`${this.config.MQTT_TOPIC}/vfo1`, { vfo: msg });
                                    console.log(`[MQTT] VFO1 set to: ${msg}`);
                                    const m = msg.match(/^\s*(\d+)\s*:/);
                                    if (m) {
                                        const idx = parseInt(m[1], 10) - 1;
                                        const cha = (this.lastSettingsInfo && typeof this.lastSettingsInfo.channel_a === 'number') ? this.lastSettingsInfo.channel_a : 0;
                                        const chb = (this.lastSettingsInfo && typeof this.lastSettingsInfo.channel_b === 'number') ? this.lastSettingsInfo.channel_b : 0;
                                        if (this.radio && typeof this.radio.writeSettings === 'function') {
                                            this.radio.writeSettings(idx, chb, (this.lastSettingsInfo && this.lastSettingsInfo.double_channel) ? this.lastSettingsInfo.double_channel : 0, (this.lastSettingsInfo && this.lastSettingsInfo.scan) ? this.lastSettingsInfo.scan : false, (this.lastSettingsInfo && this.lastSettingsInfo.squelch_level) ? this.lastSettingsInfo.squelch_level : 0);
                                        }
                                    }
                                } else if (topic === vfo2CommandTopic) {
                                    this.mqttReporter.publishStatus(`${this.config.MQTT_TOPIC}/vfo2`, { vfo: msg });
                                    console.log(`[MQTT] VFO2 set to: ${msg}`);
                                    const m = msg.match(/^\s*(\d+)\s*:/);
                                    if (m) {
                                        const idx = parseInt(m[1], 10) - 1;
                                        const cha = (this.lastSettingsInfo && typeof this.lastSettingsInfo.channel_a === 'number') ? this.lastSettingsInfo.channel_a : 0;
                                        const chb = (this.lastSettingsInfo && typeof this.lastSettingsInfo.channel_b === 'number') ? this.lastSettingsInfo.channel_b : 0;
                                        if (this.radio && typeof this.radio.writeSettings === 'function') {
                                            this.radio.writeSettings(cha, idx, (this.lastSettingsInfo && this.lastSettingsInfo.double_channel) ? this.lastSettingsInfo.double_channel : 0, (this.lastSettingsInfo && this.lastSettingsInfo.scan) ? this.lastSettingsInfo.scan : false, (this.lastSettingsInfo && this.lastSettingsInfo.squelch_level) ? this.lastSettingsInfo.squelch_level : 0);
                                        }
                                    }
                                } else if (topic === volumeCommandTopic) {
                                    const volumeLevel = parseInt(msg, 10);
                                    if (!isNaN(volumeLevel) && volumeLevel >= 0 && volumeLevel <= 15) {
                                        console.log(`[MQTT] Volume set to: ${volumeLevel}`);
                                        if (this.radio && typeof this.radio.setVolumeLevel === 'function') {
                                            this.radio.setVolumeLevel(volumeLevel);
                                        }
                                        // Optimistically publish the new volume state 
                                        this.mqttReporter.publishStatus(`${this.config.MQTT_TOPIC}/volume`, { volume: volumeLevel });
                                    } else {
                                        console.warn(`[MQTT] Invalid volume level: ${msg} (expected 0-15)`);
                                    }
                                } else if (topic === squelchCommandTopic) {
                                    const squelchLevel = parseInt(msg, 10);
                                    if (!isNaN(squelchLevel) && squelchLevel >= 0 && squelchLevel <= 15) {
                                        console.log(`[MQTT] Squelch set to: ${squelchLevel}`);
                                        if (this.radio && typeof this.radio.writeSettings === 'function' && this.lastSettingsInfo) {
                                            // Use current settings but update squelch level
                                            const cha = (this.lastSettingsInfo && typeof this.lastSettingsInfo.channel_a === 'number') ? this.lastSettingsInfo.channel_a : 0;
                                            const chb = (this.lastSettingsInfo && typeof this.lastSettingsInfo.channel_b === 'number') ? this.lastSettingsInfo.channel_b : 0;
                                            const xdouble_channel = (this.lastSettingsInfo && this.lastSettingsInfo.double_channel) ? this.lastSettingsInfo.double_channel : 0;
                                            const xscan = (this.lastSettingsInfo && this.lastSettingsInfo.scan) ? this.lastSettingsInfo.scan : false;
                                            this.radio.writeSettings(cha, chb, xdouble_channel, xscan, squelchLevel);
                                        }
                                        // Optimistically publish the new squelch state 
                                        this.mqttReporter.publishStatus(`${this.config.MQTT_TOPIC}/squelch`, { squelch: squelchLevel });
                                    } else {
                                        console.warn(`[MQTT] Invalid squelch level: ${msg} (expected 0-15)`);
                                    }
                                } else if (topic === scanCommandTopic) {
                                    const scanState = msg.toUpperCase();
                                    if (scanState === 'ON' || scanState === 'OFF') {
                                        const scanValue = scanState === 'ON';
                                        console.log(`[MQTT] Scan set to: ${scanValue ? 'ON' : 'OFF'}`);
                                        if (this.radio && typeof this.radio.writeSettings === 'function' && this.lastSettingsInfo) {
                                            // Use current settings but update scan value
                                            const cha = (this.lastSettingsInfo && typeof this.lastSettingsInfo.channel_a === 'number') ? this.lastSettingsInfo.channel_a : 0;
                                            const chb = (this.lastSettingsInfo && typeof this.lastSettingsInfo.channel_b === 'number') ? this.lastSettingsInfo.channel_b : 0;
                                            const xdouble_channel = (this.lastSettingsInfo && this.lastSettingsInfo.double_channel) ? this.lastSettingsInfo.double_channel : 0;
                                            const xsquelch = (this.lastSettingsInfo && typeof this.lastSettingsInfo.squelch_level === 'number') ? this.lastSettingsInfo.squelch_level : 0;
                                            this.radio.writeSettings(cha, chb, xdouble_channel, scanValue, xsquelch);
                                        }
                                        // Optimistically publish the new scan state 
                                        this.mqttReporter.publishStatus(`${this.config.MQTT_TOPIC}/scan`, { scan: scanState });
                                    } else {
                                        console.warn(`[MQTT] Invalid scan state: ${msg} (expected ON or OFF)`);
                                    }
                                } else if (topic === doubleChannelCommandTopic) {
                                    const doubleChannelState = msg.toUpperCase();
                                    if (doubleChannelState === 'ON' || doubleChannelState === 'OFF') {
                                        const doubleChannelValue = doubleChannelState === 'ON' ? 1 : 0;
                                        console.log(`[MQTT] Dual Watch set to: ${doubleChannelState} (${doubleChannelValue})`);
                                        if (this.radio && typeof this.radio.writeSettings === 'function' && this.lastSettingsInfo) {
                                            // Use current settings but update double_channel value
                                            const cha = (this.lastSettingsInfo && typeof this.lastSettingsInfo.channel_a === 'number') ? this.lastSettingsInfo.channel_a : 0;
                                            const chb = (this.lastSettingsInfo && typeof this.lastSettingsInfo.channel_b === 'number') ? this.lastSettingsInfo.channel_b : 0;
                                            const xscan = (this.lastSettingsInfo && typeof this.lastSettingsInfo.scan === 'boolean') ? this.lastSettingsInfo.scan : false;
                                            const xsquelch = (this.lastSettingsInfo && typeof this.lastSettingsInfo.squelch_level === 'number') ? this.lastSettingsInfo.squelch_level : 0;
                                            this.radio.writeSettings(cha, chb, doubleChannelValue, xscan, xsquelch);
                                        }
                                        // Optimistically publish the new double_channel state 
                                        this.mqttReporter.publishStatus(`${this.config.MQTT_TOPIC}/double_channel`, { double_channel: doubleChannelState });
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
                                        if (this.radio && typeof this.radio.setRegion === 'function') {
                                            this.radio.setRegion(regionIndex);
                                        }
                                        // Optimistically publish the new region state 
                                        this.mqttReporter.publishStatus(`${this.config.MQTT_TOPIC}/region_select`, { region: regionLabel });
                                    } else {
                                        console.warn(`[MQTT] Invalid region format: ${msg} (expected "Region N")`);
                                    }
                                } else if (topic === gpsCommandTopic) {
                                    const gpsState = msg.trim().toUpperCase();
                                    if (gpsState === 'ON' || gpsState === 'OFF') {
                                        const enableGps = (gpsState === 'ON');
                                        console.log(`[MQTT] GPS set to: ${gpsState}`);
                                        if (this.radio && typeof this.radio.setGpsEnabled === 'function') {
                                            this.radio.setGpsEnabled(enableGps);
                                        }
                                        // Optimistically publish the new GPS state
                                        this.mqttReporter.publishStatus(`${this.config.MQTT_TOPIC}/gps`, { gps: gpsState });

                                        // Set GPS sensor state based on GPS enable/disable
                                        if (enableGps) {
                                            // When GPS is enabled, publish initial "waiting for GPS" position data
                                            const gpsPositionTopic = `${this.config.MQTT_TOPIC}/gps_position`;
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
                                            this.mqttReporter.publishStatus(gpsPositionTopic, waitingPositionData);
                                            //console.log(`[MQTT] DEBUG: Published initial GPS position data to ${gpsPositionTopic}`);
                                        } else {
                                            console.log('[MQTT] DEBUG: GPS disabled, publishing disabled state');
                                            this.publishGpsDisabledState();
                                        }
                                    } else {
                                        console.warn(`[MQTT] Invalid GPS state: ${msg} (expected ON or OFF)`);
                                    }
                                }
                            } catch (e) {
                                console.error('[MQTT] Error handling message:', e.message);
                            }
                        });
                        this.mqttReporter._vfoHandlerInstalled = true;
                    }
                };

                // If client is already connected, run setup now, otherwise run once on next connect
                if (this.mqttReporter.client.connected) setup();
                else this.mqttReporter.client.once('connect', setup);
            };

            // Preserve original connect behavior but ensure post-connect handlers are installed after connect
            this.mqttReporter.connect = function () {
                origConnect();
                // origConnect may have created the client and even connected already; ensure our handlers are installed
                installPostConnectHandlers();
            };

            // Also attempt to install handlers immediately in case the original connect was called earlier
            installPostConnectHandlers();
        }
    }
    
    // Setup polling for battery and volume status
    setupStatusPolling() {
        // Poll battery percentage and volume immediately and every minute while connected
        let batteryPollInterval = null;
        const pollStatus = () => {
            if (this.radio) {
                if (typeof this.radio.getBatteryLevelAtPercentage === 'function') {
                    this.radio.getBatteryLevelAtPercentage();
                }
                if (typeof this.radio.getVolumeLevel === 'function') {
                    try {
                        this.radio.getVolumeLevel();
                    } catch (e) {
                        // avoid throwing from a poll call
                        console.error('[RadioCtl] Error calling getVolumeLevel():', e.message);
                    }
                }
            }
        };
        // Call once immediately after connect, then every minute while connected
        pollStatus();
        batteryPollInterval = setInterval(() => {
            if (this.radio.state === 3) { // RadioState.CONNECTED
                pollStatus();
            }
        }, 30000);
        this.radio.on('disconnected', () => {
            if (batteryPollInterval) {
                clearInterval(batteryPollInterval);
                batteryPollInterval = null;
            }
        });
    }
    
    // Helper to convert soft_ver to version string
    getFirmwareVersionString(soft_ver) {
        if (typeof soft_ver !== 'number') return '';
        return ((soft_ver >> 8) & 0xF) + '.' + ((soft_ver >> 4) & 0xF) + '.' + (soft_ver & 0xF);
    }

    // Helper to publish Firmware Version sensor
    publishFirmwareVersionSensor(devInfo) {
        if (!this.mqttReporter || !devInfo || typeof devInfo.soft_ver !== 'number') return;
        const versionString = this.getFirmwareVersionString(devInfo.soft_ver);
        this.mqttReporter.publishFirmwareVersionSensor(versionString);
    }

    // Helper to publish GPS "disabled" state when GPS is disabled
    publishGpsDisabledState() {
        if (!this.mqttReporter || !this.config.MQTT_TOPIC) return;
        this.mqttReporter.publishGpsDisabledState();
    }

    // Helper to publish VFO select sensors (VFO1, VFO2)
    publishVfoSelects(channels, channelAIndex, channelBIndex) {
        if (!this.mqttReporter || !channels || !Array.isArray(channels)) return;
        
        // Check if options haven't changed since last publish to skip republishing
        const optionsKey = JSON.stringify(channels.map((ch, idx) => `${idx + 1}: ${(ch && ch.name_str) || `Channel ${idx + 1}`}`));
        if (this.lastPublishedVfoOptions === optionsKey) {
            return;
        }
        
        this.mqttReporter.publishVfoSelects(channels, channelAIndex, channelBIndex);
        this.lastPublishedVfoOptions = optionsKey;
    }

    // Helper to publish Region select sensor
    publishRegionSelect(regionCount) {
        if (!this.mqttReporter || typeof regionCount !== 'number' || regionCount <= 0) return;
        
        this.mqttReporter.publishRegionSelect(regionCount, this.lastRegion);
    }
}

module.exports = RadioController;
