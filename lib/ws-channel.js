module.exports = WebsocketChannel;

var assert = require('assert');
var crypto = require('crypto');
var debug = require('./debug');
var events = require('events');
var util = require('util');
var url = require('url');
var Websocket = require('ws');

var REQ = 'strong-control-channel:request';
var RSP = 'strong-control-channel:response';
var NOT = 'strong-control-channel:notification';


function WebsocketChannel(onRequest) {
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
  this._token = null;
  this._unref = false;

  this._seq = -1;

  this._sentSeq = -1;
  this._receivedSeq = -1;
  this._sentAck = -1;
  this._receivedAck = -1;
  this._ackTimer = null;

  this._onOpen = this._onOpen.bind(this);
  this._handleMessage = this._handleMessage.bind(this);
  this._handleError = this._handleError.bind(this);
  this._handleDisconnect = this._handleDisconnect.bind(this);

  // _debug will be reset to a more specific tag once token is known
  this._debug = debug('ws-channel');
}

util.inherits(WebsocketChannel, events.EventEmitter);

WebsocketChannel.prototype._onNotification = function(message) {
  this._debug('recv: %s', this._debug.json(message));
  this._onRequest(message, nullCallback);
};

function nullCallback() {
}

WebsocketChannel.prototype.connect = function(uri, _token) {
  var token = _token || url.parse(uri).auth;

  this._debug = debug('ws-channel:' + token.substr(0, 5));
  this._debug('connect: uri %j token %s)', uri, _token || '(from uri)');

  assert(uri);
  assert(token, 'token required');

  this._uri = uri;
  this._token = token;

  var headers = {'x-mesh-token': token};
  var websocket = new Websocket(uri, {headers: headers});

  this._attach(websocket);

  return this;
};


WebsocketChannel.prototype.createToken = function(token) {
  this._token = token || crypto.randomBytes(24).toString('hex');
  this._debug = debug('ws-channel:' + this._token.substr(0, 5));
  return this._token;
};


WebsocketChannel.prototype.accept = function(websocket) {
  assert(this._token);
  this._uri = null; // TODO(bert) set this
  this._attach(websocket);

  return this;
};


WebsocketChannel.prototype._attach = function(websocket) {
  // If the channel is already attached to a websocket, close that one.
  if (this._websocket)
    this._detach();

  this._websocket = websocket;

  this._debug('attach with state %j', websocket.readyState);

  websocket.on('message', this._handleMessage);
  websocket.on('error', this._handleError);
  websocket.on('close', this._handleDisconnect);

  // Re-send messages that haven't been ACKed yet.
  this._sentAck = -1;
  this._sentSeq = this._receivedAck;

  if (websocket.readyState === Websocket.CONNECTING)
    websocket.on('open', this._onOpen);
  else
    this._onOpen();
};


WebsocketChannel.prototype._detach = function() {
  if (!this._websocket)
    return;

  this._debug('detach with state %j', this._websocket.readyState);

  this._unscheduleSendAck();

  this._websocket.removeListener('message', this._handleMessage);
  this._websocket.removeListener('error', this._handleError);
  this._websocket.removeListener('close', this._handleDisconnect);
  this._websocket.removeListener('open', this._onOpen);

  if (this._websocket.readystate !== Websocket.CLOSED)
    this._closeWebsocket(this._websocket);

  this._websocket = null;
};


WebsocketChannel.prototype.close = function(callback) {
  this._debug('close');

  if (this._websocket) {
    this._unscheduleSendAck();
    this._flushSendQueue();
    this._closeWebsocket(this._websocket);
  }

  if (!callback)
    return this;

  if (this._sentSeq === this._receivedAck &&
      this._sentAck === this._receivedSeq) {
    process.nextTick(callback);

  } else {
    var error = new Error('Messages were discarded');
    this._debug('close: %s', error.message);
    process.nextTick(function() {
      callback(error);
    });
  }

  return this;
};


WebsocketChannel.prototype._closeWebsocket = function(websocket) {
  // Work around a bug in ws that makes node crash when the socket is closed
  // while it is still connecting.
  if (websocket.readyState === Websocket.CONNECTING)
    websocket.once('open', websocket.close.bind(websocket));
  else if (websocket.readyState === Websocket.OPEN)
    websocket.close();
};


