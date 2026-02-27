const mqtt = require('mqtt');
const DataBroker = require('./DataBroker');

// Get logger instance
const logger = global.logger ? global.logger.getLogger('MQTT') : console;

// DataBroker event names for MQTT
const MQTT_EVENTS = {
    STATUS: 'mqtt:status',           // Connection status changes
    PUBLISHED: 'mqtt:published',     // Message published to MQTT
    RECEIVED: 'mqtt:received',       // Message received from MQTT subscription
    ERROR: 'mqtt:error',             // MQTT errors
    STATS: 'mqtt:stats'              // Overall MQTT statistics
};

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
        
        // Statistics tracking
        this.stats = {
            connected: false,
            brokerUrl: config.MQTT_BROKER_URL || null,
            baseTopic: config.MQTT_TOPIC || null,
            connectTime: null,
            disconnectTime: null,
            publishCount: 0,
            receiveCount: 0,
            errorCount: 0,
            lastPublish: null,
            lastReceive: null,
            lastError: null
        };
        
        // Dispatch initial status
        this._dispatchStatus('disconnected');
        this._dispatchStats();
    }

    connect() {
        if (!this.config.MQTT_BROKER_URL) throw new Error('MQTT_BROKER_URL missing in config');
        
        this.client = mqtt.connect(this.config.MQTT_BROKER_URL, {
            username: this.config.MQTT_USERNAME,
            password: this.config.MQTT_PASSWORD
        });
        
        this._dispatchStatus('connecting');
        
        this.client.on('connect', () => {
            logger.log('[MQTT] Connected to broker');
            this.stats.connected = true;
            this.stats.connectTime = new Date().toISOString();
            this._dispatchStatus('connected');
            this._dispatchStats();
        });
        
        this.client.on('close', () => {
            logger.log('[MQTT] Connection closed');
            this.stats.connected = false;
            this.stats.disconnectTime = new Date().toISOString();
            this._dispatchStatus('disconnected');
            this._dispatchStats();
        });
        
        this.client.on('reconnect', () => {
            logger.log('[MQTT] Reconnecting...');
            this._dispatchStatus('reconnecting');
        });
        
        this.client.on('offline', () => {
            logger.log('[MQTT] Client offline');
            this.stats.connected = false;
            this._dispatchStatus('offline');
            this._dispatchStats();
        });
        
        this.client.on('error', (err) => {
            logger.error('[MQTT] Error:', err.message);
            this.stats.errorCount++;
            this.stats.lastError = {
                message: err.message,
                timestamp: new Date().toISOString()
            };
            this._dispatchError(err.message);
            this._dispatchStats();
        });
        
        this.client.on('message', (topic, message) => {
            // Handle incoming messages from subscriptions
            this._handleReceivedMessage(topic, message);
        });
    }
    
    /**
     * Dispatch MQTT connection status to DataBroker
     */
    _dispatchStatus(status) {
        DataBroker.dispatch(0, MQTT_EVENTS.STATUS, {
            status: status,
            brokerUrl: this.config.MQTT_BROKER_URL,
            baseTopic: this.config.MQTT_TOPIC,
            timestamp: new Date().toISOString()
        });
    }
    
    /**
     * Dispatch MQTT statistics to DataBroker
     */
    _dispatchStats() {
        DataBroker.dispatch(0, MQTT_EVENTS.STATS, {
            ...this.stats,
            timestamp: new Date().toISOString()
        });
    }
    
    /**
     * Dispatch published message event to DataBroker
     */
    _dispatchPublished(topic, payload) {
        DataBroker.dispatch(0, MQTT_EVENTS.PUBLISHED, {
            topic: topic,
            payload: payload,
            timestamp: new Date().toISOString()
        }, false); // Don't store, just broadcast
    }
    
    /**
     * Dispatch received message event to DataBroker
     */
    _dispatchReceived(topic, payload) {
        DataBroker.dispatch(0, MQTT_EVENTS.RECEIVED, {
            topic: topic,
            payload: payload,
            timestamp: new Date().toISOString()
        }, false); // Don't store, just broadcast
    }
    
    /**
     * Dispatch error event to DataBroker
     */
    _dispatchError(errorMessage) {
        DataBroker.dispatch(0, MQTT_EVENTS.ERROR, {
            error: errorMessage,
            timestamp: new Date().toISOString()
        }, false); // Don't store, just broadcast
    }
    
    /**
     * Handle received message from MQTT subscription
     */
    _handleReceivedMessage(topic, message) {
        try {
            const msgStr = message.toString();
            let payload;
            try {
                payload = JSON.parse(msgStr);
            } catch {
                payload = msgStr;
            }
            
            this.stats.receiveCount++;
            this.stats.lastReceive = {
                topic: topic,
                timestamp: new Date().toISOString()
            };
            this._dispatchReceived(topic, payload);
            this._dispatchStats();
        } catch (error) {
            logger.error('[MQTT] Error handling received message:', error);
        }
    }

    publishStatus(topic, payload) {
        if (this.client && this.client.connected) {
            this.client.publish(topic, JSON.stringify(payload), { retain: true });
            
            // Track published message
            this.stats.publishCount++;
            this.stats.lastPublish = {
                topic: topic,
                timestamp: new Date().toISOString()
            };
            this._dispatchPublished(topic, payload);
            this._dispatchStats();
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
        logger.log('[MQTT] Published Home Assistant Battery sensor discovery config.');
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
        logger.log('[MQTT] Published Home Assistant Volume number discovery config.');
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
        logger.log('[MQTT] Published Home Assistant Squelch number discovery config.');
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
        logger.log('[MQTT] Published Home Assistant Scan switch discovery config.');
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
        logger.log('[MQTT] Published Home Assistant Dual Watch switch discovery config.');
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
        logger.log('[MQTT] Published Home Assistant GPS switch discovery config.');
        
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

        logger.log('[MQTT] Published Home Assistant GPS sensors discovery config.');
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

        logger.log('[MQTT] Published Home Assistant APRS message sensors discovery config.');
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
        logger.log('[MQTT] Published Firmware Version sensor:', versionString);
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
        logger.log(`[MQTT] Published Region select discovery with ${regionCount} regions.`);
        
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
        logger.log(`[MQTT] DEBUG: Published GPS disabled state to ${gpsPositionTopic}`);
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
