// Copyright IBM Corp. 2015,2016. All Rights Reserved.
// Node module: strong-control-channel
// This file is licensed under the Artistic License 2.0.
// License text available at https://opensource.org/licenses/Artistic-2.0

'use strict';

var WebsocketRouter = require('../ws-router');
var assert = require('assert');
var debug = require('../lib/debug')('test:central');
var express = require('express');
var fs = require('fs');
var url = require('url');


module.exports = Central;

// onRequest, requests and notifications
// onListening, called when server is listening, argument is server url
function Central(path, onRequest, onListening, options) {
  var self = this;
  options = options || {};

  self.app = express();
  self.path = path;
  if (self.path[0] !== '/') self.path = '/' + self.path;

  if (options.proto === 'wss') {
    self.server = require('https').createServer({
      key: fs.readFileSync(require.resolve('./fixtures/server-key.pem')),
      cert: fs.readFileSync(require.resolve('./fixtures/server-cert.pem')),
    }, self.app);
    self.server.listen(0);
  } else {
    options.proto = 'http';
    self.server = self.app.listen(0);
  }

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
      protocol: options.proto,
      auth: self.client.getToken(),
      hostname: options.hostname || '127.0.0.1',
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
