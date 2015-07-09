'use strict';

var WebsocketRouter = require('../ws-router');
var assert = require('assert');
var debug = require('../lib/debug')('test:central');
var express = require('express');
var url = require('url');


module.exports = Central;

// onRequest, requests and notifications
// onListening, called when server is listening, argument is server url
function Central(path, onRequest, onListening) {
  var self = this;

  self.app = express();
  self.server = self.app.listen(0);
  self.path = path;

  self.router = new WebsocketRouter(self.server, self.app, path);
  self.client = self.router.acceptClient(_onRequest, 'CID');
  assert.equal(self.client.getToken(), 'CID');
  self.client.on('new-channel', function(channel) {
    debug('new-channel: %s', channel.getToken());
    assert(!self.channel);
    self.channel = channel;
  });

  self.server.on('listening', function() {
    var uri = this.uri = url.format({
      protocol: 'http',
      auth: self.client.getToken(),
      hostname: '127.0.0.1',
      port: this.address().port,
      pathname: self.path,
    });
    debug('listening on %s', uri, self.client.getToken());
    assert(url.parse(uri).auth);
    onListening(uri);
  });

  function _onRequest(req, callback) {
    debug('onRequest: %j', req);
    onRequest(req, callback);
  }
}

Central.prototype.stop = function(callback) {
  this.router.close();
  this.server.close(callback);
};

Central.prototype.request = function(req, callback) {
  debug('request: %j', req);
  this.channel.request(req, function(rsp) {
    debug('response: %j', rsp);
    callback(rsp);
  });
};

Central.prototype.notify = function(req) {
  debug('notify: %j', req);
  this.channel.notify(req);
};
