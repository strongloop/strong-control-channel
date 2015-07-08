'use strict';

module.exports = WebsocketRouter;

var EventEmitter = require('events').EventEmitter;
var WebsocketChannel = require('./ws-channel');
var WebsocketServer = require('ws').Server;
var assert = require('assert');
var debug = require('./debug')('ws-router');
var inherits = require('util').inherits;

// FIXME
//   token: rename to clientToken
//   session: rename to channelToken, including in ws-channel
// left alone for now to minimize diff

// server, and http server instance
// app, an express instance
// path, express route at which to listen for connections
function WebsocketRouter(server, app, path) {
  if (!(this instanceof WebsocketRouter))
    return new WebsocketRouter(app, path);

  assert(path, 'path is mandatory');

  this._clients = {};
  this.path = app.mountpath + path;
  this._wss = new WebsocketServer({
    server: server,
    path: this.path,
  });
  this._wss.on('connection', this.handleSocket.bind(this));

  debug('listen on path %j', this.path);
}


// Create a channel for a specific client, so that it can connect to it's
// specific channel.  The client will need to be informed of the channel token
// out-of-band in order to connect.
WebsocketRouter.prototype.acceptClient = function(onRequest, token) {
  debug('acceptClient: token %s', token || '(new client)');

  var client = new WebsocketClient(onRequest, token);

  token = client.getToken();

  assert(!this._clients[token], 'token is not unique: ' + token);

  this._clients[token] = client;

  debug('accepting client %s', client.getToken());

  return client;
};

// Remove client mapping, and close it. Call with either a channel
// or a token.
WebsocketRouter.prototype.destroyClient = function(token) {
  if (token.getToken)
    token = token.getToken();

  var client = this._clients[token];

  debug('destroy client %j, exist? %j', token, !!client);

  delete this._clients[token];

  if (client)
    client._close();

  return client;
};


WebsocketRouter.prototype.handleSocket = function(websocket) {
  var headers = websocket.upgradeReq.headers;
  var token = headers['x-mesh-token'];
  var session = headers['x-session-token'];
  var client = this._clients[token];

  debug('receive client %s acceptable? %j', token, !!client);

  // Client is unknown
  if (!client)
    return websocket.close();

  client._accept(websocket, session);
};

function WebsocketClient(onRequest, token) {
  EventEmitter.call(this);
  console.assert(this.on);

  this._onRequest = onRequest;
  this._token = token || WebsocketChannel.generateToken(token);
  this._channels = {};
}

inherits(WebsocketClient, EventEmitter);

WebsocketClient.prototype.getToken = function() {
  return this._token;
};

WebsocketClient.prototype._close = function(callback) {
  if (callback)
    process.nextTick(callback);
};

WebsocketClient.prototype._accept = function(websocket, session) {
  var channel = this._channels[session];

  debug('accept session %s new? %j', session, !channel);

  if (channel) {
    channel.accept(websocket);
    return null; // Not a new channel ('session'), just a reconnect.
  }

  channel = WebsocketChannel.create(this._onRequest, this._token);
  channel.accept(websocket);
  this._channels[channel.getToken()] = channel;
  this.emit('new-channel', channel);

  return channel;
};
