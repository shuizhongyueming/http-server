const { lstatSync, existsSync, mkdirSync, createWriteStream } = require('fs');
const { isAbsolute, join, dirname } = require('path');
const { createGunzip, createBrotliDecompress } = require('zlib');
const union = require('union');
const httpServerCore = require('./core');
const auth = require('basic-auth');
const { createProxyServer } = require('http-proxy');
const corser = require('corser');
const secureCompare = require('secure-compare');

/**
 * @typedef {import("connect").HandleFunction} HandleFunction
 */

/**
 * @typedef {import("http").IncomingMessage} IncomingMessage
 * @typedef {import("http").ServerResponse} ServerResponse
 * @typedef {import("https")} https
 */

/**
 * @typedef {(req: IncomingMessage, res: ServerResponse, err: Error) => void} LogFn The function that will be used for logging.
 */

/**
 * @typedef {Object} HttpServerOptions
 * @property {string} [root] The root path from which static files will be served.
 * @property {Object} [headers] The headers that will be returned with all requests.
 * @property {number} [cache] The cache time in seconds. -1 to turn off caching.
 * @property {boolean} [showDir] Show directory listings.
 * @property {boolean} [autoIndex] Auto index directories.
 * @property {boolean} [showDotfiles] Show dotfiles.
 * @property {boolean} [gzip] Gzip file contents.
 * @property {boolean} [brotli] Brotli file contents.
 * @property {string} [contentType] Default content type if not specified.
 * @property {string} [ext] Default file extension if not specified.
 * @property {HandleFunction[]} [before] Functions to run before serving a request.
 * @property {LogFn} [logFn] The function that will be used for logging.
 * @property {boolean} [cors] Enable CORS via the `corser` package.
 * @property {string} [corsHeaders] The headers that will be returned with all CORS requests.
 * @property {string | boolean} [robots] The robots.txt file to serve, or `true` to generate a robots.txt.
 * @property {string} [proxy] The URL to proxy requests to.
 * @property {https.ServerOptions} [https] The options to pass to the `https` module.
 * @property {string} [username] The username to use for basic authentication.
 * @property {string} [password] The password to use for basic authentication.
 */

/**
 * Constructor function for the HttpServer object
 * which is responsible for serving static files along
 * with other HTTP-related features.
 */
