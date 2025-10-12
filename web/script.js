// Global variables
let ws = null;
let autoRefresh = true;
let reconnectAttempts = 0;
const maxReconnectAttempts = 5;
let currentView = 'overview';
let sessionTerminals = new Map(); // Track terminal instances for each session

// Initialize the application when DOM is loaded
document.addEventListener('DOMContentLoaded', function() {
    showConnectingOverlay(); // Show connecting overlay initially
    initializeWebSocket();
    setupEventListeners();
    setupNavigation();

    // Load saved preferences after setup
    loadSavedPreferences();
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

    // Save current view to localStorage
    saveCurrentView(viewName);

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
    // Connect to the WebSocket server on the same host that served this page
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}`;
    
    updateConnectionStatus('connecting');
    
    try {
        ws = new WebSocket(wsUrl);
        
        ws.onopen = function(event) {
            console.log('WebSocket connected');
            updateConnectionStatus('connected');
            reconnectAttempts = 0;

            // Hide connecting overlay and show main content
            hideConnectingOverlay();

            // Restore saved preferences after connection
            restoreSavedPreferences();

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

            // Show connecting overlay when disconnected
            showConnectingOverlay();

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
        case 'bulletin_delete_result':
            console.log('Bulletin delete result:', data);
            handleBulletinDeleteResult(data);
            break;
        case 'bulletin_create_result':
            console.log('Bulletin create result:', data);
            handleBulletinCreateResult(data);
            break;
        case 'winlink_mails':
            console.log('Processing winlink_mails:', data.mails);
            updateWinlinkMails(data.mails);
            break;
        case 'mail_delete_result':
            console.log('Mail delete result:', data);
            handleMailDeleteResult(data);
            break;
        case 'mail_compose_result':
            console.log('Mail compose result:', data);
            handleMailComposeResult(data);
            break;
        default:
            console.log('Unknown message type:', data.type);
    }
}

// Global mail state
let winlinkMails = { inbox: [], outbox: [], draft: [], sent: [], archive: [], trash: [] };
let currentMailFolder = 'inbox';
let selectedMailMid = null;

// WinLink Mail Functions
function updateWinlinkMails(mails) {
    console.log('Updating WinLink mails:', mails);
    winlinkMails = mails;
    
    // Update folder counts with sizes
    document.getElementById('inbox-count').textContent = mails.inbox ? mails.inbox.length : 0;
    document.getElementById('outbox-count').textContent = mails.outbox ? mails.outbox.length : 0;
    document.getElementById('draft-count').textContent = mails.draft ? mails.draft.length : 0;
    document.getElementById('sent-count').textContent = mails.sent ? mails.sent.length : 0;
    document.getElementById('archive-count').textContent = mails.archive ? mails.archive.length : 0;
    document.getElementById('trash-count').textContent = mails.trash ? mails.trash.length : 0;
    
    // Refresh mail list if on mail view
    if (currentView === 'winlink-mail') {
        displayMailList();
    }
}

// Helper function to format bytes into human-readable format
function formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}

function selectMailFolder(folder) {
    console.log('Selecting folder:', folder);
    currentMailFolder = folder;

    // Save current mailbox to localStorage
    saveCurrentMailbox(folder);

    // Update active state on buttons
    document.querySelectorAll('.folder-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    const folderBtn = document.querySelector(`[data-folder="${folder}"]`);
    if (folderBtn) {
        folderBtn.classList.add('active');
    }

    // Clear selection
    selectedMailMid = null;

    // Display mails for selected folder
    displayMailList();
}

function displayMailList() {
    const mailList = document.getElementById('mail-list');
    if (!mailList) return;
    
    const mails = winlinkMails[currentMailFolder] || [];
    console.log(`Displaying ${mails.length} mails for ${currentMailFolder}`);
    
    if (mails.length === 0) {
        mailList.innerHTML = '<div class="no-data">No mails in this folder</div>';
        // Clear detail view
        const mailDetail = document.getElementById('mail-detail');
        if (mailDetail) {
            mailDetail.innerHTML = '<div class="no-mail-selected"><p>No mails in this folder</p></div>';
        }
        return;
    }
    
    let html = '';
    mails.forEach(mail => {
        const mailDate = formatMailDate(mail.dateTime);
        const bodyPreview = (mail.body || '').substring(0, 60);
        const isSelected = selectedMailMid === mail.mid;
        
        html += `
            <div class="mail-item ${mail.isUnread ? 'unread' : ''} ${isSelected ? 'selected' : ''}" 
                 onclick="selectMail('${mail.mid}')">
                <div class="mail-item-header">
                    <span class="mail-from">${escapeHtml(mail.from)}</span>
                    <span class="mail-date">${mailDate}</span>
                </div>
                <div class="mail-subject">${escapeHtml(mail.subject)}</div>
                <div class="mail-preview">${escapeHtml(bodyPreview)}${bodyPreview.length >= 60 ? '...' : ''}</div>
                ${mail.attachmentCount > 0 || mail.isUnread || mail.isPrivate ? `
                    <div class="mail-badges">
                        ${mail.isUnread ? '<span class="mail-badge unread">UNREAD</span>' : ''}
                        ${mail.isPrivate ? '<span class="mail-badge private">PRIVATE</span>' : ''}
                        ${mail.attachmentCount > 0 ? `<span class="mail-badge attachment">📎 ${mail.attachmentCount}</span>` : ''}
                    </div>
                ` : ''}
            </div>
        `;
    });
    
    mailList.innerHTML = html;
}

function selectMail(mid) {
    console.log('Selecting mail:', mid);
    selectedMailMid = mid;
    
    // Find the mail
    const mails = winlinkMails[currentMailFolder] || [];
    const mail = mails.find(m => m.mid === mid);
    
    if (!mail) {
        console.error('Mail not found:', mid);
        return;
    }
    
    // Update selected state in list
    document.querySelectorAll('.mail-item').forEach(item => {
        item.classList.remove('selected');
    });
    event.target.closest('.mail-item').classList.add('selected');
    
    // Display mail detail
    displayMailDetail(mail);
}

function displayMailDetail(mail) {
    const mailDetail = document.getElementById('mail-detail');
    if (!mailDetail) return;
    
    const mailDate = formatMailDateTime(mail.dateTime);
    const isInTrash = currentMailFolder === 'trash';
    
    let html = `
        <div class="mail-detail-header">
            <div class="mail-header-top">
                <div class="mail-detail-subject">${escapeHtml(mail.subject)}</div>
                <button class="delete-mail-btn" onclick="confirmDeleteMail('${mail.mid}', ${isInTrash})" title="${isInTrash ? 'Permanently delete this email' : 'Move to trash'}">
                    ${isInTrash ? '🗑️ Delete Permanently' : '🗑️ Delete'}
                </button>
            </div>
            <div class="mail-detail-info">
                <div class="mail-detail-row">
                    <span class="mail-detail-label">From:</span>
                    <span class="mail-detail-value">${escapeHtml(mail.from)}</span>
                </div>
                <div class="mail-detail-row">
                    <span class="mail-detail-label">To:</span>
                    <span class="mail-detail-value">${escapeHtml(mail.to)}</span>
                </div>
                ${mail.cc ? `
                    <div class="mail-detail-row">
                        <span class="mail-detail-label">CC:</span>
                        <span class="mail-detail-value">${escapeHtml(mail.cc)}</span>
                    </div>
                ` : ''}
                <div class="mail-detail-row">
                    <span class="mail-detail-label">Date:</span>
                    <span class="mail-detail-value">${mailDate}</span>
                </div>
                <div class="mail-detail-row">
                    <span class="mail-detail-label">MID:</span>
                    <span class="mail-detail-value">${escapeHtml(mail.mid)}</span>
                </div>
            </div>
        </div>
        <div class="mail-detail-body">${escapeHtml(mail.body)}</div>
    `;
    
    if (mail.attachmentCount > 0) {
        html += `
            <div class="mail-detail-attachments">
                <h4>Attachments (${mail.attachmentCount})</h4>
                <div class="attachment-list">
                    <div class="attachment-item">
                        <span class="attachment-icon">📎</span>
                        <span class="attachment-name">Attachment information not available</span>
                    </div>
                </div>
            </div>
        `;
    }
    
    mailDetail.innerHTML = html;
}

function formatMailDate(dateTimeStr) {
    if (!dateTimeStr) return '--';
    
    try {
        const date = new Date(dateTimeStr);
        const now = new Date();
        const diffDays = Math.floor((now - date) / (1000 * 60 * 60 * 24));
        
        if (diffDays === 0) {
            // Today - show time only
            return date.toLocaleTimeString('en-US', {
                hour: '2-digit',
                minute: '2-digit',
                hour12: false
            });
        } else if (diffDays < 7) {
            // This week - show day name
            return date.toLocaleDateString('en-US', { weekday: 'short' });
        } else {
            // Older - show date
            return date.toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric'
            });
        }
    } catch (error) {
        console.error('Error formatting mail date:', error);
        return '--';
    }
}

function formatMailDateTime(dateTimeStr) {
    if (!dateTimeStr) return '--';
    
    try {
        const date = new Date(dateTimeStr);
        return date.toLocaleString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            hour12: false
        });
    } catch (error) {
        console.error('Error formatting mail datetime:', error);
        return '--';
    }
}

function updateSystemStatus(data) {
    // Update station callsign in sidebar (only callsign, no station ID)
    const stationCallsign = document.getElementById('station-callsign');
    if (stationCallsign) {
        stationCallsign.textContent = data.callsign;
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
    updateOverviewStats(data);
}

function updateOverviewStats(data) {
    // Update System Status section
    const overviewRadioStatus = document.getElementById('overview-radio-status');
    if (overviewRadioStatus) {
        overviewRadioStatus.textContent = data.radioConnected ? 'Connected' : 'Disconnected';
        overviewRadioStatus.className = 'stat-value status ' + (data.radioConnected ? 'connected' : 'disconnected');
    }

    const overviewUptime = document.getElementById('overview-uptime');
    if (overviewUptime) {
        overviewUptime.textContent = data.appUptime;
    }

    const overviewActive = document.getElementById('overview-active');
    if (overviewActive) {
        overviewActive.textContent = data.activeConnections;
    }

    const overviewStation = document.getElementById('overview-station');
    if (overviewStation) {
        overviewStation.textContent = `${data.callsign}-${data.stationId}`;
    }

    const overviewLastUpdate = document.getElementById('overview-last-update');
    if (overviewLastUpdate) {
        const now = new Date();
        overviewLastUpdate.textContent = now.toLocaleTimeString();
    }

    // Update BBS and WinLink station callsigns
    const overviewBbsStation = document.getElementById('overview-bbs-station');
    if (overviewBbsStation && data.bbsStationId) {
        overviewBbsStation.textContent = `${data.callsign}-${data.bbsStationId}`;
    }

    const overviewWinlinkStation = document.getElementById('overview-winlink-station');
    if (overviewWinlinkStation && data.winlinkStationId) {
        overviewWinlinkStation.textContent = `${data.callsign}-${data.winlinkStationId}`;
    }

    // Update BBS Status section
    const bbsConnectedStatus = document.getElementById('bbs-connected-status');
    if (bbsConnectedStatus) {
        bbsConnectedStatus.textContent = data.radioConnected ? 'Connected' : 'Disconnected';
        bbsConnectedStatus.className = 'stat-value status ' + (data.radioConnected ? 'connected' : 'disconnected');
    }

    const bbsActiveSessions = document.getElementById('bbs-active-sessions');
    if (bbsActiveSessions) {
        bbsActiveSessions.textContent = data.activeConnections;
    }

    // Update APRS Status section
    const aprsStatus = document.getElementById('aprs-status');
    if (aprsStatus) {
        // APRS status would need to be provided by the server
        aprsStatus.textContent = 'Active';
        aprsStatus.className = 'stat-value status connected';
    }

    // Update WinLink Status section with counts and sizes
    const winlinkInboxCount = document.getElementById('winlink-inbox-count');
    if (winlinkInboxCount) {
        const count = winlinkMails.inbox ? winlinkMails.inbox.length : 0;
        const size = winlinkMails.inboxSize || 0;
        winlinkInboxCount.textContent = `${count} (${formatBytes(size)})`;
    }

    const winlinkOutboxCount = document.getElementById('winlink-outbox-count');
    if (winlinkOutboxCount) {
        const count = winlinkMails.outbox ? winlinkMails.outbox.length : 0;
        const size = winlinkMails.outboxSize || 0;
        winlinkOutboxCount.textContent = `${count} (${formatBytes(size)})`;
    }

    const winlinkDraftCount = document.getElementById('winlink-draft-count');
    if (winlinkDraftCount) {
        const count = winlinkMails.draft ? winlinkMails.draft.length : 0;
        const size = winlinkMails.draftSize || 0;
        winlinkDraftCount.textContent = `${count} (${formatBytes(size)})`;
    }

    const winlinkSentCount = document.getElementById('winlink-sent-count');
    if (winlinkSentCount) {
        const count = winlinkMails.sent ? winlinkMails.sent.length : 0;
        const size = winlinkMails.sentSize || 0;
        winlinkSentCount.textContent = `${count} (${formatBytes(size)})`;
    }

    const winlinkArchiveCount = document.getElementById('winlink-archive-count');
    if (winlinkArchiveCount) {
        const count = winlinkMails.archive ? winlinkMails.archive.length : 0;
        const size = winlinkMails.archiveSize || 0;
        winlinkArchiveCount.textContent = `${count} (${formatBytes(size)})`;
    }

    const winlinkTrashCount = document.getElementById('winlink-trash-count');
    if (winlinkTrashCount) {
        const count = winlinkMails.trash ? winlinkMails.trash.length : 0;
        const size = winlinkMails.trashSize || 0;
        winlinkTrashCount.textContent = `${count} (${formatBytes(size)})`;
    }

    const winlinkTotalMessages = document.getElementById('winlink-total-messages');
    if (winlinkTotalMessages) {
        const total = (winlinkMails.inbox ? winlinkMails.inbox.length : 0) +
                     (winlinkMails.outbox ? winlinkMails.outbox.length : 0) +
                     (winlinkMails.draft ? winlinkMails.draft.length : 0) +
                     (winlinkMails.sent ? winlinkMails.sent.length : 0) +
                     (winlinkMails.archive ? winlinkMails.archive.length : 0) +
                     (winlinkMails.trash ? winlinkMails.trash.length : 0);
        winlinkTotalMessages.textContent = total;
    }

    // Update last activity timestamps
    const bbsLastActivity = document.getElementById('bbs-last-activity');
    if (bbsLastActivity) {
        if (data.lastBbsActivity) {
            bbsLastActivity.textContent = getTimeAgo(data.lastBbsActivity);
        } else {
            bbsLastActivity.textContent = 'No activity';
        }
    }

    const aprsLastMessage = document.getElementById('aprs-last-message');
    if (aprsLastMessage) {
        if (data.lastAprsMessage) {
            aprsLastMessage.textContent = getTimeAgo(data.lastAprsMessage);
        } else {
            aprsLastMessage.textContent = 'No messages';
        }
    }

    // Update BBS total connections count
    const bbsTotalConnections = document.getElementById('bbs-total-connections');
    if (bbsTotalConnections) {
        bbsTotalConnections.textContent = data.bbsTotalConnections || 0;
    }

    // Update APRS counts
    const aprsTotalMessages = document.getElementById('aprs-total-messages');
    if (aprsTotalMessages) {
        aprsTotalMessages.textContent = data.aprsMessageCount || 0;
    }

    const aprsStationsCount = document.getElementById('aprs-stations-count');
    if (aprsStationsCount) {
        aprsStationsCount.textContent = data.aprsStationsCount || 0;
    }

    // Update bulletin count
    const bbsActiveBulletins = document.getElementById('bbs-active-bulletins');
    if (bbsActiveBulletins) {
        bbsActiveBulletins.textContent = data.bulletinCount || 0;
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
                        <button class="delete-bulletin-btn" onclick="confirmDeleteBulletin(${bulletin.id}, '${escapeHtml(bulletin.callsign)}')">
                            Delete
                        </button>
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

// Bulletin Management Functions
function confirmDeleteBulletin(bulletinId, callsign) {
    const confirmed = confirm(
        `Are you sure you want to delete bulletin #${bulletinId} by ${callsign}?\n\n` +
        `This action cannot be undone.`
    );
    
    if (confirmed) {
        deleteBulletin(bulletinId);
    }
}

