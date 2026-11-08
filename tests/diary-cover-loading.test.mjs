import assert from 'node:assert/strict';
import test from 'node:test';
import { DiaryView } from '../apps/diary/diary-view.js';

const deferred = () => {
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    return { promise, resolve };
};

test('diary stylesheet readiness follows the load event and reuses the same request', async t => {
    const originalDocument = globalThis.document;
    t.after(() => {
        if (originalDocument === undefined) delete globalThis.document;
        else globalThis.document = originalDocument;
    });
    const events = {};
    const link = { addEventListener: (name, handler) => { events[name] = handler; } };
    let appended = 0;
    globalThis.document = {
        getElementById: () => null,
        createElement: () => link,
        head: { appendChild: () => { appended++; } }
    };
    const view = new DiaryView({});
    const ready = view.loadCSS();
    assert.equal(view.loadCSS(), ready);
    let loaded = false;
    ready.then(() => { loaded = true; });
    await Promise.resolve();
    assert.equal(loaded, false);
    events.load();
    await ready;
    assert.equal(loaded, true);
    assert.equal(appended, 1);
});

function setup(t, background = '/backgrounds/diary-cover.png') {
    const original = { Image: globalThis.Image, requestAnimationFrame: globalThis.requestAnimationFrame };
    const images = [];
    globalThis.Image = class {
        constructor() { images.push(this); this.decoded = deferred(); }
        decode() { return this.decoded.promise; }
    };
    globalThis.requestAnimationFrame = () => {};
    t.after(() => {
        for (const [key, value] of Object.entries(original)) {
            if (value === undefined) delete globalThis[key];
            else globalThis[key] = value;
        }
    });
    const frames = [];
    const styles = deferred();
    const view = new DiaryView({
        diaryData: { getCoverBg: () => background, getEntries: () => [] },
        phoneShell: { setContent: (html, id) => frames.push({ html, id }) }
    });
    view.loadCSS = () => styles.promise;
    view._appearanceStyle = () => '';
    return { view, images, frames, styles };
}

test('uploaded cover is not displayed until both image decoding and styles are ready', async t => {
    const { view, images, frames, styles } = setup(t);
    const rendering = view.renderCover();
    assert.equal(frames.length, 0);
    images[0].onload();
    images[0].decoded.resolve();
    await view._coverBackground.ready;
    assert.equal(frames.length, 0, 'image readiness alone must not expose an unstyled cover');
    styles.resolve();
    await rendering;
    assert.equal(frames.length, 1);
    assert.match(frames[0].html, /background-image: url\('\/backgrounds\/diary-cover.png'\)/);
    assert.doesNotMatch(frames[0].html, /class="diary-cover-title"/);
    assert.equal(frames[0].id, 'diary-cover');
    await view.renderCover();
    assert.equal(images.length, 1, 'reuse the decoded image when reopening the cover');
});

test('stylesheet readiness does not display a cover while the uploaded image is still loading', async t => {
    const { view, images, frames, styles } = setup(t);
    styles.resolve();
    const rendering = view.renderCover();
    await Promise.resolve();
    assert.equal(frames.length, 0);
    images[0].onload();
    await Promise.resolve();
    assert.equal(frames.length, 0, 'wait for decode after the image load event');
    images[0].decoded.resolve();
    await rendering;
    assert.equal(frames.length, 1);
});

test('leaving the app or opening another diary view cancels a pending cover display', async t => {
    const { view, images, frames, styles } = setup(t);
    const rendering = view.renderCover();
    view.cancelPendingCover();
    images[0].onload();
    images[0].decoded.resolve();
    styles.resolve();
    await rendering;
    assert.equal(frames.length, 0);

    const anotherRender = view.renderCover();
    view.currentView = 'toc';
    await anotherRender;
    assert.equal(frames.length, 0);
});

test('a failed image shows a usable default cover and retries the saved path next time', async t => {
    const { view, images, frames, styles } = setup(t);
    styles.resolve();
    const rendering = view.renderCover();
    images[0].onerror();
    await rendering;
    assert.equal(frames.length, 1);
    assert.match(frames[0].html, /class="diary-cover-title"/);
    assert.match(frames[0].html, /id="diary-clasp"/);
    assert.equal(view.app.diaryData.getCoverBg(), '/backgrounds/diary-cover.png');
    const retry = view.renderCover();
    assert.equal(images.length, 2);
    images[1].onload();
    images[1].decoded.resolve();
    await retry;
    assert.match(frames[1].html, /background-image:/);
});

test('a cover without an uploaded image still waits for styles and displays its default text', async t => {
    const { view, images, frames, styles } = setup(t, '');
    const rendering = view.renderCover();
    assert.equal(frames.length, 0);
    styles.resolve();
    await rendering;
    assert.equal(images.length, 0);
    assert.match(frames[0].html, /class="diary-cover-title"/);
});
