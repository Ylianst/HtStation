# APRS Message Authentication Guide

This guide explains how HtStation implements message authentication for APRS communications, allowing you to verify that messages come from trusted sources.

## Understanding Ham Radio Authentication

### Why Authentication Matters

Amateur (ham) radio operates on open, unencrypted frequencies. **By law and regulation, you cannot encrypt messages on amateur radio bands.** However, you can verify that a message comes from a specific, trusted source using **message authentication**.

### What is Message Authentication?

Message authentication allows you to:
- **Verify the sender's identity** - Confirm a message actually came from the claimed sender
- **Detect tampering** - Know if a message was altered in transit
- **Trust automated actions** - Safely trigger Home Assistant automations from authenticated messages

### What Authentication Does NOT Do

Authentication is not encryption:
- **Messages remain readable** by anyone listening on the frequency
- **Content is public** as required by amateur radio regulations
- **Privacy is not provided** - don't send sensitive information

## How HtStation Authentication Works

HtStation uses **HMAC (Hash-based Message Authentication Code)** with pre-shared keys to authenticate APRS messages.

### Authentication Process

1. **Sender creates message** with content
2. **Sender calculates authentication code** using pre-shared key + message content
3. **Authentication code appended** to message (visible but not decryptable)
4. **Receiver gets message** with authentication code
5. **Receiver calculates** what the code should be using their copy of the key
6. **Codes match** → Message is authenticated ✓
7. **Codes don't match** → Message is rejected ✗

### Message Format

**Unauthenticated message:**
```
Hello World
```

**Authenticated message:**
```
Hello World{A1B2C3D4}
```

The authentication code `{A1B2C3D4}` is appended to verify the message, but the content "Hello World" remains readable by all stations.

## Configuring Authentication

### Step 1: Share Keys with Trusted Stations

**Important:** You must coordinate with other stations to establish pre-shared keys. This is done **off-band** (not over the radio):
- In person
- Phone call
- Email
- Secure messaging app
- At a club meeting

**Example conversation:**
```
You: "Hey, I want to set up authenticated APRS. Let's use the key 'MySecretKey123' for our messages."
Them: "Sounds good! I'll add that to my config."
```

### Step 2: Configure Authentication in config.ini

Add AUTH entries for each trusted station:

```ini
# Authentication entries
AUTH=N0CALL,MySecretKey123
AUTH=N0CALL-5,AnotherKey456
AUTH=W1AW,SharedKey789
AUTH=W1AW-9,MobileKey000
```

**Format:** `AUTH=CALLSIGN-SSID,password`

- **CALLSIGN-SSID:** The station's identifier (SSID is optional)
- **password:** The pre-shared key (case-sensitive)

### Step 3: Restart HtStation

Apply the configuration:

```bash
# Console mode
Press CTRL+C, then: node htstation.js --run

# Service mode
sudo systemctl restart htstation
```

## Using Authentication

### Sending Authenticated Messages

When you send an APRS message to a station for which you have a pre-shared key configured, HtStation automatically adds authentication:

**Your message:** `Testing authentication`

**Transmitted:** `Testing authentication{B7F8E9A1}`

The authentication code is automatically calculated and appended.

### Receiving Authenticated Messages

HtStation processes incoming APRS messages and checks authentication:

1. **Message arrives** addressed to your station
2. **Checks for authentication code** (e.g., `{B7F8E9A1}`)
3. **Looks up pre-shared key** for sender's callsign
4. **Calculates expected code** using the key
5. **Compares codes:**
   - **Match** → Message is authenticated ✓
   - **No match** → Authentication failed ✗
   - **No code** → Unauthenticated message

### Message Routing

HtStation routes messages to different MQTT topics based on authentication status:

| Authentication Status | MQTT Topic | Use Case |
|----------------------|------------|----------|
| **Authenticated (Trusted)** | `homeassistant/uvpro-radio/aprs_message_trusted` | Trusted messages that can trigger automations |
| **Unauthenticated (For You)** | `homeassistant/uvpro-radio/aprs_message` | Messages addressed to you from unknown stations |
| **Other Messages** | `homeassistant/uvpro-radio/aprs_message_other` | Messages addressed to other stations (monitoring) |

## Home Assistant Integration

### Trusted vs Untrusted Messages

In Home Assistant, you can create automations that respond differently based on authentication status:

#### Safe Automation (Authenticated Only)

