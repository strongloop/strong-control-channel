// Copyright IBM Corp. 2014,2015. All Rights Reserved.
// Node module: strong-control-channel
// This file is licensed under the Artistic License 2.0.
// License text available at https://opensource.org/licenses/Artistic-2.0

// control channel server

var assert = require('assert');
var channel = require('./channel');
var debug = require('./debug')('server');
var events = require('events');
var message = require('./message');
var net = require('net');
var path = require('path');
var toPipe = require('./pipe').toPipe;
var util = require('util');

function Server(onRequest, onNotification) {
  this.server = null;
  this.protocol = new message.Protocol(onRequest, onNotification, debug);
  this.clientChannels = [];

  assert(onRequest);
}

util.inherits(Server, events.EventEmitter);

Server.prototype.listen = function listen(addr) {
  var self = this;

  assert(!self.addr);
  assert(!self.server);

  self.addr = toPipe(addr);

  self.server = net.createServer(function(socket) {
    var ch = channel.fromSocket(socket);
    self.clientChannels.push(ch);

    function removeChannel() {
      for (var i in this.clientChannels) {
        if (this.clientChannels[i] === ch) {
          delete this.clientChannels[i];
          break;
        }
      }
    }

    ch.on('error', function(er) {
      debug('channel error %s', er);
      removeChannel();
      self.emit('warn', er, ch);
    });

    socket.on('close', function() {
      removeChannel();
    });

    ch.on('message', function(data) {
      debug('channel data %s', debug.json(data));
      self.protocol.process(data, ch);
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
    debug('channel server listening on %j', self.address());

    self.emit('listening', this);
  });

  return self;
};

// If listening on a TCP port, returns `TCPServer#address()`
// Othewise, its a local domain port, and return is
//   `{ path: <fully resolved path> }`
Server.prototype.address = function address() {
  var _address = this.server.address();
  if (!_address.port) {
    return {path: path.resolve(_address)};
  }
  return _address;
};

Server.prototype.unref = function unref() {
  return this.server.unref();
};

Server.prototype.close = function close(callback) {
  this.server.close(callback);
  return this;
};

Server.prototype.notify = function notify(request) {
  for (var i in this.clientChannels) {
    try {
      this.protocol.notify(this.clientChannels[i], request);
    } catch (er) {
      delete this.clientChannels[i];
    }
  }
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
function create(onRequest, onNotification) {
  return new Server(onRequest, onNotification);
}

exports.create = create;
