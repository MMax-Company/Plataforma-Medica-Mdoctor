#!/usr/bin/env node
'use strict';

const assert = require('assert');
const {
  extensionFromMime,
  isAlreadyStoredInBucket,
  isHttpUrl,
  validateBuffer,
  getBucketName
} = require('../src/services/previous-prescription-storage.service');

function run() {
  assert.strictEqual(isHttpUrl('https://typebot.io/file.jpg'), true);
  assert.strictEqual(isHttpUrl('not-a-url'), false);

  assert.strictEqual(
    isAlreadyStoredInBucket({
      fileUrl: 'https://xxx.supabase.co/storage/v1/object/sign/receitas-anteriores/atendimentos/a/rx.jpg'
    }),
    true
  );
  assert.strictEqual(isAlreadyStoredInBucket({ fileUrl: 'https://cdn.typebot.io/tmp.jpg' }), false);

  const buf = Buffer.from('fake-image');
  assert.throws(() => validateBuffer(buf, 'image/gif'), /não permitido/);
  assert.doesNotThrow(() => validateBuffer(buf, 'image/jpeg'));

  assert.strictEqual(extensionFromMime('image/png'), 'png');
  assert.strictEqual(extensionFromMime('application/pdf'), 'pdf');
  assert.strictEqual(getBucketName(), 'receitas-anteriores');

  console.log('test-previous-prescription-storage: OK');
}

run();
