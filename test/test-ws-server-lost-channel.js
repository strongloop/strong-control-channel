// Copyright IBM Corp. 2015. All Rights Reserved.
// Node module: strong-control-channel
// This file is licensed under the Artistic License 2.0.
// License text available at https://opensource.org/licenses/Artistic-2.0

var Server = require('./mock-server');
var Channel = require('../ws-channel');
var debug = require('debug')('strong-control-channel:test');
var tap = require('tap');

tap.test('server loses channel', function(t) {
  var server = new Server('channel', function() {}, onListening);
  var channel = channel;
  server.router.CHANNEL_TIMEOUT = 500;

  t.on('end', function() {
    debug('stop server');
    server.stop();
  });

  t.plan(2);

  server.client.on('new-channel', function(channel) {
    channel.on('error', function(err) {
      t.equal(err.message, 'reconnect-timeout', 'reconnect timeout');
      channel.destroy('some reason');
    });

    channel.request({cmd: 'yo'}, function(rsp) {
      debug('onResponse: %j', rsp);
      t.equal(rsp.error, 'some reason', 'requests cancelled');
    });
  });

  function onListening(uri) {
    debug('mesh uri: %s', uri);

    var channel = Channel.connect(onRequest, uri);

    function onRequest(req, callback) {
      debug('destroy onRequest %j', req);
      channel.destroy();
      // Make sure that use of callback doesn't expode after a destroy.
      callback({error: 'should not be delivered'});
    }
  }
});
