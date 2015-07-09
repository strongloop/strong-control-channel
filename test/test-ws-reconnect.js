var Server = require('./mock-server');
var WebsocketChannel = require('../ws-channel');
var assert = require('assert');
var extend = require('util')._extend;

var isParent = process.argv[2] !== 'child';
var debug = require('debug')('strong-control-channel:test:' +
                            (isParent ? 'parent' : 'child'));

var NUM_REQUESTS = 10;
var RECONNECT_INTERVAL = 2;
var REQ_INTERVAL = 500;

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
    sendServerRequest();
  });

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
      setTimeout(sendServerRequest, REQ_INTERVAL);
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

  // TODO(sam) figure out what this is for, errors aren't emitted anymore,
  // and I'm not sure what is being asserted.
  //   channel.on('error', onError);

} else {
  process.on('disconnect', function() {
    console.error('parent died!');
    process.exit(9);
  });

  // Child and client.
  channel = WebsocketChannel.connect(onServerRequest, process.env.MESH_URI);

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
    if (clientRequestCounter && clientRequestCounter % RECONNECT_INTERVAL === 0)
      disconnectWs();

    var request = {
      cmd: 'clientRequest',
      counter: clientRequestCounter++
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
        // FIXME(sam) should not be necessary, but there are active handles,
        // fix later.
        process.exit(0);
      });
      setTimeout(function() {
        var handles = process._getActiveHandles();
        console.error('handles %j requests %j',
                    Object.keys(process._getActiveHandles()),
                    Object.keys(process._getActiveRequests()));
        console.error(typeof handles[0], handles[0]);
        console.error(typeof handles[1], handles[1]);
        console.error(typeof handles[2], handles[2]);
        assert(false, 'child should exit on channel close');
      }, 1000).unref();
    }
  }

  function disconnectWs() {
    if (channel._websocket) {
      debug('simulate error on underlying ws');
      channel._websocket.emit('error', new Error('simulated ws error'));
    } else {
      debug('skip simulated error, ws is missing');
    }
  }

  // TODO(sam) channel.on('error', onError);
  sendClientRequest();
}

/*
// FIXME bert - _handleError in WebsocketChannel reconnects for ALL errors, not
// just these two, is that intended? what is the meaning of this check?

function onError(err) {
  // The tolerable errors are ECONNRESET and "write after end"
  // either which may happen after the client kills the websocket
  // when it reconnects.
  assert.ifError(!/write after end/i.test(err.message) &&
                 err.code !== 'ECONNRESET' &&
                 err);
}
*/