class HttpServer {
  /**
  *
  * @param {HttpServerOptions} [options] The options for the server.
  */
  constructor(options) {
    options = options || {};

    if (options.root) {
      this.root = options.root;
    } else {
      try {
        // eslint-disable-next-line no-sync
        lstatSync('./public');
        this.root = './public';
      } catch (err) {
        this.root = './';
      }
    }

    this.headers = options.headers || {};
    this.headers['Accept-Ranges'] = 'bytes';

    this.cache =
      // eslint-disable-next-line no-nested-ternary
      typeof options.cache === 'undefined'
        ? 3600
        // -1 is a special case to turn off caching.
        // https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Cache-Control#Preventing_caching
        : options.cache === -1
          ? 'no-cache, no-store, must-revalidate'
          : options.cache; // in seconds.
    this.showDir = options.showDir !== 'false';
    this.autoIndex = options.autoIndex !== 'false';
    this.showDotfiles = options.showDotfiles;
    this.gzip = options.gzip === true;
    this.brotli = options.brotli === true;
    if (options.ext) {
      this.ext = options.ext === true ? 'html' : options.ext;
    }
    this.contentType =
      options.contentType || this.ext === 'html'
        ? 'text/html'
        : 'application/octet-stream';

    var before = options.before ? options.before.slice() : [];

    if (options.logFn) {
      before.push(function (req, res) {
        options.logFn(req, res);
        res.emit('next');
      });
    }

    if (options.username || options.password) {
      before.push(function (req, res) {
        var credentials = auth(req);

        // We perform these outside the if to avoid short-circuiting and giving
        // an attacker knowledge of whether the username is correct via a timing
        // attack.
        if (credentials) {
          // if credentials is defined, name and pass are guaranteed to be string
          // type
          var usernameEqual = secureCompare(
            options.username.toString(),
            credentials.name,
          );
          var passwordEqual = secureCompare(
            options.password.toString(),
            credentials.pass,
          );
          if (usernameEqual && passwordEqual) {
            return res.emit('next');
          }
        }

        res.statusCode = 401;
        res.setHeader('WWW-Authenticate', 'Basic realm=""');
        res.end('Access denied');
      });
    }

    if (options.cors) {
      this.headers['Access-Control-Allow-Origin'] = '*';
      this.headers['Access-Control-Allow-Headers'] =
        'Origin, X-Requested-With, Content-Type, Accept, Range';
      if (options.corsHeaders) {
        options.corsHeaders.split(/\s*,\s*/).forEach(function (h) {
          this.headers['Access-Control-Allow-Headers'] += ', ' + h;
        }, this);
      }
      before.push(
        corser.create(
          options.corsHeaders
            ? {
                requestHeaders:
                  this.headers['Access-Control-Allow-Headers'].split(/\s*,\s*/),
              }
            : null,
        ),
      );
    }

    if (options.robots) {
      before.push(function (req, res) {
        if (req.url === '/robots.txt') {
          res.setHeader('Content-Type', 'text/plain');
          var robots =
            options.robots === true
              ? 'User-agent: *\nDisallow: /'
              : options.robots.replace(/\\n/, '\n');

          return res.end(robots);
        }

        res.emit('next');
      });
    }

    before.push(
      httpServerCore({
        root: this.root,
        cache: this.cache,
        showDir: this.showDir,
        showDotfiles: this.showDotfiles,
        autoIndex: this.autoIndex,
        defaultExt: this.ext,
        gzip: this.gzip,
        brotli: this.brotli,
        contentType: this.contentType,
        mimetypes: options.mimetypes,
        handleError: typeof options.proxy !== 'string',
      }),
    );

    if (typeof options.proxy === 'string') {
      var proxyOptions = options.proxyOptions || {};
      var proxy = createProxyServer(proxyOptions);

      if (typeof options.proxyCache === 'string') {
        var proxyCache = options.proxyCache;
        var proxyCacheLogFn = options.proxyCacheLogFn || function () {};
        proxy.on('proxyRes', async function (proxyRes, req, res) {
          var localFile = isAbsolute(proxyCache)
            ? proxyCache
            : join(process.cwd(), proxyCache, req.url.split('?')[0]);
          var localDir = dirname(localFile);
          if (proxyRes.statusCode !== 200) {
            proxyCacheLogFn(
              {
                status: proxyRes.statusCode,
                message: proxyRes.statusMessage,
              },
              proxyRes,
              req,
              res,
              localFile,
            );
            return;
          }
          var contentEncoding = proxyRes.headers['content-encoding'];
          if (!existsSync(localDir)) {
            mkdirSync(localDir, { recursive: true });
          }

          await new Promise((resolve, reject) => {
            var stream = createWriteStream(localFile);

            if (contentEncoding === 'gzip' || contentEncoding === 'deflate') {
              proxyRes.pipe(createGunzip()).pipe(stream);
            } else if (contentEncoding === 'br') {
              proxyRes.pipe(createBrotliDecompress()).pipe(stream);
            } else {
              proxyRes.pipe(stream);
            }

            stream.on('finish', () => {
              proxyCacheLogFn(null, proxyRes, req, res, localFile);
              resolve();
            });
            stream.on('error', (err) => {
              proxyCacheLogFn(
                {
                  status: proxyRes.statusCode,
                  message: err.message,
                },
                proxyRes,
                req,
                res,
                localFile,
              );
              reject(err);
            });
          });
        });
      }
      before.push(function (req, res) {
        proxy.web(
          req,
          res,
          {
            target: options.proxy,
            changeOrigin: true,
          },
          function (err, proxyReq, proxyRes) {
            if (options.logFn) {
              options.logFn(proxyReq, proxyRes, {
                message: err.message,
                status: proxyRes.statusCode,
              });
            }
            proxyRes.emit('next');
          },
        );
      });
    }

    var serverOptions = {
      before: before,
      headers: this.headers,
      onError: function (err, req, res) {
        if (options.logFn) {
          options.logFn(req, res, err);
        }

        res.end();
      },
    };

    if (options.https) {
      serverOptions.https = options.https;
    }

    this.server =
      serverOptions.https && serverOptions.https.passphrase
        ? // if passphrase is set, shim must be used as union does not support
          require('./shims/https-server-shim')(serverOptions)
        : union.createServer(serverOptions);

    if (typeof options.timeout !== 'undefined') {
      this.server.setTimeout(options.timeout);
    }
  }
  listen() {
    this.server.listen.apply(this.server, arguments);
  }
  close() {
    return this.server.close();
  }
}

/**
 * Returns a new instance of HttpServer with the
 * specified `options`.
 * @param {HttpServerOptions} [options] options
 * @returns {HttpServer} server
 */
function createServer(options) {
  return new HttpServer(options);
}

module.exports = {
  HttpServer,
  createServer,
}
