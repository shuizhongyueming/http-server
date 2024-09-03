'use strict';

const test = require('tap').test;
const ecstatic = require('../lib/core');
const http = require('http');
const path = require('path');
const request = require('request');
const { closeAndEnd } = require('./utils');

test('if-modified-since illegal access date', (t) => {
  const dir = path.join(__dirname, 'public');
  const server = http.createServer(ecstatic(dir));

  t.plan(2);

  server.listen(0, () => {
    const opts = {
      url: `http://localhost:${server.address().port}/a.txt`,
      headers: { 'if-modified-since': '275760-09-24' },
    };
    request.get(opts, (err, res) => {
      t.error(err);
      t.equal(res.statusCode, 200);
      closeAndEnd(server, t);
    });
  });
});
