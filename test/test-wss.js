// Copyright IBM Corp. 2016. All Rights Reserved.
// Node module: strong-control-channel
// This file is licensed under the Artistic License 2.0.
// License text available at https://opensource.org/licenses/Artistic-2.0

var Server = require('./mock-server');
var WebsocketChannel = require('../ws-channel');
var assert = require('assert');
var extend = require('util')._extend;

var isParent = process.argv[2] !== 'child';
var debug = require('debug')('strong-control-channel:test:' + (isParent ?
  'parent' : 'child'));

var gotRequest = 0;
var gotResponse = 0;
var gotNotification = 0;

process.on('exit', function() {
  var which = isParent ? 'parent' : 'child';
  assert.equal(gotRequest, 1, which);
  assert.equal(gotResponse, 1, which);
  assert.equal(gotNotification, 1, which);

  // Print only if we're the parent - not the child.
  if (isParent)
    console.log('ok # PASS\n1..1');
});


var channel;

if (isParent) {
  // Parent
  var opts = {proto: 'wss', hostname: 'localhost'};
  var server = new Server('channel', onServerRequest, onListening, opts);

  server.client.on('new-channel', function(ch) {
    debug('new-channel: %s', ch.getToken());
    server.request({cmd: 'clientRequest'}, function(message) {
      debug('server got', message);
      assert(message.cmd === 'clientResponse');
      gotResponse++;

      // Not a particularly logical place to close the server, but it has to
      // happen after accepting an incoming connection, which we can be certain
      // has happened at this this point.
      server.stop();
    });
    server.notify({cmd: 'clientNotification'});
  });

} else {
  // Child
  debug('child connects to: %s', process.env.MESH_URI);
  channel = WebsocketChannel.connect(onClientRequest, process.env.MESH_URI);

  channel.on('error', function(err) {
    assert.equal(err.message, 'disconnect');
  });

  channel.notify({cmd: 'serverNotification'});

  channel.request({cmd: 'serverRequest'}, function(message) {
    debug('client got', message);
    assert(message.cmd === 'serverResponse');
    gotResponse++;
  });

  channel.unref();
}

function onServerRequest(message, callback) {
  debug('server got', message);
  if (message.cmd === 'serverRequest') {
    assert(message.cmd === 'serverRequest');
    gotRequest++;
    callback({cmd: 'serverResponse'});
    return;
  }

  assert(message.cmd === 'serverNotification');
  gotNotification++;
}

function onListening(uri) {
  debug('listening on mesh uri: %s', uri);
  var env = extend({MESH_URI: uri}, process.env);
  require('child_process').fork(process.argv[1], ['child'], {
    stdio: 'inherit',
    env: env,
  }).on('exit', function(code, signal) {
    debug('child exit: %s', signal || code);
    assert.equal(code, 0);
  });
}

function onClientRequest(message, callback) {
  debug('client got', message);

  if (message.cmd === 'clientRequest') {
    assert(message.cmd === 'clientRequest');
    gotRequest++;
    callback({cmd: 'clientResponse'});
    return;
  }

  assert(message.cmd === 'clientNotification');
  gotNotification++;
}
