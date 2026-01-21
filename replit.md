# Sigmachat

## Overview

Sigmachat is a Discord-style real-time chat application built with Node.js, Express, and Socket.IO. It provides a multi-server architecture where each server contains unlimited channels, direct messaging, user authentication, and administrative controls. The app uses JSON files for persistent data storage and implements real-time communication through WebSocket connections.

## Recent Changes

**January 2026**
- Fixed channel editing modal and refined message input styling
- Updated plus menu button styling to match Discord's neutral aesthetic
- Updated incognito mode favicon
- Implemented foundational block user system logic in backend
- Standardized UI components (plus options, channel buttons) for visual consistency
- Added protections for default system channels
- Optimized frontend performance for large message histories

**November 2025**
- Fixed duplicate variable declaration in server code causing startup errors
- Removed room creation textbox from main interface - room creation now uses dedicated room-create.html page
- Implemented proper room visibility filtering - custom rooms only visible to invited members
- Added ban confirmation modal with options: 60-minute ban, permanent ban/delete user, or cancel
- Fixed user duplication issue in online users list using Set for unique entries
- Server-side room access control via /api/rooms endpoint filters rooms by membership
- Default rooms (general, suggestions, tech-support) remain visible to all authenticated users

## System Architecture

### Backend Architecture

**Technology Stack**
- **Runtime**: Node.js with Express.js framework
- **Real-time Communication**: Socket.IO for bidirectional WebSocket connections
- **Authentication**: Express-session with bcrypt for password hashing

**File-Based Data Storage**
The application uses a JSON file-based persistence layer instead of a traditional database:
- `users.json` - User credentials and account metadata
- `rooms.json` - Chat room configurations and metadata
- `banned_users.json` - Ban records with timestamps and admin attribution
- `profile_pictures.json` - User avatar URLs
- `general_messages.json`, `suggestions_messages.json` - Per-room message histories
- `dm_[user1]_[user2].json` - Direct message conversations between users

**Rationale**: File-based storage provides simplicity for a small-scale chat application, eliminating database setup overhead. This approach is suitable for development/small deployments but would need migration to a proper database for production scale.

**Session Management**
- Express-session middleware with server-side session storage
- Cookie-based session tracking (currently configured for HTTP; `secure: false`)
- Sessions persist user authentication state across requests

### Frontend Architecture

**Client-Side Components**
- Vanilla JavaScript with Socket.IO client library
- Multiple HTML pages for different application states:
  - `login.html` / `register.html` - Authentication flows
  - `index.html` - Main chat interface
  - `account.html` - User account management
  - `room-create.html` - Room creation interface
  - `iframe.html` - Embeddable chat widget

**Real-time Event Handling**
The client maintains persistent WebSocket connections to handle:
- Message broadcasting and reception
- User presence updates (online/offline status)
- Room and DM navigation
- Administrative actions (bans, room management)

**State Management**
Client-side state includes:
- Current authenticated user
- Active room/DM context
- Online user lists
- DM conversation histories
- Administrative privileges flag

### Authentication & Authorization

**User Authentication**
- Registration with username/password (minimum length validation)
- Passwords hashed using bcrypt with salt rounds
- Session-based authentication (no JWT tokens)

**Authorization Levels**
- Standard users: Can send messages, create limited rooms, manage DMs
- Administrators: Additional privileges for user banning and moderation
- Room limits: Non-admin users restricted to creating 3 additional custom rooms

**Security Considerations**
- Current session secret is hardcoded (noted for production change)
- HTTPS not enforced (cookie secure flag disabled)
- No CSRF protection implemented
- Input validation on username/password length

### Chat Room System

**Room Types**
1. **Default Rooms**: Pre-configured rooms (`general`, `suggestions`, `tech-support`)
2. **Custom Rooms**: User-created rooms with configurable names
3. **Direct Messages**: Private one-to-one conversations

**Room Management**
- Users can create up to 3 additional custom rooms (beyond defaults)
- Room creation count tracked in `rooms.json`
- Context menu functionality for renaming/deleting custom rooms
- Message persistence per room in separate JSON files

### Direct Messaging System

**DM Structure**
- Direct messaging between users stored in files named `dm_[user1]_[user2].json`
- Alphabetical sorting of usernames ensures consistent file naming
- Message format includes: sender, recipient, message content, timestamp/date
- Online user list displays available DM recipients

### Moderation Features

**Ban System**
- Administrators can ban users (permanent or temporary)
- Ban records stored with: banned username, admin who issued ban, timestamp, expiration
- Banned users tracked in `banned_users.json`
- Client-side ban list prevents interaction with banned users

## External Dependencies

### NPM Packages

**Core Framework**
- `express` (^4.18.2) - Web application framework for routing and middleware

**Real-time Communication**
- `socket.io` (^4.7.2) - WebSocket library for bidirectional event-based communication

**Authentication & Security**
- `bcrypt` (^6.0.0) - Password hashing algorithm (bcrypt)
- `express-session` (^1.17.3) - Session middleware for user authentication state

### File System Dependencies

The application relies on Node.js native `fs` module for:
- Reading/writing JSON data files
- Synchronous file existence checks
- Persistent storage of messages, users, and configuration

### Browser APIs

**Client-Side Requirements**
- WebSocket support for Socket.IO connectivity
- Local Storage/Session Storage (implicitly used by Socket.IO client)
- Modern JavaScript ES6+ features

### Third-Party Services

**Profile Pictures**
- External image hosting (example: Pinterest CDN URLs in `profile_pictures.json`)
- No integrated image upload; users provide external URLs

**Note**: The application currently has no database integration. If migrating to a production environment, consider integrating PostgreSQL or MongoDB for improved scalability, query capabilities, and concurrent access handling. 