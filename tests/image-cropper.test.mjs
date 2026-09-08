import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync(new URL('../apps/settings/image-cropper.js', import.meta.url), 'utf8');
const moduleUrl = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const { ImageCropper } = await import(moduleUrl);

const createCropper = () => {
    const cropper = new ImageCropper({
        outputWidth: 512,
        outputHeight: 512,
        outputFormat: 'image/png'
    });
    cropper.image = {
        naturalWidth: 1200,
        naturalHeight: 1600,
        width: 300,
        height: 400
    };
    cropper.cWidth = 180;
    cropper.cHeight = 180;
    cropper.scale = 0.15;
    cropper.offsetX = 0;
    cropper.offsetY = -30;
    cropper.rotation = 0;
    return cropper;
};

test('cropper calculations prefer intrinsic image pixels over layout dimensions', () => {
    const cropper = createCropper();

    assert.deepEqual(cropper._getImageDimensions(), { width: 1200, height: 1600 });
    assert.equal(cropper._getCoverScale(), 0.15);
});

test('crop export uses the same logical transform as the preview', () => {
    const cropper = createCropper();
    const calls = [];
    const context = {
        save: () => calls.push(['save']),
        scale: (x, y) => calls.push(['scale', x, y]),
        translate: (x, y) => calls.push(['translate', x, y]),
        rotate: angle => calls.push(['rotate', angle]),
        drawImage: (...args) => calls.push(['drawImage', ...args]),
        restore: () => calls.push(['restore'])
    };
    const canvas = {
        width: 0,
        height: 0,
        getContext: () => context,
        toDataURL: () => 'data:image/png;base64,test'
    };
    const originalDocument = globalThis.document;
    globalThis.document = {
        createElement: tagName => {
            assert.equal(tagName, 'canvas');
            return canvas;
        }
    };

    try {
        assert.equal(cropper.crop(), 'data:image/png;base64,test');
    } finally {
        globalThis.document = originalDocument;
    }

    assert.deepEqual(calls[1], ['scale', 512 / 180, 512 / 180]);
    const drawCall = calls.find(call => call[0] === 'drawImage');
    assert.deepEqual(drawCall.slice(2), [0, -30, 180, 240]);
});

test('pointer movement is converted from displayed pixels to crop coordinates', () => {
    const cropper = createCropper();
    const coordinateScale = cropper._getPointerCoordinateScale({
        getBoundingClientRect: () => ({ width: 90, height: 120 })
    });

    assert.deepEqual(coordinateScale, { x: 2, y: 1.5 });
});