function deleteBulletin(bulletinId) {
    console.log(`Requesting deletion of bulletin ${bulletinId}`);
    
    if (!ws || ws.readyState !== WebSocket.OPEN) {
        alert('WebSocket connection not available. Cannot delete bulletin.');
        return;
    }
    
    // Disable the delete button to prevent double-clicks
    const deleteButtons = document.querySelectorAll('.delete-bulletin-btn');
    deleteButtons.forEach(btn => {
        if (btn.onclick && btn.onclick.toString().includes(bulletinId)) {
            btn.disabled = true;
            btn.textContent = 'Deleting...';
        }
    });
    
    sendMessage({
        type: 'delete_bulletin',
        bulletinId: bulletinId
    });
}

function handleBulletinDeleteResult(data) {
    const { success, error, bulletinId } = data;
    
    if (success) {
        console.log(`Successfully deleted bulletin ${bulletinId}`);
        // The bulletin list will be automatically updated via WebSocket
        // Show success notification
        showNotification(`Bulletin #${bulletinId} deleted successfully`, 'success');
    } else {
        console.error(`Failed to delete bulletin ${bulletinId}:`, error);
        alert(`Failed to delete bulletin: ${error}`);
        
        // Re-enable the delete button on failure
        const deleteButtons = document.querySelectorAll('.delete-bulletin-btn');
        deleteButtons.forEach(btn => {
            if (btn.onclick && btn.onclick.toString().includes(bulletinId)) {
                btn.disabled = false;
                btn.textContent = 'Delete';
            }
        });
    }
}

