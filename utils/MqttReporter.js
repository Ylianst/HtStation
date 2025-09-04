const mqtt = require('mqtt');

class MqttReporter {
    constructor(config) {
        this.config = config;
        this.client = null;
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
}

module.exports = MqttReporter;
