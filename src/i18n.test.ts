import { assert, test } from 'orca/testing'
import { supportedLocales, translator } from './i18n'

test('mail UI selects Orca locale and falls back to English', () => {
 assert.equal(supportedLocales.length, 16)
 assert.equal(translator('ru-RU')('inbox'), 'Входящие')
 assert.equal(translator('en-US')('inbox'), 'Inbox')
 assert.equal(translator('zh-CN')('inbox'), '收件箱')
 assert.equal(translator('ja-JP')('send'), 'メールを送信')
 assert.equal(translator('sv-SE')('inbox'), 'Inbox')
})
