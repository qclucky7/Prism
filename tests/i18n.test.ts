import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTranslator, errorMessage, isMessage, message, MessageError } from '../shared/i18n/index.js';
import { apiErrorText } from '../shared/i18n/api.js';
import { renderStoredMessage } from '../shared/i18n/legacy.js';

test('stored messages render in the selected language without changing their parameters', () => {
  const value = message('messages.creepjsCheckFailed', 'Navigator.prototype.userAgent');
  assert.equal(createTranslator('zh-CN')(value), 'CreepJS：Navigator.prototype.userAgent 检查异常');
  assert.equal(createTranslator('en')(value), 'CreepJS: Navigator.prototype.userAgent check failed');
  assert.equal(value.params[0], 'Navigator.prototype.userAgent');
  const detail = message('findings.detailWithSource', 'failed toString', message('messages.requestFailed'));
  assert.equal(createTranslator('en')(detail), 'failed toString. Request failed');
});

test('API error text displays the server message without interpreting its code', () => {
  assert.equal(apiErrorText({ code: 'messages.ipifyReturnedHttp', params: [403], message: 'ipify returned HTTP 403' }), 'ipify returned HTTP 403');
  assert.equal(apiErrorText({ code: 'messages.ipifyReturnedHttp', params: [403] }), undefined);
  assert.deepEqual(errorMessage(new MessageError('messages.ipifyReturnedHttp', 403)), message('messages.ipifyReturnedHttp', 403));
});

test('historical snapshot text is supported while raw third-party evidence is preserved', () => {
  assert.equal(renderStoredMessage('en', '采集失败：旧记录'), 'Capture failed: 旧记录');
  assert.equal(renderStoredMessage('zh-CN', 'Mozilla/5.0 (Windows NT 10.0)'), 'Mozilla/5.0 (Windows NT 10.0)');
  assert.equal(renderStoredMessage('en', '原始浏览器自定义读数'), '原始浏览器自定义读数');
});

test('message guards reject malformed descriptors', () => {
  const failure = message('messages.ipifyReturnedHttp', 429);
  assert.equal(isMessage({ code: failure.code, params: [{ unsupported: true }] }), false);
  assert.equal(isMessage({ code: 'errors.missingKey', params: [] }), false);
});
