const path = require('node:path');
process.env.TUBEVRA_TEST_RESULT = path.resolve(
  'out/verification/adblock/result.json',
);
require('../../out/verification/adblock/build/main.cjs');
