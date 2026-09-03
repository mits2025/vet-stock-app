const test = require('node:test')
const assert = require('node:assert/strict')
const { isNewerVersion } = require('../electron/update-utils.cjs')

test('desktop updater identifies newer semantic versions', () => {
  assert.equal(isNewerVersion('1.0.1', '1.0.0'), true)
  assert.equal(isNewerVersion('1.10.0', '1.9.9'), true)
  assert.equal(isNewerVersion('1.0.0', '1.0.0'), false)
  assert.equal(isNewerVersion('0.9.9', '1.0.0'), false)
})
