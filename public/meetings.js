const meetingPeerConnections = new Map();
const pendingMeetingIce = new Map();
const meetingStatesByServer = new Map();
let currentMeeting = null;
let meetingMicrophoneStream = null;
let meetingCameraStream = null;
let meetingScreenStream = null;

function sendMeetingRequest(eventName, payload = {}) {
  return new Promise(resolve => {
    if (!socket.connected) {
      resolve({ success: false, error: 'The chat connection is offline. Reconnect and try again.' });
      return;
    }

    socket.timeout(8000).emit(eventName, payload, (error, response) => {
      resolve(error
        ? { success: false, error: 'The meeting server did not respond. Please try again.' }
        : response || { success: false, error: 'The meeting request could not be completed.' });
    });
  });
}

function setMeetingStatus(message) {
  const status = document.getElementById('meeting-status');
  if (status) status.textContent = message;
}

function isPoliteMeetingPeer(peerSocketId) {
  // Exactly one side of a pair gives way when both devices offer at the same time.
  return String(socket.id) < String(peerSocketId);
}

function stopMeetingStreamTracks(stream) {
  if (!stream) return;
  stream.getTracks().forEach(track => {
    track.onended = null;
    if (track.readyState !== 'ended') track.stop();
  });
}

function describeMeetingMediaError(error = {}, kind = 'camera') {
  switch (error.name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return `Allow ${kind} access in your browser to turn it on.`;
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return `No ${kind} was found on this device.`;
    case 'NotReadableError':
    case 'TrackStartError':
      return `Your ${kind} is being used by another app. Close it and try again.`;
    case 'OverconstrainedError':
    case 'ConstraintNotSatisfiedError':
      return `Your ${kind} does not support the settings this meeting needs.`;
    case 'NotSupportedError':
      return `${kind === 'screen' ? 'Screen sharing' : `Your ${kind}`} is not available in this browser.`;
    default:
      return `Could not turn on the ${kind}. ${error.message || ''}`.trim();
  }
}

async function getMeetingCameraStream() {
  const videoConstraints = { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } };
  try {
    return await navigator.mediaDevices.getUserMedia({ audio: false, video: videoConstraints });
  } catch (error) {
    if (error.name !== 'OverconstrainedError' && error.name !== 'ConstraintNotSatisfiedError' && error.name !== 'TypeError') {
      throw error;
    }
    // Older phones reject the detailed camera settings, so fall back to any camera they expose.
    return navigator.mediaDevices.getUserMedia({ audio: false, video: true });
  }
}

function watchMeetingLocalTrackEnded(stream, kind) {
  const track = stream.getTracks()[0];
  if (!track) return;
  track.onended = () => {
    if (kind === 'camera' && meetingCameraStream === stream) meetingCameraStream = null;
    else if (kind === 'microphone' && meetingMicrophoneStream === stream) meetingMicrophoneStream = null;
    else return;
    stopMeetingStreamTracks(stream);
    if (!currentMeeting) return;
    syncMeetingMediaState();
    requestMeetingRenegotiation();
    showNotification(`Your ${kind} stopped. Turn it on again to keep sharing it.`, 'warning');
  };
}

function syncMeetingMediaState(notifyServer = true) {
  updateMeetingControls();
  if (!currentMeeting) return;
  currentMeeting.participants = currentMeeting.participants.map(participant =>
    participant.socketId === socket.id
      ? {
          ...participant,
          microphoneEnabled: Boolean(meetingMicrophoneStream),
          cameraEnabled: Boolean(meetingCameraStream),
          screenSharing: Boolean(meetingScreenStream)
        }
      : participant
  );
  renderMeetingState();
  if (notifyServer && socket.connected) {
    socket.emit('meeting:media-state', {
      microphoneEnabled: Boolean(meetingMicrophoneStream),
      cameraEnabled: Boolean(meetingCameraStream),
      screenSharing: Boolean(meetingScreenStream)
    });
  }
}

function updateMeetingButton(state = {}) {
  const button = document.getElementById('meeting-button');
  if (!button) return;
  const isActive = state.active === true;
  button.dataset.active = String(isActive);
  button.setAttribute('aria-label', isActive ? 'Join the active server meeting' : 'Start a server meeting');
  button.title = isActive ? 'Join the active server meeting' : 'Start a server meeting';
}

function updateMeetingWindowActions() {
  const overlay = document.getElementById('meeting-overlay');
  const maximizeButton = document.getElementById('meeting-maximize-btn');
  if (!overlay || !maximizeButton) return;
  const label = overlay.classList.contains('is-maximized') || overlay.classList.contains('is-minimized')
    ? 'Restore meeting'
    : 'Enlarge meeting';
  maximizeButton.setAttribute('aria-label', label);
  maximizeButton.title = label;
}

