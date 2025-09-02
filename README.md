# Handi-Talky Commander Station

This is a Amateur Radio (HAM Radio) tool for the UV-Pro, GA-5WB, VR-N76, VR-N7500, VR-N7600 radios.

This is a base station software build in NodeJS that is tested to run on a Raspberry Pi and pairs to the radio over Bluetooth. Once setup, the software will offer various automated services.

### Radio Support

The following radios should work with this application:

- BTech UV-Pro
- RadioOddity GA-5WB (untested)
- Vero VR-N76 (untested)
- Vero VR-N7500 (untested)
- Vero VR-N7600 (untested)

### Features

No features yet, this is early work. It currently pairs with the radio and get the radio state, channels and TNC frames.

### Credits

This tool is based on the decoding work done by Kyle Husmann, KC3SLD and this [BenLink](https://github.com/khusmann/benlink) project which decoded the Bluetooth commands for these radios.