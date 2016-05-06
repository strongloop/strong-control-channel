// Copyright IBM Corp. 2014,2015. All Rights Reserved.
// Node module: strong-control-channel
// This file is licensed under the Artistic License 2.0.
// License text available at https://opensource.org/licenses/Artistic-2.0

// Message protocol implementation.
//
// message format is:
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
var NOT = 'strong-control-channel:notification';

var assert = require('assert');

exports.Protocol = Protocol;

// onRequest will be called with request and callback, callback should be called
// with response.
function Protocol(onRequest, onNotification, debug) {
  assert(onRequest);

  var self = this;

  self.onRequest = onRequest;
  self.onNotification = onNotification;
  self.debug = debug;
  self.requests = {};
  self.seqno = 0;
}

Protocol.prototype.request = function request(worker, request, callback) {
  var seqno = this.seqno++;
  this.requests[seqno] = callback;

  this._send(worker, {
    cmd: REQ,
    data: request,
    seqno: seqno,
  });

  return this;
};

Protocol.prototype.notify = function notify(worker, request) {
  var seqno = this.seqno++;

  this._send(worker, {
    cmd: NOT,
    data: request,
    seqno: seqno,
  });

  return this;
};

Protocol.prototype.process = function process(message, worker) {
  var self = this;
  var seqno = message.seqno;
  var debug = this.debug;

  if (message.cmd === REQ) {
    var request = message.data;

    debug('protocol request #%d %s', message.seqno, debug.json(request));

    if (!self.onRequest) {
      self._send(worker, {
        cmd: RSP, seqno: seqno, data: {error: 'unsupported'},
      });
      return;
    }

    // Pass a reference to the worker for debugging purposes.
    self.onRequest(request, function(response) {
      debug('protocol response #%d %s', message.seqno, debug.json(response));
      self._send(worker, {cmd: RSP, seqno: seqno, data: response});
    }, worker);
  }

  if (message.cmd === RSP) {
    debug('protocol response #%d %s', message.seqno, debug.json(message));

    var callback = self.requests[message.seqno];

    delete self.requests[message.seqno];

    if (callback === undefined) {
      debug('protocol response seqno %d unknown!', message.seqno);
      return;
    }

    setImmediate(callback, message.data);
  }

  if (message.cmd === NOT) {
    var notification = message.data;

    debug('protocol notification #%d %s',
      message.seqno,
      debug.json(notification));
    if (self.onNotification) {
      setImmediate(self.onNotification.bind(self), notification);
    }
  }
};

Protocol.prototype._send = function _send(worker, message) {
  try {
    worker.send(message);
  } catch (er) {
    // can happen if other side disconnected since sending message,
    // there is nothing we can do if the sender died before receiving the
    // response.
    this.debug('target send failed: %s', er.stack);
  }
};
