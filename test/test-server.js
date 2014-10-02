var client = require('../client');
var debug = require('./debug');
var fs = require('fs');
var helper = require('./helper');
var net = require('net');
var path = require('path');
var server = require('../server');
var tap = require('tap');

function nop() {
  // no-op
}

tap.test('pipe listen busy', function(t) {
  var addr = 'a-pipe';

  helper.unlink(addr);
  var first = server.create(nop).listen(addr);
  
  first.on('listening', function() {
    var next = server.create(nop).listen(addr);
    next.on('error', function(er) {
      t.assert(er.message, 'errored');
      first.close(function() {
        t.assert(!fs.existsSync('a-pipe'), 'pipe closed');
        t.end();
      });
    });
  });
});

tap.test('tcp listen busy', function(t) {
  var addr = 0;

  var first = server.create(nop).listen(addr);
  
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
  var addr = 'a-pipe';
  var rpc = server.create(t.fail).listen(addr);
  
  rpc.on('listening', function() {
    net.connect(addr).end('}} garbage {{\n {helo:3}\n');
  });

  rpc.on('warn', function(er) {
    t.assert(er.message, 'errored');
    rpc.close(t.end.bind(t));
  });
});

tap.test('respond error', function(t) {
  var addr = 'a-pipe';
  var rpc = server.create(onRequest).listen(addr);
  var client;
  
  rpc.on('listening', function() {
    client = net.connect(addr)
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
  var addr = 'a-pipe';

  helper.unlink(addr);
  var first = server.create(nop).listen(addr);

  first.on('listening', function() {
    t.equal(path.basename(first.address().path), addr);
    first.close(function() {
      t.end();
    });
  });
});

tap.test('tcp address', function(t) {
  var addr = 0;

  var first = server.create(nop).listen(addr);

  first.on('listening', function() {
    t.assert(first.address().port > addr);
    first.close(function() {
      t.end();
    });
  });
});

tap.test('notify multiple clients', function (t) {
  var addr = 'a-pipe';

  helper.unlink(addr);
  var srv = server.create(nop, nop).listen(addr);

  var curNotificationCnt = 0;
  srv.on('listening', function () {
    var h = setInterval(function () {
      curNotificationCnt += 1;
      srv.notify({cntr: curNotificationCnt});
    }, 500);
    srv.on('close', function () {
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

  var c1 = new client.Client(addr, nop, onNotification1);
  var c2 = new client.Client(addr, nop, onNotification2);
});