function showNotification(message, type = 'info') {
    // Create notification element
    const notification = document.createElement('div');
    notification.className = `notification notification-${type}`;
    notification.textContent = message;
    
    // Style the notification
    notification.style.cssText = `
        position: fixed;
        top: 80px;
        right: 20px;
        padding: 12px 20px;
        border-radius: 4px;
        color: white;
        font-weight: bold;
        z-index: 10000;
        box-shadow: 0 4px 8px rgba(0, 0, 0, 0.3);
        transition: all 0.3s ease;
    `;
    
    // Set background color based on type
    switch (type) {
        case 'success':
            notification.style.backgroundColor = '#28a745';
            break;
        case 'error':
            notification.style.backgroundColor = '#dc3545';
            break;
        case 'warning':
            notification.style.backgroundColor = '#ffc107';
            notification.style.color = '#000';
            break;
        default:
            notification.style.backgroundColor = '#0066cc';
    }
    
    // Add to page
    document.body.appendChild(notification);
    
    // Animate in
    setTimeout(() => {
        notification.style.transform = 'translateX(0)';
    }, 10);
    
    // Remove after 3 seconds
    setTimeout(() => {
        notification.style.transform = 'translateX(100%)';
        setTimeout(() => {
            if (notification.parentNode) {
                document.body.removeChild(notification);
            }
        }, 300);
    }, 3000);
}

