// Copyright IBM Corp. 2015,2016. All Rights Reserved.
// Node module: strong-control-channel
// This file is licensed under the Artistic License 2.0.
// License text available at https://opensource.org/licenses/Artistic-2.0

'use strict';

var assert = require('assert');
var crypto = require('crypto');
var debug = require('./debug');
var events = require('events');
var util = require('util');
var url = require('url');
var Websocket = require('ws');

var SHK = 'SHK';
var DIS = 'DIS';
var REQ = 'REQ';
var RSP = 'RSP';
var NOT = 'NOT';

exports.SHK = SHK;

function state(readyState) {
  switch (readyState) {
    case Websocket.CONNECTING: return 'CONNECTING';
    case Websocket.OPEN: return 'OPEN';
    case Websocket.CLOSING: return 'CLOSING';
    case Websocket.CLOSED: return 'CLOSED';
    default:
      return util.format('Unknown(%j)', readyState);
  }
}


function WebsocketChannel(onRequest, clientToken) {
  assert(onRequest);

  this._onRequest = onRequest;

  // Initialize to empty.
  this._websocket = null;
  this._socket = null;
  this._sendQueue = {};
  this._uri = null;
  this._callbacks = {};
  this._callbacksPending = 0;
  this._requestId = 0;
  this._clientToken = clientToken || null;
  this._sessionToken = null;
  this._unref = false;
  this._closed = null;

  this._seq = -1;

  this._sentSeq = -1;
  this._receivedSeq = -1;
  this._sentAck = -1;
  this._receivedAck = -1;
  this._ackTimer = null;

  this._onOpen = this._onOpen.bind(this);
  this._handleMessage = this._handleMessage.bind(this);
  this._handleError = this._handleError.bind(this);
  this._fatalError = this._fatalError.bind(this);
  this._handleDisconnect = this._handleDisconnect.bind(this);

  if (clientToken) {
    this._debug = debug('ws-channel:serve:' + clientToken.substr(0, 5));
  } else {
    // Will reset to a more specific tag once connected.
    this._debug = debug('ws-channel');
  }
}

util.inherits(WebsocketChannel, events.EventEmitter);


WebsocketChannel.prototype._onNotification = function(message) {
  this._onRequest(message, nullCallback);
};


function nullCallback() {
}


WebsocketChannel.prototype.connect = function(uri) {
  assert(!this._uri);
  assert(!this._clientToken);
  assert(!this._sessionToken);

  var clientToken = url.parse(uri).auth;

  assert(clientToken, 'connect uri lacking client authentication');

  this._clientToken = clientToken;
  this._uri = uri;

  this._debug = debug('ws-channel:client:' + this._clientToken.substr(0, 5));
  this._debug('connect: uri %s', uri);

  return this._connect();
};


WebsocketChannel.prototype._connect = function() {
  var clientToken = this._clientToken;
  var sessionToken = this._sessionToken;
  var uri = this._uri;

  assert(uri, 'url required');
  assert(clientToken, 'client token required');

  var opts = {
    headers: {
      'x-mesh-token': clientToken,
    },
    // TODO: per-message deflate could be useful for some of our messages, and
    // it is even enabled by default, but it is also a little bit buggy, so we
    // disable it so we don't end up with 'write after end' errors from the
    // underlying socket.
    perMessageDeflate: false,
  };
  if (sessionToken) {
    opts.headers['x-session-token'] = sessionToken;
  }

  var uriParts = url.parse(uri);
  if (uriParts.protocol === 'wss:') {
    // When connecting over WSS (HTTPS) on localhost (but only on localhost),
    // then disable TLS certificates checks. This is a short-cut to support
    // WSS channel when the server has a certificate issued by a non-public
    // cert authority. @bajtos and @sam-github believe this does not pose
    // any security risk, because the local machine is fully under our control.
    var isLocal = uriParts.hostname === 'localhost' ||
                  uriParts.hostname === '127.0.0.1' ||
                  uriParts.hostname === '::1';
    if (isLocal) {
      opts.rejectUnauthorized = false;
    }
  }

  this._attach(new Websocket(uri, opts));

  return this;
};