function minimizeMeetingWindow() {
  const overlay = document.getElementById('meeting-overlay');
  if (!overlay) return;
  overlay.classList.add('is-minimized');
  overlay.classList.remove('is-maximized');
  overlay.setAttribute('aria-modal', 'false');
  updateMeetingWindowActions();
}

function restoreMeetingWindow() {
  const overlay = document.getElementById('meeting-overlay');
  if (!overlay) return;
  overlay.classList.remove('is-minimized', 'is-maximized');
  overlay.setAttribute('aria-modal', 'true');
  updateMeetingWindowActions();
}

function toggleMeetingMaximize() {
  const overlay = document.getElementById('meeting-overlay');
  if (!overlay) return;
  if (overlay.classList.contains('is-minimized')) {
    overlay.classList.remove('is-minimized');
    overlay.classList.add('is-maximized');
    overlay.setAttribute('aria-modal', 'true');
  } else {
    overlay.classList.toggle('is-maximized');
  }
  updateMeetingWindowActions();
}

function refreshMeetingStatus(serverId = currentServer) {
  if (!serverId || !socket.connected) return;
  socket.timeout(5000).emit('meeting:status', { serverId }, (error, response) => {
    if (error || !response?.success) return;
    meetingStatesByServer.set(serverId, response);
    if (serverId === currentServer) updateMeetingButton(response);
  });
}

function getMeetingParticipant(socketId) {
  return currentMeeting?.participants?.find(participant => participant.socketId === socketId);
}

function setMeetingParticipant(socketId, updates) {
  if (!currentMeeting || !socketId) return;
  const participants = currentMeeting.participants || [];
  let participant = participants.find(item => item.socketId === socketId);
  if (!participant) {
    participant = { socketId, username: updates.username || 'Participant' };
    participants.push(participant);
  }
  Object.assign(participant, updates);
  currentMeeting.participants = participants;
  renderMeetingState();
}

function createMeetingParticipantTile(participant) {
  const tile = document.createElement('article');
  tile.className = 'meeting-tile meeting-tile-remote';
  tile.dataset.participantId = participant.socketId;
  tile.setAttribute('aria-label', `${participant.username}'s meeting tile`);

  const cameraVideo = document.createElement('video');
  cameraVideo.className = 'meeting-tile-camera';
  cameraVideo.autoplay = true;
  cameraVideo.playsInline = true;
  cameraVideo.muted = true;
  cameraVideo.hidden = true;
  cameraVideo.setAttribute('aria-label', `${participant.username}'s camera`);

  const screenVideo = document.createElement('video');
  screenVideo.className = 'meeting-tile-screen';
  screenVideo.autoplay = true;
  screenVideo.playsInline = true;
  screenVideo.muted = true;
  screenVideo.hidden = true;
  screenVideo.setAttribute('aria-label', `${participant.username}'s shared screen`);

  const placeholder = document.createElement('div');
  placeholder.className = 'meeting-camera-placeholder meeting-remote-placeholder';
  const avatar = document.createElement('span');
  avatar.className = 'meeting-avatar meeting-remote-avatar';
  avatar.textContent = (participant.username || 'P').charAt(0).toUpperCase();
  const cameraLabel = document.createElement('span');
  cameraLabel.className = 'meeting-camera-label';
  cameraLabel.textContent = 'Camera off';
  placeholder.append(avatar, cameraLabel);

  const caption = document.createElement('div');
  caption.className = 'meeting-tile-caption';
  const speakingDot = document.createElement('span');
  speakingDot.className = 'meeting-speaking-dot';
  speakingDot.setAttribute('aria-hidden', 'true');
  const name = document.createElement('span');
  name.className = 'meeting-tile-name';
  name.textContent = participant.username || 'Participant';
  caption.append(speakingDot, name);

  const audio = document.createElement('audio');
  audio.className = 'meeting-remote-audio';
  audio.autoplay = true;
  audio.setAttribute('aria-label', `${participant.username}'s audio`);

  tile.append(cameraVideo, screenVideo, placeholder, caption, audio);
  return tile;
}

function ensureMeetingParticipantTile(participant) {
  const grid = document.getElementById('meeting-video-grid');
  if (!grid) return null;
  let tile = Array.from(grid.querySelectorAll('.meeting-tile-remote'))
    .find(element => element.dataset.participantId === participant.socketId);
  if (!tile) {
    tile = createMeetingParticipantTile(participant);
    grid.appendChild(tile);
  }
  return tile;
}