// Bulletin Form Toggle Functions
function toggleBulletinForm() {
    const form = document.getElementById('bulletin-create-form');
    const toggleBtn = document.getElementById('toggle-create-btn');
    
    if (!form || !toggleBtn) return;
    
    if (form.style.display === 'none' || form.style.display === '') {
        showBulletinForm();
    } else {
        hideBulletinForm();
    }
}

function showBulletinForm() {
    const form = document.getElementById('bulletin-create-form');
    const toggleBtn = document.getElementById('toggle-create-btn');
    const messageTextarea = document.getElementById('bulletin-message');
    
    if (form) {
        form.style.display = 'block';
        // Smooth slide-down animation
        form.style.opacity = '0';
        form.style.transform = 'translateY(-20px)';
        setTimeout(() => {
            form.style.opacity = '1';
            form.style.transform = 'translateY(0)';
        }, 10);
    }
    
    if (toggleBtn) {
        toggleBtn.textContent = '×';
        toggleBtn.title = 'Cancel';
        toggleBtn.classList.add('active');
    }
    
    // Focus on textarea and update character count
    if (messageTextarea) {
        setTimeout(() => {
            messageTextarea.focus();
        }, 300);
    }
    updateCharacterCount();
}

function hideBulletinForm() {
    const form = document.getElementById('bulletin-create-form');
    const toggleBtn = document.getElementById('toggle-create-btn');

    if (form) {
        // Smooth slide-up animation
        form.style.opacity = '0';
        form.style.transform = 'translateY(-20px)';
        setTimeout(() => {
            form.style.display = 'none';
        }, 300);
    }

    if (toggleBtn) {
        toggleBtn.textContent = 'New Bulletin';
        toggleBtn.title = 'Post New Bulletin';
        toggleBtn.classList.remove('active');
    }

    // Clear form when hiding
    clearBulletinForm();
}

// Bulletin Creation Functions
function postBulletin() {
    const messageTextarea = document.getElementById('bulletin-message');
    const postBtn = document.getElementById('post-bulletin-btn');
    
    if (!messageTextarea || !postBtn) {
        console.error('Bulletin form elements not found');
        return;
    }
    
    const message = messageTextarea.value.trim();
    
    // Validation
    if (message.length === 0) {
        alert('Please enter a bulletin message.');
        messageTextarea.focus();
        return;
    }
    
    if (message.length > 300) {
        alert('Bulletin message is too long. Maximum 300 characters allowed.');
        messageTextarea.focus();
        return;
    }
    
    if (!ws || ws.readyState !== WebSocket.OPEN) {
        alert('WebSocket connection not available. Cannot post bulletin.');
        return;
    }
    
    // Disable form during submission
    postBtn.disabled = true;
    postBtn.textContent = 'Posting...';
    messageTextarea.disabled = true;
    
    console.log('Posting bulletin:', message);
    
    sendMessage({
        type: 'create_bulletin',
        message: message
    });
}

function clearBulletinForm() {
    const messageTextarea = document.getElementById('bulletin-message');
    const charCount = document.getElementById('char-count');
    
    if (messageTextarea) {
        messageTextarea.value = '';
        messageTextarea.focus();
    }
    
    if (charCount) {
        charCount.textContent = '0';
    }
}

function handleBulletinCreateResult(data) {
    const { success, error, bulletin } = data;
    const postBtn = document.getElementById('post-bulletin-btn');
    const messageTextarea = document.getElementById('bulletin-message');
    
    // Re-enable form
    if (postBtn) {
        postBtn.disabled = false;
        postBtn.textContent = 'Post Bulletin';
    }
    
    if (messageTextarea) {
        messageTextarea.disabled = false;
    }
    
    if (success) {
        console.log(`Successfully created bulletin ${bulletin.id}`);
        // Clear the form
        clearBulletinForm();
        // Show success notification
        showNotification(`Bulletin #${bulletin.id} posted successfully!`, 'success');
        // The bulletin list will be automatically updated via WebSocket
    } else {
        console.error('Failed to create bulletin:', error);
        alert(`Failed to post bulletin: ${error}`);
        if (messageTextarea) {
            messageTextarea.focus();
        }
    }
}

function updateCharacterCount() {
    const messageTextarea = document.getElementById('bulletin-message');
    const charCount = document.getElementById('char-count');
    
    if (messageTextarea && charCount) {
        const currentLength = messageTextarea.value.length;
        charCount.textContent = currentLength;
        
        // Update styling based on character count
        if (currentLength > 280) {
            charCount.style.color = '#dc3545'; // Red when approaching limit
        } else if (currentLength > 250) {
            charCount.style.color = '#ffc107'; // Yellow when getting close
        } else {
            charCount.style.color = '#333'; // Normal color
        }
    }
}

