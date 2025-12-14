# HtStation Quick Setup Guide

This guide covers the essential steps to configure and start your packet radio station.

## Prerequisites

Before you begin, ensure you have:
- ✅ Amateur radio license and callsign
- ✅ Raspberry Pi (or Linux system) with Bluetooth
- ✅ Compatible radio (UV-Pro, GA-5WB, VR-N76, VR-N7500, or VR-N7600)

## Quick Setup Overview

This guide will walk you through:
1. Installing NodeJS and dependencies
2. Pairing your radio via Bluetooth
3. Configuring HtStation
4. Testing and installing as a service

## Step 1: Install NodeJS and Dependencies

### 1.1 Install NodeJS and NPM

```bash
curl -fsSL https://deb.nodesource.com/setup_lts.sh | sudo -E bash -
sudo apt-get install -y nodejs
```

Verify installation:
```bash
node --version
npm --version
```

### 1.2 Install Bluetooth Dependencies

```bash
sudo apt-get install bluetooth bluez libbluetooth-dev libudev-dev
```

---

## Step 2: Pair Your Radio via Bluetooth

### 2.1 Enable Bluetooth on Raspberry Pi

```bash
sudo systemctl start bluetooth
sudo systemctl enable bluetooth
```

### 2.2 Start Bluetooth Pairing

```bash
bluetoothctl
```

You should see: `[bluetooth]#`

### 2.3 Scan and Pair

At the bluetoothctl prompt:

```bash
power on
agent on
default-agent
scan on
```

**Watch for your radio** to appear in the scan results:
```
[NEW] Device A1:B2:C3:D4:E5:F6 UV-Pro
```

**Note the MAC address!** You'll need it in the next step.

### 2.4 Complete Pairing

Replace `A1:B2:C3:D4:E5:F6` with your radio's MAC address:

```bash
pair A1:B2:C3:D4:E5:F6
trust A1:B2:C3:D4:E5:F6
scan off
exit
```

> 📖 **Need more help?** See [bluetoothhelp.md](bluetoothhelp.md) for detailed troubleshooting.

---

## Step 3: Configure HtStation

### 3.1 Create and Setup HtStation Directory

Create a new folder for HtStation in your home directory:

```bash
mkdir ~/htstation
cd ~/htstation
```

### 3.2 Install HtStation

Download and install HtStation using npm:

```bash
npm install htstation
```

### 3.3 Create config.ini from Sample

```bash
cp config-sample.ini config.ini
nano config.ini
```

### 3.4 Set Required Values

**Update these two lines** with your information:

```ini
# Your radio's Bluetooth MAC address (from Step 2.3)
MACADDRESS=A1:B2:C3:D4:E5:F6

# Your amateur radio callsign (Do not put a stations id like "N0CALL-5")
CALLSIGN=N0CALL
```

### 3.5 Enable Services (Optional but Recommended)

Uncomment and set these lines to enable packet radio services:

```ini
# Bulletin Board System on YOURCALLSIGN-1
BBS_STATION_ID=1

# Echo test service on YOURCALLSIGN-3
ECHO_STATION_ID=3

# WinLink email on YOURCALLSIGN-2
WINLINK_STATION_ID=2
WINLINK_PASSWORD=your_password_here
```

### 3.6 Save and Exit

Press `CTRL+O` to save, `ENTER` to confirm, then `CTRL+X` to exit.

> 📖 **Want more options?** See [config.md](config.md) for complete configuration reference.

---

## Step 4: Test Your Setup

### 4.1 Run in Console Mode

```bash
node htstation.js --run
```

**You should see:**
```
HtStation v1.0.0
Connecting to radio at A1:B2:C3:D4:E5:F6...
Bluetooth connected successfully!
Radio is ready
BBS server started on N0CALL-1
Echo server started on N0CALL-2
WinLink server started on N0CALL-3
Web server started on port 8089
```

### 4.3 Access Web Interface

Open a browser and navigate to:
```
http://your-pi-ip:8089
```

### 4.4 Stop Testing

Press `CTRL+C` to stop HtStation.

✅ **Done!** HtStation is working correctly.

> 📖 **Explore features:** See [webpage.md](webpage.md) for web interface guide.

---

## Step 5: Install as System Service

Install HtStation to run automatically at startup.

### 5.1 Install Service

