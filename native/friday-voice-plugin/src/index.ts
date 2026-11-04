import { registerPlugin } from '@capacitor/core';
import type { FridayVoicePlugin } from './definitions';

export * from './definitions';

const FridayVoice = registerPlugin<FridayVoicePlugin>('FridayVoice');

export { FridayVoice };