```yaml
alias: Unlock Door on Authenticated APRS
description: Only unlock when message is authenticated
trigger:
  - platform: state
    entity_id: sensor.radio_aprs_message_trusted
condition:
  - condition: template
    value_template: "{{ 'UNLOCK' in trigger.to_state.state }}"
action:
  - service: lock.unlock
    target:
      entity_id: lock.front_door
  - service: notify.notify
    data:
      message: "Door unlocked by authenticated APRS from {{ state_attr('sensor.radio_aprs_message_trusted', 'from') }}"
```

#### Notification Only (Unauthenticated)

```yaml
alias: Notify on Unauthenticated APRS
description: Just notify, don't take action on unauthenticated messages
trigger:
  - platform: state
    entity_id: sensor.radio_aprs_message
action:
  - service: notify.notify
    data:
      message: "APRS from {{ state_attr('sensor.radio_aprs_message', 'from') }}: {{ states('sensor.radio_aprs_message') }}"
      title: Unauthenticated APRS
```

### Dashboard Separation

Create separate cards for trusted and untrusted messages:

```yaml
type: vertical-stack
cards:
  - type: entities
    title: Trusted APRS Messages
    entities:
      - entity: sensor.radio_aprs_message_trusted
        name: Authenticated Messages
    card_mod:
      style: |
        ha-card {
          border: 2px solid green;
        }
  
  - type: entities
    title: Unauthenticated APRS Messages
    entities:
      - entity: sensor.radio_aprs_message
        name: Unverified Messages
    card_mod:
      style: |
        ha-card {
          border: 2px solid orange;
        }
```

## Security Considerations

### Best Practices

1. **Use Strong Keys**
   - Minimum 12 characters
   - Mix letters, numbers, and symbols
   - Example: `Tr0ub4dor&3Plus!`

2. **Unique Keys per Station**
   - Don't reuse the same key for multiple stations
   - Each trusted station should have its own key

3. **Key Distribution Security**
   - **Never transmit keys over the radio** (violates regulations)
   - Share keys through secure off-band channels
   - Verify key exchange in person when possible

4. **Regular Key Rotation**
   - Change keys periodically (every 6-12 months)
   - Coordinate changes with all trusted stations
   - Keep a record of which keys are active

5. **Limit Trusted Stations**
   - Only authenticate stations you personally trust
   - Review AUTH entries regularly
   - Remove entries for inactive stations

### What Authentication Protects Against

✅ **Protected:**
- **Impersonation** - Someone pretending to be a trusted station
- **Message injection** - Fake messages triggering automations
- **Replay attacks** - Someone retransmitting old messages (with timestamp checking)
- **Tampering** - Modification of message content

❌ **Not Protected:**
- **Eavesdropping** - Anyone can read the message content
- **Traffic analysis** - Patterns of communication are visible
- **Denial of service** - Jamming or flooding the frequency

### Legal Compliance

Authentication is **legal and encouraged** in amateur radio:
- ✅ Authentication codes are not encryption
- ✅ Message content remains readable
- ✅ Complies with FCC Part 97 regulations
- ✅ Enhances security for automated systems

## Use Cases

### 1. Remote Emergency Actions

**Scenario:** You need to trigger emergency systems remotely

```ini
AUTH=N0CALL,EmergencyKey!2024
```

**Home Assistant Automation:**
```yaml
alias: Emergency Alert from Radio
trigger:
  - platform: state
    entity_id: sensor.radio_aprs_message_trusted
condition:
  - condition: template
    value_template: "{{ 'EMERGENCY' in trigger.to_state.state }}"
action:
  - service: script.emergency_protocol
  - service: notify.all_devices
    data:
      message: "EMERGENCY ALERT received via authenticated APRS"
      title: EMERGENCY
```

### 2. Home Automation Control

**Scenario:** Control lights, locks, and devices via APRS

```ini
AUTH=N0CALL-9,MobileControl789
```

**Commands:**
- `LIGHTS ON` → Turn on lights
- `GARAGE OPEN` → Open garage door
- `TEMP 72` → Set thermostat

### 3. Status Reporting

**Scenario:** Request status reports from home

```ini
AUTH=N0CALL,StatusKey456
```

**APRS Message:** `STATUS`

**Automation responds with:**
- Door lock states
- Alarm status
- Temperature readings
- Camera snapshots (via notification)

### 4. Multi-Station Coordination

**Scenario:** Multiple operators managing shared station

