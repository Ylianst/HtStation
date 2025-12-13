# Home Assistant Integration Guide

This guide explains how to integrate HtStation with Home Assistant using MQTT, enabling you to monitor and control your radio through your smart home system.

## Overview

HtStation publishes radio status (battery, volume, squelch, GPS, etc.) and accepts commands via MQTT. Home Assistant can subscribe to these topics to display information and send commands to control your radio.

### What You'll Get

- **Real-time monitoring** of radio status (battery, volume, squelch, scan mode, etc.)
- **Remote control** of radio settings from Home Assistant
- **APRS message notifications** as Home Assistant sensors
- **GPS position tracking** (if radio supports it)
- **Automatic MQTT Discovery** for easy setup

## Prerequisites

1. **Home Assistant** installed and running
2. **HtStation** configured with a paired Bluetooth radio (see [bluetooth.md](bluetooth.md))
3. **MQTT Broker** running on Home Assistant or accessible network location

## Step 1: Install MQTT Broker on Home Assistant

### Option A: Mosquitto Broker Add-on (Recommended)

1. **Open Home Assistant** in your web browser
2. **Navigate to Settings → Add-ons**
3. **Click "Add-on Store"** (bottom right)
4. **Search for "Mosquitto broker"**
5. **Click on "Mosquitto broker"**
6. **Click "INSTALL"**
7. **Wait for installation** to complete
8. **Configure the broker:**
   - Click the "Configuration" tab
   - **Enable authentication** (recommended):
     ```yaml
     logins:
       - username: btradio
         password: myradio
     ```
   - Click "SAVE"
9. **Start the broker:**
   - Click the "Info" tab
   - Enable "Start on boot"
   - Click "START"
10. **Verify it's running** - Status should show "Running"

### Option B: External MQTT Broker

If you already have an MQTT broker running elsewhere on your network:

1. **Note the broker's IP address and port** (default: 1883)
2. **Note the username and password** (if authentication is enabled)
3. **Continue to Step 2**

## Step 2: Configure Home Assistant MQTT Integration

1. **Navigate to Settings → Devices & Services**
2. **Click "ADD INTEGRATION"** (bottom right)
3. **Search for "MQTT"**
4. **Click on "MQTT"**
5. **Enter broker details:**
   - **Broker:** `localhost` (if using Mosquitto add-on) or your broker's IP
   - **Port:** `1883` (default)
   - **Username:** `btradio` (or your chosen username)
   - **Password:** `myradio` (or your chosen password)
   - **Discovery:** Enable (recommended)
6. **Click "SUBMIT"**
7. **Verify connection** - You should see "MQTT connected" status

## Step 3: Configure HtStation

Edit your `config.ini` file to connect to the MQTT broker:

```ini
# MQTT / Home Assistant integration
MQTT_BROKER_URL=mqtt://192.168.1.100:1883
MQTT_TOPIC=homeassistant/uvpro-radio
MQTT_USERNAME=btradio
MQTT_PASSWORD=myradio
```

### Configuration Details

- **MQTT_BROKER_URL:** Full URL to your MQTT broker
  - Use `mqtt://localhost:1883` if HtStation runs on same machine as Home Assistant
  - Use `mqtt://192.168.1.100:1883` if Home Assistant is on a different machine
  - Replace IP address with your Home Assistant's IP address
  
- **MQTT_TOPIC:** Base topic for all HtStation messages
  - Default: `homeassistant/uvpro-radio`
  - Can be customized but must start with `homeassistant/` for auto-discovery

- **MQTT_USERNAME:** Must match the username configured in Mosquitto

- **MQTT_PASSWORD:** Must match the password configured in Mosquitto

### Example Configurations

#### HtStation on Same Raspberry Pi as Home Assistant
```ini
MQTT_BROKER_URL=mqtt://localhost:1883
MQTT_TOPIC=homeassistant/uvpro-radio
MQTT_USERNAME=btradio
MQTT_PASSWORD=myradio
```

#### HtStation on Different Device
```ini
MQTT_BROKER_URL=mqtt://192.168.1.50:1883
MQTT_TOPIC=homeassistant/uvpro-radio
MQTT_USERNAME=btradio
MQTT_PASSWORD=myradio
```

#### Using External MQTT Broker
```ini
MQTT_BROKER_URL=mqtt://mqtt.example.com:1883
MQTT_TOPIC=homeassistant/uvpro-radio
MQTT_USERNAME=your_username
MQTT_PASSWORD=your_password
```

## Step 4: Start HtStation

Start or restart HtStation to apply the MQTT configuration:

```bash
# If running in console mode
node htstation.js --run

# If running as a service
sudo systemctl restart htstation
```

## Step 5: Verify Home Assistant Integration

### Check MQTT Topics