function attachMeetingRemoteTrack(transceiver, mediaElement) {
  if (!mediaElement) return;
  const track = transceiver?.receiver?.track || null;
  if (!track) return;
  if (mediaElement.srcObject?.getTracks?.().includes(track)) return;
  mediaElement.srcObject = new MediaStream([track]);
  mediaElement.play().catch(() => {
    if (mediaElement.tagName === 'AUDIO') {
      setMeetingStatus('Your browser blocked meeting audio. Interact with the meeting to hear participants.');
    }
  });
}

function updateMeetingParticipantTile(participant) {
  if (!participant?.socketId || participant.socketId === socket.id) return;
  const tile = ensureMeetingParticipantTile(participant);
  if (!tile) return;

  tile.setAttribute('aria-label', `${participant.username}'s meeting tile`);
  const name = tile.querySelector('.meeting-tile-name');
  const avatar = tile.querySelector('.meeting-remote-avatar');
  const cameraLabel = tile.querySelector('.meeting-camera-label');
  const cameraVideo = tile.querySelector('.meeting-tile-camera');
  const screenVideo = tile.querySelector('.meeting-tile-screen');
  if (name) name.textContent = participant.username || 'Participant';
  if (avatar) avatar.textContent = (participant.username || 'P').charAt(0).toUpperCase();
  if (cameraLabel) cameraLabel.textContent = participant.cameraEnabled ? 'Connecting camera…' : 'Camera off';

  // Receivers can exist without an ontrack for this tile, so attach them directly.
  const mediaRecord = meetingPeerConnections.get(participant.socketId);
  if (mediaRecord) {
    attachMeetingRemoteTrack(mediaRecord.cameraTransceiver, cameraVideo);
    attachMeetingRemoteTrack(mediaRecord.screenTransceiver, screenVideo);
    attachMeetingRemoteTrack(mediaRecord.audioTransceiver, tile.querySelector('.meeting-remote-audio'));
  }

  const hasCamera = Boolean(participant.cameraEnabled && cameraVideo?.srcObject);
  if (cameraVideo) cameraVideo.hidden = !hasCamera;

  const hasScreen = Boolean(participant.screenSharing && screenVideo?.srcObject);
  if (screenVideo) screenVideo.hidden = !hasScreen;
  tile.classList.toggle('meeting-tile-sharing', hasScreen);

  // Keep the avatar card out of the way of a shared screen when the camera is off.
  const placeholder = tile.querySelector('.meeting-remote-placeholder');
  if (placeholder) placeholder.hidden = hasCamera || hasScreen;
}

function renderMeetingState() {
  if (!currentMeeting) return;
  const overlay = document.getElementById('meeting-overlay');
  const serverName = document.getElementById('meeting-server-name');
  const server = servers?.[currentMeeting.serverId];
  const participants = currentMeeting.participants || [];
  const participantCount = participants.length;
  const isHost = currentMeeting.hostSocketId === socket.id;

  if (overlay) overlay.hidden = false;
  if (serverName) serverName.textContent = server?.name || currentMeeting.serverId;
  setMeetingStatus(`${participantCount} participant${participantCount === 1 ? '' : 's'} in the meeting`);

  const count = document.querySelector('.meeting-count');
  const toolbarCount = document.getElementById('meeting-control-participant-count');
  if (count) {
    count.textContent = String(participantCount);
    count.setAttribute('aria-label', `${participantCount} participant${participantCount === 1 ? '' : 's'}`);
  }
  if (toolbarCount) toolbarCount.textContent = String(participantCount);

  const localAvatar = document.querySelector('.meeting-tile-local .meeting-avatar-you');
  if (localAvatar && username) localAvatar.textContent = username.charAt(0).toUpperCase();
  const localPlaceholder = document.querySelector('.meeting-tile-local .meeting-camera-placeholder span:last-child');
  if (localPlaceholder) localPlaceholder.textContent = meetingCameraStream ? '' : 'Camera off';

  const endButton = document.getElementById('meeting-end');
  if (endButton) endButton.hidden = !isHost;

  const roster = document.getElementById('meeting-participant-list');
  if (roster) {
    roster.replaceChildren();
    participants.forEach(participant => {
      const item = document.createElement('li');
      item.className = 'meeting-person';
      const avatar = document.createElement('span');
      avatar.className = `meeting-person-avatar${participant.socketId === socket.id ? ' meeting-avatar-you' : ''}`;
      avatar.textContent = (participant.socketId === socket.id ? (username || 'Y') : (participant.username || 'P'))
        .charAt(0).toUpperCase();
      const meta = document.createElement('span');
      meta.className = 'meeting-person-meta';
      const name = document.createElement('strong');
      name.textContent = participant.socketId === socket.id ? `${username || 'You'} (you)` : (participant.username || 'Participant');
      const media = document.createElement('small');
      media.textContent = `${participant.microphoneEnabled ? 'Mic on' : 'Mic off'} · ${participant.cameraEnabled ? 'Camera on' : 'Camera off'}`;
      meta.append(name, media);
      const state = document.createElement('span');
      state.className = 'meeting-person-state';
  
      state.setAttribute('aria-label', participant.microphoneEnabled ? 'Microphone on' : 'Microphone off');
      item.append(avatar, meta, state);
      roster.appendChild(item);
    });
  }

  const grid = document.getElementById('meeting-video-grid');
  if (grid) {
    grid.querySelector('.meeting-tile-empty')?.remove();
    const remoteParticipants = participants.filter(participant => participant.socketId !== socket.id);
    grid.classList.toggle('meeting-video-grid-single', remoteParticipants.length === 0);
    const activeParticipantIds = new Set(remoteParticipants.map(participant => participant.socketId));
    grid.querySelectorAll('.meeting-tile-remote').forEach(tile => {
      if (!activeParticipantIds.has(tile.dataset.participantId)) tile.remove();
    });
    remoteParticipants.forEach(updateMeetingParticipantTile);
  }

  updateMeetingControls();
  meetingStatesByServer.set(currentMeeting.serverId, {
    success: true,
    active: true,
    serverId: currentMeeting.serverId,
    meeting: currentMeeting
  });
  if (currentMeeting.serverId === currentServer) updateMeetingButton({ active: true });
}

