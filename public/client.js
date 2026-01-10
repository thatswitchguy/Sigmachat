// SigmaChat Client - Discord-like chat application
const socket = io();

let username = null;
let currentServer = 'sigmachat';
let currentChannel = 'general';
let currentDM = null;
let onlineUsers = [];
let dmHistories = {};
let isAdmin = false;
let isServerAdmin = false;
let bannedUsers = new Set();
let notificationsEnabled = true;
let allowDMs = true;
let desktopNotifications = true;
let dataUsage = true;
let servers = {};

// Load user preferences from server
function loadUserPreferences() {
  fetch('/api/user-settings')
    .then(response => response.json())
    .then(settings => {
      allowDMs = settings.allowDMs !== false;
      desktopNotifications = settings.desktopNotifications !== false;
      dataUsage = settings.dataUsage !== false;
      notificationsEnabled = settings.messageSounds !== false;
    })
    .catch(error => {
      console.error('Error loading user preferences:', error);
    });
}

function updatePreferences() {
  loadUserPreferences();
}

function playNotificationSound() {
  if (!notificationsEnabled) return;
  try {
    const audio = new Audio('/notification.wav');
    audio.volume = 0.5;
    audio.play().catch(() => {});
  } catch (e) {}
}

function showNotification(message, type = 'info', title = '') {
  const container = document.getElementById('notification-container');
  if (!container) return;

  const notification = document.createElement('div');
  notification.className = `notification-toast ${type}`;
  const titleText = title || (type === 'error' ? 'Error' : type === 'success' ? 'Success' : type === 'warning' ? 'Warning' : 'Notification');

  notification.innerHTML = `
    <div class="notification-content">
      <div class="notification-title">${titleText}</div>
      <div class="notification-message">${message}</div>
    </div>
    <button class="notification-close">&times;</button>
  `;

  container.appendChild(notification);
  const closeBtn = notification.querySelector('.notification-close');
  closeBtn.addEventListener('click', () => {
    notification.classList.add('closing');
    setTimeout(() => notification.remove(), 300);
  });

  setTimeout(() => {
    if (notification.parentElement) {
      notification.classList.add('closing');
      setTimeout(() => notification.remove(), 300);
    }
  }, 5000);
}

function showConfirmNotification(message, onConfirm, title = 'Confirm') {
  const overlay = document.getElementById('confirm-notification-overlay');
  const modal = document.getElementById('confirm-notification');
  const titleEl = document.getElementById('confirm-title');
  const messageEl = document.getElementById('confirm-message');
  const okBtn = document.getElementById('confirm-ok-btn');

  titleEl.textContent = title;
  messageEl.textContent = message;
  
  overlay.style.display = 'flex';
  modal.style.display = 'block';

  okBtn.onclick = () => {
    closeConfirmNotification();
    onConfirm();
  };
}

function closeConfirmNotification() {
  const overlay = document.getElementById('confirm-notification-overlay');
  const modal = document.getElementById('confirm-notification');
  overlay.style.display = 'none';
  modal.style.display = 'none';
}

let isSuperAdmin = false;
let isGlobalAdmin = false;

// Initialize application
fetch('/api/user')
  .then(response => response.json())
  .then(data => {
    if (data.username) {
      username = data.username;
      isAdmin = data.username === 'thatswitchguy' || data.username === 'ikhan';
      loadUserPreferences();
      // Fetch global admin status
      fetch('/api/admin/status')
        .then(r => r.json())
        .then(adminData => {
          isSuperAdmin = adminData.isSuperAdmin;
          isGlobalAdmin = adminData.isGlobalAdmin;
          if (isGlobalAdmin) isAdmin = true;
          initializeApp();
        })
        .catch(() => {
          initializeApp();
        });
    } else {
      window.location.href = '/login';
    }
  })
  .catch(() => {
    window.location.href = '/login';
  });

function initializeApp() {
  updateUserPanel();
  loadServers();
  loadOnlineUsers();
  setupEventListeners();
  socket.emit('join', { username: username, room: `${currentServer}:${currentChannel}` });
  
  // Show admin control button for super admin
  if (isSuperAdmin) {
    const adminBtn = document.getElementById('admin-control-btn');
    if (adminBtn) adminBtn.style.display = 'block';
  }
}

function updateUserPanel() {
  const userAvatar = document.getElementById('user-avatar');
  const userNameDisplay = document.getElementById('user-name-display');
  
  if (userNameDisplay) userNameDisplay.textContent = username;
  if (userAvatar) {
    fetch('/api/profile-picture')
      .then(r => r.json())
      .then(data => {
        if (data.profilePicture) {
          userAvatar.innerHTML = `<img src="${data.profilePicture}" alt="${username}">`;
        } else {
          userAvatar.textContent = username.charAt(0).toUpperCase();
        }
      })
      .catch(() => {
        userAvatar.textContent = username.charAt(0).toUpperCase();
      });
  }
}

// Server management
function loadServers() {
  fetch('/api/servers')
    .then(response => response.json())
    .then(data => {
      servers = data;
      renderServerList();
      if (servers[currentServer]) {
        selectServer(currentServer);
      } else {
        const firstServer = Object.keys(servers)[0];
        if (firstServer) selectServer(firstServer);
      }
    })
    .catch(error => {
      console.error('Error loading servers:', error);
    });
}

function renderServerList() {
  const serverListItems = document.getElementById('server-list-items');
  if (!serverListItems) return;
  
  serverListItems.innerHTML = '';
  
  Object.values(servers).forEach(server => {
    const serverIcon = document.createElement('div');
    serverIcon.className = `server-icon ${server.id === currentServer ? 'active' : ''}`;
    serverIcon.title = server.name;
    serverIcon.dataset.serverId = server.id;
    
    if (server.icon) {
      serverIcon.innerHTML = `<img src="${server.icon}" alt="${server.name}">`;
    } else {
      serverIcon.innerHTML = `<span>${server.name.charAt(0).toUpperCase()}</span>`;
    }
    
    serverIcon.onclick = () => selectServer(server.id);
    serverListItems.appendChild(serverIcon);
  });
}

function selectServer(serverId) {
  currentServer = serverId;
  currentDM = null;
  
  document.querySelectorAll('.server-icon').forEach(icon => {
    icon.classList.toggle('active', icon.dataset.serverId === serverId);
  });
  
  fetch(`/api/servers/${serverId}`)
    .then(response => response.json())
    .then(server => {
      isServerAdmin = server.isAdmin || server.isOwner;
      document.getElementById('server-name').textContent = server.name;
      
      const settingsBtn = document.getElementById('server-settings-btn');
      const addChannelBtn = document.getElementById('add-channel-btn');
      
      if (settingsBtn) settingsBtn.style.display = isServerAdmin ? 'block' : 'none';
      if (addChannelBtn) addChannelBtn.style.display = isServerAdmin ? 'block' : 'none';
      
      renderChannelList(server.channels);
      
      const firstChannel = Object.keys(server.channels)[0] || 'general';
      selectChannel(firstChannel);
    })
    .catch(error => {
      console.error('Error loading server:', error);
    });
}

function renderChannelList(channels) {
  const channelList = document.getElementById('channel-list');
  if (!channelList) return;
  
  channelList.innerHTML = '';
  
  const protectedChannels = ['general', 'suggestions', 'tech-support'];
  
  Object.entries(channels || {}).forEach(([channelId, channel]) => {
    const channelItem = document.createElement('div');
    channelItem.className = `channel-item ${channelId === currentChannel ? 'active' : ''}`;
    channelItem.dataset.channelId = channelId;
    
    let deleteBtn = '';
    if (isServerAdmin && !protectedChannels.includes(channelId)) {
      deleteBtn = `<button class="channel-delete" onclick="event.stopPropagation(); deleteChannel('${channelId}')" title="Delete Channel">x</button>`;
    }
    
    channelItem.innerHTML = `<span class="channel-hash">#</span>${channel.name || channelId}${deleteBtn}`;
    channelItem.onclick = () => selectChannel(channelId);
    channelList.appendChild(channelItem);
  });
}

function selectChannel(channelId) {
  currentChannel = channelId;
  currentDM = null;
  
  document.querySelectorAll('.channel-item').forEach(item => {
    item.classList.toggle('active', item.dataset.channelId === channelId);
  });
  
  document.getElementById('current-room').textContent = `#${channelId}`;
  document.getElementById('input').placeholder = `Message #${channelId}`;
  
  const messages = document.getElementById('messages');
  messages.innerHTML = '';
  
  socket.emit('switch room', { room: `${currentServer}:${channelId}` });
  
  loadChannelMessages(currentServer, channelId);
}

function loadChannelMessages(serverId, channelId) {
  fetch(`/api/servers/${serverId}/channels/${channelId}/messages`)
    .then(response => response.json())
    .then(messageList => {
      const messagesContainer = document.getElementById('messages');
      messagesContainer.innerHTML = '';
      
      messageList.forEach((msg, index) => {
        appendMessage(msg, index, 'channel');
      });
      
      messagesContainer.scrollTop = messagesContainer.scrollHeight;
      // Mark as scrolled to bottom since we just scrolled
      isScrolledToBottom = true;
      checkScrollPosition();
    })
    .catch(error => {
      console.error('Error loading messages:', error);
    });
}

