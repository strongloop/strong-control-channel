'use strict';

var Server = require('./mock-server');
var WebsocketChannel = require('../ws-channel');
var tap = require('tap');

var NULL_WS_PKT = new Buffer([0, 0, 0, 0]);
var server;
var wsURL;
var client;
var clients = [];

tap.test('create server', function(t) {
  server = new Server('test-control', echo('server'), onListening);
  server.client.on('new-channel', onChannel);

  function onListening(url) {
    wsURL = url;
    t.assert(wsURL, 'server is listening at ' + wsURL);
    t.end();
  }

  function onChannel(channel) {
    channel.on('connection', function(ws) {
      t.comment('new WS client:', ws._socket.remotePort, channel.getToken());
      clients.push(ws);
    });
  }
});

tap.test('create client', function(t) {
  client = WebsocketChannel.connect(echo('client'), wsURL);

  client.once('connect', function(ws) {
    t.assert(ws, 'client should connect');
    t.end();
  });
});

tap.test('sabotage first websocket', function(t) {
  sabotage(t, 1, client, clients);
});

tap.test('verify reconnected', function(t) {
  t.plan(2);
  server.request('Hello?', function(res) {
    t.equal(res, 'Hello?');
  });
  client.request('Is there anybody in there?', function(res) {
    t.equal(res, 'Is there anybody in there?');
  });
});

tap.test('sabotage second websocket', function(t) {
  sabotage(t, 2, client, clients);
});

tap.test('verify reconnected', function(t) {
  t.plan(2);
  server.request('Just nod if you can hear me.', function(res) {
    t.equal(res, 'Just nod if you can hear me.');
  });
  client.request('Is there anyone home?', function(res) {
    t.equal(res, 'Is there anyone home?');
  });
});

tap.test('sabotage third websocket', function(t) {
  sabotage(t, 3, client, clients);
});

tap.test('verify reconnected', function(t) {
  t.plan(2);
  server.request('Come on now', function(res) {
    t.equal(res, 'Come on now');
  });
  client.request('I hear you\'re feeling down.', function(res) {
    t.equal(res, 'I hear you\'re feeling down.');
  });
});

tap.test('delay', function(t) {
  t.comment('let both sides send any unsent ACKs');
  setTimeout(t.end, 100);
});

tap.test('gracefully disconnect client', function(t) {
  inspect(t, 'client', client);
  inspect(t, 'server', client);
  client.close(function(err) {
    t.ifError(err, 'should be no errors when disconnecting');
    t.end();
  });
  client.on('error', function(err) {
    console.error('client error:', err);
  });
  server.channel.on('error', function(err) {
    console.error('server error:', err);
  });
});

tap.test('shutdown server', function(t) {
  inspect(t, 'client', client);
  inspect(t, 'server', client);
  server.stop(function() {
    t.pass('server shut down');
    t.end();
  });
});

tap.test('count the bodies', function(t) {
  t.equal(clients.length, 4, 'should be 4 different connection attempts');
  t.end();
});

function echo(name) {
  return _echo;
  function _echo(req, callback) {
    console.log('# %s:', name, req);
    callback(req);
  }
}

function sabotage(t, count, client, clients) {
  var latestClient = clients[count - 1];
  t.plan(4);
  t.equal(clients.length, count, 'should be latest client');

  server.channel.once('connection', function(ws) {
    t.ok(ws, 'server side gets a new client');
  });
  client.once('connect', function(ws) {
    t.ok(ws, 'client should reconnect');
  });

  lightOnFire(t, latestClient);
}

function inspect(t, name, ch) {
  t.comment('%s => sendSeq: %j, recvAck: %j, sentAck: %j, recvSeq: %j',
            name, ch._sentSeq, ch._receivedAck, ch._sentAck, ch._receivedSeq);
}


function lightOnFire(t, ws) {
  t.assert(ws && ws._socket, 'given a socket to light on fire');
  t.comment('burning ws: %d', ws._socket.remotePort);
  // throw a bad WS frame directly onto the socket to confuse the protocol's
  // state machine.... then set it on fire.
  if (ws._socket) {
    ws._socket.end(NULL_WS_PKT);
  }
  ws.terminate();
}
