const express = require('express');
const session = require('express-session');
const bcrypt = require('bcrypt');
const fs = require('fs');
const path = require('path');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const PORT = process.env.PORT || 3000; // Updated to use port 5000

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static('public'));

app.use(session({
  secret: 'secret-key-change-in-production',
  resave: true,
  saveUninitialized: true,
  cookie: { secure: false }
}));
let currentRoom = 'room1'; // default room

// File paths for persistent storage
const usersFile = path.join(__dirname, 'users.json');
const roomsFile = path.join(__dirname, 'rooms.json');
const generalMessagesFile = path.join(__dirname, 'general_messages.json');

// Load users from file or use empty object
let users = {};
try {
  if (fs.existsSync(usersFile)) {
    const userData = fs.readFileSync(usersFile, 'utf8');
    users = JSON.parse(userData);
  }
} catch (error) {
  console.error('Error loading users:', error);
  users = {};
}

// Load rooms from file or use defaults - three default rooms now
const defaultRooms = {
  'general': 'General Discussion',
  'suggestions': 'Suggestions',
  'tech-support': 'Tech Support'
};
let rooms = { ...defaultRooms };
let additionalRoomsCreated = 0;

try {
  if (fs.existsSync(roomsFile)) {
    const roomData = fs.readFileSync(roomsFile, 'utf8');
    const loadedRooms = JSON.parse(roomData);
    // Always ensure general room exists, then add custom rooms
    rooms = { ...defaultRooms, ...loadedRooms.rooms };
    additionalRoomsCreated = loadedRooms.additionalRoomsCreated || 0;
  }
} catch (error) {
  console.error('Error loading rooms:', error);
  rooms = { ...defaultRooms };
}

const maxAdditionalRooms = 3;

// Load messages for all default rooms
let roomMessages = {
  general: [],
  suggestions: [],
  'tech-support': []
};

// Load general room messages from file
try {
  if (fs.existsSync(generalMessagesFile)) {
    const messageData = fs.readFileSync(generalMessagesFile, 'utf8');
    roomMessages.general = JSON.parse(messageData);
  }
} catch (error) {
  console.error('Error loading general messages:', error);
  roomMessages.general = [];
}

// Load suggestions room messages
const suggestionsMessagesFile = path.join(__dirname, 'suggestions_messages.json');
try {
  if (fs.existsSync(suggestionsMessagesFile)) {
    const messageData = fs.readFileSync(suggestionsMessagesFile, 'utf8');
    roomMessages.suggestions = JSON.parse(messageData);
  }
} catch (error) {
  console.error('Error loading suggestions messages:', error);
  roomMessages.suggestions = [];
}

// Load tech-support room messages
const techSupportMessagesFile = path.join(__dirname, 'tech_support_messages.json');
try {
  if (fs.existsSync(techSupportMessagesFile)) {
    const messageData = fs.readFileSync(techSupportMessagesFile, 'utf8');
    roomMessages['tech-support'] = JSON.parse(messageData);
  }
} catch (error) {
  console.error('Error loading tech-support messages:', error);
  roomMessages['tech-support'] = [];
}

// File path for profile pictures
const profilePicturesFile = path.join(__dirname, 'profile_pictures.json');

// Load profile pictures from file
let profilePictures = {};
try {
  if (fs.existsSync(profilePicturesFile)) {
    const pictureData = fs.readFileSync(profilePicturesFile, 'utf8');
    profilePictures = JSON.parse(pictureData);
  }
} catch (error) {
  console.error('Error loading profile pictures:', error);
  profilePictures = {};
}

// Save users to file
function saveUsers() {
  try {
    fs.writeFileSync(usersFile, JSON.stringify(users, null, 2));
  } catch (error) {
    console.error('Error saving users:', error);
  }
}

