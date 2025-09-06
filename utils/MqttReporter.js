const mqtt = require('mqtt');

class MqttReporter {
    constructor(config) {
        this.config = config;
        this.client = null;
        this.stationId = config.STATIONID ? parseInt(config.STATIONID, 10) : 1;
        this.uniqueId = `uvpro_radio_${this.stationId}`;
        this.baseDevice = {
            identifiers: [this.uniqueId],
            name: 'UVPro Radio',
            manufacturer: 'BTech',
            model: 'UV-Pro'
        };
    }

    connect() {
        if (!this.config.MQTT_BROKER_URL) throw new Error('MQTT_BROKER_URL missing in config');
        this.client = mqtt.connect(this.config.MQTT_BROKER_URL, {
            username: this.config.MQTT_USERNAME,
            password: this.config.MQTT_PASSWORD
        });
        this.client.on('connect', () => {
            console.log('[MQTT] Connected to broker');
        });
        this.client.on('error', (err) => {
            console.error('[MQTT] Error:', err.message);
        });
    }

    publishStatus(topic, payload) {
        if (this.client && this.client.connected) {
            this.client.publish(topic, JSON.stringify(payload), { retain: true });
        }
    }

    // Home Assistant Discovery methods
    publishBatterySensor() {
        const batterySensorTopic = `homeassistant/sensor/uvpro_radio_battery/config`;
        const batteryStateTopic = `${this.config.MQTT_TOPIC}/battery`;
        const batterySensorConfig = {
            name: 'UVPro Radio Battery',
            state_topic: batteryStateTopic,
            unique_id: `${this.uniqueId}_battery`,
            device: this.baseDevice,
            unit_of_measurement: '%',
            value_template: '{{ value_json.battery }}',
            icon: 'mdi:battery'
        };
        this.publishStatus(batterySensorTopic, batterySensorConfig);
        console.log('[MQTT] Published Home Assistant Battery sensor discovery config.');
    }

    publishVolumeNumber() {
        const volumeNumberTopic = `homeassistant/number/uvpro_radio_volume/config`;
        const volumeStateTopic = `${this.config.MQTT_TOPIC}/volume`;
        const volumeCommandTopic = `${this.config.MQTT_TOPIC}/volume/set`;
        const volumeNumberConfig = {
            name: 'UVPro Radio Volume',
            state_topic: volumeStateTopic,
            command_topic: volumeCommandTopic,
            unique_id: `${this.uniqueId}_volume`,
            device: this.baseDevice,
            min: 0,
            max: 15,
            step: 1,
            value_template: '{{ value_json.volume }}',
            icon: 'mdi:volume-high'
        };
        this.publishStatus(volumeNumberTopic, volumeNumberConfig);
        console.log('[MQTT] Published Home Assistant Volume number discovery config.');
    }

    publishSquelchNumber() {
        const squelchNumberTopic = `homeassistant/number/uvpro_radio_squelch/config`;
        const squelchStateTopic = `${this.config.MQTT_TOPIC}/squelch`;
        const squelchCommandTopic = `${this.config.MQTT_TOPIC}/squelch/set`;
        const squelchNumberConfig = {
            name: 'UVPro Radio Squelch',
            state_topic: squelchStateTopic,
            command_topic: squelchCommandTopic,
            unique_id: `${this.uniqueId}_squelch`,
            device: this.baseDevice,
            min: 0,
            max: 15,
            step: 1,
            value_template: '{{ value_json.squelch }}',
            icon: 'mdi:volume-off'
        };
        this.publishStatus(squelchNumberTopic, squelchNumberConfig);
        console.log('[MQTT] Published Home Assistant Squelch number discovery config.');
    }

    publishScanSwitch() {
        const scanSwitchTopic = `homeassistant/switch/uvpro_radio_scan/config`;
        const scanStateTopic = `${this.config.MQTT_TOPIC}/scan`;
        const scanCommandTopic = `${this.config.MQTT_TOPIC}/scan/set`;
        const scanSwitchConfig = {
            name: 'UVPro Radio Scan',
            state_topic: scanStateTopic,
            command_topic: scanCommandTopic,
            unique_id: `${this.uniqueId}_scan`,
            device: this.baseDevice,
            payload_on: 'ON',
            payload_off: 'OFF',
            value_template: '{{ value_json.scan }}',
            icon: 'mdi:radar'
        };
        this.publishStatus(scanSwitchTopic, scanSwitchConfig);
        console.log('[MQTT] Published Home Assistant Scan switch discovery config.');
    }

