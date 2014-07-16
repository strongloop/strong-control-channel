var debug = require('debug');

module.exports = function(tag) {
  return debug('strong-control-channel:' + tag);
};