// Set up character counting when page loads
document.addEventListener('DOMContentLoaded', function() {
    // Set up character counting
    const messageTextarea = document.getElementById('bulletin-message');
    if (messageTextarea) {
        messageTextarea.addEventListener('input', updateCharacterCount);
        messageTextarea.addEventListener('keyup', updateCharacterCount);
        messageTextarea.addEventListener('paste', function() {
            // Delay to allow paste to complete
            setTimeout(updateCharacterCount, 10);
        });
        
        // Initial count
        updateCharacterCount();
    }
});

// WinLink Mail Deletion Functions
function confirmDeleteMail(mid, isInTrash) {
    const mails = winlinkMails[currentMailFolder] || [];
    const mail = mails.find(m => m.mid === mid);
    
    if (!mail) {
        console.error('Mail not found:', mid);
        return;
    }
    
    const action = isInTrash ? 'permanently delete' : 'move to trash';
    const confirmed = confirm(
        `Are you sure you want to ${action} this email?\n\n` +
        `From: ${mail.from}\n` +
        `Subject: ${mail.subject}\n\n` +
        (isInTrash ? 'This action cannot be undone!' : 'You can recover it from the Trash folder later.')
    );
    
    if (confirmed) {
        deleteMail(mid, isInTrash);
    }
}

function deleteMail(mid, permanent) {
    console.log(`Requesting ${permanent ? 'permanent deletion' : 'trash'} of mail:`, mid);
    
    if (!ws || ws.readyState !== WebSocket.OPEN) {
        alert('WebSocket connection not available. Cannot delete mail.');
        return;
    }
    
    // Disable the delete button to prevent double-clicks
    const deleteButton = document.querySelector('.delete-mail-btn');
    if (deleteButton) {
        deleteButton.disabled = true;
        deleteButton.textContent = permanent ? '🗑️ Deleting...' : '🗑️ Moving...';
    }
    
    sendMessage({
        type: 'delete_mail',
        mid: mid,
        permanent: permanent
    });
}

function handleMailDeleteResult(data) {
    const { success, error, mid, permanent } = data;
    
    if (success) {
        const action = permanent ? 'permanently deleted' : 'moved to trash';
        console.log(`Successfully ${action} mail ${mid}`);
        showNotification(`Email ${action} successfully`, 'success');
        
        // Clear the selection and detail view
        selectedMailMid = null;
        const mailDetail = document.getElementById('mail-detail');
        if (mailDetail) {
            mailDetail.innerHTML = '<div class="no-mail-selected"><p>Select a mail to view its contents</p></div>';
        }
        
        // The mail list will be automatically updated via WebSocket
    } else {
        console.error(`Failed to delete mail ${mid}:`, error);
        alert(`Failed to delete mail: ${error}`);
        
        // Re-enable the delete button on failure
        const deleteButton = document.querySelector('.delete-mail-btn');
        if (deleteButton) {
            deleteButton.disabled = false;
            deleteButton.textContent = permanent ? '🗑️ Delete Permanently' : '🗑️ Delete';
        }
    }
}

// Email Composition Functions
function toggleComposeForm() {
    const form = document.getElementById('compose-form');
    const toggleBtn = document.getElementById('toggle-compose-btn');
    
    if (!form || !toggleBtn) return;
    
    if (form.style.display === 'none' || form.style.display === '') {
        showComposeForm();
    } else {
        hideComposeForm();
    }
}

function showComposeForm() {
    const form = document.getElementById('compose-form');
    const toggleBtn = document.getElementById('toggle-compose-btn');
    const emailTo = document.getElementById('email-to');
    
    if (form) {
        form.style.display = 'block';
        // Smooth slide-down animation
        form.style.opacity = '0';
        form.style.transform = 'translateY(-20px)';
        setTimeout(() => {
            form.style.opacity = '1';
            form.style.transform = 'translateY(0)';
        }, 10);
    }
    
    if (toggleBtn) {
        toggleBtn.textContent = '×';
        toggleBtn.title = 'Cancel';
        toggleBtn.classList.add('active');
    }
    
    // Focus on To field
    if (emailTo) {
        setTimeout(() => {
            emailTo.focus();
        }, 300);
    }
    updateEmailCharCount();
}

function hideComposeForm() {
    const form = document.getElementById('compose-form');
    const toggleBtn = document.getElementById('toggle-compose-btn');

    if (form) {
        // Smooth slide-up animation
        form.style.opacity = '0';
        form.style.transform = 'translateY(-20px)';
        setTimeout(() => {
            form.style.display = 'none';
        }, 300);
    }

    if (toggleBtn) {
        toggleBtn.textContent = 'New Mail';
        toggleBtn.title = 'Compose New Email';
        toggleBtn.classList.remove('active');
    }

    // Clear form when hiding
    clearComposeForm();
}

function clearComposeForm() {
    const emailTo = document.getElementById('email-to');
    const emailSubject = document.getElementById('email-subject');
    const emailBody = document.getElementById('email-body');
    const charCount = document.getElementById('email-char-count');
    
    if (emailTo) emailTo.value = '';
    if (emailSubject) emailSubject.value = '';
    if (emailBody) emailBody.value = '';
    if (charCount) charCount.textContent = '0';
    
    if (emailTo) emailTo.focus();
}

function sendEmail() {
    composeEmailAction(false); // false = send to outbox
}

function saveDraft() {
    composeEmailAction(true); // true = save as draft
}

function composeEmailAction(isDraft) {
    const emailTo = document.getElementById('email-to');
    const emailSubject = document.getElementById('email-subject');
    const emailBody = document.getElementById('email-body');
    const sendBtn = document.getElementById('send-email-btn');
    const draftBtn = document.getElementById('draft-email-btn');
    
    if (!emailTo || !emailSubject || !emailBody) {
        console.error('Compose form elements not found');
        return;
    }
    
    const to = emailTo.value.trim();
    const subject = emailSubject.value.trim();
    const body = emailBody.value.trim();
    
    // Validation
    if (!to) {
        alert('Please enter a recipient callsign.');
        emailTo.focus();
        return;
    }
    
    if (!subject) {
        alert('Please enter a subject.');
        emailSubject.focus();
        return;
    }
    
    if (!body) {
        alert('Please enter a message.');
        emailBody.focus();
        return;
    }
    
    if (!ws || ws.readyState !== WebSocket.OPEN) {
        alert('WebSocket connection not available. Cannot send email.');
        return;
    }
    
    // Disable form during submission
    if (sendBtn) {
        sendBtn.disabled = true;
        sendBtn.textContent = isDraft ? 'Saving...' : 'Sending...';
    }
    if (draftBtn) draftBtn.disabled = true;
    emailTo.disabled = true;
    emailSubject.disabled = true;
    emailBody.disabled = true;
    
    console.log(`${isDraft ? 'Saving draft' : 'Sending email'} to ${to}`);
    
    sendMessage({
        type: 'compose_mail',
        to: to,
        subject: subject,
        body: body,
        isDraft: isDraft
    });
}

