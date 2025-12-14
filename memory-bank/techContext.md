# Technical Context: HtStation

## Technologies Used

### Core Technologies
- **Runtime**: Node.js 16+
- **Language**: JavaScript (ES6+)
- **Web Server**: Built-in Node.js HTTP server
- **Real-time Communication**: WebSocket (ws library)
- **File System**: Node.js fs module with synchronous and asynchronous operations

### Communication Protocols
- **AX.25**: Custom implementation for packet radio protocol
- **APRS**: Automatic Packet Reporting System implementation
- **BBS Protocol**: Custom BBS message handling
- **WinLink**: Radio email protocol implementation

### Development and Build Tools
- **Package Management**: npm
- **Code Quality**: ESLint for code linting and formatting
- **Version Control**: Git with GitHub repository
- **IDE**: Visual Studio Code with custom workspace configuration

### External Dependencies
```json
{
  "ws": "WebSocket library for real-time communication",
  "custom-radio-hardware": "Radio control interface (if applicable)"
}
```

## Development Setup

### System Requirements
- **Operating System**: Linux (tested on Ubuntu/Debian systems)
- **Node.js**: Version 16 or higher
- **RAM**: Minimum 512MB, recommended 1GB for stable operation
- **Storage**: 1GB free space for logs and message storage
- **Network**: TCP/IP networking for web interface and MQTT

### Installation Process
1. **Clone Repository**: `git clone https://github.com/Ylianst/HtStation.git`
2. **Install Dependencies**: `npm install`
3. **Configure Station**: Edit `config.ini` with station parameters
4. **Start Services**: `node src/htstation.js` (or `npm start`)

### Configuration Management
- **Primary Configuration**: `config.ini` file with station settings
- **Callsign**: Station identifier for packet radio operations
- **Station IDs**: Separate identifiers for BBS (1), Echo (2), WinLink (3)
- **Network Settings**: MQTT broker configuration for external monitoring
- **Authentication**: Multiple callsign/password combinations supported

## Technical Constraints

### Performance Limitations
- **File Storage**: JSON-based storage may have performance implications with large datasets
- **Memory Usage**: In-memory storage of active connections and messages
- **WebSocket Connections**: Multiple browser clients supported simultaneously
- **Radio Interface**: Dependent on stable radio hardware connection

### Scalability Considerations
- **Single Server Deployment**: Designed for single-station operation
- **Connection Limits**: WebSocket server handles multiple concurrent clients
- **Message Throughput**: Optimized for typical ham radio message volumes
- **Storage Growth**: Message history accumulates over time

### Reliability Requirements
- **Uptime Expectations**: 24/7 operation for emergency communications
- **Error Recovery**: Graceful handling of radio disconnections
- **Data Integrity**: Reliable message storage and retrieval
- **Network Resilience**: Operation during network outages (local radio)

## Tool Usage Patterns

### Development Workflow
1. **Code Editing**: Direct file modification with immediate testing
2. **Testing**: Manual testing through web interface and radio connections
3. **Debugging**: Console logging and web interface status monitoring
4. **Deployment**: Direct file updates with service restart

### Monitoring and Maintenance
- **Web Dashboard**: Primary interface for system monitoring
- **Log Files**: Console output for debugging and troubleshooting
- **Configuration Updates**: Edit config.ini and restart services
- **Data Management**: Web interface for bulletin and mail management

### Integration Points
- **MQTT Reporter**: External monitoring and home automation integration
- **Radio Hardware**: Serial or network connection to radio equipment
- **File System**: Structured storage in application directories
- **Network Services**: WebSocket clients and HTTP requests

## Deployment Architecture

### Service Organization
- **Main Application**: `src/htstation.js` coordinates all services
- **Web Server**: `src/webserver.js` handles HTTP and WebSocket connections
- **Protocol Handlers**: Separate modules for each communication protocol
- **Storage Layer**: Unified storage system for all data types

### Data Storage Structure
```
data/
├── bbs/                    # BBS-specific storage
├── winlink/               # WinLink email storage
├── aprs-messages.db       # APRS message storage
└── bulletins/             # BBS bulletin storage

src/
└── aprs/                  # APRS library and implementation
```

### Network Architecture
- **Web Interface**: HTTP + WebSocket on configurable port (default: 8089)
- **Radio Interface**: Serial connection to radio hardware
- **MQTT Integration**: Optional external monitoring and control
- **Local Network**: Support for radio.local hostname resolution
