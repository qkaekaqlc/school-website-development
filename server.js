const app = require('./app');
const { init } = require('./db');

init().then(() => {
  const port = process.env.PORT || 3000;
  app.listen(port, () => console.log(`http://localhost:${port}`));
});
