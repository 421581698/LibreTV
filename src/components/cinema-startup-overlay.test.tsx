import {describe,expect,it} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {CinemaStartupOverlay} from './cinema-startup-overlay';

describe('Cinema independent verified startup animations',()=>{
  it.each([
    ['vision','CINEMA VISION'],
    ['audio','CINEMA AUDIO'],
    ['spatial','CINEMA SPATIAL'],
  ] as const)('renders independent %s overlay without claiming licensed Dolby output',(kind,title)=>{
    const markup=renderToStaticMarkup(<CinemaStartupOverlay kind={kind}/>);
    expect(markup).toContain(`data-cinema-startup="${kind}"`);
    expect(markup).toContain('data-cinema-startup-route="enhanced"');
    expect(markup).toContain(title);
    expect(markup).not.toContain('DOLBY');
    expect(markup).toContain('pointer-events:none');
    expect(markup).toContain('prefers-reduced-motion');
  });
  it('explicitly distinguishes native Safari video from actual Dolby output',()=>{
    const markup=renderToStaticMarkup(<CinemaStartupOverlay kind="vision" route="native"/>);
    expect(markup).toContain('SAFARI NATIVE VIDEO');
    expect(markup).toContain('显示与扬声器输出待真机确认');
    expect(markup).not.toContain('CINEMA VISION');
  });
});