function showMessageActions(element) {
  const actions = element.querySelector('.message-actions');
  if (actions) actions.style.display = 'flex';
}

function hideMessageActions(element) {
  const actions = element.querySelector('.message-actions');
  if (actions) actions.style.display = 'none';
}

function appendMessage(messageData, index, type) {
  const messagesContainer = document.getElementById('messages');
  const messageDiv = document.createElement('div');
  messageDiv.className = messageData.username === 'System' ? 'message system' : 'message';
  messageDiv.dataset.messageId = messageData.id;

  if (messageData.username === 'System' || !messageData.username) {
    messageDiv.innerHTML = `<span class="content">${messageData.message}</span>`;
    messagesContainer.appendChild(messageDiv);
    return;
  }

  let processedMessage = messageData.message || '';
  if (processedMessage.includes('@')) {
    processedMessage = processedMessage.replace(/@(\w+)/g, '<span class="mention">@$1</span>');
  }
  processedMessage = processedMessage.replace(/(https?:\/\/[^\s]+\.(jpg|jpeg|png|gif|webp|svg)(\?[^\s]*)?)/gi, '<img src="$1" alt="Image" class="message-image" onclick="openImageModal(\'$1\')">');
  processedMessage = processedMessage.replace(/(https?:\/\/[^\s]+)/g, function(match) {
    if (match.match(/\.(jpg|jpeg|png|gif|webp|svg)/i)) return match;
    return '<a href="' + match + '" target="_blank" class="message-link">' + match + '</a>';
  });

  const date = messageData.date || '';
  const time = messageData.time || '';
  const messageId = messageData.id;
  const editedIndicator = messageData.edited ? ` <span class="edited">(edited)</span>` : '';

  fetch(`/api/user-profile/${messageData.username}`)
    .then(r => r.json())
    .then(profile => {
      let avatar;
      if (profile.profilePicture) {
        avatar = `<img src="${profile.profilePicture}" alt="${messageData.username}" style="width: 32px; height: 32px; border-radius: 50%; object-fit: cover; margin-right: 8px;">`;
      } else {
        avatar = `<div style="width: 32px; height: 32px; border-radius: 50%; background-color: #5865f2; display: flex; align-items: center; justify-content: center; color: white; font-weight: bold; margin-right: 8px;">${messageData.username.charAt(0).toUpperCase()}</div>`;
      }

      const messageActions = messageData.username === username ? `
        <div class="message-actions" style="display: none; margin-left: 8px;">
          <button class="edit-btn" onclick="editMessage('${currentServer}', '${currentChannel}', '${messageId}', 'room')">Edit</button>
          <button class="delete-btn" onclick="deleteMessage('${currentServer}', '${currentChannel}', '${messageId}', 'room')">Delete</button>
        </div>
      ` : '';

      messageDiv.innerHTML = `
        <div style="display: flex; align-items: flex-start;" onmouseenter="showMessageActions(this)" onmouseleave="hideMessageActions(this)">
          ${avatar}
          <div style="flex: 1;">
            ${date ? `<div class="message-date">${date}</div>` : ''}
            <span class="timestamp">[${time}]</span>
            <span class="username">${messageData.username}:</span>
            <span class="content">${processedMessage}</span>
            ${editedIndicator}
          </div>
          ${messageActions}
        </div>
      `;
    })
    .catch(() => {
      const messageActions = messageData.username === username ? `
        <div class="message-actions" style="display: none; margin-left: 8px;">
          <button class="edit-btn" onclick="editMessage('${currentServer}', '${currentChannel}', '${messageId}', 'room')">Edit</button>
          <button class="delete-btn" onclick="deleteMessage('${currentServer}', '${currentChannel}', '${messageId}', 'room')">Delete</button>
        </div>
      ` : '';

      messageDiv.innerHTML = `
        <div style="display: flex; align-items: flex-start;" onmouseenter="showMessageActions(this)" onmouseleave="hideMessageActions(this)">
          <div style="width: 32px; height: 32px; border-radius: 50%; background-color: #5865f2; display: flex; align-items: center; justify-content: center; color: white; font-weight: bold; margin-right: 8px;">${messageData.username.charAt(0).toUpperCase()}</div>
          <div style="flex: 1;">
            ${date ? `<div class="message-date">${date}</div>` : ''}
            <span class="timestamp">[${time}]</span>
            <span class="username">${messageData.username}:</span>
            <span class="content">${processedMessage}</span>
            ${editedIndicator}
          </div>
          ${messageActions}
        </div>
      `;
    });

  messagesContainer.appendChild(messageDiv);
}

function deleteMessage(serverId, channelId, messageId, type) {
  const url = type === 'dm' ? `/api/dm/${serverId}/messages/${messageId}` : `/api/servers/${serverId}/channels/${channelId}/messages/${messageId}`;
  fetch(url, { method: 'DELETE' })
    .then(r => r.json())
    .then(data => {
      if (data.success) {
        showNotification('Message deleted', 'success');
        // If DM, the roomId (serverId) is actually the target username
        if (type === 'dm') openDM(serverId);
        else loadChannelMessages(serverId, channelId);
      } else {
        showNotification(data.error || 'Failed to delete message', 'error');
      }
    })
    .catch(() => showNotification('Failed to delete message', 'error'));
}

function editMessage(serverId, channelId, messageId, type) {
  const newMessage = prompt('Edit your message:');
  if (newMessage !== null && newMessage.trim() !== '') {
    const url = type === 'dm' ? `/api/dm/${serverId}/messages/${messageId}` : `/api/servers/${serverId}/channels/${channelId}/messages/${messageId}`;
    fetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ newMessage })
    })
    .then(r => r.json())
    .then(data => {
      if (data.success) {
        showNotification('Message updated', 'success');
        if (type === 'dm') openDM(serverId);
        else loadChannelMessages(serverId, channelId);
      } else {
        showNotification(data.error || 'Failed to edit message', 'error');
      }
    })
    .catch(() => showNotification('Failed to edit message', 'error'));
  }
}

function deleteChannel(channelId) {
  showConfirmNotification(`Delete channel #${channelId}?`, () => {
    fetch(`/api/servers/${currentServer}/channels/${channelId}`, { method: 'DELETE' })
      .then(response => response.json())
      .then(data => {
        if (data.success) {
          showNotification('Channel deleted', 'success');
          selectServer(currentServer);
        } else {
          showNotification(data.error || 'Failed to delete channel', 'error');
        }
      })
      .catch(error => {
        showNotification('Failed to delete channel', 'error');
      });
  }, 'Delete Channel');
}

