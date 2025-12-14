# Web Interface Guide

![image](https://raw.githubusercontent.com/Ylianst/HTCommanderStation/refs/heads/main/docs/images/HtWebPage.png?raw=true)

This guide explains how to configure, access, and use the HtStation web interface for monitoring and managing your packet radio station.

## What is the Web Interface?

The HtStation web interface is a browser-based dashboard that provides:
- **Real-time monitoring** - Live view of radio connections and activity
- **Station management** - Control BBS bulletins and WinLink mail
- **APRS tracking** - View received APRS messages on a map
- **Connection history** - Review past BBS connections and statistics
- **System status** - Monitor uptime, resource usage, and configuration

No additional software required - just a web browser on any device connected to your network.

## Configuration

### Enable Web Server

The web server is enabled by default. Edit your `config.ini` file:

```ini
# Web server configuration
WEBSERVERPORT=8089
```

### Configuration Options

#### WEBSERVERPORT
- **Type:** Integer (1-65535)
- **Required:** No (default: 8089)
- **Description:** TCP port for the web interface

```ini
WEBSERVERPORT=8089    # Web interface at http://your-pi:8089
```

**Common port choices:**
- `8089` - Default HtStation port
- `8080` - Common alternative HTTP port
- `3000` - Common Node.js development port
- `80` - Standard HTTP (requires root/sudo)

### Restart to Apply Changes

After modifying the port:

```bash
# Console mode
Press CTRL+C, then: node htstation.js --run

# Service mode
sudo systemctl restart htstation
```

## Accessing the Web Interface

### From Same Machine (Raspberry Pi)

Open a browser and navigate to:
```
http://localhost:8089
```

### From Local Network

1. **Find your Raspberry Pi's IP address:**
   ```bash
   hostname -I
   ```
   Example output: `192.168.1.100`

2. **Open browser on any network device:**
   ```
   http://192.168.1.100:8089
   ```

### From Remote Network (Advanced)

To access from outside your local network:

1. **Set up port forwarding** on your router
   - Forward external port (e.g., 8089) to Raspberry Pi IP
   - External port → 192.168.1.100:8089

2. **Find your public IP:**
   ```
   http://whatismyip.com
   ```

3. **Access remotely:**
   ```
   http://your-public-ip:8089
   ```

⚠️ **Security Warning:** Exposing your web interface to the internet without authentication is not recommended. Consider using a VPN instead.