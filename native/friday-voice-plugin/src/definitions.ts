export interface FridayVoiceTranscriptEvent {
  text: string;
  isFinal: boolean;
}

export interface FridayVoiceStateEvent {
  state: 'idle' | 'preparing' | 'listening' | 'processing' | 'error';
  message?: string;
}

export interface FridayVoicePlugin {
  requestMicrophonePermission(): Promise<{ granted: boolean }>;
  startListening(): Promise<{ started: boolean }>;
  stopListening(): Promise<{ text: string }>;
  getStatus(): Promise<{ state: string; text: string }>;
  addListener(
    eventName: 'transcript',
    listenerFunc: (event: FridayVoiceTranscriptEvent) => void,
  ): Promise<{ remove: () => Promise<void> }>;
  addListener(
    eventName: 'state',
    listenerFunc: (event: FridayVoiceStateEvent) => void,
  ): Promise<{ remove: () => Promise<void> }>;
}