```ini
AUTH=N0CALL,AdminKey123
AUTH=N0CALL-1,OperatorKey456
AUTH=N0CALL-2,OperatorKey789
```

All operators can send authenticated commands, tracked by callsign.

### 5. Field Operations

**Scenario:** Mobile station needs to authenticate back to home base

```ini
# Home station config
AUTH=N0CALL-9,FieldKey2024

# Mobile station config
AUTH=N0CALL,HomeKey2024
```

Bidirectional authentication ensures both stations trust each other.

## Troubleshooting

### Authentication Always Fails

**Problem:** Messages never show as authenticated

**Solutions:**
1. Verify AUTH entry matches sender's exact callsign (including SSID)
2. Check key is exactly the same on both stations (case-sensitive)
3. Confirm sender is actually sending authenticated messages
4. Check HtStation logs for authentication attempts
5. Verify no extra spaces or characters in config.ini

### Wrong Topic in Home Assistant

**Problem:** Authenticated messages appear in wrong sensor

**Solutions:**
1. Verify message is addressed to your callsign
2. Check that authentication succeeded (look for authentication code in message)
3. Restart HtStation to reload AUTH entries
4. Verify MQTT_TOPIC is configured correctly

### Key Management Confusion

**Problem:** Lost track of which keys are assigned to which stations

**Solutions:**
1. Maintain a separate key management document (store securely)
2. Use descriptive comments in config.ini:
   ```ini
   # John's mobile station - added 2024-01-15
   AUTH=W1XYZ-9,MobileKey123
   
   # Sarah's home station - added 2024-02-20
   AUTH=K2ABC,HomeKey456
   ```
3. Include key creation date in the key itself:
   ```ini
   AUTH=N0CALL,Key2024Jan
   ```

### Authentication Code Not Visible

**Problem:** Can't see authentication codes in messages

**Solutions:**
1. Authentication codes are automatically added by HtStation
2. Check sender has your callsign configured in their AUTH entries
3. Use a terminal program to view raw APRS packets
4. Verify sender's HtStation is actually running

## Example Configuration

### Complete Authentication Setup

```ini
# Radio connection
MACADDRESS=38:D2:00:00:EF:24
CALLSIGN=N0CALL

# Services
BBS_STATION_ID=1
WINLINK_STATION_ID=3

# Web interface
WEBSERVERPORT=8089

# MQTT / Home Assistant
MQTT_BROKER_URL=mqtt://192.168.1.100:1883
MQTT_TOPIC=homeassistant/uvpro-radio
MQTT_USERNAME=btradio
MQTT_PASSWORD=myradio

# Authentication - Trusted stations with pre-shared keys
# Family members
AUTH=N0CALL,FamilyKey2024!
AUTH=N0CALL-9,MobileKey2024!

# Emergency services
AUTH=W1AW,EmergencyKey789

# Local ham club members
AUTH=K2XYZ,ClubKey456
AUTH=K2XYZ-5,ClubKey456Mobile

# Friend's stations
AUTH=N1ABC,FriendKey123
AUTH=N1ABC-7,FriendPortable999

# Logging
CONSOLEMSG=ALL
```

## Additional Resources

- [Configuration Guide](config.md) - Complete config.ini documentation
- [Home Assistant Integration](homeassistant.md) - MQTT setup and automations
- [FCC Part 97 Rules](https://www.ecfr.gov/current/title-47/chapter-I/subchapter-D/part-97) - Amateur radio regulations
- [APRS Specification](http://www.aprs.org/doc/APRS101.PDF) - APRS protocol details

## FAQ

**Q: Is authentication the same as encryption?**  
A: No. Authentication verifies the sender but doesn't hide the message content. Messages remain readable by all stations as required by amateur radio regulations.

**Q: Can I authenticate messages to any station?**  
A: Only stations you've configured with pre-shared keys. Both stations must have the same key configured for authentication to work.

**Q: What happens if someone guesses my key?**  
A: They could send authenticated messages as that station. Use strong, unique keys and share them only through secure off-band channels.

**Q: Do I need authentication for all APRS messages?**  
A: No. Authentication is optional and only needed for messages that trigger automated actions or require sender verification.

**Q: Can authenticated messages be received by stations without the key?**  
A: Yes. The message content is readable by all stations. Only stations with the correct key can verify the authentication.

**Q: How often should I change keys?**  
A: Every 6-12 months is recommended, or immediately if you suspect a key may be compromised. Coordinate changes with all trusted stations.