WebsocketChannel.prototype._reconnect = function() {
  if (this._closed)
    return this;

  // On first disconnect/error after a ws has been attached to the channel, try
  // to reconnect instantly. After that, only try once ever few seconds (should
  // perhaps be exponential).

  if (!this._uri) {
    this.emit('reconnecting');
    return this; // Server, can't reconnect, the client will reconnect to us.
  }

  // if (!this._sessionToken)
  //   Errored on first connection... should it retry? Or emit an
  //   error/warn event, so that the user has a chance to deal with
  //   this differently if wanted?

  if (this._recentlyAttached) {
    this._debug('reconnecting to %s', this._uri);
    this._recentlyAttached = false;
    return this._connect();
  }

  setTimeout(this._reconnect.bind(this), 5000);
};


WebsocketChannel.prototype.accept = function(websocket) {
  this._attach(websocket);
  return this;
};


WebsocketChannel.prototype._attach = function(websocket) {
  this._recentlyAttached = true;

  if (!this._uri) {
    // Server side (no uri) is the receiver of the ws upgrade request.
    var headers = websocket.upgradeReq.headers;
    var clientToken = headers['x-mesh-token'];
    var sessionToken = headers['x-session-token'];

    // Its caller's responsibility to attach websockets to the correct
    // Channel, if mismatch on these tokens occur its a router bug.
    assert(clientToken === this._clientToken, 'client tokens must match');

    if (this._sessionToken) {
      // Must be a reconnect, if mismatch on these tokens occur its a bug.
      assert.equal(sessionToken, this._sessionToken, 'session token mismatch');
      this._debug('reconnect session %s', this._sessionToken);
    } else {
      // We are accepting the first connect from the client, allocate a
      // unique identifier for this session.
      this._sessionToken = exports.generateToken();
      this._debug('initial session %s', this._sessionToken);
    }

    // Handshake confirms to client that connection was accepted, and allows
    // it to receive a session.
    // TODO(sam) if this session is closed, we should set the `error:`
    // property, but sending a reject handshake might need to be done by the
    // router: its the one that knows that a channel/client has been closed.
    websocket.send(JSON.stringify({
      type: SHK,
      sessionToken: this._sessionToken,
    }));
  }

  // If the channel is already attached to a websocket, close that one.
  if (this._websocket)
    this._detach();

  this._websocket = websocket;

  this._debug('attach with state %s', state(websocket.readyState));

  websocket.on('message', this._handleMessage);
  websocket.on('error', this._handleError);
  websocket.on('close', this._handleDisconnect);

  // Re-send messages that haven't been ACKed yet.
  this._sentAck = -1;
  this._sentSeq = this._receivedAck;

  // Handle both possibilities:
  // - Client Websocket objects are created by user, then connected, so they
  // exist before the connection has been established.
  // - Server Websocket objects are emitted by ws only when fully connected.
  if (websocket.readyState === Websocket.CONNECTING)
    websocket.on('open', this._onOpen);
  else
    this._onOpen();

  // Clients flush when they recv SHK, servers flush after they send SHK.
  if (!this._uri)
    this._flushSendQueue();
};


WebsocketChannel.prototype._detach = function() {
  if (!this._websocket)
    return;

  this._debug('detach with state %s', state(this._websocket.readyState));

  this._websocket.removeListener('message', this._handleMessage);
  this._websocket.removeListener('error', this._handleError);
  this._websocket.removeListener('close', this._handleDisconnect);
  this._websocket.removeListener('open', this._onOpen);

  this._closeWebsocket();
  this._websocket = null;
};


WebsocketChannel.prototype.close = function(reason, callback) {
  if (typeof reason === 'function') {
    callback = reason;
    reason = 'closed';
  }

  if (this._closed)
    return this;

  this._debug('closing %s', this._sessionToken);

  if (this._websocket) {
    this._flushSendQueue();
    // Notify client it has been disconnected
    this._websocket.send(JSON.stringify({
      type: DIS,
    }));
    this._detach();
  }

  this.destroy(reason);

  if (!callback)
    return this;

  if (this._sentSeq === this._receivedAck &&
      this._sentAck === this._receivedSeq) {
    process.nextTick(callback);

  } else {
    var error = new Error('Messages were discarded');
    this._debug('close: %s', error.message);
    this._debug('sendSeq: %j, recvAck: %j, sentAck: %j, recvSeq: %j',
                this._sentSeq, this._receivedAck, this._sentAck,
                this._receivedSeq);
    process.nextTick(function() {
      callback(error);
    });
  }

  return this;
};


WebsocketChannel.prototype.destroy = function(reason) {
  if (this._closed)
    return this;

  this._detach();
  this._closed = this._closed || reason || 'destroyed';
  var err = {error: this._closed};
  var _callbacks = this._callbacks;
  Object.keys(this._callbacks).forEach(function(id) {
    _callbacks[id](err);
  });
  return this;
};


