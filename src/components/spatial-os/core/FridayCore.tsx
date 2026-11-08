'use client';
import FridayHero from '@/components/friday/FridayHero';
type VoiceState='IDLE'|'LISTENING'|'THINKING'|'SPEAKING';
/** Spatial facade around the preserved Friday V3 voice and orb implementation. */
export function FridayCore({voiceState,audioLevel}:{voiceState:VoiceState;audioLevel:number}){
 return <FridayHero voiceState={voiceState} audioLevel={audioLevel}/>;
}
