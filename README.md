# Handi-Talky Commander Station

This is a Amateur Radio (HAM Radio) tool for the UV-Pro, GA-5WB, VR-N76, VR-N7500, VR-N7600 radios.

![image]([https://github.com/Ylianst/HTCommander/blob/main/docs/images/th-commander-4.png?raw=true](https://raw.githubusercontent.com/Ylianst/HTCommanderStation/refs/heads/main/docs/images/HtCommanderStation.png))

This is a base station software build in NodeJS that is tested to run on a Raspberry Pi and pairs to the radio over Bluetooth. Once setup, the software will offer various automated services. It's current main feature is that is act as a integrationt to Home Assistant so you can control your radio from the Home Assistant dashboard.

### Radio Support

The following radios should work with this application:

- BTech UV-Pro
- RadioOddity GA-5WB (untested)
- Vero VR-N76 (untested)
- Vero VR-N7500 (untested)
- Vero VR-N7600 (untested)

### Features

- Home Assistant Integration. Control the region, VFO1 and VFO2 channels, volume, squelsh, scan mode, dual-watch mode, see the battery state and more.

### Credits

This tool is based on the decoding work done by Kyle Husmann, KC3SLD and this [BenLink](https://github.com/khusmann/benlink) project which decoded the Bluetooth commands for these radios.
