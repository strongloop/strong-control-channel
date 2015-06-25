var helper = require('./helper');
var server = require('../server');

var SERVER_ADDRESS = (process.platform !== 'win32')
                     ? 'a-pipe'
                     : '\\\\.\\pipe\\a-pipe';

function nop() {
  // no-op
}

helper.unlink(SERVER_ADDRESS);
server.create(nop).listen(SERVER_ADDRESS).unref();

// If server is unrefed, it should not keep node from exiting
process.on('exit', function(code) {
  console.log('%s\n1..1', code ? 'not ok' : 'ok');
});