    publishDualWatchSwitch() {
        const doubleChannelSwitchTopic = `homeassistant/switch/uvpro_radio_double_channel/config`;
        const doubleChannelStateTopic = `${this.config.MQTT_TOPIC}/double_channel`;
        const doubleChannelCommandTopic = `${this.config.MQTT_TOPIC}/double_channel/set`;
        const doubleChannelSwitchConfig = {
            name: 'UVPro Radio Dual Watch',
            state_topic: doubleChannelStateTopic,
            command_topic: doubleChannelCommandTopic,
            unique_id: `${this.uniqueId}_double_channel`,
            device: this.baseDevice,
            payload_on: 'ON',
            payload_off: 'OFF',
            value_template: '{{ value_json.double_channel }}',
            icon: 'mdi:swap-horizontal'
        };
        this.publishStatus(doubleChannelSwitchTopic, doubleChannelSwitchConfig);
        console.log('[MQTT] Published Home Assistant Dual Watch switch discovery config.');
    }

    publishGpsSwitch() {
        const gpsSwitchTopic = `homeassistant/switch/uvpro_radio_gps/config`;
        const gpsCommandTopic = `${this.config.MQTT_TOPIC}/gps/set`;
        const gpsStateTopic = `${this.config.MQTT_TOPIC}/gps`;
        const gpsSwitchConfig = {
            name: 'UVPro Radio GPS',
            state_topic: gpsStateTopic,
            command_topic: gpsCommandTopic,
            unique_id: `${this.uniqueId}_gps`,
            device: this.baseDevice,
            payload_on: 'ON',
            payload_off: 'OFF',
            value_template: '{{ value_json.gps }}',
            icon: 'mdi:crosshairs-gps'
        };
        this.publishStatus(gpsSwitchTopic, gpsSwitchConfig);
        console.log('[MQTT] Published Home Assistant GPS switch discovery config.');
        
        // Publish initial GPS state as OFF since GPS starts disabled
        this.publishStatus(gpsStateTopic, { gps: 'OFF' });
    }

    publishGpsSensors() {
        const gpsStateTopic = `${this.config.MQTT_TOPIC}/gps_position`;
        
        // GPS Latitude sensor
        const latSensorTopic = `homeassistant/sensor/uvpro_radio_gps_lat/config`;
        const latSensorConfig = {
            name: 'UVPro Radio GPS Latitude',
            state_topic: gpsStateTopic,
            unique_id: `${this.uniqueId}_gps_lat`,
            device: this.baseDevice,
            value_template: '{{ value_json.latitude }}',
            unit_of_measurement: '°',
            icon: 'mdi:latitude'
        };
        this.publishStatus(latSensorTopic, latSensorConfig);

        // GPS Longitude sensor
        const lngSensorTopic = `homeassistant/sensor/uvpro_radio_gps_lng/config`;
        const lngSensorConfig = {
            name: 'UVPro Radio GPS Longitude',
            state_topic: gpsStateTopic,
            unique_id: `${this.uniqueId}_gps_lng`,
            device: this.baseDevice,
            value_template: '{{ value_json.longitude }}',
            unit_of_measurement: '°',
            icon: 'mdi:longitude'
        };
        this.publishStatus(lngSensorTopic, lngSensorConfig);

        // GPS Altitude sensor
        const altSensorTopic = `homeassistant/sensor/uvpro_radio_gps_alt/config`;
        const altSensorConfig = {
            name: 'UVPro Radio GPS Altitude',
            state_topic: gpsStateTopic,
            unique_id: `${this.uniqueId}_gps_alt`,
            device: this.baseDevice,
            value_template: '{{ value_json.altitude }}',
            unit_of_measurement: 'm',
            icon: 'mdi:altimeter'
        };
        this.publishStatus(altSensorTopic, altSensorConfig);

        // GPS Lock status sensor (using regular sensor for text display)
        const lockSensorTopic = `homeassistant/sensor/uvpro_radio_gps_lock/config`;
        const lockSensorConfig = {
            name: 'UVPro Radio GPS Lock',
            state_topic: gpsStateTopic,
            unique_id: `${this.uniqueId}_gps_lock`,
            device: this.baseDevice,
            value_template: '{{ value_json.lock_status }}',
            icon: 'mdi:satellite-variant'
        };
        this.publishStatus(lockSensorTopic, lockSensorConfig);

        console.log('[MQTT] Published Home Assistant GPS sensors discovery config.');
    }

