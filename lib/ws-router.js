module.exports = WebsocketRouter;

var WebsocketChannel = require('./ws-channel');


function WebsocketRouter(app, path) {
  if (!(this instanceof WebsocketRouter))
    return new WebsocketRouter(app, path);

  this._channels = {};
  this._path = path;
  app.ws(path, this.handleSocket.bind(this));
}


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