```bash
sudo node htstation.js --install
```

**You should see:**
```
Installing HtStation as systemctl service...
Service installed successfully!
Service is running and enabled for startup.
```

### 5.2 Verify Service is Running

```bash
sudo systemctl status htstation
```

**Look for:** `Active: active (running)`

### 5.3 Service Management Commands

Now that it's installed, use these commands:

```bash
# Check status
sudo systemctl status htstation

# Stop service
sudo node htstation.js --stop

# Start service
sudo node htstation.js --start

# Restart service (after config changes)
sudo node htstation.js --restart

# View logs
sudo journalctl -u htstation -f

# Uninstall service
sudo node htstation.js --uninstall
```

---

## Quick Reference Card

### Essential Commands

```bash
# Test in console mode
node htstation.js --run

# Install as service
sudo node htstation.js --install

# Start service
sudo node htstation.js --start

# Stop service
sudo node htstation.js --stop

# Restart after config changes
sudo node htstation.js --restart

# View live logs
sudo journalctl -u htstation -f
```

### Default Addresses

If you used the recommended configuration:
- **BBS:** Connect to `YOURCALLSIGN-1`
- **Echo Server:** Connect to `YOURCALLSIGN-2`
- **WinLink:** Connect to `YOURCALLSIGN-3`
- **Web Interface:** `http://your-pi-ip:8089`

### Configuration Files

- **Main config:** `config.ini`
- **Service file:** `/etc/systemd/system/htstation.service`
- **Data storage:** `data/` directory

---

## Troubleshooting Quick Fixes

### Radio Won't Connect

```bash
# Check Bluetooth is running
sudo systemctl status bluetooth

# Verify MAC address in config.ini
nano config.ini

# Re-pair the device
bluetoothctl
> remove A1:B2:C3:D4:E5:F6
> scan on
> pair A1:B2:C3:D4:E5:F6
> trust A1:B2:C3:D4:E5:F6
```

### Dependencies Missing

```bash
# Install all dependencies
npm install

# Or install individually
npm install bluetooth-serial-port mqtt ws
```

### Service Won't Start

```bash
# Check for errors in logs
sudo journalctl -u htstation -n 50

# Try running in console mode to see errors
node htstation.js --run

# Verify config.ini is correct
nano config.ini
```

### Web Interface Not Accessible

```bash
# Check firewall
sudo ufw allow 8089

# Verify service is running
sudo systemctl status htstation

# Check web server port in config.ini
grep WEBSERVERPORT config.ini
```

---

## What's Next?

Now that you have a basic setup running, explore these features:

### 📡 **BBS Features**
- Post bulletins for other stations
- Play interactive games (Guess the Number, Blackjack)
- Share files using YAPP protocol
- [Read more in bbs.md](bbs.md)

### 📧 **WinLink Email**
- Send and receive packet email
- Local message storage
- [Read more in winlink.md](winlink.md)

### 📍 **APRS Integration**
- Receive APRS messages
- View stations on map
- Authentication support
- [Read more in authentication.md](authentication.md)

### 🏠 **Home Assistant Integration**
- Control radio remotely
- Monitor battery and status
- Automate radio operations
- [Read more in homeassistant.md](homeassistant.md)

### 🌐 **Web Dashboard**
- Monitor active connections
- View APRS messages on map
- Manage bulletins and mail
- Real-time activity feed
- [Read more in webpage.md](webpage.md)

---

## Complete Documentation Index

- [Main Documentation](README.md) - Project overview
- [Configuration Guide](config.md) - All config.ini options
- [Bluetooth Setup](bluetoothhelp.md) - Detailed pairing instructions
- [BBS Guide](bbs.md) - Bulletin board features
- [Echo Server](echoserver.md) - Testing connections
- [WinLink Guide](winlink.md) - Email system
- [Web Interface](webpage.md) - Dashboard guide
- [Home Assistant](homeassistant.md) - MQTT integration
- [Authentication](authentication.md) - APRS security

---

## Support and Community

### Get Help

```bash
# View all command-line options
node htstation.js --help

# Show Bluetooth pairing guide
node htstation.js --bluetoothhelp
```

### Resources

- **GitHub:** https://github.com/Ylianst/HtStation
- **Issues:** Report bugs and request features on GitHub
- **Documentation:** All guides available in `docs/` folder