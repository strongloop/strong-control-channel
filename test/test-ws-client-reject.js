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
  var channels = [];
  var alives = 0;
  var closes = 0;

  t.plan(1);

  t.on('end', function() {
    debug('stop server');
    server.stop();
  });

  server.client.on('new-channel', function(channel) {
    channels.push(channel);
  });

  function onListening(uri) {
    debug('mesh uri: %s', uri);

    connect();

    function connect() {
      var channel = Channel.connect(function() {}, uri);
      var num = channels.length + 1;

      channel.request({cmd: 'alive'}, function(rsp) {
        debug('client %d: rsp %j', num, rsp);
      });

      channel.on('error', function(err) {
        closes++;
        assert.equal(err.message, 'reject-client');
        debug('client %d: %s closes=%d', num, closes);

        if (closes === channels.length)
          t.assert(true, 'clients closed');
      });
    }
  }

  function onRequest(message, callback) {
    alives++;
    debug('server recv: alives %d expect %d', alives, channels.length);
    assert.equal(message.cmd, 'alive');

    callback({});

    if (alives === channels.length) {
      debug('closing client');
      server.client.destroy();
    }
  }
});