// Save room messages to file
function saveRoomMessages(roomId) {
  try {
    let fileName;
    switch(roomId) {
      case 'general':
        fileName = generalMessagesFile;
        break;
      case 'suggestions':
        fileName = path.join(__dirname, 'suggestions_messages.json');
        break;
      case 'tech-support':
        fileName = path.join(__dirname, 'tech_support_messages.json');
        break;
      default:
        return; // Don't save messages for custom rooms
    }

    // Keep only the last 100 messages to prevent file from growing too large
    const messagesToSave = roomMessages[roomId].slice(-100);
    fs.writeFileSync(fileName, JSON.stringify(messagesToSave, null, 2));
  } catch (error) {
    console.error(`Error saving ${roomId} messages:`, error);
  }
}

// Save DM messages between two users
function saveDMMessages(user1, user2, messages) {
  try {
    const dmKey = [user1, user2].sort().join('_');
    const dmFile = path.join(__dirname, `dm_${dmKey}.json`);
    const messagesToSave = messages.slice(-100); // Keep last 100 messages
    fs.writeFileSync(dmFile, JSON.stringify(messagesToSave, null, 2));
  } catch (error) {
    console.error('Error saving DM messages:', error);
  }
}

// Save profile pictures to file
function saveProfilePictures() {
  try {
    fs.writeFileSync(profilePicturesFile, JSON.stringify(profilePictures, null, 2));
  } catch (error) {
    console.error('Error saving profile pictures:', error);
  }
}

// Track online users and banned users
let onlineUsers = new Set();
let bannedUsers = new Set();
const adminUsers = new Set(['ikhan', 'your_username_here']); // Add your username here

// Save rooms to file
function saveRooms() {
  try {
    // Only save non-default rooms
    const defaultRoomIds = ['general', 'suggestions', 'tech-support'];
    const customRooms = {};
    Object.keys(rooms).forEach(roomId => {
      if (!defaultRoomIds.includes(roomId)) {
        customRooms[roomId] = rooms[roomId];
      }
    });

    const roomData = {
      rooms: customRooms,
      additionalRoomsCreated: additionalRoomsCreated
    };
    fs.writeFileSync(roomsFile, JSON.stringify(roomData, null, 2));
  } catch (error) {
    console.error('Error saving rooms:', error);
  }
}

app.use((req, res, next) => {
  if (req.session && req.session.username) {
    req.username = req.session.username;
  }
  next();
});

// Home route - always redirect to login first
app.get('/', (req, res) => {
  if (req.username) {
    res.redirect('/chat');
  } else {
    res.redirect('/login');
  }
});

// Chat route (same as home)
app.get('/chat', (req, res) => {
  if (req.username) {
    res.sendFile(__dirname + '/public/index.html');
  } else {
    res.redirect('/login'); // Redirect to login if not authenticated
  }
});

// Login page - clear any existing session
app.get('/login', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      console.error('Error destroying session:', err);
    }
    res.sendFile(__dirname + '/public/login.html');
  });
});

// Register page
app.get('/register', (req, res) => {
  res.sendFile(__dirname + '/public/register.html');
});

// Registration endpoint
app.post('/register', async (req, res) => {
  const { username, password, confirmPassword } = req.body;

  if (!username || !password || !confirmPassword) {
    return res.send('All fields are required. <a href="/register">Try again</a>.');
  }

  if (username.length < 3) {
    return res.send('Username must be at least 3 characters. <a href="/register">Try again</a>.');
  }

  if (password.length < 6) {
    return res.send('Password must be at least 6 characters. <a href="/register">Try again</a>.');
  }

  if (password !== confirmPassword) {
    return res.send('Passwords do not match. <a href="/register">Try again</a>.');
  }

  if (users[username]) {
    return res.send('Username already exists. <a href="/register">Try again</a> or <a href="/login">Login</a>.');
  }

  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    users[username] = {
      username: username,
      password: hashedPassword,
      createdAt: new Date()
    };

    saveUsers(); // Save users to file
    req.session.username = username;
    res.redirect('/chat');
  } catch (error) {
    console.error('Registration error:', error);
    res.send('Registration failed. <a href="/register">Try again</a>.');
  }
});

// Login endpoint
app.post('/login', async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.send('Username and password are required. <a href="/login">Try again</a>.');
  }

  const user = users[username];
  if (!user) {
    return res.send('Invalid username or password. <a href="/login">Try again</a> or <a href="/register">Register</a>.');
  }

  try {
    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      return res.send('Invalid username or password. <a href="/login">Try again</a>.');
    }

    req.session.username = username;
    res.redirect('/chat');
  } catch (error) {
    console.error('Login error:', error);
    res.send('Login failed. <a href="/login">Try again</a>.');
  }
});

