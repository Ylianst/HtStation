# HtStation Quick Setup Guide

Get your HtStation up and running in minutes! This guide covers the essential steps to configure and start your packet radio station.

## Prerequisites

Before you begin, ensure you have:
- ✅ Raspberry Pi (or Linux system) with Bluetooth
- ✅ Compatible radio (UV-Pro, GA-5WB, VR-N76, VR-N7500, or VR-N7600)
- ✅ Amateur radio license and callsign
- ✅ Node.js installed (version 14 or higher)
- ✅ HtStation downloaded from GitHub

## Quick Setup Overview

```
1. Pair Bluetooth → 2. Configure → 3. Test → 4. Install Service
   (5 minutes)       (2 minutes)    (1 minute)  (1 minute)
```

---

## Step 1: Pair Your Radio via Bluetooth

### 1.1 Enable Bluetooth on Raspberry Pi

```bash
sudo systemctl start bluetooth
sudo systemctl enable bluetooth
```

### 1.2 Start Bluetooth Pairing

```bash
bluetoothctl
```

You should see: `[bluetooth]#`

### 1.3 Scan and Pair

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

### 1.4 Complete Pairing

Replace `A1:B2:C3:D4:E5:F6` with your radio's MAC address:

```bash
pair A1:B2:C3:D4:E5:F6
trust A1:B2:C3:D4:E5:F6
scan off
exit
```

✅ **Done!** Your radio is now paired.

> 📖 **Need more help?** See [bluetoothhelp.md](bluetoothhelp.md) for detailed troubleshooting.

---

## Step 2: Configure HtStation

### 2.1 Navigate to HtStation Directory

```bash
cd /path/to/HtStation
```

### 2.2 Edit config.ini

```bash
nano config.ini
```

### 2.3 Set Required Values

**Update these two lines** with your information:

```ini
# Your radio's Bluetooth MAC address (from Step 1.3)
MACADDRESS=A1:B2:C3:D4:E5:F6

# Your amateur radio callsign
CALLSIGN=N0CALL
```

### 2.4 Enable Services (Optional but Recommended)

Uncomment and set these lines to enable packet radio services:

```ini
# Bulletin Board System on YOURCALLSIGN-1
BBS_STATION_ID=1

# Echo test service on YOURCALLSIGN-2
ECHO_STATION_ID=2

# WinLink email on YOURCALLSIGN-3
WINLINK_STATION_ID=3
WINLINK_PASSWORD=your_password_here
```

### 2.5 Save and Exit

Press `CTRL+O` to save, `ENTER` to confirm, then `CTRL+X` to exit.

✅ **Done!** Basic configuration complete.

> 📖 **Want more options?** See [config.md](config.md) for complete configuration reference.

---

## Step 3: Test Your Setup

### 3.1 Install Dependencies

Make sure all required packages are installed:

```bash
npm install
```

### 3.2 Run in Console Mode

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

### 3.3 Access Web Interface

Open a browser and navigate to:
```
http://localhost:8089
```

Or from another device on your network:
```
http://your-pi-ip:8089
```

**You should see** the HtStation dashboard with your station information!

### 3.4 Stop Testing

Press `CTRL+C` to stop HtStation.

✅ **Done!** HtStation is working correctly.

> 📖 **Explore features:** See [webpage.md](webpage.md) for web interface guide.

---

## Step 4: Install as System Service

Install HtStation to run automatically at startup.

### 4.1 Install Service

```bash
sudo node htstation.js --install
```

**You should see:**
```
Installing HtStation as systemctl service...
Service installed successfully!
Service is running and enabled for startup.
```

### 4.2 Verify Service is Running

```bash
sudo systemctl status htstation
```

**Look for:** `Active: active (running)`

### 4.3 Service Management Commands

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

✅ **Done!** HtStation will now start automatically when your Raspberry Pi boots.

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

---

## Summary Checklist

- [ ] Bluetooth paired and trusted
- [ ] MACADDRESS set in config.ini
- [ ] CALLSIGN set in config.ini
- [ ] Services enabled (BBS, Echo, WinLink)
- [ ] Dependencies installed (npm install)
- [ ] Tested with --run
- [ ] Web interface accessible
- [ ] Service installed (--install)
- [ ] Service running (systemctl status)
- [ ] Bookmarked web dashboard

**Congratulations!** 🎉 Your HtStation is now operational and ready for packet radio operations!

---

*Quick Setup Guide - Get up and running in under 10 minutes*