function updateMeetingControls() {
  const micButton = document.getElementById('meeting-mic-toggle');
  const cameraButton = document.getElementById('meeting-camera-toggle');
  const shareButton = document.getElementById('meeting-screen-share');
  const micEnabled = Boolean(meetingMicrophoneStream);
  const cameraEnabled = Boolean(meetingCameraStream);
  const screenSharing = Boolean(meetingScreenStream);

  if (micButton) {
    const label = micEnabled ? 'Mute microphone' : 'Turn microphone on';
    micButton.setAttribute('aria-label', label);
    micButton.title = label;
    micButton.setAttribute('aria-pressed', String(micEnabled));
    micButton.querySelector('span').textContent = micEnabled ? 'Mute' : 'Unmute';
    micButton.classList.toggle('meeting-control-active', micEnabled);
    micButton.classList.toggle('is-off', !micEnabled);
  }
  if (cameraButton) {
    const label = cameraEnabled ? 'Turn camera off' : 'Turn camera on';
    cameraButton.setAttribute('aria-label', label);
    cameraButton.title = label;
    cameraButton.setAttribute('aria-pressed', String(cameraEnabled));
    cameraButton.querySelector('span').textContent = cameraEnabled ? 'Stop video' : 'Start video';
    cameraButton.classList.toggle('meeting-control-active', cameraEnabled);
    cameraButton.classList.toggle('is-off', !cameraEnabled);
  }
  if (shareButton) {
    const label = screenSharing ? 'Stop sharing your screen' : 'Share your screen';
    shareButton.setAttribute('aria-label', label);
    shareButton.title = label;
    shareButton.querySelector('span').textContent = screenSharing ? 'Stop share' : 'Share screen';
    shareButton.classList.toggle('meeting-control-active', screenSharing);
  }

  const localVideo = document.getElementById('meeting-local-video');
  if (localVideo) {
    localVideo.hidden = !cameraEnabled;
    const nextStream = cameraEnabled ? meetingCameraStream : null;
    if (localVideo.srcObject !== nextStream) {
      localVideo.srcObject = nextStream;
      if (nextStream) localVideo.play().catch(() => {});
    }
  }
  const localPlaceholder = document.querySelector('.meeting-tile-local .meeting-camera-placeholder');
  if (localPlaceholder) localPlaceholder.hidden = cameraEnabled;
}

function updateMeetingButtonDisabled(disabled) {
  const button = document.getElementById('meeting-button');
  if (button) button.disabled = disabled;
}

async function openOrStartServerMeeting() {
  if (!socket.connected) {
    showNotification('The chat connection is offline. Reconnect before joining a meeting.', 'error');
    return;
  }
  const serverId = currentServer || 'sigmachat';
  if (currentMeeting?.serverId === serverId) {
    document.getElementById('meeting-overlay').hidden = false;
    restoreMeetingWindow();
    return;
  }
  if (currentMeeting) await leaveCurrentMeeting();

  updateMeetingButtonDisabled(true);
  setMeetingStatus('Checking for an active meeting…');
  try {
    const status = await sendMeetingRequest('meeting:status', { serverId });
    if (!status.success) {
      showNotification(status.error || 'Could not check this server’s meeting.', 'error');
      return;
    }

    if (status.active) {
      await joinServerMeeting(serverId);
      return;
    }

    const start = await sendMeetingRequest('meeting:start', { serverId });
    if (start.success) {
      setMeetingStatus('Starting your meeting…');
      return;
    }
    if (start.code === 'meeting-already-running') {
      await joinServerMeeting(serverId);
      return;
    }
    showNotification(start.error || 'Could not start the meeting.', 'error');
  } finally {
    updateMeetingButtonDisabled(false);
  }
}