// API to get logged-in user
app.get('/api/user', (req, res) => {
  if (req.session && req.session.username) {
    res.json({ username: req.session.username });
  } else {
    res.status(401).json({ error: 'Not logged in' });
  }
});

// Logout endpoint
app.post('/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).send('Could not log out.');
    }
    res.redirect('/login');
  });
});

// API to get rooms
app.get('/api/rooms', (req, res) => {
  res.json(rooms);
});

// API to get room messages
app.get('/api/:roomId/messages', (req, res) => {
  const { roomId } = req.params;
  if (roomMessages[roomId]) {
    res.json(roomMessages[roomId]);
  } else {
    res.json([]);
  }
});

// Account page
app.get('/account', (req, res) => {
  if (req.username) {
    res.sendFile(__dirname + '/public/account.html');
  } else {
    res.redirect('/login');
  }
});



// API to get all users for DM list
app.get('/api/users', (req, res) => {
  if (!req.username) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  const userList = Object.keys(users).filter(user => user !== req.username);
  res.json(userList);
});

// API to get DM history between two users
app.get('/api/dm/:targetUser', (req, res) => {
  if (!req.username) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  const { targetUser } = req.params;
  const dmKey = [req.username, targetUser].sort().join('_');
  const dmFile = path.join(__dirname, `dm_${dmKey}.json`);

  try {
    if (fs.existsSync(dmFile)) {
      const dmData = fs.readFileSync(dmFile, 'utf8');
      res.json(JSON.parse(dmData));
    } else {
      res.json([]);
    }
  } catch (error) {
    console.error('Error loading DM history:', error);
    res.json([]);
  }
});

// API to create a new room
app.post('/api/rooms', (req, res) => {
  const { roomName } = req.body;

  if (!roomName || roomName.length < 3 || roomName.length > 20) {
    return res.status(400).json({ error: 'Room name must be between 3 and 20 characters' });
  }

  if (rooms[roomName.toLowerCase()]) {
    return res.status(400).json({ error: 'Room already exists' });
  }

  if (additionalRoomsCreated >= maxAdditionalRooms) {
    return res.status(400).json({ error: 'Maximum number of additional rooms reached (3)' });
  }

  const roomId = roomName.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (roomId.length < 3) {
    return res.status(400).json({ error: 'Room name must contain at least 3 alphanumeric characters' });
  }

  rooms[roomId] = roomName;
  additionalRoomsCreated++;
  saveRooms(); // Save rooms to file

  res.json({ roomId, roomName, success: true });
});

// API to rename a room
app.put('/api/rooms/:roomId', (req, res) => {
  const { roomId } = req.params;
  const { newName } = req.body;

  if (!newName || newName.length < 3 || newName.length > 20) {
    return res.status(400).json({ error: 'Room name must be between 3 and 20 characters' });
  }

  if (!rooms[roomId]) {
    return res.status(404).json({ error: 'Room not found' });
  }

  // Prevent renaming default rooms
  const defaultRoomIds = ['general', 'suggestions', 'tech-support'];
  if (defaultRoomIds.includes(roomId)) {
    return res.status(400).json({ error: 'Cannot rename default rooms' });
  }

  rooms[roomId] = newName;
  saveRooms(); // Save rooms to file
  res.json({ roomId, roomName: newName, success: true });
});

// API to delete a room
app.delete('/api/rooms/:roomId', (req, res) => {
  const { roomId } = req.params;

  if (!rooms[roomId]) {
    return res.status(404).json({ error: 'Room not found' });
  }

  const defaultRoomIds = ['general', 'suggestions', 'tech-support'];
  if (defaultRoomIds.includes(roomId)) {
    return res.status(400).json({ error: 'Cannot delete default rooms' });
  }

  delete rooms[roomId];
  additionalRoomsCreated--;
  saveRooms(); // Save rooms to file

  res.json({ success: true });
});