    publishAprsMessageSensor() {
        const aprsStateTopic = `${this.config.MQTT_TOPIC}/aprs_message`;
        const aprsTrustedStateTopic = `${this.config.MQTT_TOPIC}/aprs_message_trusted`;
        const aprsOtherStateTopic = `${this.config.MQTT_TOPIC}/aprs_message_other`;
        
        // My APRS Message sensor (messages addressed to our station, not authenticated)
        const aprsSensorTopic = `homeassistant/sensor/uvpro_radio_aprs_message/config`;
        const aprsSensorConfig = {
            name: 'My APRS Message',
            state_topic: aprsStateTopic,
            unique_id: `${this.uniqueId}_aprs_message`,
            device: this.baseDevice,
            value_template: '{{ value_json.message }}',
            icon: 'mdi:message-text'
        };
        this.publishStatus(aprsSensorTopic, aprsSensorConfig);

        // My Trusted APRS Message sensor (messages addressed to our station with successful authentication)
        const aprsTrustedSensorTopic = `homeassistant/sensor/uvpro_radio_aprs_message_trusted/config`;
        const aprsTrustedSensorConfig = {
            name: 'My Trusted APRS Message',
            state_topic: aprsTrustedStateTopic,
            unique_id: `${this.uniqueId}_aprs_message_trusted`,
            device: this.baseDevice,
            value_template: '{{ value_json.message }}',
            icon: 'mdi:message-lock'
        };
        this.publishStatus(aprsTrustedSensorTopic, aprsTrustedSensorConfig);

        // APRS Message sensor (messages not addressed to our station)
        const aprsOtherSensorTopic = `homeassistant/sensor/uvpro_radio_aprs_message_other/config`;
        const aprsOtherSensorConfig = {
            name: 'APRS Message',
            state_topic: aprsOtherStateTopic,
            unique_id: `${this.uniqueId}_aprs_message_other`,
            device: this.baseDevice,
            value_template: '{{ value_json.message }}',
            icon: 'mdi:message-outline'
        };
        this.publishStatus(aprsOtherSensorTopic, aprsOtherSensorConfig);

        console.log('[MQTT] Published Home Assistant APRS message sensors discovery config.');
    }

    publishFirmwareVersionSensor(versionString) {
        const fwSensorTopic = `homeassistant/sensor/uvpro_radio_firmware/config`;
        const fwStateTopic = `${this.config.MQTT_TOPIC}/firmware_version`;
        const fwSensorConfig = {
            name: 'UVPro Radio Firmware Version',
            state_topic: fwStateTopic,
            unique_id: `${this.uniqueId}_firmware`,
            device: this.baseDevice,
            value_template: '{{ value_json.firmware_version }}',
            icon: 'mdi:chip'
        };
        this.publishStatus(fwSensorTopic, fwSensorConfig);
        this.publishStatus(fwStateTopic, { firmware_version: versionString });
        console.log('[MQTT] Published Firmware Version sensor:', versionString);
    }

