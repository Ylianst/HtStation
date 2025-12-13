# Bluetooth Pairing Guide for Raspberry Pi

HtStation requires a Bluetooth connection to your radio (UV-Pro, GA-5WB, VR-N76, VR-N7500, or VR-N7600). Follow these steps to pair your device:

## Prerequisites

1. Ensure your Raspberry Pi has Bluetooth capability
2. Your radio should be powered on and Bluetooth enabled
3. Have your radio within range (typically 10 meters)

## Step 1: Enable Bluetooth Service

Ensure Bluetooth service is running on your Raspberry Pi:

```bash
sudo systemctl start bluetooth
sudo systemctl enable bluetooth
```

## Step 2: Start bluetoothctl

Launch the Bluetooth control utility:

```bash
bluetoothctl
```

You should see a prompt like: `[bluetooth]#`

## Step 3: Prepare for Pairing

At the bluetoothctl prompt, enter these commands:

```
power on              # Turn on Bluetooth adapter
agent on              # Enable pairing agent
default-agent         # Set as default agent
scan on               # Start scanning for devices
```

## Step 4: Identify Your Radio

Watch the scan results for your radio. It may appear as:
- "UV-Pro"
- "GA-5WB"
- "VR-N76" / "VR-N7500" / "VR-N7600"
- Or a generic Bluetooth name

Note the MAC address shown (format: XX:XX:XX:XX:XX:XX)

**Example:** `[NEW] Device 38:D2:00:00:EF:24 UV-Pro`

## Step 5: Pair the Device

Once you see your radio, pair it (replace with your MAC address):

```
pair 38:D2:00:00:EF:24
```

If prompted for a PIN, try these common values:
- 0000
- 1234
- Or check your radio's documentation

## Step 6: Trust the Device

Mark the device as trusted for automatic reconnection:

```
trust 38:D2:00:00:EF:24
```

## Step 7: Connect (Optional)

You can test the connection now (HtStation will connect automatically):

```
connect 38:D2:00:00:EF:24
```

## Step 8: Exit bluetoothctl

Stop scanning and exit:

```
scan off
exit
```

## Step 9: Configure HtStation

Edit the `config.ini` file and set your radio's MAC address:

```bash
nano config.ini
```

Uncomment and update the MACADDRESS line:

```ini
MACADDRESS=38:D2:00:00:EF:24
```

Save the file (CTRL+O, ENTER, CTRL+X in nano)

## Step 10: Start HtStation

Launch HtStation to test the connection:

```bash
node htstation.js --run
```

You should see Bluetooth connection messages in the console.

## Troubleshooting

### Device not appearing in scan:
- Ensure radio Bluetooth is enabled
- Move radio closer to Raspberry Pi
- Restart radio and try scanning again
- Try: `sudo systemctl restart bluetooth`

### Pairing fails:
- Try different PIN codes (0000, 1234, 1111)
- Remove existing pairing: `remove <MAC_ADDRESS>`
- Restart Bluetooth: `sudo systemctl restart bluetooth`

### Connection drops frequently:
- Check for interference from other devices
- Ensure radio has sufficient battery
- Update Raspberry Pi: `sudo apt update && sudo apt upgrade`

### HtStation cannot connect:
- Verify MAC address in config.ini matches paired device
- Ensure device is trusted: `bluetoothctl trust <MAC_ADDRESS>`
- Check if bluetooth-serial-port module is installed:
  ```bash
  npm install bluetooth-serial-port
  ```

## Useful Commands

```bash
bluetoothctl devices           # List paired devices
bluetoothctl info <MAC>        # Show device details
bluetoothctl remove <MAC>      # Remove pairing
sudo systemctl status bluetooth # Check Bluetooth service
hcitool scan                   # Alternative scan method
```

## Additional Resources

- [Raspberry Pi Bluetooth Guide](https://www.raspberrypi.com/documentation/computers/configuration.html#bluetooth)
- [HtStation Documentation](https://github.com/Ylianst/HtStation)