// API to get user's profile picture
app.get('/api/profile-picture', (req, res) => {
  if (!req.username) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  const profilePicture = profilePictures[req.username];
  res.json({ profilePicture: profilePicture || null });
});

// API to update user's profile picture
app.post('/api/profile-picture', (req, res) => {
  if (!req.username) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  const { profilePicture } = req.body;

  if (!profilePicture || typeof profilePicture !== 'string') {
    return res.status(400).json({ error: 'Invalid profile picture URL' });
  }

  // Basic URL validation
  try {
    new URL(profilePicture);
  } catch (error) {
    return res.status(400).json({ error: 'Invalid URL format' });
  }

  profilePictures[req.username] = profilePicture;
  saveProfilePictures();

  res.json({ success: true });
});

// API to delete user's profile picture
app.delete('/api/profile-picture', (req, res) => {
  if (!req.username) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  delete profilePictures[req.username];
  saveProfilePictures();

  res.json({ success: true });
});

// API to get any user's profile picture (for displaying in user lists)
app.get('/api/user-profile/:username', (req, res) => {
  if (!req.username) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  const { username } = req.params;
  const profilePicture = profilePictures[username];
  res.json({ profilePicture: profilePicture || null });
});

// API to edit a room message
app.put('/api/:roomId/messages/:messageIndex', (req, res) => {
  if (!req.username) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  const { roomId, messageIndex } = req.params;
  const { newMessage } = req.body;
  const index = parseInt(messageIndex);

  if (!roomMessages[roomId] || !roomMessages[roomId][index]) {
    return res.status(404).json({ error: 'Message not found' });
  }

  const message = roomMessages[roomId][index];
  if (message.username !== req.username) {
    return res.status(403).json({ error: 'Can only edit your own messages' });
  }

  if (!newMessage || newMessage.trim().length === 0) {
    return res.status(400).json({ error: 'Message cannot be empty' });
  }

  roomMessages[roomId][index].message = newMessage.trim();
  roomMessages[roomId][index].edited = true;
  roomMessages[roomId][index].editedAt = new Date().toLocaleTimeString();

  saveRoomMessages(roomId);

  // Broadcast the edit to all users in the room
  io.to(roomId).emit('message edited', {
    roomId,
    messageIndex: index,
    newMessage: newMessage.trim(),
    edited: true,
    editedAt: roomMessages[roomId][index].editedAt
  });

  res.json({ success: true });
});

// API to delete a room message
app.delete('/api/:roomId/messages/:messageIndex', (req, res) => {
  if (!req.username) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  const { roomId, messageIndex } = req.params;
  const index = parseInt(messageIndex);

  if (!roomMessages[roomId] || !roomMessages[roomId][index]) {
    return res.status(404).json({ error: 'Message not found' });
  }

  const message = roomMessages[roomId][index];
  if (message.username !== req.username) {
    return res.status(403).json({ error: 'Can only delete your own messages' });
  }

  roomMessages[roomId].splice(index, 1);
  saveRoomMessages(roomId);

  // Broadcast the deletion to all users in the room
  io.to(roomId).emit('message deleted', {
    roomId,
    messageIndex: index
  });

  res.json({ success: true });
});