1. **Navigate to Settings → Devices & Services**
2. **Click on "MQTT"**
3. **Click "CONFIGURE"**
4. **Click "Listen to a topic"**
5. **Enter topic:** `homeassistant/uvpro-radio/#`
6. **Click "START LISTENING"**

You should see messages appearing as HtStation publishes data:
- `homeassistant/uvpro-radio/battery`
- `homeassistant/uvpro-radio/volume`
- `homeassistant/uvpro-radio/squelch`
- `homeassistant/uvpro-radio/scan`
- And more...

### Check Auto-Discovered Entities

HtStation automatically creates Home Assistant entities via MQTT Discovery:

1. **Navigate to Settings → Devices & Services**
2. **Click on "MQTT"**
3. **Look for entities like:**
   - `sensor.radio_battery`
   - `number.radio_volume`
   - `number.radio_squelch`
   - `switch.radio_scan`
   - `switch.radio_double_channel`
   - `select.radio_region`
   - `switch.radio_gps`
   - `sensor.radio_gps_position`
   - `sensor.radio_aprs_message`
   - `sensor.radio_aprs_message_trusted`
   - `sensor.radio_aprs_message_other`

## Available Sensors and Controls

### Battery Status
- **Type:** Sensor
- **Topic:** `homeassistant/uvpro-radio/battery`
- **Description:** Battery percentage (0-100%)

### Volume Control
- **Type:** Number
- **Topic:** `homeassistant/uvpro-radio/volume`
- **Command Topic:** `homeassistant/uvpro-radio/volume/set`
- **Range:** 0-15
- **Description:** Radio volume level

### Squelch Control
- **Type:** Number
- **Topic:** `homeassistant/uvpro-radio/squelch`
- **Command Topic:** `homeassistant/uvpro-radio/squelch/set`
- **Range:** 0-9
- **Description:** Squelch level

### Scan Mode
- **Type:** Switch
- **Topic:** `homeassistant/uvpro-radio/scan`
- **Command Topic:** `homeassistant/uvpro-radio/scan/set`
- **Values:** ON/OFF
- **Description:** Enable/disable frequency scanning

### Double Channel Mode
- **Type:** Switch
- **Topic:** `homeassistant/uvpro-radio/double_channel`
- **Command Topic:** `homeassistant/uvpro-radio/double_channel/set`
- **Values:** ON/OFF
- **Description:** Enable/disable dual watch mode

### Region Select
- **Type:** Select
- **Topic:** `homeassistant/uvpro-radio/region_select`
- **Command Topic:** `homeassistant/uvpro-radio/region_select/set`
- **Options:** Region 1, Region 2, Region 3, Region 4, Region 5, Region 6
- **Description:** Select radio region/channel bank

### GPS Control
- **Type:** Switch
- **Topic:** `homeassistant/uvpro-radio/gps`
- **Command Topic:** `homeassistant/uvpro-radio/gps/set`
- **Values:** ON/OFF
- **Description:** Enable/disable GPS (if supported by radio)

### GPS Position
- **Type:** Sensor
- **Topic:** `homeassistant/uvpro-radio/gps_position`
- **Description:** Current GPS coordinates and status
- **Attributes:** latitude, longitude, altitude, speed, timestamp, status

### VFO1 Control
- **Type:** Text Input
- **Topic:** `homeassistant/uvpro-radio/vfo1`
- **Command Topic:** `homeassistant/uvpro-radio/vfo1/set`
- **Description:** Set VFO1 frequency (e.g., "146.520")

### VFO2 Control
- **Type:** Text Input
- **Topic:** `homeassistant/uvpro-radio/vfo2`
- **Command Topic:** `homeassistant/uvpro-radio/vfo2/set`
- **Description:** Set VFO2 frequency (e.g., "446.000")

### APRS Messages
- **Type:** Sensors (3 separate sensors)
- **Topics:**
  - `homeassistant/uvpro-radio/aprs_message` - Messages for your station (untrusted)
  - `homeassistant/uvpro-radio/aprs_message_trusted` - Authenticated messages for your station
  - `homeassistant/uvpro-radio/aprs_message_other` - Messages for other stations
- **Description:** APRS message notifications with sender, message content, and timestamp

## Creating Home Assistant Dashboards

### Basic Radio Control Card

Create a card in Lovelace UI:

```yaml
type: entities
title: Radio Control
entities:
  - entity: sensor.radio_battery
    name: Battery
  - entity: number.radio_volume
    name: Volume
  - entity: number.radio_squelch
    name: Squelch
  - entity: switch.radio_scan
    name: Scan Mode
  - entity: switch.radio_double_channel
    name: Dual Watch
  - entity: select.radio_region
    name: Region
```

### APRS Message Display

```yaml
type: entities
title: APRS Messages
entities:
  - entity: sensor.radio_aprs_message_trusted
    name: My Trusted Messages
  - entity: sensor.radio_aprs_message
    name: My Messages
  - entity: sensor.radio_aprs_message_other
    name: Other Messages
```

