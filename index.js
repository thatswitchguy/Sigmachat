
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcrypt');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const PORT = process.env.PORT || 5000;

// Configure multer for image uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadDir = path.join(__dirname, 'public', 'uploads');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
  fileFilter: function (req, file, cb) {
    const allowedTypes = /jpeg|jpg|png|gif|webp/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    
    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error('Only image files are allowed!'));
    }
  }
});

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static('public'));

app.use(session({
  secret: 'secret-key-change-in-production',
  resave: true,
  saveUninitialized: true,
  cookie: { secure: false }
}));

// File paths for persistent storage
const usersFile = path.join(__dirname, 'users.json');
const roomsFile = path.join(__dirname, 'rooms.json');
const generalMessagesFile = path.join(__dirname, 'general_messages.json');
const bannedUsersFile = path.join(__dirname, 'banned_users.json');

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

// Load rooms from file or use defaults
const defaultRooms = {
  'general': { name: 'General Discussion', members: null },
  'suggestions': { name: 'Suggestions', members: null },
  'tech-support': { name: 'Tech Support', members: null }
};
let rooms = { ...defaultRooms };
let roomMembers = {};
let additionalRoomsCreated = 0;

// Track room memberships (who can access which rooms)
const roomMembersFile = path.join(__dirname, 'room_members.json');

// First load room members from file
try {
  if (fs.existsSync(roomMembersFile)) {
    const memberData = fs.readFileSync(roomMembersFile, 'utf8');
    roomMembers = JSON.parse(memberData);
  }
} catch (error) {
  console.error('Error loading room members:', error);
  roomMembers = {};
}

// Then load rooms and merge member info
try {
  if (fs.existsSync(roomsFile)) {
    const roomData = fs.readFileSync(roomsFile, 'utf8');
    const loadedRooms = JSON.parse(roomData);
    const customRooms = loadedRooms.rooms || {};
    Object.keys(customRooms).forEach(roomId => {
      const room = customRooms[roomId];
      if (typeof room === 'object' && room !== null) {
        rooms[roomId] = room;
        if (room.members && Array.isArray(room.members) && room.members.length > 0) {
          roomMembers[roomId] = room.members;
        }
      } else if (typeof room === 'string') {
        rooms[roomId] = { name: room, members: [] };
      }
    });
    additionalRoomsCreated = loadedRooms.additionalRoomsCreated || 0;
  }
} catch (error) {
  console.error('Error loading rooms:', error);
  rooms = { ...defaultRooms };
}

const maxAdditionalRooms = 3;

function saveRoomMembers() {
  try {
    fs.writeFileSync(roomMembersFile, JSON.stringify(roomMembers, null, 2));
  } catch (error) {
    console.error('Error saving room members:', error);
  }
}

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

// File path for user settings
const userSettingsFile = path.join(__dirname, 'user_settings.json');

// Load user settings from file
let userSettings = {};
try {
  if (fs.existsSync(userSettingsFile)) {
    const settingsData = fs.readFileSync(userSettingsFile, 'utf8');
    userSettings = JSON.parse(settingsData);
  }
} catch (error) {
  console.error('Error loading user settings:', error);
  userSettings = {};
}

// Save user settings to file
function saveUserSettings() {
  try {
    fs.writeFileSync(userSettingsFile, JSON.stringify(userSettings, null, 2));
  } catch (error) {
    console.error('Error saving user settings:', error);
  }
}

// Load banned users with expiration times
let bannedUsers = {};
try {
  if (fs.existsSync(bannedUsersFile)) {
    const bannedData = fs.readFileSync(bannedUsersFile, 'utf8');
    bannedUsers = JSON.parse(bannedData);
    // Clean up expired bans on load
    const now = Date.now();
    Object.keys(bannedUsers).forEach(user => {
      if (bannedUsers[user].expiresAt && bannedUsers[user].expiresAt < now) {
        delete bannedUsers[user];
      }
    });
    saveBannedUsers();
  }
} catch (error) {
  console.error('Error loading banned users:', error);
  bannedUsers = {};
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
        return;
    }

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
    const messagesToSave = messages.slice(-100);
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

// Save banned users to file
function saveBannedUsers() {
  try {
    fs.writeFileSync(bannedUsersFile, JSON.stringify(bannedUsers, null, 2));
  } catch (error) {
    console.error('Error saving banned users:', error);
  }
}