// API to edit a DM message
app.put('/api/dm/:targetUser/messages/:messageIndex', (req, res) => {
  if (!req.username) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  const { targetUser, messageIndex } = req.params;
  const { newMessage } = req.body;
  const index = parseInt(messageIndex);

  const dmKey = [req.username, targetUser].sort().join('_');
  const dmFile = path.join(__dirname, `dm_${dmKey}.json`);

  let dmHistory = [];
  try {
    if (fs.existsSync(dmFile)) {
      const dmData = fs.readFileSync(dmFile, 'utf8');
      dmHistory = JSON.parse(dmData);
    }
  } catch (error) {
    console.error('Error loading DM history:', error);
    return res.status(500).json({ error: 'Error loading DM history' });
  }

  if (!dmHistory[index]) {
    return res.status(404).json({ error: 'Message not found' });
  }

  const message = dmHistory[index];
  if (message.from !== req.username) {
    return res.status(403).json({ error: 'Can only edit your own messages' });
  }

  if (!newMessage || newMessage.trim().length === 0) {
    return res.status(400).json({ error: 'Message cannot be empty' });
  }

  dmHistory[index].message = newMessage.trim();
  dmHistory[index].edited = true;
  dmHistory[index].editedAt = new Date().toLocaleTimeString();

  saveDMMessages(req.username, targetUser, dmHistory);

  // Broadcast the edit to both users
  const targetSocket = Array.from(io.sockets.sockets.values())
    .find(s => s.username === targetUser);
  const senderSocket = Array.from(io.sockets.sockets.values())
    .find(s => s.username === req.username);

  const editData = {
    targetUser,
    messageIndex: index,
    newMessage: newMessage.trim(),
    edited: true,
    editedAt: dmHistory[index].editedAt
  };

  if (targetSocket) {
    targetSocket.emit('dm message edited', editData);
  }
  if (senderSocket) {
    senderSocket.emit('dm message edited', editData);
  }

  res.json({ success: true });
});

// API to delete a DM message
app.delete('/api/dm/:targetUser/messages/:messageIndex', (req, res) => {
  if (!req.username) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  const { targetUser, messageIndex } = req.params;
  const index = parseInt(messageIndex);

  const dmKey = [req.username, targetUser].sort().join('_');
  const dmFile = path.join(__dirname, `dm_${dmKey}.json`);

  let dmHistory = [];
  try {
    if (fs.existsSync(dmFile)) {
      const dmData = fs.readFileSync(dmFile, 'utf8');
      dmHistory = JSON.parse(dmData);
    }
  } catch (error) {
    console.error('Error loading DM history:', error);
    return res.status(500).json({ error: 'Error loading DM history' });
  }

  if (!dmHistory[index]) {
    return res.status(404).json({ error: 'Message not found' });
  }

  const message = dmHistory[index];
  if (message.from !== req.username) {
    return res.status(403).json({ error: 'Can only delete your own messages' });
  }

  dmHistory.splice(index, 1);
  saveDMMessages(req.username, targetUser, dmHistory);

  // Broadcast the deletion to both users
  const targetSocket = Array.from(io.sockets.sockets.values())
    .find(s => s.username === targetUser);
  const senderSocket = Array.from(io.sockets.sockets.values())
    .find(s => s.username === req.username);

  const deleteData = {
    targetUser,
    messageIndex: index
  };

  if (targetSocket) {
    targetSocket.emit('dm message deleted', deleteData);
  }
  if (senderSocket) {
    senderSocket.emit('dm message deleted', deleteData);
  }

  res.json({ success: true });
});

// API to change username
app.post('/api/change-username', async (req, res) => {
  if (!req.username) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  const { newUsername } = req.body;

  if (!newUsername || newUsername.length < 3 || newUsername.length > 20) {
    return res.status(400).json({ error: 'Username must be between 3 and 20 characters' });
  }

  if (users[newUsername]) {
    return res.status(400).json({ error: 'Username already exists' });
  }

  if (newUsername === req.username) {
    return res.status(400).json({ error: 'New username must be different from current username' });
  }

  try {
    // Update user data
    const userData = users[req.username];
    delete users[req.username];
    users[newUsername] = {
      ...userData,
      username: newUsername
    };

    // Update profile picture if exists
    if (profilePictures[req.username]) {
      profilePictures[newUsername] = profilePictures[req.username];
      delete profilePictures[req.username];
      saveProfilePictures();
    }

    saveUsers();

    // Disconnect user to force re-login
    const userSocket = Array.from(io.sockets.sockets.values())
      .find(s => s.username === req.username);
    if (userSocket) {
      userSocket.disconnect();
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Error changing username:', error);
    res.status(500).json({ error: 'Failed to change username' });
  }
});

// API to change password
app.post('/api/change-password', async (req, res) => {
  if (!req.username) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  const { currentPassword, newPassword } = req.body;

  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'Current password and new password are required' });
  }

  if (newPassword.length < 6) {
    return res.status(400).json({ error: 'New password must be at least 6 characters' });
  }

  const user = users[req.username];
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  try {
    // Verify current password
    const validPassword = await bcrypt.compare(currentPassword, user.password);
    if (!validPassword) {
      return res.status(400).json({ error: 'Current password is incorrect' });
    }

    // Hash new password
    const hashedNewPassword = await bcrypt.hash(newPassword, 10);
    users[req.username].password = hashedNewPassword;

    saveUsers();

    res.json({ success: true });
  } catch (error) {
    console.error('Error changing password:', error);
    res.status(500).json({ error: 'Failed to change password' });
  }
});



