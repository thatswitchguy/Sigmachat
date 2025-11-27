// Context menu for room items
const socket = io();

let username = null;
let currentRoom = 'general';
let currentDM = null;
let additionalRoomsCreated = 0;
const maxAdditionalRooms = 3;
let onlineUsers = [];
let dmHistories = {};
let isAdmin = false;
let bannedUsers = new Set();

// Check if user is logged in
fetch('/api/user')
  .then(response => response.json())
  .then(data => {
    if (data.username) {
      username = data.username;
      // Check if user is admin
      isAdmin = data.username === 'thatswitchguy' || data.username === 'ikhan';
      socket.emit('join', { username: username, room: currentRoom });
      loadRooms();
      loadOnlineUsers();
      // Load messages for default rooms
      if (['general', 'suggestions', 'tech-support'].includes(currentRoom)) {
        loadRoomMessages(currentRoom);
      }
    } else {
      window.location.href = '/login';
    }
  })
  .catch(() => {
    window.location.href = '/login';
  });

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
  const createRoomInput = document.getElementById('create-room-input');

  roomCountElement.textContent = `${additionalRoomsCreated}/${maxAdditionalRooms} additional rooms created`;

  if (additionalRoomsCreated >= maxAdditionalRooms) {
    createRoomBtn.disabled = true;
    createRoomInput.disabled = true;
    createRoomBtn.textContent = 'Max Rooms Reached';
  } else {
    createRoomBtn.disabled = false;
    createRoomInput.disabled = false;
    createRoomBtn.textContent = 'Create Room';
  }
}