async function joinServerMeeting(serverId) {
  setMeetingStatus('Joining the meeting…');
  const response = await sendMeetingRequest('meeting:join', { serverId });
  if (!response.success) {
    showNotification(response.error || 'Could not join the meeting.', 'error');
  }
}

function queueMeetingIce(socketId, candidate) {
  if (!pendingMeetingIce.has(socketId)) pendingMeetingIce.set(socketId, []);
  pendingMeetingIce.get(socketId).push(candidate);
}

async function flushMeetingIce(socketId, peerConnection) {
  const candidates = pendingMeetingIce.get(socketId) || [];
  pendingMeetingIce.delete(socketId);
  for (const candidate of candidates) {
    try {
      await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (error) {
      console.warn('Could not apply a queued meeting network candidate:', error);
    }
  }
}

function createMeetingPeerConnection(participant) {
  const existing = meetingPeerConnections.get(participant.socketId);
  if (existing) return existing;

  const peerConnection = new RTCPeerConnection({ iceServers: streamIceServers });
  const audioTransceiver = peerConnection.addTransceiver('audio', { direction: 'sendrecv' });
  const cameraTransceiver = peerConnection.addTransceiver('video', { direction: 'sendrecv' });
  const screenTransceiver = peerConnection.addTransceiver('video', { direction: 'sendrecv' });
  const record = {
    socketId: participant.socketId,
    username: participant.username,
    peerConnection,
    audioTransceiver,
    cameraTransceiver,
    screenTransceiver,
    polite: isPoliteMeetingPeer(participant.socketId),
    makingOffer: false,
    ignoreOffer: false,
    hasOffered: false
  };
  meetingPeerConnections.set(participant.socketId, record);
  ensureMeetingParticipantTile(participant);

  peerConnection.onicecandidate = event => {
    if (event.candidate && currentMeeting) {
      socket.emit('meeting:ice', {
        to: participant.socketId,
        candidate: event.candidate.toJSON()
      });
    }
  };
  peerConnection.ontrack = event => {
    const tile = ensureMeetingParticipantTile({ socketId: participant.socketId, username: record.username });
    if (!tile) return;
    let mediaElement;

    if (event.transceiver === audioTransceiver) {
      mediaElement = tile.querySelector('.meeting-remote-audio');
    } else if (event.transceiver === cameraTransceiver) {
      mediaElement = tile.querySelector('.meeting-tile-camera');
    } else if (event.transceiver === screenTransceiver) {
      mediaElement = tile.querySelector('.meeting-tile-screen');
    }
    if (!mediaElement) return;

    mediaElement.srcObject = new MediaStream([event.track]);
    if (mediaElement.tagName === 'VIDEO') {
      mediaElement.hidden = false;
    }
    mediaElement.play().catch(() => {
      if (mediaElement.tagName === 'AUDIO') {
        setMeetingStatus('Your browser blocked meeting audio. Interact with the meeting to hear participants.');
      }
    });
    event.track.addEventListener('ended', () => {
      mediaElement.srcObject = null;
      mediaElement.hidden = true;
      if (currentMeeting) {
        const currentParticipant = getMeetingParticipant(participant.socketId);
        if (currentParticipant) updateMeetingParticipantTile(currentParticipant);
      }
    }, { once: true });
    const currentParticipant = getMeetingParticipant(participant.socketId);
    if (currentParticipant) updateMeetingParticipantTile(currentParticipant);
  };
  peerConnection.onconnectionstatechange = () => {
    if (peerConnection.connectionState === 'connected') {
      setMeetingStatus(`${currentMeeting?.participants?.length || 1} participant${(currentMeeting?.participants?.length || 1) === 1 ? '' : 's'} in the meeting`);
    } else if (peerConnection.connectionState === 'failed') {
      setMeetingStatus('A participant could not connect. Network restrictions may block peer-to-peer calls.');
    }
  };

  return record;
}

async function attachLocalTracks(record) {
  const microphoneTrack = meetingMicrophoneStream?.getAudioTracks()[0] || null;
  const cameraTrack = meetingCameraStream?.getVideoTracks()[0] || null;
  const screenTrack = meetingScreenStream?.getVideoTracks()[0] || null;
  await Promise.all([
    record.audioTransceiver.sender.replaceTrack(microphoneTrack),
    record.cameraTransceiver.sender.replaceTrack(cameraTrack),
    record.screenTransceiver.sender.replaceTrack(screenTrack)
  ]);
}

async function sendMeetingOffer(record) {
  const peerConnection = record?.peerConnection;
  if (!peerConnection || !currentMeeting) return;
  if (peerConnection.signalingState !== 'stable') return;
  try {
    record.makingOffer = true;
    const offer = await peerConnection.createOffer();
    if (peerConnection.signalingState !== 'stable') return;
    await peerConnection.setLocalDescription(offer);
    socket.emit('meeting:offer', {
      to: record.socketId,
      description: peerConnection.localDescription
    });
  } catch (error) {
    console.error('Could not start a meeting connection:', error);
    setMeetingStatus(`Could not connect to ${record.username || 'a participant'}.`);
  } finally {
    record.makingOffer = false;
  }
}

function requestMeetingRenegotiation() {
  meetingPeerConnections.forEach(record => {
    if (record.peerConnection.signalingState === 'stable') sendMeetingOffer(record);
  });
}

async function createMeetingOffer(participant) {
  try {
    const record = createMeetingPeerConnection(participant);
    if (record.hasOffered || record.peerConnection.remoteDescription) return;
    record.hasOffered = true;
    await attachLocalTracks(record);
    await sendMeetingOffer(record);
  } catch (error) {
    console.error('Could not start a meeting connection:', error);
    setMeetingStatus(`Could not connect to ${participant.username || 'a participant'}.`);
  }
}

async function handleMeetingJoined(state) {
  if (!state?.meetingId || !Array.isArray(state.participants)) return;
  currentMeeting = state;
  const overlay = document.getElementById('meeting-overlay');
  if (overlay) overlay.hidden = false;
  restoreMeetingWindow();
  renderMeetingState();
  const otherParticipants = state.participants.filter(participant => participant.socketId !== socket.id);
  for (const participant of otherParticipants) {
    await createMeetingOffer(participant);
  }
  document.getElementById('meeting-mic-toggle')?.focus();
}

async function handleMeetingOffer({ from, username: participantName, description } = {}) {
  if (!currentMeeting || !from || !description) return;
  try {
    const participant = getMeetingParticipant(from) || { socketId: from, username: participantName || 'Participant' };
    const record = createMeetingPeerConnection(participant);
    record.username = participant.username;
    const peerConnection = record.peerConnection;

    const offerCollision = record.makingOffer || peerConnection.signalingState !== 'stable';
    record.ignoreOffer = !record.polite && offerCollision;
    if (record.ignoreOffer) return;

    if (offerCollision) {
      // Both devices offered at once: this side rolls back and answers instead.
      await Promise.all([
        peerConnection.setLocalDescription({ type: 'rollback' }),
        peerConnection.setRemoteDescription(new RTCSessionDescription(description))
      ]);
    } else {
      await peerConnection.setRemoteDescription(new RTCSessionDescription(description));
    }
    await flushMeetingIce(from, peerConnection);
    await attachLocalTracks(record);
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);
    socket.emit('meeting:answer', {
      to: from,
      description: peerConnection.localDescription
    });
  } catch (error) {
    console.error('Could not answer a meeting connection:', error);
    setMeetingStatus(`Could not connect to ${participantName || 'a participant'}.`);
  }
}