// Socket.io connection handling
io.on('connection', (socket) => {
  let user;
  let currentRoom = 'general';

  socket.on('join', (data) => {
    user = data.username;
    currentRoom = data.room || 'general';
    socket.username = user;
    socket.join(currentRoom);

    // Add user to online users
    onlineUsers.add(user);
    io.emit('user online', Array.from(onlineUsers));

    socket.to(currentRoom).emit('chat message', {
      username: 'System',
      message: `${user} joined #${currentRoom}.`,
      timestamp: new Date().toLocaleTimeString()
    });
  });

  socket.on('switch room', (newRoom) => {
    if (rooms[newRoom]) {
      socket.leave(currentRoom);
      socket.to(currentRoom).emit('chat message', {
        username: 'System',
        message: `${user} left #${currentRoom}.`,
        timestamp: new Date().toLocaleTimeString()
      });

      currentRoom = newRoom;
      socket.join(currentRoom);

      socket.to(currentRoom).emit('chat message', {
        username: 'System',
        message: `${user} joined #${currentRoom}.`,
        timestamp: new Date().toLocaleTimeString()
      });

      socket.emit('room switched', currentRoom);
    }
  });

  socket.on('chat message', (msg) => {
    const messageData = {
      username: user,
      message: msg,
      timestamp: new Date().toLocaleTimeString()
    };

    // Save message to file for default rooms
    if (roomMessages[currentRoom]) {
      roomMessages[currentRoom].push(messageData);
      saveRoomMessages(currentRoom);
    }

    io.to(currentRoom).emit('chat message', messageData);
  });

  socket.on('dm message', (data) => {
    const { targetUser, message } = data;
    const messageData = {
      from: user,
      to: targetUser,
      message: message,
      timestamp: new Date().toLocaleTimeString()
    };

    // Save DM to file
    const dmKey = [user, targetUser].sort().join('_');
    const dmFile = path.join(__dirname, `dm_${dmKey}.json`);
    let dmHistory = [];

    try {
      if (fs.existsSync(dmFile)) {
        const dmData = fs.readFileSync(dmFile, 'utf8');
        dmHistory = JSON.parse(dmData);
      }
    } catch (error) {
      console.error('Error loading DM history:', error);
    }

    dmHistory.push(messageData);
    saveDMMessages(user, targetUser, dmHistory);

    // Send to target user if online
    const targetSocket = Array.from(io.sockets.sockets.values())
      .find(s => s.username === targetUser);

    if (targetSocket) {
      targetSocket.emit('dm message', messageData);
    }

    // Send back to sender for confirmation
    socket.emit('dm message', messageData);
  });

  socket.on('ban user', (data) => {
    if (adminUsers.has(user)) {
      const { targetUser } = data;
      bannedUsers.add(targetUser);

      // Disconnect the banned user
      const targetSocket = Array.from(io.sockets.sockets.values())
        .find(s => s.username === targetUser);

      if (targetSocket) {
        targetSocket.emit('banned', { message: 'You have been banned from the chat.' });
        targetSocket.disconnect();
      }

      // Notify all users
      io.emit('user banned', { bannedUser: targetUser, byAdmin: user });
    }
  });

  socket.on('disconnect', () => {
    if (user) {
      onlineUsers.delete(user);
      io.emit('user online', Array.from(onlineUsers));

      if (currentRoom) {
        socket.to(currentRoom).emit('chat message', {
          username: 'System',
          message: `${user} left #${currentRoom}.`,
          timestamp: new Date().toLocaleTimeString()
        });
      }
    }
  });
});

// Start the server
http.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
  console.log(`Access your app via the Replit webview`);
});
