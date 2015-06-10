'use strict';

module.exports = WebsocketRouter;

var WebsocketChannel = require('./ws-channel');
var WebsocketServer = require('ws').Server;
var assert = require('assert');
var debug = require('debug')('strong-control-channel:ws-router');


// server, an http.Server instance
// app, an express instance
// path, express route at which to listen for connections
function WebsocketRouter(server, app, path) {
  if (!(this instanceof WebsocketRouter))
    return new WebsocketRouter(app, path);

  this._channels = {};
  this.path = app.mountpath + path;
  this._wss = new WebsocketServer({
    server: server,
    path: this.path,
  });
  this._wss.on('connection', this.handleSocket.bind(this));
}


// Create a channel for a specific client, so that it can connect to it's
// specific channel.  The client will need to be informed of the channel token
// out-of-band in order to connect.
WebsocketRouter.prototype.createChannel = function(onRequest, token) {
  var channel = WebsocketChannel.create(onRequest);
  token = channel.createToken(token);

  assert(!this._channels[token], 'token is not unique: ' + token);

  this._channels[token] = channel;

  return channel;
};

// Remove channel mapping, and close it. Call with either a channel
// or a token.
WebsocketRouter.prototype.destroyChannel = function(token) {
  if (token.getToken)
    token = token.getToken();
  var channel = this._channels[token];
  delete this._channels[token];
  if (channel)
    channel.close();
  return channel;
};


WebsocketRouter.prototype.handleSocket = function(websocket) {
  var headers = websocket.upgradeReq.headers;
  var token = headers['x-mesh-token'];
  var channel = this._channels[token];

  debug('receive websocket: token %j acceptable? %j', token, !!channel);

  if (!channel)
    return websocket.close();

  channel.accept(websocket);
};
