// Copyright IBM Corp. 2014. All Rights Reserved.
// Node module: strong-control-channel
// This file is licensed under the Artistic License 2.0.
// License text available at https://opensource.org/licenses/Artistic-2.0

var fs = require('fs');
var net = require('net');

exports.unlink = function(name) {
  try {
    fs.unlinkSync(name);
  } catch (er) {
    // Don't care about errors
  }
};

exports.getUnusedPort = function(callback) {
  net.createServer().listen(0, function() {
    var port = this.address().port;
    this.close(function() {
      return callback(port);
    });
  });
};