function setupEventListeners() {
  // Collapse sidebar button - toggles both ways
  document.getElementById('collapse-sidebar-btn')?.addEventListener('click', () => {
    const sidebar = document.getElementById('sidebar');
    const mainChat = document.getElementById('main-chat');
    const expandBtn = document.getElementById('expand-sidebar-btn');
    const isCollapsed = sidebar.classList.contains('collapsed');
    
    if (isCollapsed) {
      sidebar.classList.remove('collapsed');
      mainChat.classList.remove('expanded');
      if (expandBtn) expandBtn.style.display = 'none';
    } else {
      sidebar.classList.add('collapsed');
      mainChat.classList.add('expanded');
      if (expandBtn) expandBtn.style.display = 'block';
    }
  });

  // Expand sidebar button (alternative way to expand)
  document.getElementById('expand-sidebar-btn')?.addEventListener('click', () => {
    const sidebar = document.getElementById('sidebar');
    const mainChat = document.getElementById('main-chat');
    const expandBtn = document.getElementById('expand-sidebar-btn');
    sidebar.classList.remove('collapsed');
    mainChat.classList.remove('expanded');
    if (expandBtn) expandBtn.style.display = 'none';
  });

  // Add server button - redirect to server creation page
  document.getElementById('add-server-btn')?.addEventListener('click', () => {
    window.location.href = '/server-create.html';
  });

  // Add channel button
  document.getElementById('add-channel-btn')?.addEventListener('click', () => {
    openModal('create-channel-modal');
  });

  // Server settings button
  document.getElementById('server-settings-btn')?.addEventListener('click', () => {
    const server = servers[currentServer];
    if (server) {
      document.getElementById('edit-server-name').value = server.name;
      document.getElementById('edit-server-icon').value = server.icon || '';
      openModal('server-settings-modal');
    }
  });

  // Create server submit
  document.getElementById('create-server-submit')?.addEventListener('click', () => {
    const name = document.getElementById('new-server-name').value.trim();
    const icon = document.getElementById('new-server-icon').value.trim();
    
    if (!name) {
      showNotification('Please enter a server name', 'warning');
      return;
    }
    
    fetch('/api/servers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, icon: icon || null })
    })
    .then(r => r.json())
    .then(data => {
      if (data.success) {
        closeModal();
        document.getElementById('new-server-name').value = '';
        document.getElementById('new-server-icon').value = '';
        loadServers();
        setTimeout(() => selectServer(data.serverId), 300);
        showNotification('Server created!', 'success');
      } else {
        showNotification(data.error || 'Failed to create server', 'error');
      }
    })
    .catch(() => showNotification('Failed to create server', 'error'));
  });

  // Create channel submit
  document.getElementById('create-channel-submit')?.addEventListener('click', () => {
    const name = document.getElementById('new-channel-name').value.trim();
    
    if (!name) {
      showNotification('Please enter a channel name', 'warning');
      return;
    }
    
    fetch(`/api/servers/${currentServer}/channels`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name })
    })
    .then(r => r.json())
    .then(data => {
      if (data.success) {
        closeModal();
        document.getElementById('new-channel-name').value = '';
        selectServer(currentServer);
        showNotification('Channel created!', 'success');
      } else {
        showNotification(data.error || 'Failed to create channel', 'error');
      }
    })
    .catch(() => showNotification('Failed to create channel', 'error'));
  });

  // Save server settings
  document.getElementById('save-server-settings')?.addEventListener('click', () => {
    const name = document.getElementById('edit-server-name').value.trim();
    const icon = document.getElementById('edit-server-icon').value.trim();
    
    fetch(`/api/servers/${currentServer}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, icon: icon || null })
    })
    .then(r => r.json())
    .then(data => {
      if (data.success) {
        closeModal();
        loadServers();
        showNotification('Server updated!', 'success');
      } else {
        showNotification(data.error || 'Failed to update server', 'error');
      }
    })
    .catch(() => showNotification('Failed to update server', 'error'));
  });

  // Delete server
  document.getElementById('delete-server-btn')?.addEventListener('click', () => {
    showConfirmNotification('Are you sure you want to delete this server? This cannot be undone.', () => {
      fetch(`/api/servers/${currentServer}`, { method: 'DELETE' })
        .then(r => r.json())
        .then(data => {
          if (data.success) {
            closeModal();
            loadServers();
            showNotification('Server deleted', 'success');
          } else {
            showNotification(data.error || 'Failed to delete server', 'error');
          }
        })
        .catch(() => showNotification('Failed to delete server', 'error'));
    }, 'Delete Server');
  });

  // Leave server
  document.getElementById('leave-server-btn')?.addEventListener('click', () => {
    showConfirmNotification('Are you sure you want to leave this server?', () => {
      fetch(`/api/servers/${currentServer}/leave`, { method: 'POST' })
        .then(r => r.json())
        .then(data => {
          if (data.success) {
            closeModal();
            loadServers();
            showNotification('Left server', 'success');
          } else {
            showNotification(data.error || 'Failed to leave server', 'error');
          }
        })
        .catch(() => showNotification('Failed to leave server', 'error'));
    }, 'Leave Server');
  });

  // Modal close buttons
  document.querySelectorAll('.modal-close, .modal-cancel').forEach(btn => {
    btn.addEventListener('click', closeModal);
  });

  // Modal overlay click to close
  document.getElementById('modal-overlay')?.addEventListener('click', (e) => {
    if (e.target.id === 'modal-overlay') closeModal();
  });

  // Admin control button (super admin only)
  document.getElementById('admin-control-btn')?.addEventListener('click', () => {
    window.location.href = '/admin-control.html';
  });

  // Account button
  document.getElementById('account-btn')?.addEventListener('click', () => {
    window.location.href = '/account';
  });

  // Logout button
  document.getElementById('logout-btn')?.addEventListener('click', () => {
    fetch('/logout', { method: 'POST' })
      .then(() => window.location.href = '/login')
      .catch(() => window.location.href = '/login');
  });
}

function openModal(modalId) {
  document.getElementById('modal-overlay').style.display = 'flex';
  document.querySelectorAll('.modal').forEach(m => m.style.display = 'none');
  document.getElementById(modalId).style.display = 'block';
}

function closeModal() {
  document.getElementById('modal-overlay').style.display = 'none';
  document.querySelectorAll('.modal').forEach(m => m.style.display = 'none');
}

// Keep legacy variable for compatibility
let currentRoom = 'general';

const input = document.getElementById('input');
const messages = document.getElementById('messages');
const scrollDownBtn = document.getElementById('scroll-down-btn');

// Scroll tracking
let isScrolledToBottom = true;

// Function to check if scrolled to bottom
function checkScrollPosition() {
  const threshold = 50; // Allow 50px tolerance
  isScrolledToBottom = messages.scrollHeight - messages.scrollTop - messages.clientHeight < threshold;

  if (isScrolledToBottom) {
    scrollDownBtn.classList.remove('show');
  } else {
    scrollDownBtn.classList.add('show');
  }
}

// Function to auto-scroll if user was at bottom
function autoScrollIfAtBottom() {
  if (isScrolledToBottom) {
    messages.scrollTop = messages.scrollHeight;
  }
}

// Listen to scroll events
messages.addEventListener('scroll', checkScrollPosition);

// Click handler for scroll button
scrollDownBtn.addEventListener('click', () => {
  messages.scrollTop = messages.scrollHeight;
  isScrolledToBottom = true;
  scrollDownBtn.classList.remove('show');
});

// Function to handle create room button click - redirect to room creation page
function openCreateRoom() {
  window.location.href = '/room-create.html';
}

// Load available rooms
function loadRooms() {
  const roomList = document.getElementById('room-list');
  const defaultRooms = ['general', 'suggestions', 'tech-support'];

  // Always show default rooms first
  roomList.innerHTML = '';

  defaultRooms.forEach(roomId => {
    const roomDiv = document.createElement('div');
    roomDiv.className = `room-item ${roomId === currentRoom ? 'active' : ''} default-room`;
    roomDiv.innerHTML = `<span class="room-hash">#</span>${roomId}`;
    roomDiv.onclick = () => switchRoom(roomId);

    // Add right-click context menu
    roomDiv.oncontextmenu = (e) => {
      e.preventDefault();
      e.stopPropagation();
      showContextMenu(e, roomId, true);
      return false;
    };

    roomList.appendChild(roomDiv);
  });

  // Then load additional rooms from server
  fetch('/api/rooms')
    .then(response => {
      if (!response.ok) {
        throw new Error('Failed to fetch rooms');
      }
      return response.json();
    })
    .then(rooms => {
      // Count additional rooms (non-default)
      additionalRoomsCreated = 0;
      Object.keys(rooms).forEach(roomId => {
        if (!defaultRooms.includes(roomId)) {
          additionalRoomsCreated++;
        }
      });

      // Add custom rooms
      Object.keys(rooms).forEach(roomId => {
        if (!defaultRooms.includes(roomId)) {
          const roomDiv = document.createElement('div');
          roomDiv.className = `room-item ${roomId === currentRoom ? 'active' : ''}`;
          roomDiv.innerHTML = `<span class="room-hash">#</span>${roomId}`;
          roomDiv.onclick = () => switchRoom(roomId);

          // Add right-click context menu
          roomDiv.oncontextmenu = (e) => {
            e.preventDefault();
            e.stopPropagation();
            showContextMenu(e, roomId, false);
            return false;
          };

          roomList.appendChild(roomDiv);
        }
      });

      updateRoomCount();
    })
    .catch(error => {
      console.error('Error loading rooms:', error);
      // Default rooms are already shown, just reset counter
      additionalRoomsCreated = 0;
      updateRoomCount();
    });
}

function updateRoomCount() {
  const roomCountElement = document.getElementById('room-count');
  const createRoomBtn = document.getElementById('create-room-btn');

  roomCountElement.textContent = `${additionalRoomsCreated}/${maxAdditionalRooms} additional rooms created`;

  if (additionalRoomsCreated >= maxAdditionalRooms) {
    createRoomBtn.disabled = true;
    createRoomBtn.textContent = 'Max Rooms Reached';
  } else {
    createRoomBtn.disabled = false;
    createRoomBtn.textContent = 'Create Room';
  }
}

function renderMessages(messagesToRender, container) {
  container.innerHTML = '';
  messagesToRender.forEach((msg, index) => {
    const messageDiv = document.createElement('div');
    messageDiv.className = msg.username === 'System' ? 'message system' : 'message';
    const messageId = msg.id || `legacy-${index}`;
    messageDiv.dataset.messageId = messageId;
    
    // ... rest of rendering logic ...
  });
}

