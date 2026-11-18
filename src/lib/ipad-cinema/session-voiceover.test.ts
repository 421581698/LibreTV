import { describe, expect, it } from 'vitest';
import { createSession, enterDetail, setVoiceOverState } from './session';
describe('VoiceOver session state', () => {
  it('updates accessibility state without changing navigation or player state', () => {
    const initial = enterDetail(createSession(), 'douban::123').session;
    const next = setVoiceOverState(initial, 'running').session;
    expect(next.voiceOver).toBe('running');
    expect(next.page).toEqual(initial.page);
    expect(next.stack).toEqual(initial.stack);
    expect(next.player).toBe(initial.player);
  });
  it('returns the original session for an unchanged state', () => {
    const initial = createSession();
    expect(setVoiceOverState(initial, 'unknown').session).toBe(initial);
  });
});
