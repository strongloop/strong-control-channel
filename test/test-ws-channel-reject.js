// Copyright IBM Corp. 2015. All Rights Reserved.
// Node module: strong-control-channel
// This file is licensed under the Artistic License 2.0.
// License text available at https://opensource.org/licenses/Artistic-2.0

var Server = require('./mock-server');
var Channel = require('../ws-channel');
var assert = require('assert');
var debug = require('debug')('strong-control-channel:test');
var tap = require('tap');

tap.test('server reject', function(t) {
  // Parent and server.
  var server = new Server('channel', onRequest, onListening);

  t.plan(1);

  t.on('end', function() {
    debug('stop server');
    server.stop();
  });

  function onListening(uri) {
    debug('mesh uri: %s', uri);

    var channel = Channel.connect(function() {}, uri);

    channel.request({cmd: 'alive'}, function(rsp) {
      debug('client rsp %j', rsp);
    });

    channel.on('error', function(err) {
      debug('client err %s', err.message);
      t.equal(err.message, 'reject-channel');
    });
  }

  function onRequest(message) {
    debug('server recv: %j', message);
    assert.equal(message.cmd, 'alive');

    debug('destroying channel');

    // Simulate server restart... destroy the client and its channels, then
    // reaccept the client token, but since the channel will no longer be known,
    // the channel will be rejected even though the client is known.
    server.client.destroy();
    server.client = server.router.acceptClient(function() {
      assert(false);
    }, 'CID');
  }
});
