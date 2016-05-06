// Copyright IBM Corp. 2014,2015. All Rights Reserved.
// Node module: strong-control-channel
// This file is licensed under the Artistic License 2.0.
// License text available at https://opensource.org/licenses/Artistic-2.0

// inter-process control channel

var assert = require('assert');
var debug = require('./debug')('process:' + process.pid);
var message = require('./message');

function Server(onRequest) {
  this._protocol = new message.Protocol(onRequest, onNotification, debug);
  function onNotification(req) {
    onRequest(req, function() {});
  }
}

// Attach to a child process.
Server.prototype.attach = function attach(target) {
  var self = this;

  self._target = target = target || process;
  self._onmessage = function(message) {
    self._protocol.process(message, target);
  };

  if (target === process) {
    debug('child %d attaching to parent', process.pid);
  } else {
    debug('parent %d attaching to child %d', process.pid, target.pid);
  }

  target.on('message', self._onmessage);

  return self;
};

Server.prototype.request = function request(request, callback) {
  var dst = this._target === process ? 'parent' : this._target.pid;
  debug('dst %s request %s', dst, debug.json(request));
  assert(this._target, 'server not attached to a process');
  return this._protocol.request(this._target, request, callback);
};

Server.prototype.notify = function notify(notification) {
  var dst = this._target === process ? 'parent' : this._target.pid;
  debug('dst %s notify %s', dst, debug.json(notification));
  assert(this._target, 'server not attached to a process');
  return this._protocol.notify(this._target, notification);
};

function createServer(onRequest) {
  return new Server(onRequest);
}

// Short-cut for attaching in a child
function attach(onRequest, child) {
  if (typeof onRequest !== 'function') {
    child = onRequest;
    onRequest = unsupported;
  }
  return createServer(onRequest).attach(child);

  function unsupported(req, callback) {
    return callback({error: 'unsupported'});
  }
}


exports.createServer = createServer;
exports.attach = attach;
