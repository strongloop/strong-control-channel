// control channel cluster
//
// cluster message format is:
//
// # cmd
//
// one of:
//
// -'strong-control-channel:request'
// -'strong-control-channel:response'
//
// # data
//
// request or response message
//
// By convention, data has a format, it is
//
// - cmd: identification of request
// - error: if request failed, this will be the reason
//
// # seqno
//
// sequence number, for correlating requests and responses

var REQ = 'strong-control-channel:request';
var RSP = 'strong-control-channel:response';

var assert = require('assert');
var channel = require('./channel');
var cluster = require('cluster');
var debug = require('./debug')('cluster-' + (cluster.worker ?
                              cluster.worker.id : 'm'));
var events = require('events');
var util = require('util');

function Server(onRequest) {
  assert(onRequest);

  var self = this;

  self.onRequest = onRequest;
  self.requests = {};
  self.seqno = 0;

  self.on('message', function(message, worker) {
    var seqno = message.seqno;

    if (message.cmd === REQ) {
      var request = message.data;

      debug('channel request #%d %j', message.seqno, request);

      if (!self.onRequest) {
        self._send(worker, {
          cmd: RSP, seqno: seqno, data: {error: 'unsupported'}
        });
        return;
      }

      self.onRequest(request, function(response) {
        debug('channel response #%d %j', message.seqno, response);

        self._send(worker, {cmd: RSP, seqno: seqno, data: response});
      });
    }

    if (message.cmd === RSP) {
      var response = message.data;

      debug('channel response #%d %j', message.seqno, message);

      var callback = self.requests[message.seqno];

      delete self.requests[message.seqno];

      if (callback === undefined) {
        debug('channel response seqno %d unknown!', message.seqno);
        return;
      }

      callback(message.data);
    }
  });

  self._attach();
}

util.inherits(Server, events.EventEmitter);

// Ensure all cluster messages are emitted on self with the worker object
// that the response should be sent to.
//
// This will look like:
//
//   self.emit('message', message, worker);
//
// In a worker, there is only one worker, but in a master, we have to listen for
// the message event on each newly forked worker :-(
Server.prototype._attach = function _attach() {
  var self = this;

  // In a worker, messages come only from master.
  if (cluster.isWorker) {
    cluster.worker.on('message', function(message) {
      self.emit('message', message, cluster.worker);
    });

    return;
  }

  // In a master, we need to listen for messages on all workers as they are
  // forked, and tell the message server which worker the message came from, as
  // well as any workers that were already forked.
  for (var id in cluster.workers) {
    listen(cluster.workers[id]);
  }

  cluster.on('fork', listen);

  function listen(worker) {
    worker.on('message', function(message) {
      self.emit('message', message, worker);
    });
  }
};

Server.prototype._send = function _send(worker, message) {
  try {
    worker.send(message);
  } catch(er) {
    // can happen if other side disconnected since sending message,
    // there is nothing we can do if the sender died before receiving the
    // response.
    debug('cluster send failed: %s', er);
  }
};

function Self(server, callback) {
  var self = this;
  this.callback;
  this.send = function(message) {
    debug('self-send %j', message);

    process.nextTick(function() {
      server.emit('message', message, self);
    });
  }
}

// Send a single request, callbacks with err, response
//
// dst is either a cluster worker ID, or a process ID. In the master, it
// can be it's own process ID, or the (never valid in node) worker ID of 0,
// used to mean 'master'
Server.prototype.request = function request(dst, request, callback) {
  debug('dst %s request %j', dst, request);

  if (cluster.isWorker) {
    if (dst !== 0)
      return;

    var worker = cluster.worker;
  } else {
    function isMatch(w) {
      if (w.id === dst || w.process.pid === dst) {
        return w;
      }
    }

    if (dst === 0 || dst === process.pid) {
      // Send to self,
      // fake this out with a wrapper that does the right thing for the request
      // and response send
      worker = new Self(this, callback);
    } else {
      for (var id in cluster.workers) {
        worker = isMatch(cluster.workers[id]);
        if (worker)
          break;
      }
    }
    if (!worker)
      return;
  }

  var seqno = this.seqno++;
  this.requests[seqno] = callback;
  this._send(worker, {
    cmd: REQ,
    data: request,
    seqno: seqno
  });

  return this;
}

// On request, callback will be called with request and callback.
//
// callback should be called with response.
//
// Only one can be created (because there is only one instance of cluster module
// to attach to).
function attach(onRequest) {
  assert(!cluster._strongControlChannel);

  debug('attaching to cluster in pid %d', process.pid);

  cluster._strongControlChannel = new Server(onRequest);

  return cluster._strongControlChannel;
}

// usage:
//
// require('strong-control-channel/cluster')(function(request, callback) {
//   callback({/* ...some response... */});
// });
//
module.exports = attach;
module.exports.attach = attach;
