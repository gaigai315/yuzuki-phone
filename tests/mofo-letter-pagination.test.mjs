import assert from 'node:assert/strict';
import test from 'node:test';
import { MofoData } from '../apps/mofo/mofo-data.js';

// Exercise the renderer contract without depending on a separately distributed template.
const template = {
    htmlTemplate: `<div class="letter-mofo" data-letter-layout="ten-columns">
<section>{{#each letterFirstColumns}}<span>{{text}}</span>{{/each}}
{{#if letterHasSecondPage}}{{else}}<span class="letter-mofo-final"></span>{{/if}}</section>
{{#if letterHasSecondPage}}<section>{{#each letterSecondColumns}}<span>{{text}}</span>{{/each}}
<span class="letter-mofo-final"></span></section><label>下一页</label>{{/if}}</div>`
};
const data = new MofoData({ get: (_key, fallback) => fallback });

test('letter packs input fragments into ten columns and reserves the final column for the signature', () => {
    for (const length of [0, 150, 220, 234, 235, 260, 261, 480, 600]) {
        const original = { p1: '甲'.repeat(Math.min(length, 100)), p4: '乙'.repeat(Math.max(0, length - 100)) };
        const state = structuredClone(original);
        const result = data._compactShortLetterStateForRender(template.htmlTemplate, state);
        assert.equal(result.letterHasSecondPage, length > 234);
        assert.equal(result.letterFirstColumns.length + (result.letterHasSecondPage ? 0 : 1), 10);
        assert.equal(result.letterSecondColumns.length + 1, 10);
        assert.equal([...result.letterFirstColumns, ...result.letterSecondColumns].map(column => column.text).join(''), original.p1 + original.p4);
        if (length > 234) assert.equal(result.letterFirstColumns.map(column => column.text).join('').length, Math.min(length, 260));
        assert.deepEqual(state, original);
        const html = data.renderTemplate(template.htmlTemplate, state);
        assert.equal((html.match(/<section/g) || []).length, length > 234 ? 2 : 1);
        assert.equal((html.match(/class="letter-mofo-final"/g) || []).length, 1);
        assert.equal(html.includes('下一页'), length > 234);
    }
});

test('letter preserves Unicode characters and escapes input; other templates keep their state', () => {
    const state = { p1: '𠮷'.repeat(27), p4: '<script>内容</script>' };
    const result = data._compactShortLetterStateForRender(template.htmlTemplate, state);
    assert.equal(Array.from(result.letterFirstColumns[0].text).length, 26);
    const html = data.renderTemplate(template.htmlTemplate, state);
    assert.match(html, /&lt;script&gt;/);
    assert.doesNotMatch(html, /<script>/);
    assert.equal(data._compactShortLetterStateForRender('<div>{{p4}}</div>', state), state);
});
