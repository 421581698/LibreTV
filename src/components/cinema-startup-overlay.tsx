'use client';

export type CinemaStartupKind='vision'|'audio'|'spatial';
export type CinemaStartupRoute='enhanced'|'native';

/** Visual confirmation of a real Cinema processing state, never a Dolby badge.
 * Native-path notice is explicitly not proof of physical HDR/Atmos output. */
export function CinemaStartupOverlay({
  kind,route='enhanced',
}:{
  kind:CinemaStartupKind;
  route?:CinemaStartupRoute;
}) {
  const title=route==='native'
    ? kind==='vision'?'SAFARI NATIVE VIDEO':'SAFARI NATIVE AUDIO'
    : kind==='vision'?'CINEMA VISION':kind==='audio'?'CINEMA AUDIO':'CINEMA SPATIAL';
  const subtitle=route==='native'
    ? '原生通路已选择 · 显示与扬声器输出待真机确认'
    : kind==='vision'?'SDR 实时画质处理'
    : kind==='audio'?'PCM 动态音效处理':'虚拟 HRTF 双耳空间音效';
  return <div data-testid="cinema-startup-animation" data-cinema-startup={kind}
    data-cinema-startup-route={route} aria-hidden="true" style={{
      position:'absolute',inset:0,zIndex:18,pointerEvents:'none',
      display:'grid',placeItems:'center',overflow:'hidden',
    }}>
    <style>{`
      @keyframes cinema-intro-out {
        0%{opacity:0;transform:scale(.90)}
        15%{opacity:1;transform:scale(1.00)}
        72%{opacity:1;transform:scale(1.00)}
        100%{opacity:0;transform:scale(1.08)}
      }
      @keyframes cinema-intro-ring {
        0%{opacity:.12;transform:rotate(-15deg) scale(.72)}
        40%{opacity:1;transform:rotate(8deg) scale(1.03)}
        100%{opacity:.1;transform:rotate(18deg) scale(1.2)}
      }
      @keyframes cinema-intro-wave {
        0%,100%{transform:scaleY(.45)}
        50%{transform:scaleY(1.25)}
      }
      @media(prefers-reduced-motion:reduce){
        [data-testid="cinema-startup-animation"] *{animation:none!important}
        [data-testid="cinema-startup-animation"]{opacity:1}
      }
    `}</style>
    <div style={{
      width:'min(78vw,360px)',minHeight:170,display:'flex',flexDirection:'column',
      alignItems:'center',justifyContent:'center',gap:12,padding:20,borderRadius:24,
      background:'radial-gradient(ellipse,rgba(23,20,17,.88),rgba(0,0,0,.05) 80%)',
      color:route==='native'?'#d1d5db':'#e5c78d',textAlign:'center',
      textShadow:'0 2px 12px #000',animation:'cinema-intro-out 1.8s ease-out both',
    }}>
      {kind==='vision'?
        <div style={{width:72,height:48,border:'2px solid currentColor',borderRadius:6,
          boxShadow:'0 0 16px rgba(228,191,115,.30)',
          display:'grid',placeItems:'center',animation:'cinema-intro-ring 1.8s ease-out both'}}>
          <span style={{fontSize:24,fontWeight:700}}>V</span>
        </div>
        :kind==='audio'?
          <div style={{display:'flex',height:48,gap:7,alignItems:'center'}}>
            {[18,36,48,30,18].map((height,index)=><span key={index}
              style={{display:'block',width:5,height,borderRadius:4,
                background:'currentColor',animation:'cinema-intro-wave .5s ease-in-out infinite',
                animationDelay:`${index*.10}s`}} />)}
          </div>
          :<div style={{width:74,height:52,position:'relative',display:'grid',placeItems:'center'}}>
            <span style={{position:'absolute',inset:3,border:'2px solid currentColor',
              borderRadius:'50%',transform:'rotate(30deg)',animation:'cinema-intro-ring 1.8s ease-out both'}}/>
            <span style={{position:'absolute',inset:3,border:'2px solid currentColor',
              borderRadius:'50%',transform:'rotate(-30deg)',animation:'cinema-intro-ring 1.8s ease-out reverse both'}}/>
            <span style={{width:12,height:12,borderRadius:'50%',background:'currentColor'}}/>
          </div>}
      <strong style={{fontSize:18,letterSpacing:'.15em'}}>{title}</strong>
      <span style={{fontSize:11,letterSpacing:'.03em',opacity:.85}}>{subtitle}</span>
    </div>
  </div>;
}