    publishVfoSelects(channels, channelAIndex, channelBIndex) {
        if (!channels || !Array.isArray(channels)) return;
        
        const vfo1SensorTopic = `homeassistant/select/uvpro_radio_vfo1/config`;
        const vfo2SensorTopic = `homeassistant/select/uvpro_radio_vfo2/config`;
        const vfo1StateTopic = `${this.config.MQTT_TOPIC}/vfo1`;
        const vfo2StateTopic = `${this.config.MQTT_TOPIC}/vfo2`;
        const vfo1CommandTopic = `${this.config.MQTT_TOPIC}/vfo1/set`;
        const vfo2CommandTopic = `${this.config.MQTT_TOPIC}/vfo2/set`;

        // Build options array
        const options = [];
        for (let idx = 0; idx < channels.length; idx++) {
            const ch = channels[idx];
            let name = (ch && ch.name_str) ? ch.name_str : '';
            if (!name) name = `Channel ${idx + 1}`;
            options.push(`${idx + 1}: ${name}`);
        }

        const vfo1Config = {
            name: 'UVPro Radio VFO1',
            command_topic: vfo1CommandTopic,
            state_topic: vfo1StateTopic,
            unique_id: `${this.uniqueId}_vfo1`,
            device: this.baseDevice,
            options: options,
            value_template: '{{ value_json.vfo }}'
        };

        const vfo2Config = Object.assign({}, vfo1Config, {
            name: 'UVPro Radio VFO2',
            command_topic: vfo2CommandTopic,
            state_topic: vfo2StateTopic,
            unique_id: `${this.uniqueId}_vfo2`
        });

        this.publishStatus(vfo1SensorTopic, vfo1Config);
        this.publishStatus(vfo2SensorTopic, vfo2Config);

        // Publish initial states
        const selA = options[(typeof channelAIndex === 'number' ? channelAIndex : 0)] || options[0];
        const selB = options[(typeof channelBIndex === 'number' ? channelBIndex : 0)] || options[0];
        this.publishStatus(vfo1StateTopic, { vfo: selA });
        this.publishStatus(vfo2StateTopic, { vfo: selB });
    }

    publishRegionSelect(regionCount, lastRegion = null) {
        if (typeof regionCount !== 'number' || regionCount <= 0) return;
        
        const regionSelectTopic = `homeassistant/select/uvpro_radio_region/config`;
        const regionStateTopic = `${this.config.MQTT_TOPIC}/region_select`;
        const regionCommandTopic = `${this.config.MQTT_TOPIC}/region_select/set`;
        
        // Build options like "Region 1", "Region 2", etc.
        const options = [];
        for (let i = 1; i <= regionCount; i++) {
            options.push(`Region ${i}`);
        }
        
        const regionSelectConfig = {
            name: 'UVPro Radio Region',
            command_topic: regionCommandTopic,
            state_topic: regionStateTopic,
            unique_id: `${this.uniqueId}_region_select`,
            device: this.baseDevice,
            options: options,
            value_template: '{{ value_json.region }}',
            icon: 'mdi:map'
        };
        
        this.publishStatus(regionSelectTopic, regionSelectConfig);
        console.log(`[MQTT] Published Region select discovery with ${regionCount} regions.`);
        
        // Publish initial state if we know the current region
        if (lastRegion !== null) {
            const regionLabel = `Region ${lastRegion + 1}`;
            this.publishStatus(regionStateTopic, { region: regionLabel });
        }
    }

    publishGpsDisabledState() {
        const gpsPositionTopic = `${this.config.MQTT_TOPIC}/gps_position`;
        const disabledPositionData = {
            latitude: null,
            longitude: null,
            altitude: null,
            speed: null,
            heading: null,
            accuracy: null,
            locked: false,
            lock_status: "Disabled",
            latitude_dms: "Disabled",
            longitude_dms: "Disabled",
            timestamp: new Date().toISOString()
        };
        this.publishStatus(gpsPositionTopic, disabledPositionData);
        console.log(`[MQTT] DEBUG: Published GPS disabled state to ${gpsPositionTopic}`);
    }

    publishAllDiscoveryConfigs() {
        this.publishBatterySensor();
        this.publishVolumeNumber();
        this.publishSquelchNumber();
        this.publishScanSwitch();
        this.publishDualWatchSwitch();
        this.publishGpsSwitch();
        this.publishGpsSensors();
        this.publishAprsMessageSensor();
        this.publishGpsDisabledState();
    }
}

module.exports = MqttReporter;
