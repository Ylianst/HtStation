// Global variables
let ws = null;
let autoRefresh = true;
let reconnectAttempts = 0;
const maxReconnectAttempts = 5;
let currentView = 'overview';
let sessionTerminals = new Map(); // Track terminal instances for each session

// Initialize the application when DOM is loaded
document.addEventListener('DOMContentLoaded', function() {
    initializeWebSocket();
    setupEventListeners();
    setupNavigation();
});

function setupEventListeners() {
    // Auto-refresh toggle
    const autoRefreshBtn = document.getElementById('auto-refresh-btn');
    if (autoRefreshBtn) {
        autoRefreshBtn.addEventListener('click', toggleAutoRefresh);
    }
    
    // Manual refresh button
    const refreshBtn = document.getElementById('refresh-btn');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', refreshData);
    }
}

function setupNavigation() {
    // Setup navigation click handlers
    const navItems = document.querySelectorAll('.nav-item');
    navItems.forEach(item => {
        item.addEventListener('click', function(e) {
            e.preventDefault();
            const viewName = this.getAttribute('data-view');
            switchView(viewName);
        });
    });
}

function switchView(viewName) {
    console.log('Switching to view:', viewName);
    
    // Update current view
    currentView = viewName;
    
    // Update navigation active state
    const navItems = document.querySelectorAll('.nav-item');
    navItems.forEach(item => {
        item.classList.remove('active');
        if (item.getAttribute('data-view') === viewName) {
            item.classList.add('active');
        }
    });
    
    // Hide all content views
    const contentViews = document.querySelectorAll('.content-view');
    contentViews.forEach(view => {
        view.classList.remove('active');
    });
    
    // Show selected view
    const targetView = document.getElementById(`view-${viewName}`);
    if (targetView) {
        targetView.classList.add('active');
    }
    
    // Refresh data for the current view
    refreshCurrentViewData();
}

function refreshCurrentViewData() {
    // Request fresh data when switching views or refreshing
    if (ws && ws.readyState === WebSocket.OPEN) {
        sendMessage({ type: 'refresh_data' });
    }
}

function initializeWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}`;
    
    updateConnectionStatus('connecting');
    
    try {
        ws = new WebSocket(wsUrl);
        
        ws.onopen = function(event) {
            console.log('WebSocket connected');
            updateConnectionStatus('connected');
            reconnectAttempts = 0;
            
            // Request initial data
            sendMessage({ type: 'get_initial_data' });
        };
        
        ws.onmessage = function(event) {
            try {
                const data = JSON.parse(event.data);
                handleWebSocketMessage(data);
            } catch (error) {
                console.error('Error parsing WebSocket message:', error);
            }
        };
        
        ws.onclose = function(event) {
            console.log('WebSocket disconnected');
            updateConnectionStatus('disconnected');
            
            // Attempt to reconnect
            if (reconnectAttempts < maxReconnectAttempts) {
                setTimeout(() => {
                    reconnectAttempts++;
                    console.log(`Attempting to reconnect (${reconnectAttempts}/${maxReconnectAttempts})`);
                    initializeWebSocket();
                }, 2000 * reconnectAttempts); // Exponential backoff
            }
        };
        
        ws.onerror = function(error) {
            console.error('WebSocket error:', error);
            updateConnectionStatus('disconnected');
        };
        
    } catch (error) {
        console.error('Failed to create WebSocket connection:', error);
        updateConnectionStatus('disconnected');
    }
}

function handleWebSocketMessage(data) {
    console.log('Received WebSocket message:', data.type, data);
    updateLastUpdate();
    
    switch (data.type) {
        case 'system_status':
            console.log('Processing system_status:', data);
            updateSystemStatus(data);
            break;
        case 'current_connection':
            console.log('Processing current_connection:', data.connections ? data.connections.length : 0, 'connections');
            updateCurrentConnections(data.connections);
            break;
        case 'bbs_connections':
            console.log('Processing bbs_connections:', data.connections ? data.connections.length : 0, 'connections');
            updateBbsConnections(data.connections);
            break;
        case 'aprs_messages':
            console.log('Processing aprs_messages:', data.messages ? data.messages.length : 0, 'messages');
            updateAprsMessages(data.messages);
            break;
        case 'connection_update':
            // Handle real-time connection updates
            console.log('Connection update:', data);
            break;
        case 'session_data':
            // Handle real-time session data
            console.log('Session data:', data);
            handleSessionData(data);
            break;
        case 'aprs_message':
            // Handle real-time APRS message
            console.log('New APRS message:', data);
            break;
        case 'bulletins':
            console.log('Processing bulletins:', data.bulletins ? data.bulletins.length : 0, 'bulletins');
            updateBulletins(data.bulletins);
            break;
        default:
            console.log('Unknown message type:', data.type);
    }
}

function updateSystemStatus(data) {
    // Update station callsign in sidebar
    const stationCallsign = document.getElementById('station-callsign');
    if (stationCallsign) {
        stationCallsign.textContent = `${data.callsign}-${data.stationId}`;
    }
    
    // Update radio status in title bar
    const radioStatus = document.getElementById('radio-status');
    if (radioStatus) {
        radioStatus.textContent = data.radioConnected ? 'Connected' : 'Disconnected';
        radioStatus.className = 'status ' + (data.radioConnected ? 'connected' : 'disconnected');
    }
    
    // Update app uptime in sidebar
    const appUptime = document.getElementById('app-uptime');
    if (appUptime) {
        appUptime.textContent = data.appUptime;
    }
    
    // Update active connections count in sidebar
    const activeConnections = document.getElementById('active-connections');
    if (activeConnections) {
        activeConnections.textContent = data.activeConnections;
    }
    
    // Update overview status elements
    const overviewRadioStatus = document.getElementById('overview-radio-status');
    if (overviewRadioStatus) {
        overviewRadioStatus.textContent = data.radioConnected ? 'Connected' : 'Disconnected';
        overviewRadioStatus.className = 'status ' + (data.radioConnected ? 'connected' : 'disconnected');
    }
    
    const overviewUptime = document.getElementById('overview-uptime');
    if (overviewUptime) {
        overviewUptime.textContent = data.appUptime;
    }
    
    const overviewActive = document.getElementById('overview-active');
    if (overviewActive) {
        overviewActive.textContent = data.activeConnections;
    }
}

function updateCurrentConnections(connections) {
    const container = document.getElementById('current-connections');
    const overviewContainer = document.getElementById('overview-current-connections');
    
    // For the main "Current Connections" view, we'll only show terminals
    // So we just clear the connection list container
    if (container) {
        if (!connections || connections.length === 0) {
            container.innerHTML = '<div class="no-data">No active connections</div>';
        } else {
            container.innerHTML = ''; // Clear the list, terminals will be shown below
        }
    }
    
    // For overview, still show the compact connection list
    let overviewHtml = '';
    if (!connections || connections.length === 0) {
        overviewHtml = '<div class="no-data">No active connections</div>';
    } else {
        connections.forEach(conn => {
            const stateText = getStateText(conn.state);
            overviewHtml += `
                <div class="connection-item">
                    <div>
                        <div class="connection-callsign">${escapeHtml(conn.callsign)}</div>
                        <div class="connection-details">
                            State: ${escapeHtml(stateText)} | 
                            Menu: ${escapeHtml(conn.menuState)}
                        </div>
                    </div>
                    <div class="connection-duration">${escapeHtml(conn.duration || '--')}</div>
                </div>
            `;
        });
    }
    
    if (overviewContainer) overviewContainer.innerHTML = overviewHtml;
    
    // Update terminal management
    updateTerminalManagement(connections);
}

function updateBbsConnections(connections) {
    const container = document.getElementById('bbs-connections');
    const overviewContainer = document.getElementById('overview-recent-activity');
    
    if (!container) return;
    
    if (!connections || connections.length === 0) {
        container.innerHTML = '<div class="no-data">No recent connections</div>';
        if (overviewContainer) {
            overviewContainer.innerHTML = '<div class="no-data">No recent activity</div>';
        }
        return;
    }
    
    // Full table for main view with session statistics
    let html = `
        <table class="data-table">
            <thead>
                <tr>
                    <th>Callsign</th>
                    <th>Date/Time</th>
                    <th>Duration</th>
                    <th>Packets (S/R)</th>
                    <th>Bytes (S/R)</th>
                </tr>
            </thead>
            <tbody>
    `;
    
    connections.forEach(conn => {
        const duration = conn.connectionDuration ? `${conn.connectionDuration}s` : '--';
        const packetStats = (conn.packetsSent || conn.packetsReceived) ? 
            `${conn.packetsSent || 0}/${conn.packetsReceived || 0}` : '--';
        const byteStats = (conn.bytesSent || conn.bytesReceived) ? 
            `${conn.bytesSent || 0}/${conn.bytesReceived || 0}` : '--';
        
        html += `
            <tr>
                <td class="connection-callsign">${escapeHtml(conn.callsign)}</td>
                <td>${escapeHtml(conn.localTime)}</td>
                <td>${duration}</td>
                <td>${packetStats}</td>
                <td>${byteStats}</td>
            </tr>
        `;
    });
    
    html += '</tbody></table>';
    container.innerHTML = html;
    
    // Compact view for overview (last 5 connections)
    if (overviewContainer) {
        let overviewHtml = '';
        const recentConnections = connections.slice(0, 5); // Show only last 5
        
        recentConnections.forEach(conn => {
            const timeAgo = getTimeAgo(conn.timestamp || conn.localTime);
            overviewHtml += `
                <div class="connection-item" style="margin: 5px 0; padding: 8px; font-size: 12px;">
                    <div>
                        <div class="connection-callsign" style="font-size: 13px;">${escapeHtml(conn.callsign)}</div>
                        <div class="connection-details" style="font-size: 11px;">Connected ${timeAgo}</div>
                    </div>
                </div>
            `;
        });
        
        if (overviewHtml) {
            overviewContainer.innerHTML = overviewHtml;
        } else {
            overviewContainer.innerHTML = '<div class="no-data">No recent activity</div>';
        }
    }
}

function updateAprsMessages(messages) {
    const container = document.getElementById('aprs-messages');
    if (!container) return;
    
    if (!messages || messages.length === 0) {
        container.innerHTML = '<div class="no-data">No APRS messages received</div>';
        return;
    }
    
    let html = '';
    messages.forEach(msg => {
        const time = formatTime(msg.localTime || msg.timestamp);
        const messageText = truncateText(msg.message, 50);
        const dataType = msg.dataType || 'Message';
        
        // Add CSS class based on data type for styling
        const typeClass = dataType.toLowerCase().replace(/[^a-z]/g, '');
        
        html += `
            <div class="aprs-message aprs-${typeClass}">
                <div class="aprs-source">${escapeHtml(msg.source)}</div>
                <div class="aprs-destination">${escapeHtml(msg.destination)}</div>
                <div class="aprs-type">${escapeHtml(dataType)}</div>
                <div class="aprs-text">${escapeHtml(messageText)}</div>
                <div class="aprs-time">${escapeHtml(time)}</div>
            </div>
        `;
    });
    
    container.innerHTML = html;
}

function updateBulletins(bulletins) {
    const container = document.getElementById('bulletins');
    if (!container) return;
    
    if (!bulletins || bulletins.length === 0) {
        container.innerHTML = '<div class="no-data">No active bulletins</div>';
        return;
    }
    
    let html = '';
    bulletins.forEach((bulletin, index) => {
        const postedTime = formatTime(bulletin.postedTimeLocal || bulletin.postedTime);
        const expireTime = formatTime(bulletin.expireTimeLocal || bulletin.expireTime);
        
        // Calculate days remaining
        const now = new Date();
        const expireDate = new Date(bulletin.expireTime);
        const daysRemaining = Math.ceil((expireDate - now) / (1000 * 60 * 60 * 24));
        
        // Determine status color based on days remaining
        let statusClass = 'bulletin-active';
        if (daysRemaining <= 1) {
            statusClass = 'bulletin-expiring';
        } else if (daysRemaining <= 3) {
            statusClass = 'bulletin-warning';
        }
        
        html += `
            <div class="bulletin-item ${statusClass}">
                <div class="bulletin-header">
                    <div class="bulletin-info">
                        <span class="bulletin-id">#${bulletin.id}</span>
                        <span class="bulletin-callsign">${escapeHtml(bulletin.callsign)}</span>
                    </div>
                    <div class="bulletin-status">
                        <span class="days-remaining">${daysRemaining} day${daysRemaining !== 1 ? 's' : ''} left</span>
                    </div>
                </div>
                <div class="bulletin-message">${escapeHtml(bulletin.message)}</div>
                <div class="bulletin-footer">
                    <div class="bulletin-times">
                        <div class="posted-time">Posted: ${postedTime}</div>
                        <div class="expire-time">Expires: ${expireTime}</div>
                    </div>
                </div>
            </div>
        `;
    });
    
    container.innerHTML = html;
}

function updateConnectionStatus(status) {
    const wsStatus = document.getElementById('ws-status');
    if (wsStatus) {
        wsStatus.textContent = status.charAt(0).toUpperCase() + status.slice(1);
        wsStatus.className = 'status ' + status;
    }
}

function updateLastUpdate() {
    const lastUpdate = document.getElementById('last-update');
    if (lastUpdate) {
        const now = new Date();
        lastUpdate.textContent = now.toLocaleTimeString();
    }
}

function sendMessage(message) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(message));
    } else {
        console.warn('WebSocket not connected, cannot send message');
    }
}

function refreshData() {
    console.log('Manually refreshing data');
    sendMessage({ type: 'refresh_data' });
    
    // Visual feedback
    const refreshBtn = document.getElementById('refresh-btn');
    if (refreshBtn) {
        refreshBtn.disabled = true;
        refreshBtn.textContent = 'Refreshing...';
        setTimeout(() => {
            refreshBtn.disabled = false;
            refreshBtn.textContent = 'Refresh Data';
        }, 2000);
    }
}

function toggleAutoRefresh() {
    autoRefresh = !autoRefresh;
    const autoRefreshBtn = document.getElementById('auto-refresh-btn');
    if (autoRefreshBtn) {
        autoRefreshBtn.textContent = `Auto-Refresh: ${autoRefresh ? 'ON' : 'OFF'}`;
        autoRefreshBtn.style.backgroundColor = autoRefresh ? '#004400' : '#440000';
        autoRefreshBtn.style.borderColor = autoRefresh ? '#00ff00' : '#ff4444';
    }
    
    console.log('Auto-refresh', autoRefresh ? 'enabled' : 'disabled');
}

// Utility functions
function getStateText(state) {
    // Convert numeric state to readable text
    // Based on AX25Session.ConnectionState constants
    switch (parseInt(state)) {
        case 1:
            return 'Disconnected';
        case 2:
            return 'Connected';
        case 3:
            return 'Connecting';
        case 4:
            return 'Disconnecting';
        default:
            return 'Unknown';
    }
}

function escapeHtml(text) {
    if (typeof text !== 'string') return text;
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function truncateText(text, maxLength) {
    if (typeof text !== 'string') return text;
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength - 3) + '...';
}

function formatTime(timeString) {
    if (!timeString) return '--';
    
    try {
        // Try to parse as ISO string first
        let date;
        if (timeString.includes('T')) {
            date = new Date(timeString);
        } else {
            // Assume it's already a formatted local time string
            return timeString;
        }
        
        if (isNaN(date.getTime())) {
            return timeString; // Return original if parsing failed
        }
        
        return date.toLocaleString('en-US', {
            month: '2-digit',
            day: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false
        });
    } catch (error) {
        console.warn('Error formatting time:', error);
        return timeString;
    }
}

function getTimeAgo(timeString) {
    if (!timeString) return 'unknown time';
    
    try {
        let date;
        if (timeString.includes('T')) {
            date = new Date(timeString);
        } else {
            // Try to parse local time string
            date = new Date(timeString);
        }
        
        if (isNaN(date.getTime())) {
            return 'unknown time';
        }
        
        const now = new Date();
        const diffMs = now.getTime() - date.getTime();
        const diffMinutes = Math.floor(diffMs / (1000 * 60));
        const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
        const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
        
        if (diffDays > 0) {
            return `${diffDays} day${diffDays !== 1 ? 's' : ''} ago`;
        } else if (diffHours > 0) {
            return `${diffHours} hour${diffHours !== 1 ? 's' : ''} ago`;
        } else if (diffMinutes > 0) {
            return `${diffMinutes} minute${diffMinutes !== 1 ? 's' : ''} ago`;
        } else {
            return 'just now';
        }
    } catch (error) {
        console.warn('Error calculating time ago:', error);
        return 'unknown time';
    }
}

// Auto-refresh functionality
setInterval(() => {
    if (autoRefresh && ws && ws.readyState === WebSocket.OPEN) {
        sendMessage({ type: 'refresh_data' });
    }
}, 30000); // Refresh every 30 seconds

// Handle page visibility changes
document.addEventListener('visibilitychange', function() {
    if (document.visibilityState === 'visible' && autoRefresh) {
        // Page became visible, refresh data
        setTimeout(() => {
            if (ws && ws.readyState === WebSocket.OPEN) {
                sendMessage({ type: 'refresh_data' });
            }
        }, 1000);
    }
});

// Session Terminal Management Functions
function handleSessionData(data) {
    const { sessionKey, direction, data: sessionDataText, timestamp } = data;
    
    // Ensure terminal exists for this session
    createOrUpdateTerminal(sessionKey);
    
    // Add data to terminal
    addDataToTerminal(sessionKey, direction, sessionDataText, timestamp);
}

function createOrUpdateTerminal(sessionKey, connectionInfo = null) {
    const terminalsContainer = document.getElementById('session-terminals');
    if (!terminalsContainer) return;
    
    // Check if terminal already exists
    if (sessionTerminals.has(sessionKey)) {
        // Update existing terminal header if connection info provided
        if (connectionInfo) {
            updateTerminalHeader(sessionKey, connectionInfo);
        }
        return; // Terminal already exists
    }
    
    // Create new terminal container
    const terminalContainer = document.createElement('div');
    terminalContainer.className = 'terminal-container';
    terminalContainer.id = `terminal-${sessionKey}`;
    
    // Create terminal header
    const terminalHeader = document.createElement('div');
    terminalHeader.className = 'terminal-header';
    terminalHeader.id = `terminal-header-${sessionKey}`;
    
    // Set initial header content
    updateTerminalHeaderContent(terminalHeader, sessionKey, connectionInfo);
    
    // Create terminal body
    const terminalBody = document.createElement('div');
    terminalBody.className = 'terminal-body auto-scroll';
    terminalBody.id = `terminal-body-${sessionKey}`;
    
    // Assemble terminal
    terminalContainer.appendChild(terminalHeader);
    terminalContainer.appendChild(terminalBody);
    terminalsContainer.appendChild(terminalContainer);
    
    // Store terminal reference
    sessionTerminals.set(sessionKey, {
        container: terminalContainer,
        header: terminalHeader,
        body: terminalBody,
        autoScroll: true,
        lineCount: 0
    });
    
    // Add scroll event listener for auto-scroll detection
    terminalBody.addEventListener('scroll', () => {
        const terminal = sessionTerminals.get(sessionKey);
        if (terminal) {
            const isAtBottom = terminalBody.scrollTop + terminalBody.clientHeight >= terminalBody.scrollHeight - 5;
            terminal.autoScroll = isAtBottom;
            
            // Update visual indicator
            if (isAtBottom) {
                terminalBody.classList.add('auto-scroll');
            } else {
                terminalBody.classList.remove('auto-scroll');
            }
        }
    });
    
    console.log(`Created terminal for session: ${sessionKey}`);
}

function updateTerminalHeader(sessionKey, connectionInfo) {
    const terminal = sessionTerminals.get(sessionKey);
    if (terminal && terminal.header) {
        updateTerminalHeaderContent(terminal.header, sessionKey, connectionInfo);
    }
}

function updateTerminalHeaderContent(headerElement, sessionKey, connectionInfo) {
    let stateText = 'Unknown';
    let menuText = 'unknown';
    let durationText = '--';
    
    if (connectionInfo) {
        stateText = getStateText(connectionInfo.state);
        menuText = connectionInfo.menuState || 'unknown';
        durationText = connectionInfo.duration || '--';
    }
    
    headerElement.innerHTML = `
        <span>${escapeHtml(sessionKey)} - State: ${escapeHtml(stateText)} | Menu: ${escapeHtml(menuText)}</span>
        <div class="terminal-info">
            <span>Duration: ${escapeHtml(durationText)}</span>
            <span id="terminal-status-${sessionKey}">Active</span>
        </div>
    `;
}

function addDataToTerminal(sessionKey, direction, dataText, timestamp) {
    const terminal = sessionTerminals.get(sessionKey);
    if (!terminal) return;
    
    const terminalBody = terminal.body;
    
    // Create terminal line
    const line = document.createElement('div');
    line.className = `terminal-line ${direction}`;
    
    // Format timestamp
    const time = new Date(timestamp).toLocaleTimeString('en-US', { 
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    });
    
    // Create line content with timestamp and data
    const timestampSpan = document.createElement('span');
    timestampSpan.className = 'terminal-timestamp';
    timestampSpan.textContent = `[${time}]`;
    
    const dataSpan = document.createElement('span');
    
    // Process the data text to handle special characters and formatting
    let processedText = dataText;
    
    // Convert \r\n to proper line breaks and handle other escape sequences
    processedText = processedText
        .replace(/\\r\\n/g, '\n')
        .replace(/\\r/g, '\n')
        .replace(/\\n/g, '\n')
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n');
    
    // Add direction indicator
    const directionIndicator = direction === 'sent' ? '→ ' : '← ';
    dataSpan.textContent = directionIndicator + processedText;
    
    line.appendChild(timestampSpan);
    line.appendChild(dataSpan);
    
    // Add line to terminal
    terminalBody.appendChild(line);
    
    // Increment line count and manage terminal size
    terminal.lineCount++;
    
    // Keep only last 500 lines to prevent memory issues
    if (terminal.lineCount > 500) {
        const firstLine = terminalBody.firstChild;
        if (firstLine) {
            terminalBody.removeChild(firstLine);
            terminal.lineCount--;
        }
    }
    
    // Auto-scroll if enabled
    if (terminal.autoScroll) {
        setTimeout(() => {
            terminalBody.scrollTop = terminalBody.scrollHeight;
        }, 10);
    }
}

function updateTerminalManagement(connections) {
    const terminalsContainer = document.getElementById('session-terminals');
    if (!terminalsContainer) return;
    
    // Create a map for easy lookup of connection info by callsign
    const connectionMap = new Map();
    if (connections) {
        connections.forEach(conn => {
            connectionMap.set(conn.callsign, conn);
        });
    }
    
    // Get current active session keys
    const activeSessionKeys = new Set(connections ? connections.map(conn => conn.callsign) : []);
    
    // Remove terminals for disconnected sessions
    for (const [sessionKey, terminal] of sessionTerminals.entries()) {
        if (!activeSessionKeys.has(sessionKey)) {
            console.log(`Removing terminal for disconnected session: ${sessionKey}`);
            
            // Update terminal status
            const statusElement = document.getElementById(`terminal-status-${sessionKey}`);
            if (statusElement) {
                statusElement.textContent = 'Disconnected';
                statusElement.style.color = '#dc3545';
            }
            
            // Remove terminal after a delay to allow user to see final data
            setTimeout(() => {
                if (terminal.container && terminal.container.parentNode) {
                    terminal.container.parentNode.removeChild(terminal.container);
                }
                sessionTerminals.delete(sessionKey);
            }, 10000); // Keep for 10 seconds after disconnect
        }
    }
    
    // Create terminals for new sessions and update existing ones
    activeSessionKeys.forEach(sessionKey => {
        const connectionInfo = connectionMap.get(sessionKey);
        if (!sessionTerminals.has(sessionKey)) {
            createOrUpdateTerminal(sessionKey, connectionInfo);
        } else {
            // Update existing terminal header with current connection info
            updateTerminalHeader(sessionKey, connectionInfo);
        }
    });
}

// Handle window beforeunload
window.addEventListener('beforeunload', function() {
    if (ws) {
        ws.close();
    }
});
