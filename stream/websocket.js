'use strict';
const { EventEmitter } = require('node:events');
const WebSocket = require('ws');

// Socket interface used by the existing IRC parser and token lifecycle.
function connectWebSocket(options, ready) {
  const socket = new EventEmitter();
  const ws = new WebSocket(options.url || 'wss://irc-ws.chat.twitch.tv:443', {
    handshakeTimeout: 15000, maxPayload: 65536, perMessageDeflate: false,
    rejectUnauthorized: true,
  });
  let timer, timeout = 0, onTimeout, destroyed = false;
  const touch = () => {
    clearTimeout(timer);
    if (timeout && !destroyed) {
      timer = setTimeout(() => onTimeout?.(), timeout);
      timer.unref();
    }
  };
  socket.setEncoding = () => socket;
  socket.setTimeout = (ms, callback) => { timeout = ms; onTimeout = callback; touch(); return socket; };
  socket.destroy = () => {
    destroyed = true; clearTimeout(timer); ws.terminate();
  };
  socket.write = text => {
    if (destroyed || ws.readyState !== WebSocket.OPEN) return false;    // Twitch expects one IRC command per WebSocket message.
    for (const line of text.split('\r\n').filter(Boolean)) {
      ws.send(line + '\r\n', error => {
        if (error) { socket.emit('error', error); socket.destroy(); }
      });
    }
    return true;
  };
  ws.on('open', () => { if (!destroyed) { touch(); ready(); } });
  ws.on('message', (data, binary) => {
    if (destroyed) return;
    if (binary) { socket.destroy(); return; }
    touch(); socket.emit('data', data.toString('utf8'));
  });
  ws.on('error', error => { socket.emit('error', error); socket.destroy(); });
  ws.on('close', () => { destroyed = true; clearTimeout(timer); socket.emit('close'); });
  return socket;
}
module.exports = { connectWebSocket };
