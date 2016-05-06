// Copyright IBM Corp. 2015. All Rights Reserved.
// Node module: strong-control-channel
// This file is licensed under the Artistic License 2.0.
// License text available at https://opensource.org/licenses/Artistic-2.0

var Server = require('./mock-server');
var WebsocketChannel = require('../ws-channel');
var assert = require('assert');
var extend = require('util')._extend;

var isParent = process.argv[2] !== 'child';
var debug = require('debug')('strong-control-channel:test:' +
                            (isParent ? 'parent' : 'child'));

var NUM_REQUESTS = 20;
var SERVER_ABORT = 3;
var CLIENT_ABORT = 5;
var REQ_INTERVAL = 100;

var clientRequestCounter = 0;
var clientResponseCounter = 0;
var serverRequestCounter = 0;
var serverResponseCounter = 0;

var channel;

process.on('exit', function(code) {
  debug('process exit: code %d', code);

  if (code !== 0)
    return;
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
  server.client.on('new-channel', function(ch) {
    channel = ch;
    channel.on('error', function(err) {
      assert.equal(err.message, 'disconnect');
    });
    sendServerRequest();
  });

  // TODO(sam) figure out what this is for, errors aren't emitted anymore,
  // and I'm not sure what is being asserted.
  //   channel.on('error', onError);

} else {
  process.on('disconnect', function() {
    console.error('parent died!');
    process.exit(9);
  });

  // Listening on the IPC channel implicitly causes it to be refed.
  process._channel.unref();

  // Child and client.
  channel = WebsocketChannel.connect(onServerRequest, process.env.MESH_URI);

  channel.on('error', function(err) {
    assert.equal(err.message, 'disconnect');
  });

  sendClientRequest();
}

function disconnectWs() {
  if (channel._websocket && channel._websocket._socket) {
    debug('cause protocol error on underlying ws');
    // XXX(sam) ws isn't robust to protocol errors, this causes random occurence
    // of the following bug when a bad buffer is sent:
    //   https://github.com/websockets/ws/issues/366
    // channel._websocket._socket.end(new Buffer([0, 0, 0, 0]));
    channel._websocket.close();
  } else {
    debug('skip simulated protocol error, ws is missing');
  }
}

function onListening(uri) {
  debug('mesh uri: %s', uri);
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
  assert(message.cmd === 'clientRequest');
  assert(message.counter === clientRequestCounter++);

  debug('clientRequest %d', clientRequestCounter);

  var response = {
    cmd: 'serverResponse',
    counter: message.counter,
  };
  callback(response);

  if (++serverResponseCounter === NUM_REQUESTS)
    maybeCloseServer();
}

function sendServerRequest() {
  var request = {
    cmd: 'serverRequest',
    counter: serverRequestCounter++,
  };
  channel.request(request, onClientResponse);

  if (serverRequestCounter < NUM_REQUESTS) {
    if (serverRequestCounter && ((serverRequestCounter % SERVER_ABORT) === 0))
      disconnectWs(channel);
    setTimeout(sendServerRequest, REQ_INTERVAL);
  }
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

function onServerRequest(message, callback) {
  assert(message.cmd === 'serverRequest');
  assert(message.counter === serverRequestCounter++);

  debug('serverRequest %d', serverRequestCounter);

  var response = {
    cmd: 'clientResponse',
    counter: message.counter,
  };
  callback(response);

  if (++clientResponseCounter === NUM_REQUESTS)
    maybeCloseClient();
}

function sendClientRequest() {
  if (clientRequestCounter && ((clientRequestCounter % CLIENT_ABORT) === 0))
    disconnectWs(channel);

  var request = {
    cmd: 'clientRequest',
    counter: clientRequestCounter++,
  };
  channel.request(request, onServerResponse);

  if (clientRequestCounter < NUM_REQUESTS)
    setTimeout(sendClientRequest, REQ_INTERVAL);
}

function onServerResponse(message) {
  assert(message.cmd === 'serverResponse');
  assert(message.counter === serverResponseCounter++);

  debug('serverResponse %d', serverResponseCounter);

  if (serverResponseCounter === NUM_REQUESTS)
    maybeCloseClient();
}

function maybeCloseClient() {
  debug('maybe close: want %d client? %d server? %d',
        NUM_REQUESTS, clientResponseCounter, serverResponseCounter);
  if (clientResponseCounter === NUM_REQUESTS &&
      serverResponseCounter === NUM_REQUESTS) {
    channel.close(function() {
      debug('channel closed');
      setTimeout(function() {
        assert(false, 'child should exit on channel close');
      }, 1000).unref();
    });
  }
}
