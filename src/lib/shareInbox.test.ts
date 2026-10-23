import { describe, expect, it } from 'vitest';
import { sharedToQuickText, sharedUrlLabel, takeSharedPayload } from './shareInbox';

describe('shared lines', () => {
  it('uses the shared text as the line', () => {
    expect(sharedToQuickText({ text: 'Call Nova re proposal', title: '', url: '', at: 1 })).toBe('Call Nova re proposal');
  });

  it('collapses Android sending the same content as title and text', () => {
    expect(sharedToQuickText({ text: 'Invoice #402', title: 'Invoice #402', url: '', at: 1 })).toBe('Invoice #402');
  });

  it('joins distinct title and text', () => {
    const line = sharedToQuickText({ text: 'the body', title: 'the subject', url: '', at: 1 });
    expect(line).toBe('the subject — the body');
  });

  it('appends a link only when the words do not already contain it', () => {
    const url = 'https://example.com/deck';
    expect(sharedToQuickText({ text: 'Review deck', title: '', url, at: 1 })).toBe(`Review deck ${url}`);
    expect(sharedToQuickText({ text: `Review ${url}`, title: '', url, at: 1 })).toBe(`Review ${url}`);
  });

  it('labels a bare link when nothing else was shared', () => {
    expect(sharedToQuickText({ text: '', title: '', url: 'https://www.nova.example/pricing', at: 1 })).toBe(
      'nova.example/pricing',
    );
    expect(sharedToQuickText({ text: '', title: '', url: '', at: 1 })).toBe('');
  });

  it('turns a malformed URL into something short rather than throwing', () => {
    expect(sharedUrlLabel('not a url')).toBe('not a url');
  });
});

describe('the pending-share reader', () => {
  it('answers null when there is no cache API (plain tests) or nothing pending', async () => {
    // jsdom has no CacheStorage; the reader must degrade, not throw.
    expect(await takeSharedPayload()).toBeNull();
  });
});
