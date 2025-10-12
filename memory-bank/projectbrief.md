# Project Brief: HtStation

## Core Requirements and Goals

HtStation is a comprehensive ham radio station management system designed for packet radio communications and digital radio operations.

### Primary Functions
- **BBS (Bulletin Board System)**: Packet radio messaging and bulletin management
- **APRS (Automatic Packet Reporting System)**: Position reporting and message handling
- **WinLink Mail**: Radio email system for emergency communications
- **Web Dashboard**: Real-time monitoring and management interface
- **Radio Control**: Integration with physical radio hardware

### Station Identity
- **Callsign**: KK7VZT
- **Station ID**: Multi-purpose station (BBS=1, Echo=2, WinLink=3)
- **Network**: MQTT integration for home automation and monitoring

### Key Features
1. **Real-time Web Interface** (Port 8089)
   - Live system monitoring
   - Active connection management
   - Bulletin board administration
   - WinLink mail management
   - APRS message display

2. **Multi-Protocol Support**
   - AX.25 packet radio protocol
   - BBS message handling
   - WinLink email over radio
   - APRS position and messaging

3. **Data Persistence**
   - Connection history tracking
   - Message archiving
   - Bulletin storage
   - Mail storage and organization

### Technical Architecture
- **Backend**: Node.js with modular architecture
- **Frontend**: HTML/CSS/JavaScript with WebSocket real-time updates
- **Communication**: WebSocket for real-time data streaming
- **Storage**: File-based storage with structured data management
- **Authentication**: Callsign-based authentication system

### Operational Goals
- Provide reliable packet radio communications
- Enable emergency communications via WinLink
- Support APRS tracking and messaging
- Offer web-based remote station management
- Maintain connection history and statistics
