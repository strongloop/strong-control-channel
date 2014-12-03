// control channel encoder/decoder, common to client and server
var debug = require('./debug')('channel');
var json = require('newline-json');
var events = require('events');
var util = require('util');

exports.fromSocket = function(transport) {
  return new SocketChannel(transport);
};

exports.SocketChannel = SocketChannel;

function SocketChannel(socket) {
  var self = this;

  this.socket = socket;
  this.reader = new json.Parser;
  this.writer = new json.Stringifier;

  socket.pipe(this.reader);
  this.writer.pipe(socket);

  // Emit errors only once!
  this.errored = false;

  // Forward socket errors and read messages
  this.socket.on('error', function(er) {
    debug('socket error: %s', er);
    self.error(er);
  });

  this.reader.on('error', function(er) {
    debug('reader error: %s', er);
    self.error(er);
  });

  this.reader.on('data', function(msg) {
    debug('recv msg: %s', debug.json(msg));
    self.emit('message', msg);
  });
}

util.inherits(SocketChannel, events.EventEmitter);

SocketChannel.prototype.send = function send(msg) {
  debug('send msg: %s', debug.json(msg));
  this.writer.write(msg);
  return this;
};

SocketChannel.prototype.error = function error(err) {
  debug('channel error: %s', debug.json(err));
  if (this.errored)
    return;
  this.socket && this.socket.destroy && this.socket.destroy();
  this.errored = true;
  this.emit('error', err);
  return this;
};
