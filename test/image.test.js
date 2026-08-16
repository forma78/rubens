import { test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { S as DEFAULT_STATE, PRESETS } from '../src/engine/index.js';
import { renderToPng } from '../src/syndicate/render-core.js';
import { toTransmitJpeg } from '../src/syndicate/image.js';

test('toTransmitJpeg caps the longest side at 768px and outputs a JPEG', async () => {
  const png = await renderToPng(DEFAULT_STATE, PRESETS, [{}, {}, {}, {}, {}], { quality: 'preview', height: 1200 });
  const jpeg = await toTransmitJpeg(png);
  const meta = await sharp(jpeg).metadata();
  assert.equal(meta.format, 'jpeg');
  assert.ok(Math.max(meta.width, meta.height) <= 768);
  assert.ok(Math.max(meta.width, meta.height) >= 700, 'should use nearly all of the 768px budget, not shrink further');
});

test('toTransmitJpeg never upscales a smaller source', async () => {
  const png = await renderToPng(DEFAULT_STATE, PRESETS, [{}, {}, {}, {}, {}], { quality: 'preview', height: 300 });
  const before = await sharp(png).metadata();
  const jpeg = await toTransmitJpeg(png, { longestSide: 768 });
  const after = await sharp(jpeg).metadata();
  assert.ok(Math.max(after.width, after.height) <= Math.max(before.width, before.height) + 1);
});
