module.exports = WebsocketRouter;

var WebsocketChannel = require('./ws-channel');


// app, an express instance
// path, express route at which to listen for connections
function WebsocketRouter(app, path) {
  if (!(this instanceof WebsocketRouter))
    return new WebsocketRouter(app, path);

  this._channels = {};
  this._path = path;
  app.ws(path, this.handleSocket.bind(this));
}


// Create a channel for a specific client, so that it can connect to it's
// specific channel.  The client will need to be informed of the channel token
// out-of-band in order to connect.
WebsocketRouter.prototype.createChannel = function(onRequest, onNotification) {
  var channel = WebsocketChannel.create(onRequest, onNotification);
  var token = channel.createToken();

  this._channels[token] = channel;

  return channel;
};


WebsocketRouter.prototype.handleSocket = function(websocket) {
  var headers = websocket.upgradeReq.headers;
  var token = headers['x-mesh-token'];
  var channel = this._channels[token];

  if (!channel)
    return websocket.close();

  channel.accept(websocket);
};