function loadRoomMessages(roomId) {
  fetch(`/api/servers/${currentServer}/channels/${roomId}/messages`)
    .then(response => response.json())
    .then(roomMessages => {
      messages.innerHTML = '';
      roomMessages.forEach((messageData, index) => {
        const messageDiv = document.createElement('div');
        messageDiv.className = messageData.username === 'System' ? 'message system' : 'message';
        const messageId = messageData.id || `legacy-${index}`;
        messageDiv.dataset.messageId = messageId;
        messageDiv.dataset.serverId = currentServer;
        messageDiv.dataset.channelId = roomId;

        if (messageData.username === 'System' || !messageData.username) {
          messageDiv.innerHTML = `<span class="content">${messageData.message}</span>`;
          messages.appendChild(messageDiv);
        } else {
          // Process mentions, links, and images in the message
          let processedMessage = messageData.message;
          if (processedMessage.includes('@')) {
            processedMessage = processedMessage.replace(/@(\w+)/g, '<span class="mention">@$1</span>');
          }

          processedMessage = processedMessage.replace(/(https?:\/\/[^\s]+\.(jpg|jpeg|png|gif|webp|svg)(\?[^\s]*)?)/gi, '<img src="$1" alt="Image" class="message-image" onclick="openImageModal(\'$1\')">');

          processedMessage = processedMessage.replace(/(https?:\/\/[^\s]+)/g, function(match) {
            if (match.match(/\.(jpg|jpeg|png|gif|webp|svg)/i)) {
              return match;
            }
            return '<a href="' + match + '" target="_blank" class="message-link">' + match + '</a>';
          });

          // Get user's profile picture
          fetch(`/api/user-profile/${messageData.username}`)
            .then(response => response.json())
            .then(profileData => {
              let avatarContent;
              if (profileData.profilePicture) {
                avatarContent = `<img src="${profileData.profilePicture}" alt="${messageData.username}" style="width: 32px; height: 32px; border-radius: 50%; object-fit: cover; margin-right: 8px;">`;
              } else {
                avatarContent = `<div style="width: 32px; height: 32px; border-radius: 50%; background-color: #5865f2; display: flex; align-items: center; justify-content: center; color: white; font-weight: bold; margin-right: 8px;">${messageData.username.charAt(0).toUpperCase()}</div>`;
              }

              const editedIndicator = messageData.edited ? ` <span class="edited">(edited at ${messageData.editedAt})</span>` : '';
              const messageActions = messageData.username === username ? `
                <div class="message-actions" style="display: none; margin-left: 8px;">
                  <button class="edit-btn" onclick="editMessage('${currentServer}', '${roomId}', '${messageId}', 'room')">Edit</button>
                  <button class="delete-btn" onclick="deleteMessage('${currentServer}', '${roomId}', '${messageId}', 'room')">Delete</button>
                </div>
              ` : '';

              const date = messageData.date || '';
              const time = messageData.time || '';
              messageDiv.innerHTML = `
                <div style="display: flex; align-items: center;" onmouseenter="showMessageActions(this)" onmouseleave="hideMessageActions(this)">
                  ${avatarContent}
                  <div style="flex: 1;">
                    ${date ? `<div class="message-date">${date}</div>` : ''}
                    <span class="timestamp">[${time}]</span>
                    <span class="username">${messageData.username}:</span>
                    <span class="content">${processedMessage}</span>
                    ${editedIndicator}
                  </div>
                  ${messageActions}
                </div>
              `;
            })
            .catch(() => {
              const editedIndicator = messageData.edited ? ` <span class="edited">(edited at ${messageData.editedAt})</span>` : '';
              const messageActions = messageData.username === username ? `
                <div class="message-actions" style="display: none; margin-left: 8px;">
                  <button class="edit-btn" onclick="editMessage('${currentServer}', '${roomId}', '${messageId}', 'room')">Edit</button>
                  <button class="delete-btn" onclick="deleteMessage('${currentServer}', '${roomId}', '${messageId}', 'room')">Delete</button>
                </div>
              ` : '';

              const date = messageData.date || '';
              const time = messageData.time || '';
              messageDiv.innerHTML = `
                <div style="display: flex; align-items: center;" onmouseenter="showMessageActions(this)" onmouseleave="hideMessageActions(this)">
                  <div style="flex: 1;">
                    ${date ? `<div class="message-date">${date}</div>` : ''}
                    <span class="timestamp">[${time}]</span>
                    <span class="username">${messageData.username}:</span>
                    <span class="content">${processedMessage}</span>
                    ${editedIndicator}
                  </div>
                  ${messageActions}
                </div>
              `;
            });
          messages.appendChild(messageDiv);
        }
      });
      autoScrollIfAtBottom();
    })
    .catch(error => {
      console.error('Error loading channel messages:', error);
    });
}

function loadOnlineUsers() {
  const onlineUserList = document.getElementById('online-user-list');
  onlineUserList.innerHTML = '';

  // Load all users for DM capability
  fetch('/api/users')
    .then(response => {
      if (!response.ok) {
        throw new Error('Failed to fetch users');
      }
      return response.json();
    })
    .then(allUsers => {
      // Filter out banned users and current user - use Set to avoid duplicates
      const visibleUsersSet = new Set(allUsers.filter(user => !bannedUsers.has(user) && user !== username));
      const visibleUsers = Array.from(visibleUsersSet);

      if (visibleUsers.length === 0) {
        const noUsersDiv = document.createElement('div');
        noUsersDiv.className = 'online-user';
        noUsersDiv.innerHTML = '<span class="user-name" style="color: #72767d; font-style: italic;">No other users available</span>';
        onlineUserList.appendChild(noUsersDiv);
        return;
      }

      visibleUsers.forEach(user => {
        const isOnline = onlineUsers.includes(user);
        const userDiv = document.createElement('div');
        userDiv.className = 'online-user';

        let banButton = '';
        if (isAdmin && user !== username) {
          banButton = `<button class="ban-btn" onclick="showBanOptions('${user}')">Ban</button>`;
        }

        // Set initial content with fallback
        userDiv.innerHTML = `
          <div class="user-avatar ${isOnline ? 'online' : 'offline'}">${user.charAt(0).toUpperCase()}</div>
          <span class="user-name">${user} ${isOnline ? '(online)' : '(offline)'}</span>
          <button class="dm-btn" onclick="startDM('${user}')">DM</button>
          ${banButton}
        `;
        onlineUserList.appendChild(userDiv);

        // Get user's profile picture and update
        fetch(`/api/user-profile/${user}`)
          .then(response => response.json())
          .then(profileData => {
            // Check if user div still exists in the list (in case list was cleared)
            if (!onlineUserList.contains(userDiv)) return;

            let avatarContent;
            if (profileData.profilePicture) {
              avatarContent = `<img src="${profileData.profilePicture}" alt="${user}" style="width: 32px; height: 32px; border-radius: 50%; object-fit: cover;">`;
            } else {
              avatarContent = user.charAt(0).toUpperCase();
            }

            userDiv.querySelector('.user-avatar').innerHTML = avatarContent;
          })
          .catch(() => {
            // Already has fallback, do nothing
          });
      });
    })
    .catch(error => {
      console.error('Error loading users:', error);
      // Fallback to showing only online users - use Set to avoid duplicates
      const visibleOnlineUsersSet = new Set(onlineUsers.filter(user => !bannedUsers.has(user) && user !== username));
      const visibleOnlineUsers = Array.from(visibleOnlineUsersSet);

      if (visibleOnlineUsers.length === 0) {
        const noUsersDiv = document.createElement('div');
        noUsersDiv.className = 'online-user';
        noUsersDiv.innerHTML = '<span class="user-name" style="color: #72767d; font-style: italic;">No other users available</span>';
        onlineUserList.appendChild(noUsersDiv);
        return;
      }

      visibleOnlineUsers.forEach(user => {
        const userDiv = document.createElement('div');
        userDiv.className = 'online-user';
        userDiv.innerHTML = `
          <div class="user-avatar online">${user.charAt(0).toUpperCase()}</div>
          <span class="user-name">${user} (online)</span>
          <button class="dm-btn" onclick="startDM('${user}')">DM</button>
        `;
        onlineUserList.appendChild(userDiv);
      });
    });
}

