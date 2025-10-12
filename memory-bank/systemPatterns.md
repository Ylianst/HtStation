# System Patterns: HtStation

## System Architecture

HtStation follows a modular, service-oriented architecture designed for reliability and maintainability in packet radio operations.

### Core Architecture Pattern
```
┌─────────────────────────────────────┐
│           HtStation Core            │
├─────────────────────────────────────┤
│  ┌─────────────┐ ┌─────────────┐    │
│  │   Radio     │ │  WebServer  │    │
│  │   Control   │ │   (Port     │    │
│  │             │ │    8089)    │    │
│  └─────────────┘ └─────────────┘    │
├─────────────────────────────────────┤
│  ┌─────────────┐ ┌─────────────┐    │
│  │     BBS     │ │   APRS      │    │
│  │   Server    │ │  Handler    │    │
│  └─────────────┘ └─────────────┘    │
├─────────────────────────────────────┤
│  ┌─────────────┐ ┌─────────────┐    │
│  │  WinLink    │ │   Storage   │    │
│  │   Server    │ │  System     │    │
│  └─────────────┘ └─────────────┘    │
└─────────────────────────────────────┘
```

### Key Technical Decisions

#### 1. Modular Service Design
- **Pattern**: Each major function (BBS, APRS, WinLink) is implemented as an independent service
- **Rationale**: Allows for independent scaling, testing, and maintenance of each communication protocol
- **Implementation**: Services communicate through well-defined interfaces and event systems

#### 2. WebSocket Real-time Communication
- **Pattern**: Server-Sent Events via WebSocket for live updates
- **Rationale**: Enables real-time monitoring of connections, messages, and system status
- **Implementation**: WebSocket server broadcasts system events to all connected web clients

#### 3. File-Based Storage with Structured Access
- **Pattern**: JSON-based storage with key-value access patterns
- **Rationale**: Simple, reliable storage that doesn't require external database dependencies
- **Implementation**: Structured storage classes with consistent interface for all data types

#### 4. Event-Driven Architecture
- **Pattern**: Publish-Subscribe model for inter-service communication
- **Rationale**: Loose coupling between services while maintaining real-time responsiveness
- **Implementation**: EventEmitter-based system for BBS session events, APRS messages, and system status

## Component Relationships

### Service Dependencies
- **WebServer** depends on all other services for data aggregation and display
- **BBS Server** operates independently but provides data to WebServer
- **APRS Handler** processes packets and forwards to BBS for storage
- **WinLink Server** manages email storage and transmission
- **Storage System** provides data persistence for all services

### Data Flow Patterns
1. **Packet Reception**: Radio → Protocol Handlers → Storage → WebSocket Broadcast
2. **Web Requests**: Browser → WebServer → Service Layer → Storage
3. **Real-time Updates**: Service Events → WebSocket → Browser Updates

## Critical Implementation Paths

### Connection Handling
```
Radio Packet → AX25Packet Parser → Session Manager → BBS Protocol Handler → Storage → WebSocket Event
```

### Message Processing
```
APRS Message → APRS Handler → Validation → BBS Storage → Bulletin Creation → WebSocket Broadcast
```

### Web Interface Updates
```
Service Event → Event Listener → Data Formatting → WebSocket Broadcast → Client Update
```

## Design Patterns in Use

### 1. Factory Pattern (Connection Management)
- BBS sessions created through factory method ensuring proper initialization
- Radio connections established with consistent configuration

### 2. Observer Pattern (Real-time Updates)
- WebSocket clients observe system events
- Services emit events for state changes

### 3. Strategy Pattern (Protocol Handling)
- Different protocols (BBS, APRS, WinLink) handled by specialized strategies
- Easy to add new communication protocols

### 4. Singleton Pattern (Configuration)
- Single configuration instance shared across all services
- Centralized station identity and settings management

## Error Handling Patterns

### Graceful Degradation
- Services continue operating even if individual components fail
- Web interface remains accessible even if radio hardware is disconnected

### Comprehensive Logging
- Structured logging for debugging and monitoring
- Error categorization for appropriate response strategies

### Resource Management
- Proper cleanup of network connections and file handles
- Memory leak prevention in long-running services
