// Copyright IBM Corp. 2015. All Rights Reserved.
// Node module: strong-control-channel
// This file is licensed under the Artistic License 2.0.
// License text available at https://opensource.org/licenses/Artistic-2.0

'use strict';

var Central = require('./mock-server');
var Channel = require('../lib/ws-channel');
var EventEmitter = require('events').EventEmitter;
var assert = require('assert');
var async = require('async');
var debug = require('debug')('strong-control-channel:test');
var tap = require('tap');

var NULL_WS_PKT = new Buffer([0, 0, 0, 0]);
var central;
var control;
var channel;

var monitor = new EventEmitter();

tap.test('create central', function(t) {
  central = new Central('test-control', onRequest, onListening);

  function onListening(wsURL) {
    control = wsURL;
    t.assert(control, 'central is listening at ' + control);
    t.end();
  }
  function onRequest(req, callback) {
    callback({});
    monitor.emit('request', req);
  }
});

tap.test('create client', function(t) {
  channel = Channel.connect(echo, control);
  channel.notify({cmd: 'HI'});

  channel.on('error', function(err) {
    assert.equal(err.message, 'disconnect');
  });

  monitor.once('request', function(req) {
    debug('once HI: %j', req);
    t.match(req, {cmd: 'HI'}, 'client started');
    t.end();
  });

  function echo(req, callback) {
    req.echo = true;
    callback(req);
  }
});

tap.test('sabotage first websocket', function(t) {
  lightOnFire();

  t.plan(1);

  var to = setTimeout(function() {
    t.assert(false, 'timeout waiting for response');
  }, 3000);

  central.request({cmd: 'status'}, function(status) {
    clearTimeout(to);
    t.match(status, {cmd: 'status', echo: true});
  });

});

tap.test('sabotage third websocket without using the second', function(t) {
  // The intention here is to catch any errors that might occur if the client or
  // server aren't able to use the socket before it is killed. This serves as a
  // regression test for the client or server side getting confused if it
  // doesn't send any messages to piggyback ACK's on.

  // Destroy second websocket
  var ws2 = lightOnFire();

  // There aren't events that to observe the internal websockets in control
  // channel, so we'll just loop until the channels _websocket property has
  // a new value - the third websocket.
  async.until(isNew, pause, function() {
    lightOnFire();

    t.plan(1);

    var to = setTimeout(function() {
      t.assert(false, 'timeout waiting for response');
    }, 3000);

    central.request({cmd: 'status'}, function(status) {
      clearTimeout(to);
      t.match(status, {cmd: 'status', echo: true});
    });

  });

  function isNew() {
    var ws3 = channel._websocket;
    return ws3 && ws3 !== ws2;
  }

  function pause(next) {
    setTimeout(next, 100);
  }
});

tap.test('shutdown central', function(t) {
  central.stop(function() {
    t.pass('central shut down');
    t.end();
  });
});

function lightOnFire() {
  // throw a bad WS frame directly onto the socket to confuse the protocol's
  // state machine.... then set it on fire.

  var socket = channel._websocket;

  debug('inject protocol error on socket!');

  if (socket._socket) {
    socket._socket.end(NULL_WS_PKT);
  }
  // XXX(sam) Commenting this out triggers
  //   https://github.com/websockets/ws/issues/366
  socket.terminate();

  return socket;
}
