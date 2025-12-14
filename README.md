# Handi-Talky Station

This is a Amateur Radio (HAM Radio) tool for the UV-Pro, GA-5WB, VR-N76, VR-N7500, VR-N7600 radios.

![image](https://raw.githubusercontent.com/Ylianst/HTCommanderStation/refs/heads/main/docs/images/HtCommanderStation.png?raw=true)

This is a base station software build in NodeJS that is tested to run on a Raspberry Pi and pairs to the radio over Bluetooth. Once setup, the software will offer various automated services. It's current main feature is that is act as a integrationt to Home Assistant so you can control your radio from the Home Assistant dashboard.

### Radio Support

The following radios should work with this application:

- BTech UV-Pro
- RadioOddity GA-5WB (untested)
- Vero VR-N76 (untested)
- Vero VR-N7500 (untested)
- Vero VR-N7600 (untested)

### Features

- **Home Assistant Integration** - Control the region, VFO1 and VFO2 channels, volume, squelch, scan mode, dual-watch mode, see the battery state and more.
- **Packet BBS** - Run a bulletin board system for packet radio users to share messages, download files, and play games.
- **WinLink Server** - Local WinLink message exchange (currently local only, no cloud relay).
- **Echo Server** - Test and debug packet radio connections by echoing back transmitted data.
- **APRS Support** - Send and receive APRS messages with authentication support.
- **Web Dashboard** - Browser-based interface for real-time monitoring and management.
- **File Downloads** - Serve files over packet radio using YAPP protocol.
- **Interactive Games** - Guess the Number, Blackjack, and Joke of the Day games over BBS.

## Documentation

### Getting Started
- [Quick Setup Guide](docs/quicksetup.md) - **Get up and running in 10 minutes!**

### Configuration
- [Configuration Guide](docs/config.md) - Complete config.ini reference
- [Bluetooth Setup](docs/bluetoothhelp.md) - Pairing Bluetooth devices on Raspberry Pi

### Services
- [BBS Guide](docs/bbs.md) - Bulletin Board System features and commands
- [Echo Server Guide](docs/echoserver.md) - Testing and debugging with echo server
- [WinLink Guide](docs/winlink.md) - WinLink server configuration and usage

### Integration & Monitoring
- [Web Interface Guide](docs/webpage.md) - Using the web dashboard
- [Home Assistant Integration](docs/homeassistant.md) - MQTT setup and automations
- [Authentication Guide](docs/authentication.md) - APRS message authentication setup

### Credits

This tool is based on the decoding work done by Kyle Husmann, KC3SLD and this [BenLink](https://github.com/khusmann/benlink) project which decoded the Bluetooth commands for these radios.
