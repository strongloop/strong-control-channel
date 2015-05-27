module.exports = WebsocketChannel;

var assert = require('assert');
var crypto = require('crypto');
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
  this._error = null;
  this._sendQueue = [];
  this._uri = null;
  this._callbacks = {};
  this._callbacksPending = 0;
  this._seqno = 0;
  this._token = null;
  this._unref = false;
}

util.inherits(WebsocketChannel, events.EventEmitter);

WebsocketChannel.prototype._onNotification = function(message) {
  this._onRequest(message, nullCallback);
};

function nullCallback() {
}

WebsocketChannel.prototype.connect = function(uri, token) {
  token = token || url.parse(uri).auth;
  assert(!this._websocket);
  assert(uri);
  assert(token, 'token required');
  this._uri = uri;
  this._token = token;

  var headers = {'x-mesh-token': token};
  var websocket = new Websocket(uri, {headers: headers});

  this._attach(websocket);

  return this;
};


WebsocketChannel.prototype.createToken = function() {
  assert(!this._token);
  this._token = crypto.randomBytes(24).toString('hex');
  return this._token;
};


WebsocketChannel.prototype.accept = function(websocket) {
  assert(!this._websocket);
  assert(this._token);
  this._uri = null; // TODO(bert) set this
  this._attach(websocket);

  return this;
};


WebsocketChannel.prototype._attach = function(websocket) {
  this._websocket = websocket;

  websocket.on('message', this._handleMessage.bind(this));
  websocket.on('error', this._handleError.bind(this));

  if (websocket.readyState === Websocket.CONNECTING)
    websocket.once('open', this._onOpen.bind(this));
  else
    this._onOpen();

  this._flushSendQueue();
};


WebsocketChannel.prototype.close = function(callback) {
  if (this._websocket)
    this._websocket.close();

  if (!callback)
    return this;

  if (this._sendQueue.length === 0) {
    process.nextTick(callback);

  } else {
    var error = new Error('Messages were discarded');
    process.nextTick(function() {
      callback(error);
    });
  }

  return this;
};


WebsocketChannel.prototype.notify = function(message) {
  var packet = {
    type: NOT,
    seqno: this._seqno++,
    data: message
  };

  this._send(packet);
};


WebsocketChannel.prototype.request = function(message, callback) {
  var seqno = this._seqno++;
  this._callbacks[seqno] = callback;
  this._callbacksPending++;

  // Reference the socket (even if was referenced) if we're waiting for a
  // response.
  if (this._callbacksPending === 1 && this._socket && this._unref)
    this._socket.ref();

  var packet = {
    type: REQ,
    seqno: seqno,
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
  this._socket = this._websocket._socket;

  if (this._unref && this._callbacksPending === 0)
    this._socket.unref();

  this._flushSendQueue();
};


WebsocketChannel.prototype._send = function(message) {
  this._sendQueue.push(JSON.stringify(message));
  if (this._isOpen())
    this._flushSendQueue();
};


WebsocketChannel.prototype._handleMessage = function(s) {
  var self = this;

  try {
    var packet = JSON.parse(s);
  } catch (err) {
    return this._handleError(err);
  }

  switch (packet.type) {
    case NOT:
      return this._onNotification(packet.data);

    case REQ:
      return this._onRequest(packet.data, sendReply);

    case RSP:
      var callback = this._callbacks[packet.seqno];
      if (!callback) {
        var error = new Error('Unrecognized response sequence number');
        return this._handleError(error);
      }

      delete this._callbacks[packet.seqno];
      this._callbacksPending--;

      // Unref the socket if the channel was unref'ed and we're no longer
      // awaiting any responses.
      if (this._unref && this._callbacksPending === 0)
        this._socket.unref();

      return callback(packet.data);

    default:
      return this._handleError(new Error('Invalid message received'));
  }

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
  var s;

  while ((s = sendQueue.shift()) !== undefined)
    this._websocket.send(s, afterSend);

  function afterSend(err) {
    if (err)
      self._handleError(err);
  }
};


WebsocketChannel.prototype._handleError = function(err) {
  if (this._error)
    return;

  this._error = err;
  this._websocket.close();

  this.emit('error', err);
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
// token, used to connect to server, overrides the token in the uri, mandatory
//   if the uri does not have a token
WebsocketChannel.connect = function(onRequest, uri) {
  return new WebsocketChannel(onRequest).connect(uri);
};