function startDM(targetUser) {
  // Update preferences before starting DM
  updatePreferences();

  if (!allowDMs) {
    showNotification('The user has disabled direct messages from DMs from other server members', 'warning');
    return;
  }

  currentDM = targetUser;
  currentRoom = null;
  messages.innerHTML = '';

  // Load DM history
  fetch(`/api/dm/${targetUser}`)
    .then(response => response.json())
    .then(dmMessages => {
      dmHistories[targetUser] = dmMessages;
      dmMessages.forEach((messageData, index) => {
        const messageDiv = document.createElement('div');
        messageDiv.className = 'message dm-message';
        const messageId = messageData.id || `legacy-${index}`;
        messageDiv.dataset.messageId = messageId;
        messageDiv.dataset.targetUser = targetUser;

        // Process mentions, links, and images in DM messages
        let processedMessage = messageData.message;
        if (processedMessage.includes('@')) {
          processedMessage = processedMessage.replace(/@(\w+)/g, '<span class="mention">@$1</span>');
        }

        // Process images FIRST (before links to prevent double wrapping)
        // Match image URLs with common extensions (with or without query parameters)
        processedMessage = processedMessage.replace(/(https?:\/\/[^\s]+\.(jpg|jpeg|png|gif|webp|svg)(\?[^\s]*)?)/gi, '<img src="$1" alt="Image" class="message-image" onclick="openImageModal(\'$1\')">');

        // Process remaining links (that aren't already images)
        processedMessage = processedMessage.replace(/(https?:\/\/[^\s]+)/g, function(match) {
          // Don't link if it's already an image
          if (match.match(/\.(jpg|jpeg|png|gif|webp|svg)/i)) {
            return match;
          }
          return '<a href="' + match + '" target="_blank" class="message-link">' + match + '</a>';
        });

        // Get user's profile picture
        fetch(`/api/user-profile/${messageData.from}`)
          .then(response => response.json())
          .then(profileData => {
            let avatarContent;
            if (profileData.profilePicture) {
              avatarContent = `<img src="${profileData.profilePicture}" alt="${messageData.from}" style="width: 32px; height: 32px; border-radius: 50%; object-fit: cover; margin-right: 8px;">`;
            } else {
              avatarContent = `<div style="width: 32px; height: 32px; border-radius: 50%; background-color: #5865f2; display: flex; align-items: center; justify-content: center; color: white; font-weight: bold; margin-right: 8px;">${messageData.from.charAt(0).toUpperCase()}</div>`;
            }

            const editedIndicator = messageData.edited ? ` <span class="edited">(edited at ${messageData.editedAt})</span>` : '';
            const messageActions = messageData.from === username ? `
              <div class="message-actions" style="display: none; margin-left: 8px;">
                <button class="edit-btn" onclick="editMessage('${targetUser}', null, '${messageId}', 'dm')">Edit</button>
                <button class="delete-btn" onclick="deleteMessage('${targetUser}', null, '${messageId}', 'dm')">Delete</button>
              </div>
            ` : '';

            const dmDate = messageData.date || '';
            const dmTime = messageData.time || messageData.timestamp || '';
            messageDiv.innerHTML = `
              <div style="display: flex; align-items: center;" onmouseenter="showMessageActions(this)" onmouseleave="hideMessageActions(this)">
                ${avatarContent}
                <div style="flex: 1;">
                  ${dmDate ? `<div class="message-date">${dmDate}</div>` : ''}
                  <span class="timestamp">[${dmTime}]</span>
                  <span class="username">${messageData.from}:</span>
                  <span class="content">${processedMessage}</span>
                  ${editedIndicator}
                </div>
                ${messageActions}
              </div>
            `;
          })
          .catch(() => {
            // Fallback without profile picture
            const editedIndicator = messageData.edited ? ` <span class="edited">(edited at ${messageData.editedAt})</span>` : '';
            const messageActions = messageData.from === username ? `
              <div class="message-actions" style="display: none; margin-left: 8px;">
                <button class="edit-btn" onclick="editMessage('${targetUser}', ${index}, 'dm')">Edit</button>
                <button class="delete-btn" onclick="deleteMessage('${targetUser}', ${index}, 'dm')">Delete</button>
              </div>
            ` : '';

            const dmDate2 = messageData.date || '';
            const dmTime2 = messageData.time || messageData.timestamp || '';
            messageDiv.innerHTML = `
              <div style="display: flex; align-items: center;" onmouseenter="showMessageActions(this)" onmouseleave="hideMessageActions(this)">
                <div style="flex: 1;">
                  ${dmDate2 ? `<div class="message-date">${dmDate2}</div>` : ''}
                  <span class="timestamp">[${dmTime2}]</span>
                  <span class="username">${messageData.from}:</span>
                  <span class="content">${processedMessage}</span>
                  ${editedIndicator}
                </div>
                ${messageActions}
              </div>
            `;
          });
        messages.appendChild(messageDiv);
      });
      autoScrollIfAtBottom();
    })
    .catch(error => {
      console.error('Error loading DM history:', error);
    });

  // Update header
  document.getElementById('current-room').textContent = `@${targetUser}`;
  document.getElementById('input').placeholder = `Message @${targetUser}`;

  // Update active styling
  document.querySelectorAll('.room-item').forEach(item => {
    item.classList.remove('active');
  });
}

function createRoom(roomName) {
  fetch('/api/rooms', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: `roomName=${encodeURIComponent(roomName)}`
  })
  .then(response => response.json())
  .then(data => {
    if (data.success) {
      loadRooms();
      document.getElementById('create-room-input').value = '';
    } else {
      showNotification(data.error || 'Failed to create room', 'error');
    }
  })
  .catch(error => {
    console.error('Error creating room:', error);
    showNotification('Failed to create room', 'error');
  });
}

function showContextMenu(event, roomId, isDefault) {
  // Remove existing context menu
  const existingMenu = document.querySelector('.context-menu');
  if (existingMenu) {
    existingMenu.remove();
  }

  // Don't show context menu for default/protected rooms
  const protectedRooms = ['general', 'suggestions', 'tech-support'];
  if (protectedRooms.includes(roomId)) {
    return;
  }

  const contextMenu = document.createElement('div');
  contextMenu.className = 'context-menu';

  // Position the menu, ensuring it stays within viewport
  const x = Math.min(event.clientX, window.innerWidth - 150);
  const y = Math.min(event.clientY, window.innerHeight - 150);

  contextMenu.style.left = x + 'px';
  contextMenu.style.top = y + 'px';
  contextMenu.style.position = 'fixed';
  contextMenu.style.zIndex = '9999';

  const editItem = document.createElement('div');
  editItem.className = 'context-menu-item';
  editItem.textContent = 'Edit Room';
  editItem.addEventListener('click', (e) => {
    e.stopPropagation();
    contextMenu.remove();
    openEditRoom(roomId);
  });

  const renameItem = document.createElement('div');
  renameItem.className = 'context-menu-item';
  renameItem.textContent = 'Rename Room';
  renameItem.addEventListener('click', (e) => {
    e.stopPropagation();
    contextMenu.remove();
    startRename(roomId);
  });

  const deleteItem = document.createElement('div');
  deleteItem.className = 'context-menu-item danger';
  deleteItem.textContent = 'Delete Room';
  deleteItem.addEventListener('click', (e) => {
    e.stopPropagation();
    contextMenu.remove();
    showConfirmNotification(`Are you sure you want to delete room #${roomId}?`, () => {
      deleteRoom(roomId);
    }, 'Delete Room');
  });

  contextMenu.appendChild(editItem);
  contextMenu.appendChild(renameItem);
  contextMenu.appendChild(deleteItem);
  document.body.appendChild(contextMenu);

  // Close menu when clicking elsewhere
  const closeMenu = (e) => {
    if (!contextMenu.contains(e.target)) {
      contextMenu.remove();
      document.removeEventListener('click', closeMenu);
      document.removeEventListener('contextmenu', closeMenu);
    }
  };

  // Add slight delay to prevent immediate closure
  setTimeout(() => {
    document.addEventListener('click', closeMenu);
    document.addEventListener('contextmenu', closeMenu);
  }, 50);
}

function startRename(roomId) {
  const roomItems = document.querySelectorAll('.room-item');
  const roomItem = Array.from(roomItems).find(item => item.textContent.includes(`#${roomId}`));

  if (roomItem) {
    const currentName = roomId;
    const input = document.createElement('input');
    input.className = 'rename-input';
    input.type = 'text';
    input.value = currentName;
    input.maxLength = 20;
    input.minLength = 3;

    roomItem.innerHTML = '';
    roomItem.appendChild(input);
    input.focus();
    input.select();

    const finishRename = () => {
      const newName = input.value.trim();
      if (newName && newName.length >= 3 && newName !== currentName) {
        renameRoom(roomId, newName);
      } else {
        loadRooms(); // Revert changes
      }
    };

    input.onblur = finishRename;
    input.onkeydown = (e) => {
      if (e.key === 'Enter') {
        finishRename();
      } else if (e.key === 'Escape') {
        loadRooms(); // Revert changes
      }
    };
  }
}

