const request = require('request');
const { closeAndEnd } = require('./utils');

module.exports = (t, server, path, check) => {
  server.listen(() => {
    const port = server.address().port;
    const uri = `http://localhost:${port}/${path}`;

    request.get({ uri }, (err, res) => {
      t.error(err);
      t.equal(res.statusCode, 200);
      check(t, res.headers);

      closeAndEnd(server, t);
    });
  });
}