async function handleMeetingAnswer({ from, description } = {}) {
  const record = meetingPeerConnections.get(from);
  if (!record || !description) return;
  if (record.peerConnection.signalingState !== 'have-local-offer') return;
  try {
    await record.peerConnection.setRemoteDescription(new RTCSessionDescription(description));
    await flushMeetingIce(from, record.peerConnection);
  } catch (error) {
    console.error('Could not complete a meeting connection:', error);
    setMeetingStatus('Could not complete the meeting connection. Try leaving and joining again.');
  }
}

async function toggleMeetingMedia(kind) {
  if (!currentMeeting) return;
  const isEnabled = kind === 'microphone' ? Boolean(meetingMicrophoneStream) : Boolean(meetingCameraStream);
  if (isEnabled) {
    const stream = kind === 'microphone' ? meetingMicrophoneStream : meetingCameraStream;
    const senderKey = kind === 'microphone' ? 'audioTransceiver' : 'cameraTransceiver';
    try {
      await Promise.all(Array.from(meetingPeerConnections.values(), record =>
        record[senderKey].sender.replaceTrack(null)));
    } catch (error) {
      console.warn(`Could not disable the meeting ${kind}:`, error);
    }
    stopMeetingStreamTracks(stream);
    if (kind === 'microphone') meetingMicrophoneStream = null;
    else meetingCameraStream = null;
  } else {
    if (!navigator.mediaDevices?.getUserMedia) {
      showNotification('Camera and microphone are not available in this browser.', 'error');
      return;
    }
    let stream = null;
    try {
      stream = kind === 'microphone'
        ? await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
        : await getMeetingCameraStream();
      const track = kind === 'microphone' ? stream.getAudioTracks()[0] : stream.getVideoTracks()[0];
      if (!track) {
        stopMeetingStreamTracks(stream);
        throw new Error(`No ${kind} was selected.`);
      }
      if (kind === 'microphone') meetingMicrophoneStream = stream;
      else meetingCameraStream = stream;
      watchMeetingLocalTrackEnded(stream, kind);
      const senderKey = kind === 'microphone' ? 'audioTransceiver' : 'cameraTransceiver';
      await Promise.all(Array.from(meetingPeerConnections.values(), record =>
        record[senderKey].sender.replaceTrack(track)));
    } catch (error) {
      stopMeetingStreamTracks(stream);
      if (kind === 'microphone') meetingMicrophoneStream = null;
      else meetingCameraStream = null;
      showNotification(describeMeetingMediaError(error, kind), 'error');
      updateMeetingControls();
      return;
    }
  }

  syncMeetingMediaState();
  requestMeetingRenegotiation();
}