function renameRoom(roomId, newName) {
  fetch(`/api/rooms/${roomId}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: `newName=${encodeURIComponent(newName)}`
  })
  .then(response => response.json())
  .then(data => {
    if (data.success) {
      loadRooms();
    } else {
      showNotification(data.error || 'Failed to rename room', 'error');
      loadRooms();
    }
  })
  .catch(error => {
    console.error('Error renaming room:', error);
    showNotification('Failed to rename room', 'error');
    loadRooms();
  });
}

function deleteRoom(roomId) {
  // Show confirmation notification
  showNotification(`Deleting room "#${roomId}"...`, 'warning', 'Confirm Delete');

  fetch(`/api/rooms/${roomId}`, {
    method: 'DELETE'
  })
  .then(response => response.json())
  .then(data => {
    if (data.success) {
      // If we're in the deleted room, switch to general
      if (currentRoom === roomId) {
        switchRoom('general');
      }
      loadRooms();
      showNotification(`Room "#${roomId}" deleted successfully`, 'success');
    } else {
      showNotification(data.error || 'Failed to delete room', 'error');
    }
  })
  .catch(error => {
    console.error('Error deleting room:', error);
    showNotification('Failed to delete room', 'error');
  });
}

function openEditRoom(roomId) {
  // Create modal overlay and content
  const modalOverlay = document.createElement('div');
  modalOverlay.className = 'edit-room-modal-overlay';
  
  const modalContent = document.createElement('div');
  modalContent.className = 'edit-room-modal';
  
  // Create close button
  const closeBtn = document.createElement('button');
  closeBtn.className = 'edit-room-close';
  closeBtn.textContent = '×';
  closeBtn.onclick = () => modalOverlay.remove();
  
  // Title
  const title = document.createElement('h2');
  title.textContent = `Edit Room: #${roomId}`;
  
  // User search input
  const searchLabel = document.createElement('label');
  searchLabel.textContent = 'Search Users';
  searchLabel.style.display = 'block';
  searchLabel.style.marginBottom = '8px';
  searchLabel.style.color = '#b5bac1';
  searchLabel.style.fontSize = '12px';
  searchLabel.style.fontWeight = '600';
  
  const searchInput = document.createElement('input');
  searchInput.type = 'text';
  searchInput.placeholder = 'Search username...';
  searchInput.className = 'edit-room-search';
  
  // Users list
  const usersListLabel = document.createElement('label');
  usersListLabel.textContent = 'Room Members';
  usersListLabel.style.display = 'block';
  usersListLabel.style.marginTop = '16px';
  usersListLabel.style.marginBottom = '8px';
  usersListLabel.style.color = '#b5bac1';
  usersListLabel.style.fontSize = '12px';
  usersListLabel.style.fontWeight = '600';
  
  const usersList = document.createElement('div');
  usersList.className = 'edit-room-users-list';
  
  let allUsers = [];
  let currentMembers = new Set();
  
  // Fetch room members and all users
  Promise.all([
    fetch(`/api/room/${roomId}/members`).then(r => r.json()).catch(() => ({})),
    fetch('/api/users').then(r => r.json()).catch(() => [])
  ]).then(([memberData, users]) => {
    currentMembers = new Set(memberData.members || []);
    allUsers = users.filter(u => u !== username);
    
    function renderUsersList(usersToShow) {
      usersList.innerHTML = '';
      usersToShow.forEach(user => {
        const userDiv = document.createElement('div');
        userDiv.className = 'edit-room-user-item';
        const isMember = currentMembers.has(user);
        
        userDiv.innerHTML = `
          <input type="checkbox" id="user-${user}" ${isMember ? 'checked' : ''} class="user-checkbox">
          <label for="user-${user}">${user}</label>
        `;
        
        const checkbox = userDiv.querySelector('.user-checkbox');
        checkbox.onchange = () => {
          if (checkbox.checked) {
            currentMembers.add(user);
          } else {
            currentMembers.delete(user);
          }
        };
        
        usersList.appendChild(userDiv);
      });
    }
    
    renderUsersList(allUsers);
    
    searchInput.addEventListener('input', (e) => {
      const search = e.target.value.toLowerCase();
      const filtered = allUsers.filter(u => u.toLowerCase().includes(search));
      renderUsersList(filtered);
    });
  });
  
  // Save button
  const saveBtn = document.createElement('button');
  saveBtn.className = 'edit-room-save-btn';
  saveBtn.textContent = 'Save Changes';
  saveBtn.onclick = () => {
    const selectedUsers = Array.from(currentMembers);
    
    fetch(`/api/rooms/${roomId}/members`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ members: selectedUsers })
    })
    .then(r => r.json())
    .then(data => {
      if (data.success) {
        showNotification(`Room "#${roomId}" updated successfully`, 'success');
        modalOverlay.remove();
        loadRooms();
      } else {
        showNotification(data.error || 'Failed to update room', 'error');
      }
    })
    .catch(error => {
      console.error('Error updating room:', error);
      showNotification('Failed to update room', 'error');
    });
  };
  
  // Cancel button
  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'edit-room-cancel-btn';
  cancelBtn.textContent = 'Cancel';
  cancelBtn.onclick = () => modalOverlay.remove();
  
  // Add elements to modal
  modalContent.appendChild(closeBtn);
  modalContent.appendChild(title);
  modalContent.appendChild(searchLabel);
  modalContent.appendChild(searchInput);
  modalContent.appendChild(usersListLabel);
  modalContent.appendChild(usersList);
  
  const buttonGroup = document.createElement('div');
  buttonGroup.className = 'edit-room-button-group';
  buttonGroup.appendChild(cancelBtn);
  buttonGroup.appendChild(saveBtn);
  modalContent.appendChild(buttonGroup);
  
  modalOverlay.appendChild(modalContent);
  
  // Close modal on overlay click
  modalOverlay.onclick = (e) => {
    if (e.target === modalOverlay) {
      modalOverlay.remove();
    }
  };
  
  document.body.appendChild(modalOverlay);
}

function switchRoom(roomId) {
  if (roomId !== currentRoom || currentDM) {
    socket.emit('switch room', roomId);
    currentRoom = roomId;
    currentDM = null; // Clear DM state when switching to room
    messages.innerHTML = '';

    // Load room messages for default rooms
    if (['general', 'suggestions', 'tech-support'].includes(roomId)) {
      loadRoomMessages(roomId);
    }

    // Update active room styling
    document.querySelectorAll('.room-item').forEach(item => {
      item.classList.remove('active');
    });

    // Find the correct room item to mark as active
    const roomItems = document.querySelectorAll('.room-item');
    roomItems.forEach(item => {
      if (item.textContent.includes(`#${roomId}`)) {
        item.classList.add('active');
      }
    });

    // Update header
    document.getElementById('current-room').textContent = `#${roomId}`;
    document.getElementById('input').placeholder = `Message #${roomId}`;
  }
}

document.querySelector('#form form').addEventListener('submit', (e) => {
  e.preventDefault();
  if (input.value.trim()) {
    const message = input.value.trim();

    if (currentDM) {
      // Send DM
      socket.emit('dm message', {
        targetUser: currentDM,
        message: message
      });
    } else if (!processMessageForDM(message)) {
      // Send room message only if it wasn't processed as a DM
      socket.emit('chat message', message);
    }
    input.value = '';
  }
});

// Create room form - now just redirects to room creation page
const createRoomForm = document.getElementById('create-room-form');
if (createRoomForm) {
  createRoomForm.addEventListener('submit', (e) => {
    e.preventDefault();
    openCreateRoom();
  });
}

socket.on('chat message', (data) => {
  // Play notification sound only if user is NOT currently in this room and message is from another user
  if (currentRoom !== data.room && data.username !== username && data.username !== 'System') {
    playNotificationSound();
  }

  const messageDiv = document.createElement('div');
  messageDiv.className = data.username === 'System' ? 'message system' : 'message';

  // Get the current number of messages to set the index
  const messageIndex = messages.children.length;
  messageDiv.dataset.messageIndex = messageIndex;
  messageDiv.dataset.roomId = currentRoom;

  if (data.username === 'System') {
    messageDiv.innerHTML = `<span class="content">${data.message}</span>`;
  } else {
    // Process mentions, links, and images in the message
    let processedMessage = data.message;
    if (processedMessage.includes('@')) {
      processedMessage = processedMessage.replace(/@(\w+)/g, '<span class="mention">@$1</span>');
    }

    // Process images FIRST (before links to prevent double wrapping)
    // Match image URLs with common extensions (with or without query parameters)
    processedMessage = processedMessage.replace(/(https?:\/\/[^\s]+\.(jpg|jpeg|png|gif|webp|svg)(\?[^\s]*)?)/gi, '<img src="$1" alt="Image" class="message-image" onclick="openImageModal(\'$1\')">');

    // Process remaining links (that aren't already images)
    processedMessage = processedMessage.replace(/(https?:\/\/[^\s]+)/g, function(match) {
      // Don't link if it's already an image
      if (match.match(/\.(jpg|jpeg|png|gif|webp|svg)/i)) {
        return match;
      }
      return '<a href="' + match + '" target="_blank" class="message-link">' + match + '</a>';
    });

    // Get user's profile picture
    fetch(`/api/user-profile/${data.username}`)
      .then(response => response.json())
      .then(profileData => {
        let avatarContent;
        if (profileData.profilePicture) {
          avatarContent = `<img src="${profileData.profilePicture}" alt="${data.username}" style="width: 32px; height: 32px; border-radius: 50%; object-fit: cover; margin-right: 8px;">`;
        } else {
          avatarContent = `<div style="width: 32px; height: 32px; border-radius: 50%; background-color: #5865f2; display: flex; align-items: center; justify-content: center; color: white; font-weight: bold; margin-right: 8px;">${data.username.charAt(0).toUpperCase()}</div>`;
        }

        const messageActions = data.username === username ? `
          <div class="message-actions" style="display: none; margin-left: 8px;">
            <button class="edit-btn" onclick="editMessage('${currentServer}', '${currentChannel}', ${messageIndex}, 'room')">Edit</button>
            <button class="delete-btn" onclick="deleteMessage('${currentServer}', '${currentChannel}', ${messageIndex}, 'room')">Delete</button>
          </div>
        ` : '';

        const msgDate = data.date || '';
        const msgTime = data.time || '';
        messageDiv.innerHTML = `
          <div style="display: flex; align-items: center;" onmouseenter="showMessageActions(this)" onmouseleave="hideMessageActions(this)">
            ${avatarContent}
            <div style="flex: 1;">
              ${msgDate ? `<div class="message-date">${msgDate}</div>` : ''}
              <span class="timestamp">[${msgTime}]</span>
              <span class="username">${data.username}:</span>
              <span class="content">${processedMessage}</span>
            </div>
            ${messageActions}
          </div>
        `;
      })
      .catch(() => {
        // Fallback without profile picture
        const messageActions = data.username === username ? `
          <div class="message-actions" style="display: none; margin-left: 8px;">
            <button class="edit-btn" onclick="editMessage('${currentServer}', '${currentChannel}', ${messageIndex}, 'room')">Edit</button>
            <button class="delete-btn" onclick="deleteMessage('${currentServer}', '${currentChannel}', ${messageIndex}, 'room')">Delete</button>
          </div>
        ` : '';

        const msgDate2 = data.date || '';
        const msgTime2 = data.time || '';
        messageDiv.innerHTML = `
          <div style="display: flex; align-items: center;" onmouseenter="showMessageActions(this)" onmouseleave="hideMessageActions(this)">
            <div style="flex: 1;">
              ${msgDate2 ? `<div class="message-date">${msgDate2}</div>` : ''}
              <span class="timestamp">[${msgTime2}]</span>
              <span class="username">${data.username}:</span>
              <span class="content">${processedMessage}</span>
            </div>
            ${messageActions}
          </div>
        `;
      });
  }

  messages.appendChild(messageDiv);
  autoScrollIfAtBottom();
});