function handleMailComposeResult(data) {
    const { success, error, isDraft } = data;
    const sendBtn = document.getElementById('send-email-btn');
    const draftBtn = document.getElementById('draft-email-btn');
    const emailTo = document.getElementById('email-to');
    const emailSubject = document.getElementById('email-subject');
    const emailBody = document.getElementById('email-body');
    
    // Re-enable form
    if (sendBtn) {
        sendBtn.disabled = false;
        sendBtn.textContent = 'Send Email';
    }
    if (draftBtn) {
        draftBtn.disabled = false;
    }
    if (emailTo) emailTo.disabled = false;
    if (emailSubject) emailSubject.disabled = false;
    if (emailBody) emailBody.disabled = false;
    
    if (success) {
        const action = isDraft ? 'saved as draft' : 'sent to outbox';
        console.log(`Successfully ${action}`);
        // Clear the form
        clearComposeForm();
        // Hide the form
        hideComposeForm();
        // Show success notification
        showNotification(`Email ${action} successfully!`, 'success');
        // The mail list will be automatically updated via WebSocket
    } else {
        console.error(`Failed to ${isDraft ? 'save draft' : 'send email'}:`, error);
        alert(`Failed to ${isDraft ? 'save draft' : 'send email'}: ${error}`);
        if (emailTo) emailTo.focus();
    }
}

function updateEmailCharCount() {
    const emailBody = document.getElementById('email-body');
    const charCount = document.getElementById('email-char-count');
    
    if (emailBody && charCount) {
        const currentLength = emailBody.value.length;
        charCount.textContent = currentLength;
    }
}

// Set up email compose character counting when page loads
document.addEventListener('DOMContentLoaded', function() {
    // Set up email body character counting
    const emailBody = document.getElementById('email-body');
    if (emailBody) {
        emailBody.addEventListener('input', updateEmailCharCount);
        emailBody.addEventListener('keyup', updateEmailCharCount);
        emailBody.addEventListener('paste', function() {
            setTimeout(updateEmailCharCount, 10);
        });
        
        // Initial count
        updateEmailCharCount();
    }
});

// Connecting Overlay Functions
function showConnectingOverlay() {
    const overlay = document.getElementById('connecting-overlay');
    const mainContainer = document.querySelector('.main-container');

    if (overlay) {
        overlay.style.display = 'flex';
    }
    if (mainContainer) {
        mainContainer.style.display = 'none';
    }

    // Hide radio status when not connected
    const radioStatus = document.getElementById('radio-status');
    if (radioStatus) {
        radioStatus.textContent = 'Unknown';
        radioStatus.className = 'status';
    }
}

function hideConnectingOverlay() {
    const overlay = document.getElementById('connecting-overlay');
    const mainContainer = document.querySelector('.main-container');

    if (overlay) {
        overlay.style.display = 'none';
    }
    if (mainContainer) {
        mainContainer.style.display = 'flex';
    }
}

// LocalStorage Functions for Preferences
function saveCurrentView(viewName) {
    try {
        localStorage.setItem('handitalky-current-view', viewName);
    } catch (error) {
        console.warn('Failed to save current view to localStorage:', error);
    }
}

function saveCurrentMailbox(mailbox) {
    try {
        localStorage.setItem('handitalky-current-mailbox', mailbox);
    } catch (error) {
        console.warn('Failed to save current mailbox to localStorage:', error);
    }
}

function loadSavedPreferences() {
    try {
        const savedView = localStorage.getItem('handitalky-current-view');
        const savedMailbox = localStorage.getItem('handitalky-current-mailbox');

        if (savedView) {
            console.log('Loading saved view:', savedView);
            // Will be restored when WebSocket connects
            window.savedViewToRestore = savedView;
        }

        if (savedMailbox) {
            console.log('Loading saved mailbox:', savedMailbox);
            // Will be restored when WebSocket connects
            window.savedMailboxToRestore = savedMailbox;
        }
    } catch (error) {
        console.warn('Failed to load saved preferences:', error);
    }
}

function restoreSavedPreferences() {
    try {
        // Restore saved view/tab
        if (window.savedViewToRestore) {
            const targetView = document.getElementById(`view-${window.savedViewToRestore}`);
            if (targetView) {
                console.log('Restoring saved view:', window.savedViewToRestore);
                switchView(window.savedViewToRestore);
            }
            window.savedViewToRestore = null;
        }

        // Restore saved mailbox (only if we're on the mail view)
        if (window.savedMailboxToRestore && currentView === 'winlink-mail') {
            console.log('Restoring saved mailbox:', window.savedMailboxToRestore);
            selectMailFolder(window.savedMailboxToRestore);
            window.savedMailboxToRestore = null;
        }
    } catch (error) {
        console.warn('Failed to restore saved preferences:', error);
    }
}

// Handle window beforeunload
window.addEventListener('beforeunload', function() {
    if (ws) {
        ws.close();
    }
});

// ============================================================================
// APRS MESSAGE FILTERING AND MAP FUNCTIONALITY
// ============================================================================

// Global APRS state
let allAprsMessages = [];
let currentAprsFilter = 'all';
let currentAprsTypeFilter = 'all';
let aprsSearchQuery = '';

// APRS Map variables
let aprsMap = null;
let aprsMarkers = [];
let aprsPolylines = [];
let myLocationMarker = null;
let myLocationEnabled = false;
let myLocationWatchId = null;

