var Server = require('./mock-server');
var WebsocketChannel = require('../ws-channel');
var assert = require('assert');
var extend = require('util')._extend;

var isParent = process.argv[2] !== 'child';
var debug = require('debug')('strong-control-channel:test:' +
                            (isParent ? 'parent' : 'child'));

var NUM_REQUESTS = 500;
var RECONNECT_INTERVAL = 10;

var clientRequestCounter = 0;
var clientResponseCounter = 0;
var serverRequestCounter = 0;
var serverResponseCounter = 0;

var channel;

process.on('exit', function() {
  assert(clientRequestCounter === NUM_REQUESTS);
  assert(clientResponseCounter === NUM_REQUESTS);
  assert(serverRequestCounter === NUM_REQUESTS);
  assert(serverResponseCounter === NUM_REQUESTS);

  // Print only if we're the parent - not the child.
  if (isParent)
    console.log('ok # PASS\n1..1');
});


if (isParent) {
  // Parent and server.
  var server = new Server('channel', onClientRequest, onListening);
  channel = server.channel;

  function onListening(uri) {
    debug('mesh uri: %s', uri);
    var env = extend({MESH_URI: uri}, process.env);
    require('child_process').fork(process.argv[1], ['child'], {
      stdio: 'inherit',
      env: env
    }).on('exit', function(code, signal) {
      debug('child exit: %s', signal || code);
      assert.equal(code, 0);
    });
  }

  function onClientRequest(message, callback) {
    assert(message.cmd === 'clientRequest');
    assert(message.counter === clientRequestCounter++);

    debug('clientRequest %d', clientRequestCounter);

    var response = {
      cmd: 'serverResponse',
      counter: message.counter
    };
    callback(response);

    if (++serverResponseCounter === NUM_REQUESTS)
      maybeCloseServer();
  }

  function sendServerRequest() {
    var request = {
      cmd: 'serverRequest',
      counter: serverRequestCounter++
    };
    channel.request(request, onClientResponse);

    if (serverRequestCounter < NUM_REQUESTS)
      setTimeout(sendServerRequest, 5);
  }

  function onClientResponse(message) {
    assert(message.cmd === 'clientResponse');
    assert(message.counter === clientResponseCounter++);

    debug('clientResponse %d', clientResponseCounter);

    if (clientResponseCounter === NUM_REQUESTS)
      maybeCloseServer();
  }

  function maybeCloseServer() {
    if (clientResponseCounter === NUM_REQUESTS &&
        serverResponseCounter === NUM_REQUESTS)
      server.stop();
  }

  channel.on('error', onError);
  sendServerRequest();

} else {
  // Child and client.
  channel = new WebsocketChannel(onServerRequest);

  function connect() {
    debug('child (re)connecting to: %s', process.env.MESH_URI);
    channel.connect(process.env.MESH_URI);
  }

  function onServerRequest(message, callback) {
    assert(message.cmd === 'serverRequest');
    assert(message.counter === serverRequestCounter++);

    debug('serverRequest %d', serverRequestCounter);

    var response = {
      cmd: 'clientResponse',
      counter: message.counter
    };
    callback(response);

    if (++clientResponseCounter === NUM_REQUESTS)
      maybeCloseClient();
  }

  function sendClientRequest() {
    if (clientRequestCounter % RECONNECT_INTERVAL === 0)
      connect();

    var request = {
      cmd: 'clientRequest',
      counter: clientRequestCounter++
    };
    channel.request(request, onServerResponse);

    if (clientRequestCounter < NUM_REQUESTS)
      setTimeout(sendClientRequest, 5);
  }

  function onServerResponse(message) {
    assert(message.cmd === 'serverResponse');
    assert(message.counter === serverResponseCounter++);

    debug('serverResponse %d', serverResponseCounter);

    if (serverResponseCounter === NUM_REQUESTS)
      maybeCloseClient();
  }

  function maybeCloseClient() {
    if (clientResponseCounter === NUM_REQUESTS &&
        serverResponseCounter === NUM_REQUESTS)
      channel.close();
  }

  channel.on('error', onError);
  connect();
  sendClientRequest();
}

function onError(err) {
  // The tolerable errors are ECONNRESET and "write after end"
  // either which may happen after the client kills the websocket
  // when it reconnects.
  assert(/write after end/i.test(err.message) ||
         err.code === 'ECONNRESET');
}