async function tuneMeetingScreenSender(sender) {
  try {
    const parameters = sender.getParameters();
    // Keep text and detail readable instead of letting the encoder drop resolution.
    parameters.degradationPreference = 'maintain-resolution';
    if (parameters.encodings?.length) parameters.encodings[0].maxBitrate = 2_500_000;
    await sender.setParameters(parameters);
  } catch (error) {
    console.warn('Could not raise the meeting screen share quality:', error);
  }
}

async function stopMeetingScreenShare(notifyServer = true) {
  const stream = meetingScreenStream;
  if (!stream) return;
  meetingScreenStream = null;
  try {
    await Promise.all(Array.from(meetingPeerConnections.values(), record =>
      record.screenTransceiver.sender.replaceTrack(null)));
  } catch (error) {
    console.warn('Could not stop sharing the meeting screen:', error);
  }
  stopMeetingStreamTracks(stream);
  syncMeetingMediaState(notifyServer);
  requestMeetingRenegotiation();
}

async function toggleMeetingScreenShare() {
  if (!currentMeeting) return;
  if (meetingScreenStream) {
    await stopMeetingScreenShare();
    return;
  }
  if (typeof navigator.mediaDevices?.getDisplayMedia !== 'function') {
    showNotification('Screen sharing is not available in this browser or on this device. Try a desktop browser such as Chrome, Edge, Firefox or Safari.', 'error');
    return;
  }

  let stream = null;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
    const track = stream.getVideoTracks()[0];
    if (!track) {
      stopMeetingStreamTracks(stream);
      throw new Error('No screen was selected.');
    }
    meetingScreenStream = stream;
    track.contentHint = 'detail';
    track.onended = () => {
      if (meetingScreenStream === stream) stopMeetingScreenShare();
    };
    await Promise.all(Array.from(meetingPeerConnections.values(), record => {
      const sender = record.screenTransceiver.sender;
      return sender.replaceTrack(track).then(() => tuneMeetingScreenSender(sender));
    }));
    syncMeetingMediaState();
    requestMeetingRenegotiation();
  } catch (error) {
    if (meetingScreenStream === stream) meetingScreenStream = null;
    stopMeetingStreamTracks(stream);
    updateMeetingControls();
    showNotification(
      error.name === 'NotAllowedError' || error.name === 'AbortError'
        ? 'Screen sharing was cancelled.'
        : `Could not share your screen. ${error.message || ''}`.trim(),
      'warning'
    );
  }
}

function closeMeetingPeer(socketId) {
  const record = meetingPeerConnections.get(socketId);
  if (record) record.peerConnection.close();
  meetingPeerConnections.delete(socketId);
  pendingMeetingIce.delete(socketId);
  const tile = Array.from(document.querySelectorAll('.meeting-tile-remote'))
    .find(element => element.dataset.participantId === socketId);
  if (tile) tile.remove();
}

async function leaveCurrentMeeting(notifyServer = true) {
  if (!currentMeeting) return;
  const serverId = currentMeeting.serverId;
  if (notifyServer && socket.connected) {
    await sendMeetingRequest('meeting:leave');
  }
  finishMeetingLocally();
  if (notifyServer) refreshMeetingStatus(serverId);
}

function finishMeetingLocally(markInactive = false) {
  const serverId = currentMeeting?.serverId;
  if (serverId && markInactive) {
    meetingStatesByServer.set(serverId, { success: true, active: false, serverId, meeting: null });
    if (serverId === currentServer) updateMeetingButton({ active: false });
  }
  meetingPeerConnections.forEach(record => record.peerConnection.close());
  meetingPeerConnections.clear();
  pendingMeetingIce.clear();
  [meetingMicrophoneStream, meetingCameraStream, meetingScreenStream].forEach(stopMeetingStreamTracks);
  meetingMicrophoneStream = null;
  meetingCameraStream = null;
  meetingScreenStream = null;
  currentMeeting = null;
  updateMeetingControls();
  const overlay = document.getElementById('meeting-overlay');
  if (overlay) overlay.hidden = true;
  restoreMeetingWindow();
}