### GPS Position Map

```yaml
type: map
entities:
  - entity: sensor.radio_gps_position
title: Radio GPS Position
default_zoom: 15
```

## Automations

### Example: Battery Low Notification

Create an automation to alert when battery is low:

```yaml
alias: Radio Battery Low Alert
description: Notify when radio battery is below 20%
trigger:
  - platform: numeric_state
    entity_id: sensor.radio_battery
    below: 20
action:
  - service: notify.notify
    data:
      message: "Radio battery is low ({{ states('sensor.radio_battery') }}%)"
      title: Radio Alert
```

### Example: Auto-Enable GPS at Sunrise

```yaml
alias: Enable Radio GPS at Sunrise
description: Turn on GPS tracking when the sun rises
trigger:
  - platform: sun
    event: sunrise
action:
  - service: switch.turn_on
    target:
      entity_id: switch.radio_gps
```

### Example: APRS Message Notification

```yaml
alias: APRS Message Received
description: Notify when a trusted APRS message is received
trigger:
  - platform: state
    entity_id: sensor.radio_aprs_message_trusted
action:
  - service: notify.notify
    data:
      message: "APRS from {{ state_attr('sensor.radio_aprs_message_trusted', 'from') }}: {{ states('sensor.radio_aprs_message_trusted') }}"
      title: APRS Message
```

## Troubleshooting

### Connection Issues

**Problem:** HtStation can't connect to MQTT broker

**Solutions:**
1. Verify Mosquitto broker is running in Home Assistant
2. Check IP address and port in `MQTT_BROKER_URL`
3. Verify username and password match broker configuration
4. Check firewall settings (port 1883 must be open)
5. Test connection from HtStation machine:
   ```bash
   mosquitto_sub -h 192.168.1.50 -p 1883 -u btradio -P myradio -t '#' -v
   ```

### No Entities Appearing

**Problem:** Home Assistant doesn't show HtStation entities

**Solutions:**
1. Verify MQTT Discovery is enabled in Home Assistant
2. Check `MQTT_TOPIC` starts with `homeassistant/`
3. Restart HtStation to republish discovery messages
4. Check MQTT logs in Home Assistant (Settings → System → Logs)
5. Verify HtStation is publishing (use MQTT topic listener)

### Authentication Failed

**Problem:** MQTT authentication errors

**Solutions:**
1. Verify username and password in both `config.ini` and Mosquitto configuration
2. Check for typos or extra spaces
3. Restart Mosquitto broker after configuration changes
4. Check Mosquitto logs for authentication errors

### Entities Not Updating

**Problem:** Sensor values don't update

**Solutions:**
1. Verify radio is connected via Bluetooth
2. Check HtStation console logs for MQTT publishing
3. Verify MQTT broker is receiving messages (use topic listener)
4. Restart HtStation service
5. Check that radio is responding to status requests

## Advanced Configuration

### Using TLS/SSL

For secure MQTT connections:

```ini
MQTT_BROKER_URL=mqtts://192.168.1.50:8883
MQTT_TOPIC=homeassistant/uvpro-radio
MQTT_USERNAME=btradio
MQTT_PASSWORD=myradio
```

Configure Mosquitto for TLS (requires certificates).

### Custom Topic Prefix

You can use a custom topic prefix:

```ini
MQTT_TOPIC=homeassistant/radio_station_1
```

Each HtStation instance should use a unique topic if running multiple radios.

### Multiple Radios

To run multiple HtStation instances with Home Assistant:

1. **Each radio needs unique:**
   - Bluetooth MAC address (different radio)
   - MQTT topic (e.g., `homeassistant/radio1`, `homeassistant/radio2`)
   - Callsign (or SSID variant like `N0CALL`, `N0CALL-1`)

2. **Example config.ini for second radio:**
   ```ini
   MACADDRESS=38:D2:00:00:EF:25
   CALLSIGN=N0CALL-1
   MQTT_TOPIC=homeassistant/radio2
   ```

## Additional Resources

- [Home Assistant MQTT Integration](https://www.home-assistant.io/integrations/mqtt/)
- [Mosquitto Broker Add-on](https://github.com/home-assistant/addons/tree/master/mosquitto)
- [HtStation Configuration Guide](config.md)
- [MQTT Discovery](https://www.home-assistant.io/integrations/mqtt/#mqtt-discovery)

## Security Recommendations

1. **Use strong passwords** for MQTT authentication
2. **Enable TLS/SSL** for production deployments
3. **Restrict network access** to MQTT broker (firewall rules)
4. **Use unique credentials** for each HtStation instance
5. **Keep Home Assistant updated** with latest security patches
6. **Monitor MQTT logs** for unauthorized access attempts
