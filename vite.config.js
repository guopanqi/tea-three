export default {
  // GitHub Pages serves this project from /tea-three/; keep local development at /.
  base: process.env.GITHUB_ACTIONS ? '/tea-three/' : '/',
  server: { port: 5183, host: '127.0.0.1' },
};