document.getElementById('meeting-button')?.addEventListener('click', openOrStartServerMeeting);
document.getElementById('meeting-mic-toggle')?.addEventListener('click', () => toggleMeetingMedia('microphone'));
document.getElementById('meeting-camera-toggle')?.addEventListener('click', () => toggleMeetingMedia('camera'));
document.getElementById('meeting-screen-share')?.addEventListener('click', toggleMeetingScreenShare);
document.getElementById('meeting-leave')?.addEventListener('click', () => leaveCurrentMeeting());
document.getElementById('meeting-minimize-btn')?.addEventListener('click', minimizeMeetingWindow);
document.getElementById('meeting-maximize-btn')?.addEventListener('click', toggleMeetingMaximize);
document.getElementById('meeting-participants-toggle')?.addEventListener('click', event => {
  const overlay = document.getElementById('meeting-overlay');
  if (!overlay) return;
  const hidden = overlay.classList.toggle('is-participants-hidden');
  const label = hidden ? 'Show participants panel' : 'Hide participants panel';
  event.currentTarget.setAttribute('aria-expanded', String(!hidden));
  event.currentTarget.setAttribute('aria-label', label);
  event.currentTarget.title = label;
});
document.getElementById('meeting-end')?.addEventListener('click', async () => {
  if (!currentMeeting) return;
  const response = await sendMeetingRequest('meeting:end');
  if (!response.success) showNotification(response.error || 'Only the host can end this meeting.', 'error');
});

window.addEventListener('server-selected', event => {
  refreshMeetingStatus(event.detail?.serverId || currentServer);
});

socket.on('connect', () => refreshMeetingStatus());
socket.on('meeting:server-state', state => {
  if (!state?.serverId) return;
  meetingStatesByServer.set(state.serverId, { success: true, ...state });
  if (state.serverId === currentServer) updateMeetingButton(state);
});
socket.on('meeting:joined', handleMeetingJoined);
socket.on('meeting:state', state => {
  if (!currentMeeting || state?.meetingId !== currentMeeting.meetingId) return;
  currentMeeting = state;
  renderMeetingState();
});
socket.on('meeting:offer', handleMeetingOffer);
socket.on('meeting:answer', handleMeetingAnswer);
socket.on('meeting:ice', async ({ from, candidate } = {}) => {
  if (!from || !candidate) return;
  const record = meetingPeerConnections.get(from);
  if (!record?.peerConnection.remoteDescription) {
    queueMeetingIce(from, candidate);
    return;
  }
  try {
    await record.peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
  } catch (error) {
    console.warn('Could not apply a meeting network candidate:', error);
  }
});
socket.on('meeting:media-state', state => {
  if (!currentMeeting || !state?.socketId || state.socketId === socket.id) return;
  setMeetingParticipant(state.socketId, {
    username: state.username,
    microphoneEnabled: state.microphoneEnabled === true,
    cameraEnabled: state.cameraEnabled === true,
    screenSharing: state.screenSharing === true
  });
});
socket.on('meeting:participant-left', ({ socketId } = {}) => {
  if (!socketId || !currentMeeting) return;
  currentMeeting.participants = currentMeeting.participants.filter(participant => participant.socketId !== socketId);
  closeMeetingPeer(socketId);
  renderMeetingState();
});
socket.on('meeting:host-changed', ({ hostSocketId, hostUsername } = {}) => {
  if (!currentMeeting) return;
  currentMeeting.hostSocketId = hostSocketId;
  currentMeeting.hostUsername = hostUsername;
  renderMeetingState();
});
socket.on('meeting:ended', state => {
  if (!currentMeeting || state?.meetingId !== currentMeeting.meetingId) return;
  const serverId = currentMeeting.serverId;
  finishMeetingLocally(true);
  meetingStatesByServer.set(serverId, { success: true, active: false, serverId, meeting: null });
  if (serverId === currentServer) updateMeetingButton({ active: false });
  showNotification('The server meeting has ended.', 'info');
});
socket.on('meeting:removed', state => {
  if (!currentMeeting || state?.meetingId !== currentMeeting.meetingId) return;
  finishMeetingLocally(true);
  showNotification(state.message || 'You were removed from this server meeting.', 'warning');
});
socket.on('disconnect', () => {
  if (currentMeeting) finishMeetingLocally();
});

window.addEventListener('beforeunload', () => {
  [meetingMicrophoneStream, meetingCameraStream, meetingScreenStream].forEach(stopMeetingStreamTracks);
});