// Update the existing updateAprsMessages function to store messages
const originalUpdateAprsMessages = updateAprsMessages;
updateAprsMessages = function(messages) {
    allAprsMessages = messages || [];
    updateAprsFilterCounts();
    displayFilteredAprsMessages();
    
    // Update map if on map view
    if (currentView === 'aprs-map' && aprsMap) {
        updateAprsMap();
    }
};

// Filter APRS messages by direction (all, received, sent)
function filterAprsMessages(filter) {
    currentAprsFilter = filter;
    
    // Update tab button states
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.remove('active');
        if (btn.getAttribute('data-filter') === filter) {
            btn.classList.add('active');
        }
    });
    
    displayFilteredAprsMessages();
}

// Filter APRS messages by type
function filterAprsMessagesByType() {
    const typeFilter = document.getElementById('aprs-type-filter');
    if (typeFilter) {
        currentAprsTypeFilter = typeFilter.value;
    }
    displayFilteredAprsMessages();
}

// Search APRS messages
function searchAprsMessages() {
    const searchInput = document.getElementById('aprs-search');
    if (searchInput) {
        aprsSearchQuery = searchInput.value.trim().toLowerCase();
    }
    displayFilteredAprsMessages();
}

// Update filter counts
function updateAprsFilterCounts() {
    const allCount = allAprsMessages.length;
    const receivedCount = allAprsMessages.filter(m => m.direction === 'received').length;
    const sentCount = allAprsMessages.filter(m => m.direction === 'sent').length;
    
    const allCountEl = document.getElementById('aprs-count-all');
    const receivedCountEl = document.getElementById('aprs-count-received');
    const sentCountEl = document.getElementById('aprs-count-sent');
    
    if (allCountEl) allCountEl.textContent = allCount;
    if (receivedCountEl) receivedCountEl.textContent = receivedCount;
    if (sentCountEl) sentCountEl.textContent = sentCount;
}

// Display filtered APRS messages
function displayFilteredAprsMessages() {
    const container = document.getElementById('aprs-messages');
    if (!container) return;
    
    // Apply filters
    let filteredMessages = allAprsMessages;
    
    // Direction filter
    if (currentAprsFilter !== 'all') {
        filteredMessages = filteredMessages.filter(m => m.direction === currentAprsFilter);
    }
    
    // Type filter
    if (currentAprsTypeFilter !== 'all') {
        filteredMessages = filteredMessages.filter(m => m.dataType === currentAprsTypeFilter);
    }
    
    // Search filter
    if (aprsSearchQuery) {
        filteredMessages = filteredMessages.filter(m => {
            return (m.source && m.source.toLowerCase().includes(aprsSearchQuery)) ||
                   (m.destination && m.destination.toLowerCase().includes(aprsSearchQuery)) ||
                   (m.message && m.message.toLowerCase().includes(aprsSearchQuery));
        });
    }
    
    // Display messages
    if (filteredMessages.length === 0) {
        container.innerHTML = '<div class="no-data">No APRS messages match the current filters</div>';
        return;
    }
    
    let html = '';
    filteredMessages.forEach(msg => {
        const time = formatTime(msg.localTime || msg.timestamp);
        const messageText = truncateText(msg.message, 50);
        const dataType = msg.dataType || 'Message';
        const direction = msg.direction || 'received';
        
        // Add CSS class based on data type for styling
        const typeClass = dataType.toLowerCase().replace(/[^a-z]/g, '');
        const directionBadge = direction === 'sent' ? 
            '<span class="direction-badge direction-sent">SENT</span>' : 
            '<span class="direction-badge direction-received">RX</span>';
        
        html += `
            <div class="aprs-message aprs-${typeClass}">
                <div class="aprs-source">${escapeHtml(msg.source)} ${directionBadge}</div>
                <div class="aprs-destination">${escapeHtml(msg.destination)}</div>
                <div class="aprs-type">${escapeHtml(dataType)}</div>
                <div class="aprs-text">${escapeHtml(messageText)}</div>
                <div class="aprs-time">${escapeHtml(time)}</div>
            </div>
        `;
    });
    
    container.innerHTML = html;
}

// ============================================================================
// APRS MAP FUNCTIONALITY
// ============================================================================

// Initialize APRS map when switching to map view
function initializeAprsMap() {
    if (aprsMap) {
        return; // Map already initialized
    }
    
    const mapContainer = document.getElementById('aprs-map-container');
    if (!mapContainer) {
        console.error('Map container not found');
        return;
    }
    
    // Remove loading message
    mapContainer.innerHTML = '';
    
    try {
        // Create map centered on a default location (will be updated when markers are added)
        aprsMap = L.map('aprs-map-container').setView([37.7749, -122.4194], 10);
        
        // Add OpenStreetMap tile layer
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '© OpenStreetMap contributors',
            maxZoom: 19
        }).addTo(aprsMap);
        
        console.log('APRS map initialized');
        
        // Load initial markers
        updateAprsMap();
        
    } catch (error) {
        console.error('Failed to initialize APRS map:', error);
        mapContainer.innerHTML = '<div class="map-loading">Failed to load map</div>';
    }
}

