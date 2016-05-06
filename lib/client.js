// Copyright IBM Corp. 2014,2015. All Rights Reserved.
// Node module: strong-control-channel
// This file is licensed under the Artistic License 2.0.
// License text available at https://opensource.org/licenses/Artistic-2.0

// control channel client

var net = require('net');

var channel = require('./channel');
var debug = require('./debug')('client');
var toPipe = require('./pipe').toPipe;
var message = require('./message');

function nop() {
}

function Client(addr, onResponse, onNotification, onError) {
  addr = toPipe(addr);
  debug('connect to: %s', addr);
  this._socket = net.connect(addr);
  this._ch = channel.fromSocket(this._socket);
  this._protocol = new message.Protocol(nop, onNotification, debug);
  this._onResponse = onResponse;

  var self = this;
  this._ch.on('message', function(response) {
    self._protocol.process(response);
  });

  if (onError && typeof onError === 'function') {
    this._ch.once('error', onError);
  }
}

Client.prototype.request = function(req, callback) {
  this._protocol.request(this._ch, req, callback || this._onResponse);
};

Client.prototype.close = function() {
  this._socket.end();
};

// Send a single request, callbacks with err, response
function request(addr, request, callback) {
  var c = new Client(addr, onResponse, nop, onError);

  function onResponse(resp) {
    c.close();
    callback(null, resp);
  }

  function onError(err) {
    callback(err, undefined);
  }

  c.request(request);
  return c._ch;
}

exports.request = request;
exports.Client = Client;