WebsocketChannel.prototype._closeWebsocket = function() {
  var websocket = this._websocket;

  if (!websocket)
    return;

  // Work around a bug in ws that makes node crash when the socket is closed
  // while it is still connecting.
  if (websocket.readyState === Websocket.CONNECTING) {
    this._debug('closing socket: once its open');
    websocket.once('open', websocket.close.bind(websocket));
  } else if (websocket.readyState === Websocket.OPEN) {
    this._debug('closing socket: now');
    websocket.close();
  }
  // else CLOSING or CLOSED, don't need to close.
  // XXX(sam) but maybe it would be safer to do so?
};


WebsocketChannel.prototype.notify = function(message) {
  if (this._closed) {
    return;
  }

  var requestId = this._requestId++;

  this._debug('queue NOT %d: %s', requestId, this._debug.json(message));

  var packet = {
    type: NOT,
    requestId: requestId,
    data: message,
  };

  this._send(packet);
};


WebsocketChannel.prototype.request = function(message, callback) {
  if (this._closed) {
    if (callback)
      setImmediate(callback, new Error(this._closed));
    return;
  }
  var requestId = this._requestId++;
  this._callbacks[requestId] = callback || function() {};
  this._callbacksPending++;

  this._debug('queue REQ %d: %s', requestId, this._debug.json(message));

  // Reference the socket (even if was referenced) if we're waiting for a
  // response.
  if (this._callbacksPending === 1 && this._socket && this._unref)
    this._socket.ref();

  var packet = {
    type: REQ,
    requestId: requestId,
    data: message,
  };

  this._send(packet);
};


WebsocketChannel.prototype.address = function() {
  return this.uri && url.parse(this.uri);
};


WebsocketChannel.prototype.getClientToken = function() {
  return this._clientToken;
};


WebsocketChannel.prototype.getToken = function() {
  return this._sessionToken;
};


WebsocketChannel.prototype.unref = function() {
  this._unref = true;
  // Note that on Node v0.10, TLS socket (CleartextStream) does not
  // provide unref() method.
  if (this._socket && this._callbacksPending === 0 && this._socket.unref)
    this._socket.unref();
};


WebsocketChannel.prototype._onOpen = function() {
  this._debug('ws connection is open');

  this._socket = this._websocket._socket;

  // Note that on Node v0.10, TLS socket (CleartextStream) does not
  // provide unref() method.
  if (this._unref && this._callbacksPending === 0 && this._socket.unref)
    this._socket.unref();
};


WebsocketChannel.prototype._send = function(packet) {
  // Set the packet's sequence number and insert into the send queue.
  var seq = packet.seq = ++this._seq;
  this._sendQueue[seq] = packet;

  if (this._isOpen())
    this._flushSendQueue();
};


WebsocketChannel.prototype._sendAck = function() {
  this._ackTimer = null;
  this._flushSendQueue();
};


WebsocketChannel.prototype._scheduleSendAck = function() {
  // Normally we'll try to piggyback ACKs on top of other messages. Here we
  // set a timeout just in case no other messages are sent, so we have to send
  // send a dummy packet with only ack information instead.

  // Don't schedule if we've already sent an ack for the last-received packet.
  if (this._receivedSeq === this._sentAck)
    return;
  // Don't schedule if other packets are scheduled.
  if (this._sentSeq !== this._seq)
    return;
  // Don't schedule if the ack timer is already running.
  if (this._ackTimer)
    return;

  this._ackTimer = setTimeout(this._sendAck.bind(this), 50);
};


WebsocketChannel.prototype._unscheduleSendAck = function() {
  if (!this._ackTimer)
    return;

  clearTimeout(this._ackTimer);
  this._ackTimer = null;
};


