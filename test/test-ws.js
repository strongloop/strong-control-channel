var assert = require('assert');
var express = require('express');
var expressWs = require('express-ws');
var extend = require('util')._extend;
var http = require('http');
var url = require('url');
var WebsocketChannel = require('../ws-channel');
var WebsocketRouter = require('../ws-router');

var isParent = process.argv[2] !== 'child';
var debug = require('debug')('strong-control-channel:test:' + (isParent ?
  'parent' : 'child'));

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
  var server = http.createServer(app).listen(0);
  expressWs(app, server);

  server.on('error', function(err) {
    debug('err: %j', err);
    assert.ifError(err);
  });

  // Create a websocket handler.
  var router = new WebsocketRouter(app, 'channel');
  channel = router.createChannel(onServerRequest);

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

  server.once('listening', function() {
    var uri = url.format({
      protocol: 'ws',
      slashes: true,
      auth: channel.getToken(),
      hostname: '127.0.0.1',
      port: this.address().port,
      pathname: 'channel',
    });
    debug('mesh uri: %s', uri);
    var env = extend({MESH_URI: uri}, process.env);
    require('child_process').fork(process.argv[1], ['child'], {
      stdio: 'inherit',
      env: env
    }).on('exit', function(code, signal) {
      debug('child exit: %s', signal || code);
      assert.equal(code, 0);
    });
  });

  channel.request({cmd: 'clientRequest'}, function(message) {
    debug('server got', message);
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
  debug('child connects to: %s', process.env.MESH_URI);
  channel = WebsocketChannel.connect(onClientRequest, process.env.MESH_URI);

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

  channel.notify({cmd: 'serverNotification'});

  channel.request({cmd: 'serverRequest'}, function(message) {
    debug('client got', message);
    assert(message.cmd === 'serverResponse');
    gotResponse++;
  });

  channel.unref();
}