// Track online users
let onlineUsers = new Set();
const adminUsers = new Set(['ikhan', 'thatswitchguy']);

// Check if user is banned
function isUserBanned(username) {
  if (!bannedUsers[username]) return false;
  
  const ban = bannedUsers[username];
  if (!ban.expiresAt) return true; // Permanent ban
  
  if (ban.expiresAt < Date.now()) {
    delete bannedUsers[username];
    saveBannedUsers();
    return false;
  }
  
  return true;
}

// Get ban information for display
function getBanInfo(username) {
  const banRecord = bannedUsers[username];
  if (!banRecord) {
    return null;
  }

  if (!banRecord.expiresAt) {
    return { type: 'permanent' };
  }

  const remainingMs = banRecord.expiresAt - Date.now();
  if (remainingMs <= 0) {
    return null;
  }

  const remainingMinutes = Math.ceil(remainingMs / 60000);
  const hours = Math.floor(remainingMinutes / 60);
  const minutes = remainingMinutes % 60;

  return {
    type: 'temporary',
    remainingMinutes,
    hours,
    minutes,
    expiresAt: banRecord.expiresAt
  };
}

// Save rooms to file
function saveRooms() {
  try {
    const defaultRoomIds = ['general', 'suggestions', 'tech-support'];
    const customRooms = {};
    Object.keys(rooms).forEach(roomId => {
      if (!defaultRoomIds.includes(roomId)) {
        const roomData = { ...rooms[roomId] };
        if (roomMembers[roomId]) {
          roomData.members = roomMembers[roomId];
        }
        customRooms[roomId] = roomData;
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

// Home route
app.get('/', (req, res) => {
  if (req.username) {
    res.redirect('/chat');
  } else {
    res.redirect('/login');
  }
});

// Chat route
app.get('/chat', (req, res) => {
  if (req.username) {
    if (isUserBanned(req.username)) {
      req.session.destroy();
      return res.send('You have been banned. <a href="/login">Return to login</a>');
    }
    res.sendFile(__dirname + '/public/index.html');
  } else {
    res.redirect('/login');
  }
});

// Login page
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

// Iframe embed page
app.get('/iframe', (req, res) => {
  res.sendFile(__dirname + '/public/iframe.html');
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

    saveUsers();
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

  if (isUserBanned(username)) {
    const banInfo = getBanInfo(username);
    const banType = banInfo?.type === 'permanent' ? 'permanent' : 'temporary';
    const expiresAt = banInfo?.type === 'temporary' ? banInfo.expiresAt : '';
    return res.redirect(`/banned.html?type=${banType}&expiresAt=${expiresAt}`);
  }

  const user = users[username];
  if (!user) {
    return res.sendFile(__dirname + '/public/invalid-credentials.html');
  }

  try {
    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      return res.sendFile(__dirname + '/public/invalid-credentials.html');
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

// API to get rooms - filter by user access
app.get('/api/rooms', (req, res) => {
  const currentUser = req.username;
  if (!currentUser) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  const filteredRooms = {};
  const defaultRoomIds = ['general', 'suggestions', 'tech-support'];
  
  Object.keys(rooms).forEach(roomId => {
    // Always include default rooms
    if (defaultRoomIds.includes(roomId)) {
      filteredRooms[roomId] = rooms[roomId].name || rooms[roomId];
    } else {
      // For custom rooms, only include if user is a member
      const members = roomMembers[roomId] || [];
      if (members.includes(currentUser)) {
        filteredRooms[roomId] = rooms[roomId].name || rooms[roomId];
      }
    }
  });
  
  res.json(filteredRooms);
});

// API to get room messages - check access
app.get('/api/:roomId/messages', (req, res) => {
  const { roomId } = req.params;
  const currentUser = req.username;
  const defaultRoomIds = ['general', 'suggestions', 'tech-support'];
  
  // Check if user has access to this room
  const hasAccess = defaultRoomIds.includes(roomId) || 
                    (roomMembers[roomId] && roomMembers[roomId].includes(currentUser));
  
  if (!hasAccess) {
    return res.status(403).json({ error: 'Access denied to this room' });
  }
  
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
  const { roomName, selectedUsers } = req.body;
  const currentUser = req.username;

  if (!currentUser) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  if (!roomName || roomName.length < 3 || roomName.length > 20) {
    return res.status(400).json({ error: 'Room name must be between 3 and 20 characters' });
  }

  if (rooms[roomName.toLowerCase()]) {
    return res.status(400).json({ error: 'Room already exists' });
  }

  if (additionalRoomsCreated >= maxAdditionalRooms) {
    return res.status(400).json({ error: 'Maximum number of additional rooms reached (3)' });
  }

  const roomId = roomName.toLowerCase().replace(/[^a-z0-9-]/g, '');
  if (roomId.length < 3) {
    return res.status(400).json({ error: 'Room name must contain at least 3 alphanumeric characters' });
  }

  // Store room with members list
  rooms[roomId] = { name: roomName };
  roomMembers[roomId] = selectedUsers && Array.isArray(selectedUsers) ? 
    [...new Set([currentUser, ...selectedUsers])] : [currentUser];
  
  additionalRoomsCreated++;
  saveRooms();

  res.json({ roomId, roomName, success: true });
});

// API to rename a room
app.put('/api/rooms/:roomId', (req, res) => {
  const { roomId } = req.params;
  const { newName } = req.body;
  const currentUser = req.username;

  if (!newName || newName.length < 3 || newName.length > 20) {
    return res.status(400).json({ error: 'Room name must be between 3 and 20 characters' });
  }

  if (!rooms[roomId]) {
    return res.status(404).json({ error: 'Room not found' });
  }

  const defaultRoomIds = ['general', 'suggestions', 'tech-support'];
  if (defaultRoomIds.includes(roomId)) {
    return res.status(400).json({ error: 'Cannot rename default rooms' });
  }

  // Check if user has access to this room
  const members = roomMembers[roomId] || [];
  if (!members.includes(currentUser)) {
    return res.status(403).json({ error: 'Access denied' });
  }

  const roomData = typeof rooms[roomId] === 'object' ? rooms[roomId] : { name: rooms[roomId] };
  rooms[roomId] = { ...roomData, name: newName };
  saveRooms();
  res.json({ roomId, roomName: newName, success: true });
});

// API to delete a room
app.delete('/api/rooms/:roomId', (req, res) => {
  const { roomId } = req.params;
  const currentUser = req.username;

  if (!rooms[roomId]) {
    return res.status(404).json({ error: 'Room not found' });
  }

  const defaultRoomIds = ['general', 'suggestions', 'tech-support'];
  if (defaultRoomIds.includes(roomId)) {
    return res.status(400).json({ error: 'Cannot delete default rooms' });
  }

  // Check if user has access to this room
  const members = roomMembers[roomId] || [];
  if (!members.includes(currentUser)) {
    return res.status(403).json({ error: 'Access denied' });
  }

  delete rooms[roomId];
  delete roomMembers[roomId];
  additionalRoomsCreated--;
  saveRooms();

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

// API to get any user's profile picture
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
    const userData = users[req.username];
    delete users[req.username];
    users[newUsername] = {
      ...userData,
      username: newUsername
    };

    if (profilePictures[req.username]) {
      profilePictures[newUsername] = profilePictures[req.username];
      delete profilePictures[req.username];
      saveProfilePictures();
    }

    saveUsers();

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
    const validPassword = await bcrypt.compare(currentPassword, user.password);
    if (!validPassword) {
      return res.status(400).json({ error: 'Current password is incorrect' });
    }

    const hashedNewPassword = await bcrypt.hash(newPassword, 10);
    users[req.username].password = hashedNewPassword;

    saveUsers();

    res.json({ success: true });
  } catch (error) {
    console.error('Error changing password:', error);
    res.status(500).json({ error: 'Failed to change password' });
  }
});

// Helper function to format timestamp with date and time (no seconds)
function formatTimestamp() {
  const now = new Date();
  const date = now.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const time = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
  return { date, time };
}

// Socket.io connection handling
io.on('connection', (socket) => {
  let user;
  let currentRoom = 'general';

  socket.on('join', (data) => {
    user = data.username;
    currentRoom = data.room || 'general';
    socket.username = user;
    socket.join(currentRoom);

    onlineUsers.add(user);
    io.emit('user online', Array.from(onlineUsers));

    const ts = formatTimestamp();
    socket.to(currentRoom).emit('chat message', {
      username: 'System',
      message: `${user} joined #${currentRoom}.`,
      date: ts.date,
      time: ts.time
    });
  });

  socket.on('switch room', (newRoom) => {
    if (rooms[newRoom]) {
      socket.leave(currentRoom);
      let ts = formatTimestamp();
      socket.to(currentRoom).emit('chat message', {
        username: 'System',
        message: `${user} left #${currentRoom}.`,
        date: ts.date,
        time: ts.time
      });

      currentRoom = newRoom;
      socket.join(currentRoom);

      ts = formatTimestamp();
      socket.to(currentRoom).emit('chat message', {
        username: 'System',
        message: `${user} joined #${currentRoom}.`,
        date: ts.date,
        time: ts.time
      });

      socket.emit('room switched', currentRoom);
    }
  });

  socket.on('chat message', (msg) => {
    const ts = formatTimestamp();
    const messageData = {
      username: user,
      message: msg,
      date: ts.date,
      time: ts.time
    };

    if (roomMessages[currentRoom]) {
      roomMessages[currentRoom].push(messageData);
      saveRoomMessages(currentRoom);
    }

    io.to(currentRoom).emit('chat message', messageData);
  });

  socket.on('dm message', (data) => {
    const { targetUser, message } = data;
    const ts = formatTimestamp();
    const messageData = {
      from: user,
      to: targetUser,
      message: message,
      date: ts.date,
      time: ts.time
    };

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

    const targetSocket = Array.from(io.sockets.sockets.values())
      .find(s => s.username === targetUser);

    if (targetSocket) {
      targetSocket.emit('dm message', messageData);
    }

    socket.emit('dm message', messageData);
  });

  socket.on('ban user', (data) => {
    if (adminUsers.has(user)) {
      const { targetUser, banMinutes } = data;
      
      const banData = {
        bannedBy: user,
        bannedAt: Date.now()
      };
      
      if (banMinutes === 0) {
        banData.expiresAt = null; // Permanent ban
        // Delete user account permanently if permanent ban
        if (users[targetUser]) {
          delete users[targetUser];
          fs.writeFileSync(usersFile, JSON.stringify(users, null, 2));
        }
      } else {
        banData.expiresAt = Date.now() + (banMinutes * 60 * 1000);
      }
      
      bannedUsers[targetUser] = banData;
      saveBannedUsers();

      const targetSocket = Array.from(io.sockets.sockets.values())
        .find(s => s.username === targetUser);

      if (targetSocket) {
        const banMessage = banMinutes === 0 
          ? 'You have been permanently banned from the chat.'
          : `You have been banned for ${banMinutes} minutes.`;
        targetSocket.emit('banned', { message: banMessage });
        targetSocket.disconnect();
      }

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

// API to upload images
app.post('/api/upload-image', upload.single('image'), (req, res) => {
  if (!req.username) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  const imageUrl = `/uploads/${req.file.filename}`;
  res.json({ success: true, imageUrl: imageUrl });
});

// API to get user settings
app.get('/api/user-settings', (req, res) => {
  if (!req.username) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  if (!userSettings[req.username]) {
    userSettings[req.username] = {
      allowDMs: true,
      dataUsage: true,
      desktopNotifications: true,
      messageSounds: true
    };
  }

  res.json(userSettings[req.username]);
});

// API to update user settings
app.post('/api/user-settings', (req, res) => {
  if (!req.username) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  const { allowDMs, dataUsage, desktopNotifications, messageSounds } = req.body;

  if (!userSettings[req.username]) {
    userSettings[req.username] = {};
  }

  if (typeof allowDMs === 'boolean') userSettings[req.username].allowDMs = allowDMs;
  if (typeof dataUsage === 'boolean') userSettings[req.username].dataUsage = dataUsage;
  if (typeof desktopNotifications === 'boolean') userSettings[req.username].desktopNotifications = desktopNotifications;
  if (typeof messageSounds === 'boolean') userSettings[req.username].messageSounds = messageSounds;

  saveUserSettings();
  res.json({ success: true, settings: userSettings[req.username] });
});

// Start the server
http.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
  console.log(`Access your app via the Replit webview`);
});