WebsocketChannel.prototype._handleMessage = function(s) {
  var self = this;

  try {
    var packet = JSON.parse(s);
  } catch (err) {
    return this._fatalError(err);
  }

  var data = packet.data;
  delete packet.data;
  this._debug('on pkt: %j', packet);

  // Delete ack'ed packets from the send queue.
  var ack = packet.ack;
  assert(ack === undefined || typeof ack === 'number');

  if (ack !== undefined) {
    while (ack > this._receivedAck)
      delete this._sendQueue[++this._receivedAck];
  }

  if (packet.type === SHK) {
    if (this._sessionToken && !packet.error) {
      assert.equal(packet.sessionToken, this._sessionToken, 'session mismatch');
      this._debug('reconnected: session %s', packet.sessionToken);
    } else {
      this._debug('handshaked: session %s', packet.sessionToken);
      this._sessionToken = packet.sessionToken;
      if (!packet.error)
        this.emit('connect');
    }

    if (packet.error)
      return this._fatalError(new Error(packet.error));

    return this._flushSendQueue();
  }

  if (packet.type === DIS) {
    this._debug('finished: session %s', this._sessionToken);
    return this._fatalError(new Error('disconnect'));
  }

  // Only process re-sent packets that we haven't already processed; also
  // ignore ACK-only packets which have neither a type nor a sequence number.
  var seq = packet.seq;
  assert((typeof seq === 'number') ||
         (seq === undefined && packet.type === undefined));
  if (seq > this._receivedSeq) {
    this._receivedSeq = seq;

    switch (packet.type) {
      case NOT:
        this._debug('on NOT: %s', this._debug.json(data));
        this._onNotification(data);
        break;

      case REQ:
        this._debug('on REQ: %s', this._debug.json(data));
        this._onRequest(data, sendReply);
        break;

      case RSP:
        var callback = this._callbacks[packet.requestId];
        if (!callback) {
          var error = new Error('Unrecognized response sequence number');
          return this._fatalError(error);
        }

        delete this._callbacks[packet.requestId];
        this._callbacksPending--;

        // Unref the socket if the channel was unref'ed and we're no longer
        // awaiting any responses.
        // Note that on Node v0.10, TLS socket (CleartextStream) does not
        // provide unref() method.
        if (this._unref && this._callbacksPending === 0 && this._socket.unref)
          this._socket.unref();

        this._debug('on RSP: %s', this._debug.json(data));
        callback(data);
        break;

      default:
        return this._fatalError(new Error('Invalid message received'));
    }
  }

  // If necessary, set a timeout for sending an ack packet.
  this._scheduleSendAck();

  function sendReply(message) {
    packet.type = RSP;
    packet.data = message;
    self._send(packet);
  }
};


WebsocketChannel.prototype._isOpen = function() {
  return this._websocket && this._websocket.readyState === Websocket.OPEN;
};


WebsocketChannel.prototype._flushSendQueue = function() {
  var self = this;
  var packet;

  while (this._sentSeq < this._seq && this._isOpen()) {
    packet = this._sendQueue[++this._sentSeq];
    if (!packet)
      continue; // Packet was acked and deleted.
    packet.ack = this._sentAck = this._receivedSeq;
    this._debug('flush %s %d', packet.type, packet.requestId);
    this._websocket.send(JSON.stringify(packet), afterSend);
  }

  // Send an ack-only packet if necessary.
  if (this._sentAck !== this._receivedSeq && this._isOpen()) {
    packet = {ack: this._sentAck = this._receivedSeq};
    this._websocket.send(JSON.stringify(packet), afterSend);
  }

  if (packet) {
    this._unscheduleSendAck();
  }

  function afterSend(err) {
    if (err) {
      self._debug('send error %j', err.message || err);
      self._handleError(err);
    }
  }
};


WebsocketChannel.prototype._handleError = function(err) {
  // Note that ws doesn't always emit Error objects, it also emits strings!
  this._debug('detach on error: %j', err);
  this._detach();
  this._reconnect();
};


WebsocketChannel.prototype._fatalError = function(err) {
  if (typeof err === 'string')
    err = new Error(err);
  debug('detach on fatal error: %s', err.message);
  this._detach();
  this._closeWebsocket();
  this._closed = err.message;
  this.emit('error', err);
  return this;
};


WebsocketChannel.prototype._handleDisconnect = function() {
  this._debug('detach on disconnect');
  this._detach();
  this._reconnect();
};


exports.generateToken = function() {
  return crypto.randomBytes(24).toString('hex');
};


// Used by WebsocketRouter to create a Channel that can accept incoming
// websocket connections.
exports.create = function(onRequest, clientToken) {
  return new WebsocketChannel(onRequest, clientToken);
};


// Use to connect to a server, uri must be known from the server (communicated
// out of band).
//
// onRequest, receive requests/notifications from server
// uri, ws://[token@]host:port/path
exports.connect = function(onRequest, uri) {
  return new WebsocketChannel(onRequest).connect(uri);
};
