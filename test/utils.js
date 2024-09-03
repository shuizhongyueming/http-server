
exports.closeAndEnd = (server, test) => {
  server.close(() => {
    setTimeout(() => {
      test.end();
    }, 100)
  });
}