socket.on('room switched', (room) => {
  currentRoom = room;
});

socket.on('dm message', (data) => {
  const dmUser = data.from === username ? data.to : data.from;

  // Play notification sound if user is NOT currently viewing this DM and message is from the other user
  const isCurrentDM = (currentDM === data.from && data.to === username) || (currentDM === data.to && data.from === username);
  if (!isCurrentDM && data.from !== username) {
    playNotificationSound();
  }

  // Only show if we're in the DM with this user
  if (isCurrentDM) {
    const messageDiv = document.createElement('div');
    messageDiv.className = 'message dm-message';

    // Process mentions, links, and images in DM messages
    let processedMessage = data.message;
    if (processedMessage.includes('@')) {
      processedMessage = processedMessage.replace(/@(\w+)/g, '<span class="mention">@$1</span>');
    }

    // Process images FIRST (before links to prevent double wrapping)
    // Match image URLs with common extensions (with or without query parameters)
    processedMessage = processedMessage.replace(/(https?:\/\/[^\s]+\.(jpg|jpeg|png|gif|webp|svg)(\?[^\s]*)?)/gi, '<img src="$1" alt="Image" class="message-image" onclick="openImageModal(\'$1\')">');

    // Process remaining links (that aren't already images)
    processedMessage = processedMessage.replace(/(https?:\/\/[^\s]+)/g, function(match) {
      // Don't link if it's already an image
      if (match.match(/\.(jpg|jpeg|png|gif|webp|svg)/i)) {
        return match;
      }
      return '<a href="' + match + '" target="_blank" class="message-link">' + match + '</a>';
    });

    const dmMsgDate = data.date || '';
    const dmMsgTime = data.time || '';
    messageDiv.innerHTML = `
      ${dmMsgDate ? `<div class="message-date">${dmMsgDate}</div>` : ''}
      <span class="timestamp">[${dmMsgTime}]</span>
      <span class="username">${data.from}:</span>
      <span class="content">${processedMessage}</span>
    `;
    messages.appendChild(messageDiv);
    autoScrollIfAtBottom();
  }

  // Update DM history
  if (!dmHistories[dmUser]) {
    dmHistories[dmUser] = [];
  }
  dmHistories[dmUser].push(data);
});

socket.on('user online', (users) => {
  onlineUsers = users.filter(user => user !== username);
  loadOnlineUsers();
});

socket.on('user banned', (data) => {
  bannedUsers.add(data.bannedUser);

  // Remove from online users
  onlineUsers = onlineUsers.filter(user => user !== data.bannedUser);

  // If currently in DM with banned user, close it
  if (currentDM === data.bannedUser) {
    currentDM = null;
    messages.innerHTML = '';
    document.getElementById('current-room').textContent = '#general';
    document.getElementById('input').placeholder = 'Message #general';
  }

  // Clear the user list before reloading to prevent duplicates
  const onlineUserList = document.getElementById('online-user-list');
  if (onlineUserList) {
    onlineUserList.innerHTML = '';
  }
  loadOnlineUsers();

  const messageDiv = document.createElement('div');
  messageDiv.className = 'message system';
  messageDiv.innerHTML = `<span class="content">${data.bannedUser} was banned by ${data.byAdmin}</span>`;
  messages.appendChild(messageDiv);
  autoScrollIfAtBottom();
});

socket.on('banned', (data) => {
  showNotification(data.message, 'error', 'Account Banned');
  setTimeout(() => {
    window.location.href = '/login';
  }, 3000);
});

// Navigation button functionality
document.addEventListener('DOMContentLoaded', () => {
  // General button functionality
  const generalBtn = document.getElementById('general-btn');
  if (generalBtn) {
    generalBtn.addEventListener('click', () => {
      switchRoom('general');
      currentDM = null; // Clear any DM state
    });
  }

  // Account button functionality
  const accountBtn = document.getElementById('account-btn');
  if (accountBtn) {
    accountBtn.addEventListener('click', () => {
      window.location.href = '/account';
    });
  }

  // Logout functionality
  const logoutBtn = document.getElementById('logout-btn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', () => {
      fetch('/logout', { method: 'POST' })
        .then(() => {
          window.location.href = '/login';
        })
        .catch(err => {
          console.error('Logout failed:', err);
        });
    });
  }

  // Create room button - redirect to room creation page
  const createRoomBtn = document.getElementById('create-room-btn');
  if (createRoomBtn) {
    createRoomBtn.addEventListener('click', (e) => {
      e.preventDefault();
      openCreateRoom();
    });
  }

  const createRoomForm = document.getElementById('create-room-form');
  if (createRoomForm) {
    createRoomForm.addEventListener('submit', (e) => {
      e.preventDefault();
      openCreateRoom();
    });
  }
});

// Show ban options with duration prompt (admin only)
function showBanOptions(targetUser) {
  if (!isAdmin) {
    showNotification('You do not have permission to ban users.', 'error');
    return;
  }

  // Create and show ban modal
  const existingModal = document.getElementById('ban-modal');
  if (existingModal) {
    existingModal.remove();
  }

  const modal = document.createElement('div');
  modal.id = 'ban-modal';
  modal.className = 'ban-modal';
  modal.innerHTML = `
    <div class="ban-modal-content">
      <h2>Ban User: ${targetUser}</h2>
      <p>Select an action for this user:</p>

      <div class="ban-options">
        <div class="ban-option">
          <label>Temporary Ban (minutes):</label>
          <div class="ban-time-options">
            <button class="ban-time-btn" data-minutes="5">5 min</button>
            <button class="ban-time-btn" data-minutes="15">15 min</button>
            <button class="ban-time-btn" data-minutes="30">30 min</button>
            <button class="ban-time-btn" data-minutes="60">1 hour</button>
            <button class="ban-time-btn" data-minutes="1440">24 hours</button>
          </div>
          <div class="custom-time">
            <input type="number" id="custom-ban-time" placeholder="Custom minutes" min="1" max="10080">
            <button class="ban-time-btn custom" id="custom-ban-btn">Apply</button>
          </div>
        </div>

        <div class="ban-divider"></div>

        <div class="ban-option danger">
          <button class="permanent-ban-btn" id="permanent-ban-btn">Permanent Ban</button>
          <p class="warning-text">User will be banned forever and cannot access the chat.</p>
        </div>

        <div class="ban-divider"></div>

        <div class="ban-option danger">
          <button class="delete-user-btn" id="delete-user-btn">Delete User Account</button>
          <p class="warning-text">This will permanently delete the user's account and ban them.</p>
        </div>
      </div>

      <div class="ban-modal-footer">
        <button class="cancel-btn" id="cancel-ban-btn">Cancel</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  // Add event listeners
  const timeBtns = modal.querySelectorAll('.ban-time-btn:not(.custom)');
  timeBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const minutes = parseInt(btn.dataset.minutes);
      banUser(targetUser, minutes);
      modal.remove();
    });
  });

  document.getElementById('custom-ban-btn').addEventListener('click', () => {
    const customTime = parseInt(document.getElementById('custom-ban-time').value);
    if (customTime && customTime > 0) {
      banUser(targetUser, customTime);
      modal.remove();
    } else {
      showNotification('Please enter a valid number of minutes', 'error');
    }
  });

  document.getElementById('permanent-ban-btn').addEventListener('click', () => {
    showConfirmNotification(`Are you sure you want to PERMANENTLY ban ${targetUser}? This cannot be undone.`, () => {
      banUser(targetUser, 0);
      modal.remove();
    }, 'Permanent Ban');
  });

  document.getElementById('delete-user-btn').addEventListener('click', () => {
    showConfirmNotification(`Are you sure you want to DELETE ${targetUser}'s account? This will permanently remove them.`, () => {
      banUser(targetUser, 0);
      modal.remove();
    }, 'Delete User');
  });

  document.getElementById('cancel-ban-btn').addEventListener('click', () => {
    modal.remove();
  });

  // Close on click outside
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      modal.remove();
    }
  });
}

// Ban user function (admin only)
function banUser(targetUser, banMinutes) {
  if (!isAdmin) {
    showNotification('You do not have permission to ban users.', 'error');
    return;
  }

  const banMessage = banMinutes === 0 ? 'permanently' : `for ${banMinutes} minutes`;
  socket.emit('ban user', { targetUser: targetUser, banMinutes: banMinutes });
  bannedUsers.add(targetUser);
  showNotification(`${targetUser} has been banned ${banMessage}.`, 'success', 'User Banned');
}

// Process @username mentions for DM
function processMessageForDM(message) {
  const dmPattern = /@(\w+)\s+(.*)/;
  const match = message.match(dmPattern);

  if (match) {
    const targetUser = match[1];
    const dmMessage = match[2];

    if (dmMessage.trim()) {
      // Send DM
      socket.emit('dm message', {
        targetUser: targetUser,
        message: dmMessage
      });

      // Show in chat that DM was sent
      const messageDiv = document.createElement('div');
      messageDiv.className = 'message';
      const nowDate = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      const nowTime = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
      messageDiv.innerHTML = `
        <div class="message-date">${nowDate}</div>
        <span class="timestamp">[${nowTime}]</span>
        <span class="username">${username}:</span>
        <span class="content">Sent DM to <span class="dm-highlight">@${targetUser}</span>: ${dmMessage}</span>
      `;
      messages.appendChild(messageDiv);
      autoScrollIfAtBottom();

      return true; // Message was processed as DM
    }
  }

  return false; // Not a DM message
}

