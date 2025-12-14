# Home Assistant Integration Guide

![image](https://raw.githubusercontent.com/Ylianst/HTCommanderStation/refs/heads/main/docs/images/HtCommanderStation.png?raw=true)

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