WebsocketChannel.prototype.notify = function(message) {
  this._debug('notify: %s', this._debug.json(message));

  var packet = {
    type: NOT,
    requestId: this._requestId++,
    data: message
  };

  this._send(packet);
};


WebsocketChannel.prototype.request = function(message, callback) {
  var requestId = this._requestId++;
  this._callbacks[requestId] = callback;
  this._callbacksPending++;

  this._debug('request id %d: %s', requestId, this._debug.json(message));

  // Reference the socket (even if was referenced) if we're waiting for a
  // response.
  if (this._callbacksPending === 1 && this._socket && this._unref)
    this._socket.ref();

  var packet = {
    type: REQ,
    requestId: requestId,
    data: message
  };

  this._send(packet);
};


WebsocketChannel.prototype.address = function() {
  return this.uri && url.parse(this.uri);
};


WebsocketChannel.prototype.getToken = function() {
  return this._token;
};


WebsocketChannel.prototype.unref = function() {
  this._unref = true;
  if (this._socket && this._callbacksPending === 0)
    this._socket.unref();
};


WebsocketChannel.prototype._onOpen = function() {
  this._debug('connection open');

  this._socket = this._websocket._socket;

  if (this._unref && this._callbacksPending === 0)
    this._socket.unref();

  this._flushSendQueue();
};


WebsocketChannel.prototype._send = function(packet) {
  this._unscheduleSendAck();

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
  if (this._sentSeq === this._seq)
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
  if (this._debug.enabled) {
    var snippet = s.replace(/(.{50})(.+)/, '$1...');
    this._debug('message <%s>', snippet);
  }

  var self = this;

  try {
    var packet = JSON.parse(s);
  } catch (err) {
    return this._handleError(err);
  }

  // Delete ack'ed packets from the send queue.
  var ack = packet.ack;
  assert(ack === undefined || typeof ack === 'number');

  if (ack !== undefined) {
    while (ack > this._receivedAck)
      delete this._sendQueue[++this._receivedAck];
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
        this._onNotification(packet.data);
        break;

      case REQ:
        this._onRequest(packet.data, sendReply);
        break;

      case RSP:
        var callback = this._callbacks[packet.requestId];
        if (!callback) {
          var error = new Error('Unrecognized response sequence number');
          return this._handleError(error);
        }

        delete this._callbacks[packet.requestId];
        this._callbacksPending--;

        // Unref the socket if the channel was unref'ed and we're no longer
        // awaiting any responses.
        if (this._unref && this._callbacksPending === 0)
          this._socket.unref();

        callback(packet.data);
        break;

      default:
        return this._handleError(new Error('Invalid message received'));
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
  var sendQueue = this._sendQueue;
  var packet;

  this._debug('flush %d msgs', this._seq - this._sentSeq);

  while (this._sentSeq < this._seq) {
    packet = sendQueue[++this._sentSeq];
    packet.ack = this._sentAck = this._receivedSeq;
    this._websocket.send(JSON.stringify(packet), afterSend);
  }

  // Send an ack-only packet if necessary.
  if (this._sentAck !== this._receivedSeq) {
    packet = {ack: this._sentAck = this._receivedSeq};
    this._websocket.send(JSON.stringify(packet), afterSend);
  }

  function afterSend(err) {
    self._debug('sent: err?', err);
    if (err)
      self._handleError(err);
  }
};


WebsocketChannel.prototype._handleError = function(err) {
  this._debug('detach on error: %s', err.message);
  this._detach();
  this.emit('error', err);
};


WebsocketChannel.prototype._handleDisconnect = function() {
  this._debug('detach on disconnect');
  this._detach();
};

// Used by WebsocketRouter#createChannel()
WebsocketChannel.create = function(onRequest) {
  return new WebsocketChannel(onRequest);
};


// Use to connect to a serveer, token/uri must be known from the server
// (communicated out of band).
//
// onRequest, receive requests/notifications from server
// uri, ws://[token@]host:port/path
WebsocketChannel.connect = function(onRequest, uri) {
  return new WebsocketChannel(onRequest).connect(uri);
};
