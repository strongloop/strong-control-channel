// control channel server

var net = require('net');

var assert = require('assert');
var channel = require('./channel');
var debug = require('./debug')('server');
var events = require('events');
var fs = require('fs');
var net = require('net');
var path = require('path');
var toPipe = require('./pipe').toPipe;
var util = require('util');

function Server(onRequest) {
  this.server = null;
  this.onRequest = onRequest;

  assert(onRequest);
}

util.inherits(Server, events.EventEmitter);

Server.prototype.listen = function listen(addr) {
  var self = this;

  assert(!self.addr);
  assert(!self.server);

  self.addr = toPipe(addr);

  net.createServer(function(socket) {
    var ch = channel.fromSocket(socket);

    ch.on('error', function(er) {
      debug('channel error %s', er);
      // We don't care about channel errors, and the channel will destroy the
      // socket.
      self.emit('warn', er, ch);
    });

    ch.on('message', function(request) {
      debug('channel request %j', request);
      self.onRequest(request, function(response) {
        debug('channel request %j => %j', request, response);
        // XXX(sam) will have to trim json, it can be very large
        ch.send(response); // XXX(sam) may throw if channel closed?
      }, ch /* for test/debug purposes */);
    });
  }).on('error', function(er) {
    // Only error I know about is caused by listen failing
    debug('server error %s', er);
    self.emit('error', er);
  }).on('close', function() {
    // On Server#close()
    debug('channel server closed');
    self.emit('close');
  }).listen(self.addr, function() {
    self.server = this; // because it isn't valid to close a server until it is listening
    debug('channel server listening on', this.address());
    self.emit('listening', this);
  });

  return self;
};


Server.prototype.close = function close(callback) {
  this.server.close(callback);
  return this;
};

/* XXX might need this
Server.prototype.destroy = function close(callback) {
  this.connections.forEach(function(c) {
    c.destroy();
  });
  this.listener.close(callback);
  return this;
};
*/

// On request, callback will be called with request and callback.
//
// callback should be called with response.
//
// server supports #listen(addr), with address being a tcp port number, or local
// socket name.
function create(onRequest) {
  return new Server(onRequest);
}

exports.create = create;