function loadRoomMessages(roomId) {
  fetch(`/api/${roomId}/messages`)
    .then(response => response.json())
    .then(roomMessages => {
      roomMessages.forEach((messageData, index) => {
        const messageDiv = document.createElement('div');
        messageDiv.className = messageData.username === 'System' ? 'message system' : 'message';
        messageDiv.dataset.messageIndex = index;
        messageDiv.dataset.roomId = roomId;

        if (messageData.username === 'System' || !messageData.username) {
          messageDiv.innerHTML = `<span class="content">${messageData.message}</span>`;
          messages.appendChild(messageDiv);
        } else {
          // Process mentions, links, and images in the message
          let processedMessage = messageData.message;
          if (processedMessage.includes('@')) {
            processedMessage = processedMessage.replace(/@(\w+)/g, '<span class="mention">@$1</span>');
          }
          
          // Process links
          processedMessage = processedMessage.replace(/(https?:\/\/[^\s]+)/g, '<a href="$1" target="_blank" class="message-link">$1</a>');
          
          // Process images (common image extensions)
          processedMessage = processedMessage.replace(/(https?:\/\/[^\s]+\.(jpg|jpeg|png|gif|webp|svg))/gi, '<img src="$1" alt="Image" class="message-image" onclick="openImageModal(\'$1\')">');
          
          // Process image URLs that end with image extensions but might have query parameters
          processedMessage = processedMessage.replace(/(https?:\/\/[^\s]*\.(jpg|jpeg|png|gif|webp|svg)[^\s]*)/gi, '<img src="$1" alt="Image" class="message-image" onclick="openImageModal(\'$1\')">');

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
                  <button class="edit-btn" onclick="editMessage('${roomId}', ${index}, 'room')">Edit</button>
                  <button class="delete-btn" onclick="deleteMessage('${roomId}', ${index}, 'room')">Delete</button>
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
              // Fallback without profile picture
              const editedIndicator = messageData.edited ? ` <span class="edited">(edited at ${messageData.editedAt})</span>` : '';
              const messageActions = messageData.username === username ? `
                <div class="message-actions" style="display: none; margin-left: 8px;">
                  <button class="edit-btn" onclick="editMessage('${roomId}', ${index}, 'room')">Edit</button>
                  <button class="delete-btn" onclick="deleteMessage('${roomId}', ${index}, 'room')">Delete</button>
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
      console.error('Error loading general messages:', error);
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
      // Filter out banned users and current user
      const visibleUsers = allUsers.filter(user => !bannedUsers.has(user) && user !== username);

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
          banButton = `<button class="ban-btn" onclick="banUser('${user}')">Ban</button>`;
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
      // Fallback to showing only online users
      const visibleOnlineUsers = onlineUsers.filter(user => !bannedUsers.has(user));
      
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
        messageDiv.dataset.messageIndex = index;
        messageDiv.dataset.targetUser = targetUser;

        // Process mentions, links, and images in DM messages
        let processedMessage = messageData.message;
        if (processedMessage.includes('@')) {
          processedMessage = processedMessage.replace(/@(\w+)/g, '<span class="mention">@$1</span>');
        }
        
        // Process links
        processedMessage = processedMessage.replace(/(https?:\/\/[^\s]+)/g, '<a href="$1" target="_blank" class="message-link">$1</a>');
        
        // Process images (common image extensions)
        processedMessage = processedMessage.replace(/(https?:\/\/[^\s]+\.(jpg|jpeg|png|gif|webp|svg))/gi, '<img src="$1" alt="Image" class="message-image" onclick="openImageModal(\'$1\')">');
        
        // Process image URLs that end with image extensions but might have query parameters
        processedMessage = processedMessage.replace(/(https?:\/\/[^\s]*\.(jpg|jpeg|png|gif|webp|svg)[^\s]*)/gi, '<img src="$1" alt="Image" class="message-image" onclick="openImageModal(\'$1\')">');

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
                <button class="edit-btn" onclick="editMessage('${targetUser}', ${index}, 'dm')">Edit</button>
                <button class="delete-btn" onclick="deleteMessage('${targetUser}', ${index}, 'dm')">Delete</button>
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
      alert(data.error || 'Failed to create room');
    }
  })
  .catch(error => {
    console.error('Error creating room:', error);
    alert('Failed to create room');
  });
}

function showContextMenu(event, roomId, isDefault) {
  // Remove existing context menu
  const existingMenu = document.querySelector('.context-menu');
  if (existingMenu) {
    existingMenu.remove();
  }

  const contextMenu = document.createElement('div');
  contextMenu.className = 'context-menu';

  // Position the menu, ensuring it stays within viewport
  const x = Math.min(event.clientX, window.innerWidth - 150);
  const y = Math.min(event.clientY, window.innerHeight - 100);

  contextMenu.style.left = x + 'px';
  contextMenu.style.top = y + 'px';

  const renameItem = document.createElement('div');
  renameItem.className = `context-menu-item ${isDefault ? 'disabled' : ''}`;
  renameItem.textContent = 'Rename Room';
  if (!isDefault) {
    renameItem.addEventListener('click', (e) => {
      e.stopPropagation();
      contextMenu.remove();
      startRename(roomId);
    });
  }

  const deleteItem = document.createElement('div');
  deleteItem.className = `context-menu-item danger ${isDefault ? 'disabled' : ''}`;
  deleteItem.textContent = 'Delete Room';
  if (!isDefault) {
    deleteItem.addEventListener('click', (e) => {
      e.stopPropagation();
      contextMenu.remove();
      deleteRoom(roomId);
    });
  }

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
      alert(data.error || 'Failed to rename room');
      loadRooms();
    }
  })
  .catch(error => {
    console.error('Error renaming room:', error);
    alert('Failed to rename room');
    loadRooms();
  });
}

function deleteRoom(roomId) {
  if (confirm(`Are you sure you want to delete the room "#${roomId}"? This action cannot be undone.`)) {
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
      } else {
        alert(data.error || 'Failed to delete room');
      }
    })
    .catch(error => {
      console.error('Error deleting room:', error);
      alert('Failed to delete room');
    });
  }
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

// Create room form
const createRoomForm = document.getElementById('create-room-form');
createRoomForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const roomName = document.getElementById('create-room-input').value.trim();
  if (roomName && roomName.length >= 3) {
    createRoom(roomName);
  }
});

socket.on('chat message', (data) => {
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
    
    // Process links
    processedMessage = processedMessage.replace(/(https?:\/\/[^\s]+)/g, '<a href="$1" target="_blank" class="message-link">$1</a>');
    
    // Process images (common image extensions)
    processedMessage = processedMessage.replace(/(https?:\/\/[^\s]+\.(jpg|jpeg|png|gif|webp|svg))/gi, '<img src="$1" alt="Image" class="message-image" onclick="openImageModal(\'$1\')">');
    
    // Process image URLs that end with image extensions but might have query parameters
    processedMessage = processedMessage.replace(/(https?:\/\/[^\s]*\.(jpg|jpeg|png|gif|webp|svg)[^\s]*)/gi, '<img src="$1" alt="Image" class="message-image" onclick="openImageModal(\'$1\')">');

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
            <button class="edit-btn" onclick="editMessage('${currentRoom}', ${messageIndex}, 'room')">Edit</button>
            <button class="delete-btn" onclick="deleteMessage('${currentRoom}', ${messageIndex}, 'room')">Delete</button>
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
            <button class="edit-btn" onclick="editMessage('${currentRoom}', ${messageIndex}, 'room')">Edit</button>
            <button class="delete-btn" onclick="deleteMessage('${currentRoom}', ${messageIndex}, 'room')">Delete</button>
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
  // Only show if we're in the DM with this user
  if ((currentDM === data.from && data.to === username) || 
      (currentDM === data.to && data.from === username)) {
    const messageDiv = document.createElement('div');
    messageDiv.className = 'message dm-message';

    // Process mentions, links, and images in DM messages
    let processedMessage = data.message;
    if (processedMessage.includes('@')) {
      processedMessage = processedMessage.replace(/@(\w+)/g, '<span class="mention">@$1</span>');
    }
    
    // Process links
    processedMessage = processedMessage.replace(/(https?:\/\/[^\s]+)/g, '<a href="$1" target="_blank" class="message-link">$1</a>');
    
    // Process images (common image extensions)
    processedMessage = processedMessage.replace(/(https?:\/\/[^\s]+\.(jpg|jpeg|png|gif|webp|svg))/gi, '<img src="$1" alt="Image" class="message-image" onclick="openImageModal(\'$1\')">');
    
    // Process image URLs that end with image extensions but might have query parameters
    processedMessage = processedMessage.replace(/(https?:\/\/[^\s]*\.(jpg|jpeg|png|gif|webp|svg)[^\s]*)/gi, '<img src="$1" alt="Image" class="message-image" onclick="openImageModal(\'$1\')">');

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
  const dmUser = data.from === username ? data.to : data.from;
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
  
  // If currently in DM with banned user, close it
  if (currentDM === data.bannedUser) {
    currentDM = null;
    messages.innerHTML = '';
    document.getElementById('current-room').textContent = '#general';
    document.getElementById('input').placeholder = 'Message #general';
  }
  
  loadOnlineUsers();

  const messageDiv = document.createElement('div');
  messageDiv.className = 'message system';
  messageDiv.innerHTML = `<span class="content">${data.bannedUser} was banned by ${data.byAdmin}</span>`;
  messages.appendChild(messageDiv);
  autoScrollIfAtBottom();
});

socket.on('banned', (data) => {
  alert(data.message);
  window.location.href = '/login';
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
});

// Ban user function (admin only)
function banUser(targetUser) {
  if (!isAdmin) {
    alert('You do not have permission to ban users.');
    return;
  }

  if (confirm(`Are you sure you want to ban ${targetUser}?`)) {
    socket.emit('ban user', { targetUser: targetUser });
    bannedUsers.add(targetUser);
    loadOnlineUsers();
    alert(`${targetUser} has been banned.`);
  }
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

function editMessage(roomOrUser, messageIndex, type) {
  const messageDiv = document.querySelector(`[data-message-index="${messageIndex}"]`);
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
        url = `/api/${roomOrUser}/messages/${messageIndex}`;
      } else {
        url = `/api/dm/${roomOrUser}/messages/${messageIndex}`;
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
          alert(data.error || 'Failed to edit message');
          cancelEdit();
        }
      })
      .catch(error => {
        console.error('Error editing message:', error);
        alert('Failed to edit message');
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

function deleteMessage(roomOrUser, messageIndex, type) {
  if (confirm('Are you sure you want to delete this message?')) {
    let url;
    if (type === 'room') {
      url = `/api/${roomOrUser}/messages/${messageIndex}`;
    } else {
      url = `/api/dm/${roomOrUser}/messages/${messageIndex}`;
    }

    fetch(url, {
      method: 'DELETE'
    })
    .then(response => response.json())
    .then(data => {
      if (data.success) {
        const messageDiv = document.querySelector(`[data-message-index="${messageIndex}"]`);
        if (messageDiv) {
          messageDiv.remove();
          // Update message indices for remaining messages
          updateMessageIndices();
        }
      } else {
        alert(data.error || 'Failed to delete message');
      }
    })
    .catch(error => {
      console.error('Error deleting message:', error);
      alert('Failed to delete message');
    });
  }
}

function updateMessageIndices() {
  const messageElements = messages.querySelectorAll('[data-message-index]');
  messageElements.forEach((element, index) => {
    element.dataset.messageIndex = index;
  });
}

// Socket handlers for message editing and deletion
socket.on('message edited', (data) => {
  const messageDiv = document.querySelector(`[data-message-index="${data.messageIndex}"][data-room-id="${data.roomId}"]`);
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
  const messageDiv = document.querySelector(`[data-message-index="${data.messageIndex}"][data-room-id="${data.roomId}"]`);
  if (messageDiv) {
    messageDiv.remove();
    updateMessageIndices();
  }
});

socket.on('dm message edited', (data) => {
  const messageDiv = document.querySelector(`[data-message-index="${data.messageIndex}"][data-target-user="${data.targetUser}"]`);
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
  const messageDiv = document.querySelector(`[data-message-index="${data.messageIndex}"][data-target-user="${data.targetUser}"]`);
  if (messageDiv) {
    messageDiv.remove();
    updateMessageIndices();
  }
});