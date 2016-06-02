2016-06-02, Version 2.2.3
=========================

 * package: upgrade tap to 5.x (Behnam Hajian)

 * package: upgrade ws to 1.x (Behnam Hajian)


2016-05-06, Version 2.2.2
=========================

 * update copyright notices and license (Ryan Graham)


2016-05-04, Version 2.2.1
=========================

 * package: include mock server from tests (Sam Roberts)


2016-02-18, Version 2.2.0
=========================

 * Don't unref TLS sockets on v0.10 (2) (Miroslav Bajtoš)

 * Don't unref TLS sockets on v0.10 (Miroslav Bajtoš)

 * Accept unauthorized certs for wss://localhost (Miroslav Bajtoš)

 * lint: update to eslint@1 and strongloop config (Ryan Graham)

 * move async to regular dependency (Ryan Graham)

 * Refer to licenses with a link (Sam Roberts)


2015-09-28, Version 2.1.1
=========================

 * Use strongloop conventions for licensing (Sam Roberts)

 * ws: unref the reconnect timeout timer (Sam Roberts)

 * deps: update ws to 0.8.x (Ryan Graham)


2015-07-24, Version 2.1.0
=========================

 * ws: note that server's error events are odd (Sam Roberts)

 * ws: allow channel timeout to be customized (Sam Roberts)

 * ws: allow channel.close() to take a reason (Sam Roberts)


2015-07-21, Version 2.0.0
=========================

 * ws: timeout on channel loss, to allow destroy (Sam Roberts)

 * ws: allow request with no callback (Sam Roberts)

 * ws: fix bug revealed by ws-seq-flush test (Sam Roberts)

 * test: note the ws bug triggered by ws-server-flush (Sam Roberts)

 * ws: reconnect fast on initial disconnect (Sam Roberts)

 * test: ws reconnect test server and client (Sam Roberts)

 * test: close ws instead of injecting protocol error (Sam Roberts)

 * ws: use upper-case tokens in debug msgs (Sam Roberts)

 * ws: improved debug output (Sam Roberts)

 * ws: server must flush messages on reconnect (Sam Roberts)

 * lint (Sam Roberts)

 * ws: implement disconnect handling (Sam Roberts)

 * ws: channel tokens only for session reconnect (Bert Belder)

 * channel: print longer debug message snippets (Sam Roberts)

 * Router path is mandatory (Sam Roberts)

 * Upgrade tap to v1.3.0 (Bert Belder)

 * ws: disable perMessageDeflate (Ryan Graham)

 * test: add tests for violent WS disconnects (Ryan Graham)

 * ws: fix sending of ack-only messages (Ryan Graham)

 * ws: add debug message for close() error details (Ryan Graham)

 * ws: only unschedule sending ack after sending (Ryan Graham)

 * ws: always close on detach (Ryan Graham)

 * ws: emit connect and connection from channel (Ryan Graham)

 * test: improve readability of failure message (Ryan Graham)

 * ws: add debug statements so state is debuggable (Sam Roberts)

 * test: make non-tap test output more TAP compliant (Ryan Graham)

 * test: add graceful reconnect test (Bert Belder)

 * ws: re-send queued messages on reconnect (Bert Belder)

 * ws: acknowledge all packets (Bert Belder)

 * ws: s/seqno/requestId/ (Bert Belder)

 * ws: work around connect/close race (Bert Belder)

 * Expose ws-router's path for generating URLs (Ryan Graham)

 * replace express-ws with internal router (Ryan Graham)

 * deps: upgrade to tap@1 (Ryan Graham)

 * test: make test-server(-unref) work on Windows (Bert Belder)

 * ws: remove incorrect send queue flush from _attach() (Bert Belder)


2015-06-03, Version 1.3.0
=========================

 * websocket: support router.deleteChannel() (Sam Roberts)

 * Fixes for token generation and socket disconnect (Krishna Raman)

 * Add a test ws server (Sam Roberts)

 * Api simplifications for central/executor (Sam Roberts)

 * package: add eslint and jscs dependencies (Sam Roberts)

 * cluster: fix regression caused during linting (Sam Roberts)

 * ws: doc comments (Sam Roberts)

 * ws: implement basic websocket-based control channel (Bert Belder)

 * lint: fix style issues reported by jscs (Bert Belder)

 * package: add eslint and jscs (Sam Roberts)


2015-05-20, Version 1.2.1
=========================

 * Call response callbacks asynchronously (Ryan Graham)


2015-05-08, Version 1.2.0
=========================

 * Allow Client requests to provide a callback (Ryan Graham)


2015-01-12, Version 1.1.2
=========================

 * Fix bad CLA URL in CONTRIBUTING.md (Ryan Graham)


2014-12-12, Version 1.1.1
=========================

 * package: use debug v2.x in all strongloop deps (Sam Roberts)


2014-11-03, Version 1.1.0
=========================

 * package: increment minor to reflect API addition (Sam Roberts)

 * process: fix debug message syntax error (Sam Roberts)

 * process: support notification reception (Sam Roberts)

 * process: add debug statement for notify() (Sam Roberts)

 * process: make attach() arguments optional (Sam Roberts)

 * process: add debug message when making request (Sam Roberts)


2014-10-02, Version 1.0.0
=========================

 * Update contribution guidelines (Ryan Graham)

 * Add notification support (Krishna Raman)


2014-09-02, Version 0.2.3
=========================

 * package: expand slightly on the README (Sam Roberts)


2014-08-21, Version 0.2.2
=========================

 * process: support parent/child request/response (Sam Roberts)

 * cluster: refactor ipc protocol from cluster (Sam Roberts)

 * server: add an unref() method (Sam Roberts)

 * server: add an address() method for port or path (Sam Roberts)


2014-08-05, Version 0.2.1
=========================

 * cluster: node v0.11 only emits message on process (Sam Roberts)

 * debug: limit size of json debug messages (Sam Roberts)

 * Update package license to match LICENSE.md (Sam Roberts)


2014-07-21, Version 0.2.0
=========================

 * cluster: support request/response within a cluster (Sam Roberts)


2014-07-17, Version 0.1.0
=========================

 * Add test coverage script (Sam Roberts)

 * Control channel from strong-cluster-control (Sam Roberts)

 * Initial package (Sam Roberts)


2014-07-15, Version INITIAL
===========================

 * First release!