// Update APRS map with station positions
function updateAprsMap() {
    if (!aprsMap) {
        console.log('Map not initialized yet');
        return;
    }
    
    // Clear existing markers and polylines
    aprsMarkers.forEach(marker => aprsMap.removeLayer(marker));
    aprsMarkers = [];
    aprsPolylines.forEach(line => aprsMap.removeLayer(line));
    aprsPolylines = [];
    
    // Get all messages with position data
    const positionMessages = allAprsMessages.filter(m => m.position && m.position.latitude && m.position.longitude);
    
    if (positionMessages.length === 0) {
        console.log('No APRS position data to display');
        return;
    }
    
    // Group messages by station to get latest position and create paths
    const stationPositions = new Map();
    
    positionMessages.forEach(msg => {
        const station = msg.source;
        if (!stationPositions.has(station)) {
            stationPositions.set(station, []);
        }
        stationPositions.get(station).push({
            lat: msg.position.latitude,
            lng: msg.position.longitude,
            timestamp: new Date(msg.timestamp),
            comment: msg.position.comment || '',
            altitude: msg.position.altitude,
            weather: msg.weather
        });
    });
    
    // Create markers and paths for each station
    const bounds = [];
    
    stationPositions.forEach((positions, station) => {
        // Sort by timestamp
        positions.sort((a, b) => a.timestamp - b.timestamp);
        
        // Get latest position
        const latest = positions[positions.length - 1];
        bounds.push([latest.lat, latest.lng]);
        
        // Create marker for latest position
        const markerIcon = L.divIcon({
            className: 'custom-marker',
            html: '<div style="background-color: #2196F3; color: white; padding: 4px 8px; border-radius: 12px; font-weight: bold; box-shadow: 0 2px 4px rgba(0,0,0,0.3);">📍</div>',
            iconSize: [30, 30],
            iconAnchor: [15, 15]
        });
        
        const marker = L.marker([latest.lat, latest.lng], { icon: markerIcon }).addTo(aprsMap);
        
        // Create popup content
        let popupContent = `<div class="popup-callsign">${escapeHtml(station)}</div>`;
        popupContent += `<div class="popup-info">`;
        popupContent += `<strong>Last Update:</strong> ${latest.timestamp.toLocaleString()}<br>`;
        if (latest.altitude) {
            popupContent += `<strong>Altitude:</strong> ${latest.altitude} m<br>`;
        }
        if (latest.comment) {
            popupContent += `<strong>Comment:</strong> ${escapeHtml(latest.comment)}<br>`;
        }
        if (latest.weather) {
            popupContent += `<strong>Weather:</strong><br>`;
            if (latest.weather.temperature) popupContent += `Temp: ${latest.weather.temperature}°F<br>`;
            if (latest.weather.windSpeed) popupContent += `Wind: ${latest.weather.windSpeed}mph @ ${latest.weather.windDirection}°<br>`;
        }
        popupContent += `</div>`;
        popupContent += `<div class="popup-coords">${latest.lat.toFixed(5)}, ${latest.lng.toFixed(5)}</div>`;
        
        marker.bindPopup(popupContent);
        aprsMarkers.push(marker);
        
        // Create path if "Show Paths" is enabled and there are multiple positions
        const showPathsCheck = document.getElementById('show-paths-check');
        if (showPathsCheck && showPathsCheck.checked && positions.length > 1) {
            const latlngs = positions.map(pos => [pos.lat, pos.lng]);
            const polyline = L.polyline(latlngs, {
                color: '#2196F3',
                weight: 2,
                opacity: 0.6,
                dashArray: '5, 10'
            }).addTo(aprsMap);
            aprsPolylines.push(polyline);
        }
    });
    
    // Fit map to show all markers
    if (bounds.length > 0) {
        aprsMap.fitBounds(bounds, { padding: [50, 50] });
    }
    
    console.log(`Updated map with ${aprsMarkers.length} markers`);
}

// Center map on all stations
function centerMapOnStations() {
    if (!aprsMap || aprsMarkers.length === 0) {
        console.log('No markers to center on');
        return;
    }
    
    const bounds = aprsMarkers.map(marker => marker.getLatLng());
    aprsMap.fitBounds(bounds, { padding: [50, 50] });
}

// Toggle path display
function togglePaths() {
    updateAprsMap(); // Refresh map with updated path setting
}

// Toggle my location on map
function toggleMyLocation() {
    const btn = document.getElementById('my-location-btn');
    
    if (myLocationEnabled) {
        // Disable location tracking
        myLocationEnabled = false;
        if (btn) btn.classList.remove('active');
        
        // Stop watching position
        if (myLocationWatchId !== null) {
            navigator.geolocation.clearWatch(myLocationWatchId);
            myLocationWatchId = null;
        }
        
        // Remove marker
        if (myLocationMarker) {
            aprsMap.removeLayer(myLocationMarker);
            myLocationMarker = null;
        }
        
        console.log('My location disabled');
    } else {
        // Enable location tracking
        if (!navigator.geolocation) {
            alert('Geolocation is not supported by your browser');
            return;
        }
        
        myLocationEnabled = true;
        if (btn) btn.classList.add('active');
        
        // Start watching position
        myLocationWatchId = navigator.geolocation.watchPosition(
            (position) => {
                updateMyLocation(position.coords.latitude, position.coords.longitude);
            },
            (error) => {
                console.error('Geolocation error:', error);
                alert('Unable to get your location: ' + error.message);
                myLocationEnabled = false;
                if (btn) btn.classList.remove('active');
            },
            {
                enableHighAccuracy: true,
                maximumAge: 10000,
                timeout: 5000
            }
        );
        
        console.log('My location enabled');
    }
}

// Update my location marker on map
function updateMyLocation(lat, lng) {
    if (!aprsMap) return;
    
    if (myLocationMarker) {
        // Update existing marker
        myLocationMarker.setLatLng([lat, lng]);
    } else {
        // Create new marker
        const myIcon = L.divIcon({
            className: 'my-location-marker',
            html: '<div style="background-color: #4CAF50; color: white; padding: 6px 10px; border-radius: 16px; font-weight: bold; box-shadow: 0 2px 6px rgba(0,0,0,0.4); border: 2px solid white;">🏠 Me</div>',
            iconSize: [60, 30],
            iconAnchor: [30, 15]
        });
        
        myLocationMarker = L.marker([lat, lng], { icon: myIcon }).addTo(aprsMap);
        
        const popupContent = `
            <div class="popup-callsign">My Location</div>
            <div class="popup-coords">${lat.toFixed(5)}, ${lng.toFixed(5)}</div>
        `;
        myLocationMarker.bindPopup(popupContent);
        
        // Center map on my location
        aprsMap.setView([lat, lng], 13);
    }
}

// Watch for view changes to initialize map
const originalSwitchView = switchView;
switchView = function(viewName) {
    originalSwitchView(viewName);
    
    // Initialize map when switching to map view
    if (viewName === 'aprs-map') {
        setTimeout(() => {
            initializeAprsMap();
        }, 100);
    }
};

console.log('APRS filtering and map functionality loaded');
