// Copyright IBM Corp. 2015. All Rights Reserved.
// Node module: strong-control-channel
// This file is licensed under the Artistic License 2.0.
// License text available at https://opensource.org/licenses/Artistic-2.0

'use strict';

module.exports = WebsocketRouter;

var EventEmitter = require('events').EventEmitter;
var WebsocketChannel = require('./ws-channel');
var WebsocketServer = require('ws').Server;
var assert = require('assert');
var async = require('async');
var debug = require('./debug')('ws-router');
var inherits = require('util').inherits;

// server, and http server instance
// app, an express instance
// path, express route at which to listen for connections
//
// Life cycle of client:
// - call .connect() to get a channel
// - 'connect' will be emitted when its handshaked with server
// - it will retry forever if there is network/websocket layer errors (ip/port
//   unreachable, etc.), set a timeout if you don't want that
// - 'error' will be emitted on channel for unrecoverable situations:
//   - there is a protocol error, in websocket or the control channel protocol,
//     such as invalid sequence numbering
//   - server deliberately disconnected the channel: err.message is 'disconnect'
//   - server rejected the client as unknown: err.message is 'reject-client'
//   - server rejected the channel as unknown: err.message is 'reject-channel'
// - when the underlying websocket errors or closes, the websocket will be
//   reconnected, and messages continue to be flushed
// - XXX reconnection is unobservable ATM, perhaps it should be, for easy of
//   debugging
function WebsocketRouter(server, app, path) {
  if (!(this instanceof WebsocketRouter))
    return new WebsocketRouter(app, path);

  assert(path, 'path is mandatory');

  this._clients = Object.create(null);
  this.path = app.mountpath + path;
  this._wss = new WebsocketServer({
    server: server,
    path: this.path,
  });
  this._wss.on('connection', this.handleSocket.bind(this));

  debug('listen on path %j', this.path);
}

// Can be overridden per-router, or globally (used by tests);
WebsocketRouter.prototype.CHANNEL_TIMEOUT =
  (+process.env.STRONGLOOP_CHANNEL_TIMEOUT > 0) ?
  (+process.env.STRONGLOOP_CHANNEL_TIMEOUT * 1000) : 60000;


// Create a channel for a specific client, so that it can connect to it's
// specific channel.  The client will need to be informed of the channel token
// out-of-band in order to connect.
WebsocketRouter.prototype.acceptClient = function(onRequest, token) {
  debug('acceptClient: token %s', token || '(new client)');

  var client = new WebsocketClient(onRequest, token, this);

  token = client.getToken();

  assert(!this._clients[token], 'token is not unique: ' + token);

  this._clients[token] = client;

  debug('accepting client %s', client.getToken());

  return client;
};


WebsocketRouter.prototype._closeClient = function(token, callback) {
  if (token.getToken)
    token = token.getToken();

  var client = this._clients[token];

  debug('destroy client %j, exist? %j', token, !!client);

  delete this._clients[token];

  if (client) {
    client._close(callback);
  } else if (callback) {
    // If this returns undefined, you know there is no client, and won't get a
    // callback, but that seems subtly error prone, so always callback.
    process.nextTick(callback);
  }

  return client;
};


WebsocketRouter.prototype._destroyClient = function(token) {
  if (token.getToken)
    token = token.getToken();

  var client = this._clients[token];

  debug('destroy client %j, exist? %j', token, !!client);

  delete this._clients[token];

  if (client) {
    client._destroy();
  }

  return client;
};


WebsocketRouter.prototype.close = function(callback) {
  debug('close router');
  var self = this;
  async.each(Object.keys(this._clients), function(token, next) {
    var client = self._clients[token];
    client.close(next);
  }, callback || function() {});
};


WebsocketRouter.prototype.handleSocket = function(websocket) {
  var headers = websocket.upgradeReq.headers;
  var token = headers['x-mesh-token'];
  var session = headers['x-session-token'];
  var client = this._clients[token];

  debug('receive client %s acceptable? %j', token, !!client);

  // Client is unknown
  if (!client) {
    websocket.send(JSON.stringify({
      type: WebsocketChannel.SHK,
      error: 'reject-client',
    }));
    return websocket.close();
  }

  client._accept(websocket, session);
};


function WebsocketClient(onRequest, token, router) {
  EventEmitter.call(this);

  this._onRequest = onRequest;
  this._token = token || WebsocketChannel.generateToken(token);
  this._router = router;
  this._channels = Object.create(null);
}

inherits(WebsocketClient, EventEmitter);


WebsocketClient.prototype.getToken = function() {
  return this._token;
};


WebsocketClient.prototype.close = function(callback) {
  debug('close client %s', this._token);
  return this._router._closeClient(this._token, callback || function() {});
};


WebsocketClient.prototype._close = function(callback) {
  var self = this;
  async.each(Object.keys(this._channels), function(session, next) {
    var channel = self._channels[session];
    clearTimeout(channel.__reconnectTimeout);
    channel.close(function() {
      // Discard any error on unhandshaked data
      return next();
    });
  }, callback);
};


WebsocketClient.prototype.destroy = function() {
  debug('destroy client %s', this._token);
  return this._router._destroyClient(this._token);
};


WebsocketClient.prototype._destroy = function() {
  var self = this;
  Object.keys(this._channels).forEach(function(channel) {
    clearTimeout(channel.__reconnectTimeout);
    self._channels[channel].destroy();
  });
  return this;
};


WebsocketClient.prototype._accept = function(websocket, session) {
  var channel = this._channels[session];

  if (session && !channel) {
    debug('reject channel %j', session);
    websocket.send(JSON.stringify({
      type: WebsocketChannel.SHK,
      error: 'reject-channel',
    }));
    return websocket.close();
  }

  if (channel) {
    debug('accept reconnecting session %s', session);
    clearTimeout(channel.__reconnectTimeout);
    return channel.accept(websocket);
  }

  debug('accept new session');

  channel = WebsocketChannel.create(this._onRequest, this._token);
  channel.accept(websocket);
  this._channels[channel.getToken()] = channel;
  this.emit('new-channel', channel);

  var to = this._router.CHANNEL_TIMEOUT;

  channel.on('reconnecting', function() {
    channel.__reconnectTimeout = setTimeout(function() {
      channel.emit('error', new Error('reconnect-timeout'));
      // receiver of the error is responsible for destroying the channel
    }, to);
    channel.__reconnectTimeout.unref();
  });

  // FIXME - this means that channel's error events are never 'uncaught',
  // which is arguably quite bad...
  channel.on('error', function() {
    // Don't timeout after an error, prevent double erroring.
    clearTimeout(channel.__reconnectTimeout);
  });

  return channel;
};
