const test = require('tap').test;
const httpServer = require('../lib/http-server');
const request = require('request');
const { getPort } = require("../lib/core/get-port.js");
const fs = require('node:fs');

// Prevent errors from being swallowed
process.on('uncaughtException', console.error);

const requestGetPromise = (options) => new Promise((resolve, reject) => {
  request.get(options, (err, res, body) => {
    if (err) {
      reject(err);
    } else {
      if (res.statusCode !== 200) {
        reject({statusCode: res.statusCode});
      } else {
        resolve(res);
      }
    }
  });
});

test('proxy with headerKeyForProxyUrl', async (t) => {
  // Create a mock target server
  const targetServer = httpServer.createServer({
    root: __dirname + '/public'
  });

  const targetPort = await getPort();
  await new Promise(resolve => targetServer.listen(targetPort, resolve));

  // Create a proxy server
  const proxyServer = httpServer.createServer({
    root: __dirname + '/public',
    proxy: `http://localhost:${targetPort}`,
    headerKeyForProxyUrl: 'x-proxy-url',
  });

  const proxyPort = await getPort();
  await new Promise(resolve => proxyServer.listen(proxyPort, resolve));

  try {
    // Test 1: Basic proxying with headerKeyForProxyUrl
    const response1 = await requestGetPromise({
      uri: `http://localhost:${proxyPort}/variant-b.txt`,
      headers: {
        'x-proxy-url': '/b.txt'
      },
      resolveWithFullResponse: true,
    });

    const bContent = fs.readFileSync(__dirname + '/public/b.txt', 'utf8');

    t.equal(response1.statusCode, 200, 'Response status should be 200');
    t.equal(response1.body.trim(), bContent.trim(), 'Should receive content from /b.txt');

    // Test 2: Proxy without the header (should use original path)
    const response2 = await requestGetPromise({
      uri: `http://localhost:${proxyPort}/a.txt`,
      resolveWithFullResponse: true
    });

    const aContent = fs.readFileSync(__dirname + '/public/a.txt', 'utf8');

    t.equal(response2.statusCode, 200, 'Response status should be 200');
    t.equal(response2.body.trim(), aContent.trim(), 'Should receive content from /a.txt');

    // Test 3: Proxy with non-existent path in header
    try {
      await requestGetPromise({
        uri: `http://localhost:${proxyPort}/some-non-existent-file.txt`,
        headers: {
          'x-proxy-url': '/another-non-existent-file.txt'
        }
      });
      t.fail('Should throw an error for non-existent file');
    } catch (error) {
      t.equal(error.statusCode, 404, 'Should return 404 for non-existent file');
    }
  } catch (error) {
    t.error(error, 'No error should be thrown');
  } finally {
    await new Promise(resolve => proxyServer.close(resolve));
    await new Promise(resolve => targetServer.close(resolve));
  }
});
