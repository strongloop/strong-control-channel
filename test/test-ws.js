var assert = require('assert');
var express = require('express');
var expressWs = require('express-ws');
var extend = require('util')._extend;
var http = require('http');
var WebsocketChannel = require('../ws-channel');
var WebsocketRouter = require('../ws-router');

var ctlUri = 'ws://127.0.0.1:9999/channel';
var isParent = process.argv[2] !== 'child';

var gotRequest = 0;
var gotResponse = 0;
var gotNotification = 0;

process.on('exit', function() {
  assert(gotRequest === 1);
  assert(gotResponse === 1);
  assert(gotNotification === 1);

  // Print only if we're the parent - not the child.
  if (isParent)
    console.log('PASS');
});


var channel;

if (isParent) {
  // Parent

  // Create http + express server.
  var app = express();
  var server = http.createServer(app).listen(9999);
  expressWs(app, server);

  // Create a websocket handler.
  var router = new WebsocketRouter(app, 'channel');
  channel = router.createChannel(onServerRequest, onServerNotification);

  function onServerRequest(message, callback) {
    console.log('server got', message);
    assert(message.cmd === 'serverRequest');
    gotRequest++;
    callback({cmd: 'serverResponse'});
  }

  function onServerNotification(message) {
    console.log('server got', message);
    assert(message.cmd === 'serverNotification');
    gotNotification++;
  }

  var env = extend({MESH_TOKEN: channel.getToken()}, process.env_);
  require('child_process').fork(process.argv[1],
                                ['child'],
                                {stdio: 'inherit', env: env});

  channel.request({cmd: 'clientRequest'}, function(message) {
    console.log('server got', message);
    assert(message.cmd === 'clientResponse');
    gotResponse++;

    // Not a particularly logical place to close the server, but it has to
    // happen after accepting an incoming connection, which we can be certain
    // has happened at this this point.
    server.close();
  });

  channel.notify({cmd: 'clientNotification'});

} else {
  // Child
  channel = WebsocketChannel.connect(onClientRequest,
                                     onClientNotification,
                                     ctlUri,
                                     process.env.MESH_TOKEN);

  function onClientRequest(message, callback) {
    console.log('client got', message);
    assert(message.cmd === 'clientRequest');
    gotRequest++;
    callback({cmd: 'clientResponse'});
  }

  function onClientNotification(message) {
    console.log('client got', message);
    assert(message.cmd === 'clientNotification');
    gotNotification++;
  }

  channel.notify({cmd: 'serverNotification'});

  channel.request({cmd: 'serverRequest'}, function(message) {
    console.log('client got', message);
    assert(message.cmd === 'serverResponse');
    gotResponse++;
  });

  channel.unref();
}
