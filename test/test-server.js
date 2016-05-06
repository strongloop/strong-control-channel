// Copyright IBM Corp. 2014,2015. All Rights Reserved.
// Node module: strong-control-channel
// This file is licensed under the Artistic License 2.0.
// License text available at https://opensource.org/licenses/Artistic-2.0

var client = require('../client');
var fs = require('fs');
var helper = require('./helper');
var net = require('net');
var path = require('path');
var server = require('../server');
var tap = require('tap');

var SERVER_ADDRESS = (process.platform !== 'win32')
                     ? 'a-pipe'
                     : '\\\\.\\pipe\\a-pipe';

function nop() {
  // no-op
}

tap.test('pipe listen busy', function(t) {
  helper.unlink(SERVER_ADDRESS);
  var first = server.create(nop).listen(SERVER_ADDRESS);

  first.on('listening', function() {
    var next = server.create(nop).listen(SERVER_ADDRESS);
    next.on('error', function(er) {
      t.assert(er.message, 'errored');
      first.close(function() {
        t.assert(!fs.existsSync(SERVER_ADDRESS), 'pipe closed');
        t.end();
      });
    });
  });
});

tap.test('tcp listen busy', function(t) {
  var first = server.create(nop).listen(0);

  first.on('listening', function() {
    var port = first.server.address().port;
    var next = server.create(nop).listen(port);
    next.on('error', function(er) {
      t.assert(er.message, 'errored');
      first.close(function() {
        t.end();
      });
    });
  });
});

tap.test('receive error', function(t) {
  var rpc = server.create(t.fail).listen(SERVER_ADDRESS);

  rpc.on('listening', function() {
    net.connect(SERVER_ADDRESS).end('}} garbage {{\n {helo:3}\n');
  });

  rpc.on('warn', function(er) {
    t.assert(er.message, 'errored');
    rpc.close(t.end.bind(t));
  });
});

tap.test('respond error', function(t) {
  var rpc = server.create(onRequest).listen(SERVER_ADDRESS);
  var client;

  rpc.on('listening', function() {
    client = net.connect(SERVER_ADDRESS);
    client.write('{"cmd": "strong-control-channel:request"}\n');
  });

  function onRequest(request, callback, ch) {
    client.end();
    client.on('close', function() {
      // verify channel socket is not writeable
      ch.once('error', function() {
        // closed/errored channels should discard response, with no error
        ch.once('error', t.fail);
        process.nextTick(function() {
          rpc.close(t.end.bind(t));
        });

        callback({msg: 'bye'});
      });
      // XXX sockets emit errors synchronously, probably a node bug, so write
      // after attaching error listener
      ch.socket.write('line\n');
    });
  }
});

tap.test('pipe address', function(t) {
  helper.unlink(SERVER_ADDRESS);
  var first = server.create(nop).listen(SERVER_ADDRESS);

  first.on('listening', function() {
    t.equal(path.basename(first.address().path), 'a-pipe');
    first.close(function() {
      t.end();
    });
  });
});

tap.test('tcp address', function(t) {
  var first = server.create(nop).listen(0);

  first.on('listening', function() {
    t.assert(first.address().port !== 0);
    first.close(function() {
      t.end();
    });
  });
});

tap.test('notify multiple clients', function(t) {
  helper.unlink(SERVER_ADDRESS);
  var srv = server.create(nop, nop).listen(SERVER_ADDRESS);

  var curNotificationCnt = 0;
  srv.on('listening', function() {
    var h = setInterval(function() {
      curNotificationCnt += 1;
      srv.notify({cntr: curNotificationCnt});
    }, 500);
    srv.on('close', function() {
      clearInterval(h);
      t.end();
    });
  });

  function checkComplete() {
    if (c1._notified && c2._notified) {
      t.equal(c1._msg, c2._msg);
      srv.close();
    }
  }

  function onNotification1(data) {
    t.equal(data.cntr, curNotificationCnt);
    c1._notified = true;
    c1._msg = data.cntr;
    c1.close();
    checkComplete();
  }

  function onNotification2(data) {
    t.equal(data.cntr, curNotificationCnt);
    c2._notified = true;
    c2._msg = data.cntr;
    c2.close();
    checkComplete();
  }

  var c1 = new client.Client(SERVER_ADDRESS, nop, onNotification1);
  var c2 = new client.Client(SERVER_ADDRESS, nop, onNotification2);
});