// Image modal functions
function openImageModal(imageUrl) {
  // Remove existing modal
  const existingModal = document.getElementById('image-modal');
  if (existingModal) {
    existingModal.remove();
  }

  // Create modal
  const modal = document.createElement('div');
  modal.id = 'image-modal';
  modal.className = 'image-modal';
  modal.innerHTML = `
    <div class="image-modal-content">
      <span class="image-modal-close" onclick="closeImageModal()">&times;</span>
      <img src="${imageUrl}" alt="Full size image" class="image-modal-img">
      <div class="image-modal-caption">
        <a href="${imageUrl}" target="_blank" class="image-modal-link">Open in new tab</a>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  // Close modal when clicking outside
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      closeImageModal();
    }
  });

  // Close modal on escape key
  document.addEventListener('keydown', function escapeHandler(e) {
    if (e.key === 'Escape') {
      closeImageModal();
      document.removeEventListener('keydown', escapeHandler);
    }
  });
}

function closeImageModal() {
  const modal = document.getElementById('image-modal');
  if (modal) {
    modal.remove();
  }
}

// Image upload functionality
const imageUploadInput = document.getElementById('image-upload');
const uploadImageBtn = document.getElementById('upload-image-btn');

if (uploadImageBtn && imageUploadInput) {
  uploadImageBtn.addEventListener('click', () => {
    imageUploadInput.click();
  });

  imageUploadInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    // Check file size (5MB limit)
    if (file.size > 5 * 1024 * 1024) {
      showNotification('Image must be less than 5MB', 'error');
      imageUploadInput.value = '';
      return;
    }

    // Check file type
    if (!file.type.startsWith('image/')) {
      showNotification('Only image files are allowed', 'error');
      imageUploadInput.value = '';
      return;
    }

    const formData = new FormData();
    formData.append('image', file);

    try {
      const response = await fetch('/api/upload-image', {
        method: 'POST',
        body: formData
      });

      const data = await response.json();

      if (data.success) {
        // Send the image URL as a message
        const imageUrl = window.location.origin + data.imageUrl;
        socket.emit('chat message', imageUrl);
        showNotification('Image uploaded successfully!', 'success');
      } else {
        showNotification('Failed to upload image: ' + data.error, 'error');
      }
    } catch (error) {
      console.error('Error uploading image:', error);
      showNotification('Failed to upload image', 'error');
    }

    // Clear the input
    imageUploadInput.value = '';
  });
}

// Focus input on page load
window.addEventListener('load', () => {
  if (input) {
    input.focus();
  }
});

// Message actions functions
function showMessageActions(messageElement) {
  const actions = messageElement.querySelector('.message-actions');
  if (actions) {
    actions.style.display = 'flex';
  }
}

function hideMessageActions(messageElement) {
  const actions = messageElement.querySelector('.message-actions');
  if (actions) {
    actions.style.display = 'none';
  }
}

function editMessage(serverId, channelId, messageId, type) {
  const messageDiv = document.querySelector(`[data-message-id="${messageId}"]`);
  if (!messageDiv) return;

  const contentSpan = messageDiv.querySelector('.content');
  const currentText = contentSpan.textContent;

  const input = document.createElement('input');
  input.type = 'text';
  input.value = currentText;
  input.className = 'edit-input';
  input.style.cssText = 'background: #40444b; border: 1px solid #202225; color: #dcddde; padding: 4px 8px; border-radius: 4px; font-size: 14px; width: 200px;';

  const saveBtn = document.createElement('button');
  saveBtn.textContent = 'Save';
  saveBtn.className = 'save-btn';
  saveBtn.style.cssText = 'margin-left: 8px; padding: 4px 8px; background: #3ba55c; color: white; border: none; border-radius: 4px; cursor: pointer;';

  const cancelBtn = document.createElement('button');
  cancelBtn.textContent = 'Cancel';
  cancelBtn.className = 'cancel-btn';
  cancelBtn.style.cssText = 'margin-left: 4px; padding: 4px 8px; background: #ed4245; color: white; border: none; border-radius: 4px; cursor: pointer;';

  const editContainer = document.createElement('div');
  editContainer.style.display = 'flex';
  editContainer.style.alignItems = 'center';
  editContainer.appendChild(input);
  editContainer.appendChild(saveBtn);
  editContainer.appendChild(cancelBtn);

  contentSpan.style.display = 'none';
  contentSpan.parentNode.appendChild(editContainer);

  input.focus();
  input.select();

  function saveEdit() {
    const newMessage = input.value.trim();
    if (newMessage && newMessage !== currentText) {
      let url;
      if (type === 'room') {
        url = `/api/servers/${serverId}/channels/${channelId}/messages/${messageId}`;
      } else {
        url = `/api/dm/${serverId}/messages/${messageId}`;
      }

      fetch(url, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ newMessage })
      })
      .then(response => response.json())
      .then(data => {
        if (data.success) {
          contentSpan.textContent = newMessage;
          contentSpan.style.display = 'inline';
          editContainer.remove();

          // Add edited indicator if not already present
          if (!messageDiv.querySelector('.edited')) {
            const editedSpan = document.createElement('span');
            editedSpan.className = 'edited';
            editedSpan.textContent = ' (edited)';
            editedSpan.style.color = '#72767d';
            editedSpan.style.fontSize = '12px';
            contentSpan.parentNode.appendChild(editedSpan);
          }
        } else {
          showNotification(data.error || 'Failed to edit message', 'error');
          cancelEdit();
        }
      })
      .catch(error => {
        console.error('Error editing message:', error);
        showNotification('Failed to edit message', 'error');
        cancelEdit();
      });
    } else {
      cancelEdit();
    }
  }

  function cancelEdit() {
    contentSpan.style.display = 'inline';
    editContainer.remove();
  }

  saveBtn.onclick = saveEdit;
  cancelBtn.onclick = cancelEdit;

  input.onkeydown = (e) => {
    if (e.key === 'Enter') {
      saveEdit();
    } else if (e.key === 'Escape') {
      cancelEdit();
    }
  };
}

function deleteMessage(serverId, channelId, messageId, type) {
  let url;
  if (type === 'room') {
    url = `/api/servers/${serverId}/channels/${channelId}/messages/${messageId}`;
  } else {
    // For DMs, roomOrUser is the targetUser
    url = `/api/dm/${serverId}/messages/${messageId}`;
  }

  fetch(url, {
    method: 'DELETE'
  })
  .then(response => response.json())
  .then(data => {
    if (data.success) {
      const messageDiv = document.querySelector(`[data-message-id="${messageId}"]`);
      if (messageDiv) {
        messageDiv.remove();
        showNotification('Message deleted', 'success');
      }
    } else {
      showNotification(data.error || 'Failed to delete message', 'error');
    }
  })
  .catch(error => {
    console.error('Error deleting message:', error);
    showNotification('Failed to delete message', 'error');
  });
}

function updateMessageIndices() {
  const messageElements = messages.querySelectorAll('[data-message-index]');
  messageElements.forEach((element, index) => {
    element.dataset.messageIndex = index;
  });
}

// Socket handlers for message editing and deletion
socket.on('message edited', (data) => {
  const messageDiv = document.querySelector(`[data-message-id="${data.messageId}"]`);
  if (messageDiv) {
    const contentSpan = messageDiv.querySelector('.content');
    if (contentSpan) {
      contentSpan.textContent = data.newMessage;

      // Add or update edited indicator
      let editedSpan = messageDiv.querySelector('.edited');
      if (!editedSpan) {
        editedSpan = document.createElement('span');
        editedSpan.className = 'edited';
        editedSpan.style.color = '#72767d';
        editedSpan.style.fontSize = '12px';
        contentSpan.parentNode.appendChild(editedSpan);
      }
      editedSpan.textContent = ` (edited at ${data.editedAt})`;
    }
  }
});

socket.on('message deleted', (data) => {
  const messageDiv = document.querySelector(`[data-message-id="${data.messageId}"]`);
  if (messageDiv) {
    messageDiv.remove();
  }
});

socket.on('dm message edited', (data) => {
  const messageDiv = document.querySelector(`[data-message-id="${data.messageId}"]`);
  if (messageDiv) {
    const contentSpan = messageDiv.querySelector('.content');
    if (contentSpan) {
      contentSpan.textContent = data.newMessage;

      // Add or update edited indicator
      let editedSpan = messageDiv.querySelector('.edited');
      if (!editedSpan) {
        editedSpan = document.createElement('span');
        editedSpan.className = 'edited';
        editedSpan.style.color = '#72767d';
        editedSpan.style.fontSize = '12px';
        contentSpan.parentNode.appendChild(editedSpan);
      }
      editedSpan.textContent = ` (edited at ${data.editedAt})`;
    }
  }
});

socket.on('dm message deleted', (data) => {
  const messageDiv = document.querySelector(`[data-message-id="${data.messageId}"]`);
  if (messageDiv) {
    messageDiv.remove();
  }
});